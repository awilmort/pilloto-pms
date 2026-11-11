/**
 * Monthly charges: what each tenant owes Pilloto for a month — its subscription(s) plus the
 * e-invoicing statement. A charge is an amount to collect, not a fiscal document; the e-CF is
 * issued when a payment is recorded (see billingPayments).
 *
 * Charges are generated for the month that just ended (arrears), once per tenant and month, and
 * the run is idempotent: running it again, or after the server was down, creates only what is
 * missing.
 */
import { Types } from 'mongoose';
import { tenantLocalStorage } from '../../middleware/tenantContext';
import BillingCharge, { IBillingCharge, IBillingChargeLine } from '../../models/BillingCharge';
import BillingPayment from '../../models/BillingPayment';
import { nextSequence } from '../../models/Counter';
import FiscalStatement, { IFiscalStatement } from '../../models/FiscalStatement';
import Tenant, { ITenant } from '../../models/Tenant';
import { sendEmail } from '../../utils/email';
import { dominicanDate, dominicanPeriod, FiscalError, previousPeriod } from '../fiscal/fiscalCore';
import { closeStatement } from '../fiscal/fiscalStatements';
import { getPlatformSettings } from '../fiscal/platformIssuer';
import { addDays, chargeTotals, discountAmount, isPeriod, periodLabelEs, round2 } from './billingMath';
import { proration } from './billingMath';
import { ResolvedContract, resolveContracts } from './billingContracts';

const PRODUCT_NAME = { pms: 'Pilloto PMS', accounting: 'Pilloto Accounting' } as const;
const FISCAL_PLAN_NAME: Record<string, string> = { essential: 'Esencial', pro: 'Pro', max: 'Max' };

const money = (n: number) => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(n);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function nextChargeNumber(): Promise<string> {
  const seq = await tenantLocalStorage.run(null, () => nextSequence('billingCharge'));
  return `COB-${String(seq).padStart(6, '0')}`;
}

/** The subscription lines of a charge: one per product, prorated in the tenant's first month. */
export function subscriptionLines(contracts: ResolvedContract[], period: string, startedAt: Date): IBillingChargeLine[] {
  const share = proration(period, startedAt);
  return contracts
    .filter((c) => c.price > 0)
    .map((c) => {
      const base = round2(c.price * share);
      const off = c.discount ? discountAmount(base, c.discount, share) : 0;
      const discountNote = c.discount && off > 0 ? `, descuento ${c.discount.type === 'percent' ? `${c.discount.value}%` : money(c.discount.value)}` : '';
      return {
        kind: 'subscription' as const,
        product: c.product,
        description: `Suscripción ${PRODUCT_NAME[c.product]} — plan ${c.plan} (${periodLabelEs(period)})${share < 1 ? `, proporcional ${Math.round(share * 100)}%` : ''}${discountNote}`,
        amount: round2(base - off),
        ...(share < 1 ? { proration: share } : {}),
        ...(c.discount && off > 0 ? { discount: { type: c.discount.type, value: c.discount.value, amount: off } } : {}),
      };
    })
    .filter((l) => l.amount > 0);
}

/** The e-invoicing lines of a charge, from the month's closed statement. */
export function statementLines(statement: Pick<IFiscalStatement, 'plan' | 'includedPlan' | 'planCharge' | 'overageAmount' | 'overageUnitPrice' | 'transactions'>, period: string): IBillingChargeLine[] {
  const lines: IBillingChargeLine[] = [];
  const plan = FISCAL_PLAN_NAME[statement.plan] ?? statement.plan;
  if (statement.planCharge > 0) {
    lines.push({
      kind: 'fiscal_plan',
      description: statement.includedPlan
        ? `Facturación electrónica — plan ${plan}, diferencia sobre el plan incluido (${periodLabelEs(period)})`
        : `Facturación electrónica — plan ${plan} (${periodLabelEs(period)})`,
      amount: round2(statement.planCharge),
    });
  }
  if (statement.overageAmount > 0) {
    lines.push({
      kind: 'fiscal_overage',
      description: `Facturación electrónica — ${statement.transactions.extra} documentos adicionales × ${money(statement.overageUnitPrice)} (${periodLabelEs(period)})`,
      amount: round2(statement.overageAmount),
    });
  }
  return lines;
}

export interface GenerateOptions {
  now?: Date;
  /** Email the tenant about the new charge. */
  notify?: boolean;
  actorEmail?: string;
}

export interface GenerateResult {
  /** Null when the tenant owes nothing for the period. */
  charge: IBillingCharge | null;
  created: boolean;
  reason?: 'exists' | 'nothing_to_charge' | 'before_start';
}

/** The tenant's closed (or closable) statement for `period`, or null when it has none to charge. */
async function statementFor(tenant: ITenant, period: string, now: Date): Promise<IFiscalStatement | null> {
  let statement: IFiscalStatement | null = await FiscalStatement.findOne({ tenantId: tenant._id, period });
  const hadFiscal = Boolean(tenant.fiscal?.organizationId && tenant.fiscal.provisionedAt && dominicanPeriod(tenant.fiscal.provisionedAt) <= period);
  if (hadFiscal && (!statement || statement.status === 'open')) {
    // The month is over: its figures must exist and be final before they are charged.
    try {
      statement = await closeStatement(tenant, period, now);
    } catch (err: any) {
      throw new FiscalError(503, 'BILLING_STATEMENT_PENDING', `The e-invoicing statement for ${period} could not be closed yet: ${err?.message}`);
    }
  }
  if (!statement || statement.status === 'open' || statement.status === 'void' || statement.status === 'paid') return null;
  return statement;
}

export async function generateCharge(tenant: ITenant, period: string, options: GenerateOptions = {}): Promise<GenerateResult> {
  const now = options.now ?? new Date();
  if (!isPeriod(period)) throw new FiscalError(400, 'BILLING_INVALID', 'Choose a month (YYYY-MM)', { period: 'Mes inválido' });
  if (period > previousPeriod(dominicanPeriod(now))) {
    throw new FiscalError(409, 'BILLING_PERIOD_OPEN', 'A month can only be charged once it has ended', { period: 'El mes no ha terminado' });
  }
  if (period < dominicanPeriod(tenant.createdAt)) return { charge: null, created: false, reason: 'before_start' };

  const existing = await BillingCharge.findOne({ tenantId: tenant._id, period, status: { $ne: 'void' } });
  if (existing) return { charge: existing, created: false, reason: 'exists' };

  const settings = await getPlatformSettings();
  const contracts = await resolveContracts(tenant, period);
  const statement = await statementFor(tenant, period, now);
  const lines = [...subscriptionLines(contracts, period, tenant.createdAt), ...(statement ? statementLines(statement, period) : [])];
  if (lines.length === 0) return { charge: null, created: false, reason: 'nothing_to_charge' };

  const tax = settings.billing?.tax ?? 'itbis18';
  const totals = chargeTotals(lines.map((l) => l.amount), tax);
  if (totals.total <= 0) return { charge: null, created: false, reason: 'nothing_to_charge' };

  let charge: IBillingCharge;
  try {
    charge = await BillingCharge.create({
      tenantId: tenant._id,
      number: await nextChargeNumber(),
      period,
      lines,
      subtotal: totals.subtotal,
      tax,
      itbis: totals.itbis,
      total: totals.total,
      paidAmount: 0,
      balance: totals.total,
      status: 'open',
      dueDate: addDays(dominicanDate(now), settings.billing?.dueDays ?? 10),
      ...(statement ? { fiscalStatementId: statement._id } : {}),
      createdBy: options.actorEmail ?? 'system',
    });
  } catch (err: any) {
    // Two runs at once: the other one saved first.
    if (err?.code === 11000) {
      const raced = await BillingCharge.findOne({ tenantId: tenant._id, period, status: { $ne: 'void' } });
      if (raced) return { charge: raced, created: false, reason: 'exists' };
    }
    throw err;
  }

  if (options.notify !== false) await notifyCharge(charge, tenant, settings.billing?.paymentInstructions);
  return { charge, created: true };
}

/** Tells the tenant what it owes and how to pay. Failing to send never fails the charge. */
export async function notifyCharge(charge: IBillingCharge, tenant: Pick<ITenant, '_id' | 'ownerEmail' | 'name' | 'billing'>, instructions?: string): Promise<boolean> {
  const to = tenant.billing?.billingEmail || tenant.ownerEmail;
  if (!to) return false;
  try {
    await sendEmail({
      to,
      subject: `[Pilloto] Cobro ${charge.number} — ${periodLabelEs(charge.period)}`,
      html:
        `<p>Hola,</p><p>Este es el detalle de su suscripción a Pilloto correspondiente a <strong>${periodLabelEs(charge.period)}</strong>.</p>` +
        `<table cellpadding="6" style="border-collapse:collapse">` +
        charge.lines.map((l) => `<tr><td>${esc(l.description)}</td><td align="right">${money(l.amount)}</td></tr>`).join('') +
        `<tr><td align="right">Subtotal</td><td align="right">${money(charge.subtotal)}</td></tr>` +
        (charge.itbis > 0 ? `<tr><td align="right">ITBIS</td><td align="right">${money(charge.itbis)}</td></tr>` : '') +
        `<tr><td align="right"><strong>Total a pagar</strong></td><td align="right"><strong>${money(charge.total)}</strong></td></tr></table>` +
        `<p><strong>Fecha límite:</strong> ${charge.dueDate.split('-').reverse().join('/')}</p>` +
        (instructions ? `<p><strong>Cómo pagar:</strong><br>${esc(instructions).replace(/\n/g, '<br>')}</p>` : '') +
        `<p>Al recibir su pago le enviaremos el comprobante fiscal electrónico (e-CF) por este medio.</p>`,
      _logMeta: { emailType: 'billing_charge', referenceId: String(charge._id) },
    });
    await BillingCharge.updateOne({ _id: charge._id }, { $set: { notifiedAt: new Date() } });
    return true;
  } catch (err: any) {
    console.warn(`[Billing] Could not email charge ${charge.number}: ${err?.message}`);
    return false;
  }
}

export interface RunSummary {
  period: string;
  created: number;
  existing: number;
  skipped: number;
  failed: number;
}

/**
 * Generates last month's charge for every tenant that does not have one yet. Idempotent. A tenant
 * whose statement cannot be closed yet (BillingSoft unreachable) is left for the next run.
 */
export async function runMonthlyBilling(now = new Date()): Promise<RunSummary> {
  const period = previousPeriod(dominicanPeriod(now));
  const summary: RunSummary = { period, created: 0, existing: 0, skipped: 0, failed: 0 };
  const tenants = await Tenant.find({ isActive: true, 'billing.paused': { $ne: true } });
  for (const tenant of tenants) {
    try {
      const result = await generateCharge(tenant, period, { now, notify: true });
      if (result.created) summary.created++;
      else if (result.reason === 'exists') summary.existing++;
      else summary.skipped++;
    } catch (err: any) {
      summary.failed++;
      console.warn(`[Billing] Could not charge tenant ${tenant._id} for ${period}: ${err?.message}`);
    }
  }
  return summary;
}

/** Cancels a charge nobody has paid (an error in it, or a tenant that should not be charged). */
export async function voidCharge(chargeId: string | Types.ObjectId, reason: string, actor: { email?: string }, now = new Date()): Promise<IBillingCharge> {
  const text = (reason ?? '').trim();
  if (text.length < 5) throw new FiscalError(400, 'BILLING_INVALID', 'A reason is required', { reason: 'Requerido' });
  const charge = await BillingCharge.findById(chargeId);
  if (!charge) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Charge not found');
  if (charge.status === 'void') throw new FiscalError(409, 'BILLING_STATE', 'This charge is already void');
  const live = await BillingPayment.countDocuments({ chargeId: charge._id, status: 'recorded' });
  if (live > 0) {
    throw new FiscalError(409, 'BILLING_STATE', 'This charge has payments. Reverse them first.');
  }
  const updated = await BillingCharge.findOneAndUpdate(
    { _id: charge._id, status: { $ne: 'void' } },
    { $set: { status: 'void', isCurrent: false, voidedAt: now, voidReason: `${text}${actor.email ? ` (${actor.email})` : ''}`.slice(0, 500) } },
    { new: true },
  );
  if (!updated) throw new FiscalError(409, 'BILLING_STATE', 'This charge changed; reload it');
  return updated;
}

/** True once `dueDate` has passed (Dominican time) with something still owed. */
export function isOverdue(charge: Pick<IBillingCharge, 'status' | 'dueDate' | 'balance'>, now = new Date()): boolean {
  return (charge.status === 'open' || charge.status === 'partial') && charge.balance > 0 && charge.dueDate < dominicanDate(now);
}
