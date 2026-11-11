/**
 * Monthly statements: what each tenant owes for electronic invoicing — the BillingSoft plan on top
 * of what its Pilloto plan includes, plus each transaction beyond the plan's allowance.
 *
 * A statement is `open` while the month runs (refreshed from BillingSoft's usage), `closed` on the
 * 1st of the next month — after which its figures never change — and then `paid` or `void`. The
 * payment integration only ever moves a `closed` statement on to `paid`.
 */
import { Types } from 'mongoose';
import { includedFiscalPlan } from '../../config/fiscal';
import FiscalStatement, { IFiscalStatement } from '../../models/FiscalStatement';
import Tenant, { FiscalPlan, ITenant } from '../../models/Tenant';
import { BillingSoftError } from './billingsoftClient';
import { getBillingSoftClient } from './fiscalClient';
import { dominicanPeriod, FiscalError, periodBounds, previousPeriod } from './fiscalCore';
import { getPlanCatalog, planCharge, statementFigures } from './fiscalPlans';

function figuresFields(figures: ReturnType<typeof statementFigures>) {
  return {
    plan: figures.plan,
    ...(figures.includedPlan ? { includedPlan: figures.includedPlan } : {}),
    planPrice: figures.planPrice,
    includedPlanPrice: figures.includedPlanPrice,
    planCharge: figures.planCharge,
    transactions: { included: figures.transactions, used: figures.used, extra: figures.extra },
    overageUnitPrice: figures.overageUnitPrice,
    overageAmount: figures.overageAmount,
    total: figures.total,
  };
}

/** Refreshes (creating it if needed) the open statement of the current month from BillingSoft's usage. */
export async function snapshotUsage(tenant: ITenant, now = new Date()): Promise<IFiscalStatement | null> {
  const organizationId = tenant.fiscal?.organizationId;
  if (!organizationId) return null;
  const period = dominicanPeriod(now);
  const [subscription, catalog] = await Promise.all([
    getBillingSoftClient().subscription(organizationId),
    getPlanCatalog(now.getTime()),
  ]);
  const charge = planCharge(catalog, tenant.fiscal!.plan, includedFiscalPlan(tenant));
  const figures = statementFigures(charge, subscription.transactions.used);
  try {
    return await FiscalStatement.findOneAndUpdate(
      { tenantId: tenant._id, period, status: 'open' },
      {
        $set: { ...figuresFields(figures), usageSource: 'billingsoft', lastSnapshotAt: now },
        $setOnInsert: { tenantId: tenant._id, period, currency: 'DOP', status: 'open', planChanges: [] },
      },
      { upsert: true, new: true },
    );
  } catch (err: any) {
    // The month's statement is already closed: nothing to refresh.
    if (err?.code === 11000) return FiscalStatement.findOne({ tenantId: tenant._id, period });
    throw err;
  }
}

/** Notes a plan change on the month's statement. Best effort: the change itself has already happened. */
export async function recordPlanChange(tenant: ITenant, from: FiscalPlan, to: FiscalPlan, now = new Date()): Promise<void> {
  try {
    const statement = await snapshotUsage(tenant, now);
    if (statement && statement.status === 'open') {
      await FiscalStatement.updateOne({ _id: statement._id }, { $push: { planChanges: { from, to, at: now } } });
    }
  } catch (err: any) {
    console.warn(`[Fiscal] Could not note the plan change on the statement for tenant ${tenant._id}: ${err?.message}`);
  }
}

/**
 * Closes `period` for the tenant. BillingSoft only reports the current month, so for a past month
 * the figures come from BillingSoft when it can answer for that month, else from the last snapshot
 * checked against the number of documents it holds for the month (never less than either).
 */
export async function closeStatement(tenant: ITenant, period: string, now = new Date()): Promise<IFiscalStatement> {
  const organizationId = tenant.fiscal?.organizationId;
  if (!organizationId) throw new FiscalError(409, 'FISCAL_NOT_ACTIVATED', 'Electronic invoicing is not activated');
  const existing = await FiscalStatement.findOne({ tenantId: tenant._id, period });
  if (existing && existing.status !== 'open') return existing;

  const client = getBillingSoftClient();
  const catalog = await getPlanCatalog(now.getTime());

  let used = existing?.transactions.used ?? 0;
  let source: IFiscalStatement['usageSource'] = existing ? 'snapshot' : 'documents';
  try {
    const subscription = await client.subscription(organizationId, period);
    if (dominicanPeriod(new Date(subscription.period.start)) === period) {
      used = subscription.transactions.used;
      source = 'billingsoft';
    } else {
      const { from, to } = periodBounds(period);
      const documents = await client.listDocuments(organizationId, { from, to });
      if (documents.total > used) {
        used = documents.total;
        source = 'documents';
      }
    }
  } catch (err) {
    if (!(err instanceof BillingSoftError)) throw err;
    // BillingSoft cannot be asked now; a statement with no figures at all would be wrong, so wait.
    if (!existing) throw new FiscalError(503, 'BILLINGSOFT_UNREACHABLE', err.message);
  }

  const plan = existing?.plan ?? tenant.fiscal!.plan;
  const included = existing ? existing.includedPlan ?? null : includedFiscalPlan(tenant);
  const figures = statementFigures(planCharge(catalog, plan, included), used);
  const closed = await FiscalStatement.findOneAndUpdate(
    { tenantId: tenant._id, period, status: { $in: ['open'] } },
    {
      $set: { ...figuresFields(figures), usageSource: source, status: 'closed', closedAt: now },
      $setOnInsert: { tenantId: tenant._id, period, currency: 'DOP', planChanges: [] },
    },
    { upsert: true, new: true },
  );
  return closed!;
}

/** True while the previous month's statement is not closed, so a plan change must wait. */
export async function hasUnclosedPreviousPeriod(tenant: ITenant, now = new Date()): Promise<boolean> {
  const previous = previousPeriod(dominicanPeriod(now));
  if (!tenant.fiscal?.provisionedAt || dominicanPeriod(tenant.fiscal.provisionedAt) > previous) return false;
  const statement = await FiscalStatement.findOne({ tenantId: tenant._id, period: previous }).select('status');
  return !statement || statement.status === 'open';
}

/** Closes last month for every tenant that had electronic invoicing then. Returns how many it closed. */
export async function closeDuePeriods(now = new Date()): Promise<number> {
  const previous = previousPeriod(dominicanPeriod(now));
  const tenants = await Tenant.find({ 'fiscal.organizationId': { $exists: true } });
  let closed = 0;
  for (const tenant of tenants) {
    if (await hasUnclosedPreviousPeriod(tenant, now)) {
      try {
        await closeStatement(tenant, previous, now);
        closed++;
      } catch (err: any) {
        console.warn(`[Fiscal] Could not close ${previous} for tenant ${tenant._id}: ${err?.message}`);
      }
    }
  }
  return closed;
}

/** Refreshes the open statement of every active tenant. */
export async function snapshotAllUsage(now = new Date()): Promise<number> {
  const tenants = await Tenant.find({ 'fiscal.organizationId': { $exists: true }, 'fiscal.isActive': true });
  let refreshed = 0;
  for (const tenant of tenants) {
    try {
      if (await snapshotUsage(tenant, now)) refreshed++;
    } catch (err: any) {
      console.warn(`[Fiscal] Could not read the usage of tenant ${tenant._id}: ${err?.message}`);
    }
  }
  return refreshed;
}

// ─── What the payment integration (and the platform console) do ─────────────

export async function markStatementPaid(
  tenantId: Types.ObjectId | string,
  period: string,
  payment: { reference?: string; method?: string },
  now = new Date(),
): Promise<IFiscalStatement> {
  const updated = await FiscalStatement.findOneAndUpdate(
    { tenantId, period, status: 'closed' },
    { $set: { status: 'paid', paidAt: now, payment } },
    { new: true },
  );
  if (!updated) throw new FiscalError(409, 'FISCAL_STATEMENT_STATE', 'Only a closed statement can be marked as paid');
  return updated;
}

export async function voidStatement(
  tenantId: Types.ObjectId | string,
  period: string,
  reason: string,
): Promise<IFiscalStatement> {
  if (!reason.trim()) throw new FiscalError(400, 'FISCAL_REJECTED', 'A reason is required', { reason: 'Requerido' });
  const updated = await FiscalStatement.findOneAndUpdate(
    { tenantId, period, status: { $in: ['open', 'closed'] } },
    { $set: { status: 'void', voidReason: reason.trim() } },
    { new: true },
  );
  if (!updated) throw new FiscalError(409, 'FISCAL_STATEMENT_STATE', 'This statement cannot be voided');
  return updated;
}
