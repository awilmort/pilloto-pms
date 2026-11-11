/**
 * What a tenant pays for each product it has, fixed in `Tenant.billing.contracts`.
 *
 *  - The contract takes the list price when it is first needed and again when the tenant's plan
 *    changes — so editing the price list never reaches an existing customer.
 *  - A platform operator can schedule a different price for a tenant from a given period (with a
 *    reason, which is emailed to the tenant). The charge for that period is the first at the new
 *    price. It lasts until the tenant's plan changes, which re-prices it at the list.
 */
import { Types } from 'mongoose';
import Tenant, { BILLING_PRODUCTS, BillingProduct, ITenant, ITenantContract, ITenantDiscount } from '../../models/Tenant';
import { dominicanPeriod, FiscalError, previousPeriod } from '../fiscal/fiscalCore';
import { isPeriod, round2 } from './billingMath';
import { getPlatformSettings } from '../fiscal/platformIssuer';
import { listPrice, validatePrice } from './billingPlans';
import { sendEmail } from '../../utils/email';
import { periodLabelEs } from './billingMath';

export interface ResolvedContract {
  product: BillingProduct;
  plan: string;
  price: number;
  source: ITenantContract['source'];
  /** The discount in force for the period, when there is one. */
  discount?: { type: 'percent' | 'amount'; value: number };
}

/** True when `discount` covers `period` (`YYYY-MM`, compared as text). */
export const discountCovers = (discount: Pick<ITenantDiscount, 'effectiveFrom' | 'effectiveUntil'>, period: string): boolean =>
  discount.effectiveFrom <= period && (!discount.effectiveUntil || period <= discount.effectiveUntil);

/** The discount granted on `product` that covers `period` (grants never overlap, so at most one). */
export const discountFor = (tenant: Pick<ITenant, 'billing'>, product: BillingProduct, period: string): ITenantDiscount | undefined =>
  (tenant.billing?.discounts ?? []).find((d) => d.product === product && discountCovers(d, period));

/** The plan the tenant is on for `product`, or undefined when it does not have the product. */
export function planOf(tenant: Pick<ITenant, 'products' | 'plan' | 'plans'>, product: BillingProduct): string | undefined {
  if (!tenant.products?.includes(product)) return undefined;
  return product === 'pms' ? tenant.plan : tenant.plans?.accounting;
}

/**
 * The contract of each product the tenant has, for charging `period`: snapshots the list price
 * where there is none (or the plan changed) and applies scheduled price changes that are due.
 * Persists what it changes.
 */
export async function resolveContracts(tenant: ITenant, period: string): Promise<ResolvedContract[]> {
  const resolved: ResolvedContract[] = [];
  const set: Record<string, unknown> = {};
  const appliedIds: Types.ObjectId[] = [];

  for (const product of BILLING_PRODUCTS) {
    const plan = planOf(tenant, product);
    if (!plan) continue;

    const stored = tenant.billing?.contracts?.[product];
    let contract: ITenantContract | undefined = stored ? { plan: stored.plan, price: stored.price, since: stored.since, source: stored.source } : undefined;
    if (!contract || contract.plan !== plan) {
      contract = { plan, price: await listPrice(product, plan), since: period, source: 'catalog' };
      set[`billing.contracts.${product}`] = contract;
    }

    const due = (tenant.billing?.priceChanges ?? [])
      .filter((c) => c.product === product && !c.appliedAt && c.effectiveFrom <= period)
      .sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? a.createdAt.getTime() - b.createdAt.getTime() : a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    if (due.length > 0) {
      const latest = due[due.length - 1];
      contract = { plan, price: latest.price, since: latest.effectiveFrom, source: 'override' };
      set[`billing.contracts.${product}`] = contract;
      appliedIds.push(...due.map((c) => c._id));
    }
    const discount = discountFor(tenant, product, period);
    resolved.push({ product, plan, price: contract.price, source: contract.source, ...(discount ? { discount: { type: discount.type, value: discount.value } } : {}) });
  }

  if (Object.keys(set).length > 0) await Tenant.updateOne({ _id: tenant._id }, { $set: set });
  if (appliedIds.length > 0) {
    await Tenant.updateOne(
      { _id: tenant._id },
      { $set: { 'billing.priceChanges.$[c].appliedAt': new Date() } },
      { arrayFilters: [{ 'c._id': { $in: appliedIds } }] },
    );
  }
  return resolved;
}

export interface SchedulePriceChangeInput {
  product: BillingProduct;
  price: unknown;
  /** `YYYY-MM`. */
  effectiveFrom: string;
  reason: string;
}

const MIN_REASON = 10;

/**
 * Schedules a price for a tenant from `effectiveFrom` and emails the tenant's owner the reason.
 * The period must not be one that was already charged: a charge never changes.
 */
export async function schedulePriceChange(
  tenant: ITenant,
  input: SchedulePriceChangeInput,
  actor: { email?: string },
  now = new Date(),
): Promise<ITenant> {
  if (!BILLING_PRODUCTS.includes(input.product)) {
    throw new FiscalError(400, 'BILLING_INVALID', 'Choose a product', { product: 'Producto inválido' });
  }
  if (!planOf(tenant, input.product)) {
    throw new FiscalError(409, 'BILLING_NO_PRODUCT', `This tenant does not have ${input.product}`, { product: 'El inquilino no tiene este producto' });
  }
  const price = validatePrice(input.price);
  if (!isPeriod(input.effectiveFrom)) {
    throw new FiscalError(400, 'BILLING_INVALID', 'Choose the first month at the new price', { effectiveFrom: 'Mes inválido' });
  }
  const reason = (input.reason ?? '').trim();
  if (reason.length < MIN_REASON) {
    throw new FiscalError(400, 'BILLING_INVALID', 'Explain the reason (the tenant is told)', { reason: `Mínimo ${MIN_REASON} caracteres` });
  }
  // A charge covers the month that just ended, so every month before the current one is already
  // charged (or about to be) and cannot be re-priced.
  if (input.effectiveFrom < dominicanPeriod(now)) {
    throw new FiscalError(409, 'BILLING_PERIOD_CLOSED', 'That month has already been charged. Choose the current month or a later one.', { effectiveFrom: 'Mes ya cobrado' });
  }

  const updated = await Tenant.findByIdAndUpdate(
    tenant._id,
    { $push: { 'billing.priceChanges': { product: input.product, price, effectiveFrom: input.effectiveFrom, reason, createdByEmail: actor.email, createdAt: now } } },
    { new: true },
  );
  if (!updated) throw new FiscalError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
  const created = updated.billing!.priceChanges[updated.billing!.priceChanges.length - 1];

  const notified = await notifyPriceChange(updated, created, planOf(updated, input.product)!, resolvedPriceBefore(updated, input.product));
  if (notified) {
    await Tenant.updateOne({ _id: tenant._id, 'billing.priceChanges._id': created._id }, { $set: { 'billing.priceChanges.$.notifiedAt': now } });
  }
  return (await Tenant.findById(tenant._id)) ?? updated;
}

/** What the tenant pays now for `product`, as far as the stored contract says. */
const resolvedPriceBefore = (tenant: ITenant, product: BillingProduct): number | undefined => tenant.billing?.contracts?.[product]?.price;

export async function cancelPriceChange(tenant: ITenant, changeId: string): Promise<ITenant> {
  const change = tenant.billing?.priceChanges?.find((c) => String(c._id) === String(changeId));
  if (!change) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Price change not found');
  if (change.appliedAt) throw new FiscalError(409, 'BILLING_STATE', 'This price already applies; it cannot be cancelled');
  const updated = await Tenant.findByIdAndUpdate(tenant._id, { $pull: { 'billing.priceChanges': { _id: change._id } } }, { new: true });
  return updated ?? tenant;
}

export interface GrantDiscountInput {
  product: BillingProduct;
  type: unknown;
  value: unknown;
  /** `YYYY-MM`. */
  effectiveFrom: string;
  /** `YYYY-MM`, inclusive; empty for a discount with no end. */
  effectiveUntil?: string;
  reason: string;
}

const MAX_DISCOUNT_AMOUNT = 10_000_000;

/**
 * Grants a discount on one product's subscription, from `effectiveFrom` through `effectiveUntil`
 * (or with no end). It is taken off the price the contract has at charging time, so it follows a
 * price change. Months that were already charged cannot be discounted, and two discounts on the
 * same product cannot cover the same month.
 */
export async function grantDiscount(
  tenant: ITenant,
  input: GrantDiscountInput,
  actor: { email?: string },
  now = new Date(),
): Promise<ITenant> {
  if (!BILLING_PRODUCTS.includes(input.product)) {
    throw new FiscalError(400, 'BILLING_INVALID', 'Choose a product', { product: 'Producto inválido' });
  }
  if (!planOf(tenant, input.product)) {
    throw new FiscalError(409, 'BILLING_NO_PRODUCT', `This tenant does not have ${input.product}`, { product: 'El inquilino no tiene este producto' });
  }
  if (input.type !== 'percent' && input.type !== 'amount') {
    throw new FiscalError(400, 'BILLING_INVALID', 'Choose a percentage or an amount', { type: 'Tipo inválido' });
  }
  const raw = typeof input.value === 'string' ? Number(input.value) : input.value;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw new FiscalError(400, 'BILLING_INVALID', 'The discount must be greater than zero', { value: 'Debe ser mayor que cero' });
  }
  const value = round2(raw);
  if (input.type === 'percent' && value > 100) {
    throw new FiscalError(400, 'BILLING_INVALID', 'A percentage cannot be more than 100', { value: 'Máximo 100 %' });
  }
  if (input.type === 'amount' && value > MAX_DISCOUNT_AMOUNT) {
    throw new FiscalError(400, 'BILLING_INVALID', 'The amount is out of range', { value: 'Monto fuera de rango' });
  }
  if (!isPeriod(input.effectiveFrom)) {
    throw new FiscalError(400, 'BILLING_INVALID', 'Choose the first month with the discount', { effectiveFrom: 'Mes inválido' });
  }
  const until = input.effectiveUntil || undefined;
  if (until !== undefined && !isPeriod(until)) {
    throw new FiscalError(400, 'BILLING_INVALID', 'Choose the last month with the discount', { effectiveUntil: 'Mes inválido' });
  }
  if (until !== undefined && until < input.effectiveFrom) {
    throw new FiscalError(400, 'BILLING_INVALID', 'The last month cannot be before the first', { effectiveUntil: 'Antes del mes de inicio' });
  }
  const reason = (input.reason ?? '').trim();
  if (reason.length < MIN_REASON) {
    throw new FiscalError(400, 'BILLING_INVALID', 'Explain the reason', { reason: `Mínimo ${MIN_REASON} caracteres` });
  }
  if (input.effectiveFrom < dominicanPeriod(now)) {
    throw new FiscalError(409, 'BILLING_PERIOD_CLOSED', 'That month has already been charged. Choose the current month or a later one.', { effectiveFrom: 'Mes ya cobrado' });
  }
  const overlaps = (tenant.billing?.discounts ?? []).some(
    (d) => d.product === input.product && d.effectiveFrom <= (until ?? '9999-12') && (!d.effectiveUntil || input.effectiveFrom <= d.effectiveUntil),
  );
  if (overlaps) {
    throw new FiscalError(409, 'BILLING_DISCOUNT_OVERLAP', 'This product already has a discount in those months. End it first.', { effectiveFrom: 'Ya hay un descuento en esos meses' });
  }

  const updated = await Tenant.findByIdAndUpdate(
    tenant._id,
    { $push: { 'billing.discounts': { product: input.product, type: input.type, value, effectiveFrom: input.effectiveFrom, ...(until ? { effectiveUntil: until } : {}), reason, createdByEmail: actor.email, createdAt: now } } },
    { new: true },
  );
  if (!updated) throw new FiscalError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
  return updated;
}

/**
 * Ends a discount: one that has not reached a charge yet is removed; one in force stops after the
 * last month already charged (so every charge made keeps what it had).
 */
export async function endDiscount(tenant: ITenant, discountId: string, now = new Date()): Promise<ITenant> {
  const discount = tenant.billing?.discounts?.find((d) => String(d._id) === String(discountId));
  if (!discount) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Discount not found');
  const current = dominicanPeriod(now);
  const lastCharged = previousPeriod(current);
  if (discount.effectiveFrom >= current) {
    return (await Tenant.findByIdAndUpdate(tenant._id, { $pull: { 'billing.discounts': { _id: discount._id } } }, { new: true })) ?? tenant;
  }
  if (discount.effectiveUntil && discount.effectiveUntil <= lastCharged) {
    throw new FiscalError(409, 'BILLING_STATE', 'This discount has already ended');
  }
  return (
    (await Tenant.findOneAndUpdate(
      { _id: tenant._id, 'billing.discounts._id': discount._id },
      { $set: { 'billing.discounts.$.effectiveUntil': lastCharged } },
      { new: true },
    )) ?? tenant
  );
}

const money = (n: number) => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(n);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Tells the tenant its price will change and why. Returns whether the email went out. */
async function notifyPriceChange(
  tenant: ITenant,
  change: { product: BillingProduct; price: number; effectiveFrom: string; reason: string },
  plan: string,
  previous: number | undefined,
): Promise<boolean> {
  const to = tenant.billing?.billingEmail || tenant.ownerEmail;
  if (!to) return false;
  const settings = await getPlatformSettings();
  const product = change.product === 'pms' ? 'Pilloto PMS' : 'Pilloto Accounting';
  try {
    await sendEmail({
      to,
      subject: `[Pilloto] Cambio en el precio de su suscripción — ${periodLabelEs(change.effectiveFrom)}`,
      html:
        `<p>Hola,</p><p>El precio mensual de su suscripción a <strong>${product}</strong> (plan ${esc(plan)}) cambiará a partir de <strong>${periodLabelEs(change.effectiveFrom)}</strong>.</p>` +
        `<ul>${previous !== undefined ? `<li><strong>Precio actual:</strong> ${money(previous)} al mes</li>` : ''}<li><strong>Nuevo precio:</strong> ${money(round2(change.price))} al mes</li></ul>` +
        `<p>Los precios no incluyen impuestos${settings.billing?.tax === 'exempt' || settings.billing?.tax === 'itbis0' ? '' : ' (se agrega ITBIS)'}.</p>` +
        `<p><strong>Motivo:</strong> ${esc(change.reason)}</p><p>Si tiene preguntas, responda a este correo.</p>`,
      _logMeta: { emailType: 'billing_price_change', referenceId: String(tenant._id) },
    });
    return true;
  } catch (err: any) {
    console.warn(`[Billing] Could not email the price change to tenant ${tenant._id}: ${err?.message}`);
    return false;
  }
}
