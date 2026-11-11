/**
 * The price list: what each Pilloto plan costs per month, in Dominican pesos before ITBIS.
 *
 * It is managed from the platform console and starts from the prices below the first time it is
 * read. A tenant's own price is fixed in its contract (see billingContracts), so editing the list
 * only affects subscriptions that start afterwards.
 */
import { ACCOUNTING_PLANS } from '../../config/accountingPlans';
import { PLANS } from '../../config/plans';
import PlanPrice, { IPlanPrice } from '../../models/PlanPrice';
import { BillingProduct } from '../../models/Tenant';
import { FiscalError } from '../fiscal/fiscalCore';
import { round2 } from './billingMath';

/** Monthly prices (DOP, before ITBIS) the list starts with. */
export const DEFAULT_PLAN_PRICES: Record<BillingProduct, Record<string, number>> = {
  pms: { basic: 2450, pro: 5540, enterprise: 9370 },
  accounting: { starter: 2450, pro: 5540, plus: 9370 },
};

const MAX_PRICE = 10_000_000;

export interface CatalogEntry {
  product: BillingProduct;
  plan: string;
  name: string;
  monthlyPrice: number;
  history: IPlanPrice['history'];
  updatedAt?: Date;
}

/** Every plan that can be sold, per product, in the order they are offered. */
export function sellablePlans(): { product: BillingProduct; plan: string; name: string }[] {
  return [
    ...Object.values(PLANS).map((p) => ({ product: 'pms' as const, plan: p.slug as string, name: p.name })),
    ...Object.values(ACCOUNTING_PLANS).map((p) => ({ product: 'accounting' as const, plan: p.slug as string, name: p.name })),
  ];
}

export const isSellable = (product: string, plan: string): boolean =>
  sellablePlans().some((p) => p.product === product && p.plan === plan);

/** Makes sure every plan has a row, creating the missing ones with the starting prices. */
export async function ensureCatalog(): Promise<void> {
  for (const { product, plan } of sellablePlans()) {
    const price = DEFAULT_PLAN_PRICES[product][plan] ?? 0;
    try {
      await PlanPrice.updateOne(
        { product, plan },
        { $setOnInsert: { product, plan, monthlyPrice: price, history: [{ previous: null, price, changedAt: new Date(), changedByEmail: 'system' }] } },
        { upsert: true },
      );
    } catch (err: any) {
      if (err?.code !== 11000) throw err; // two requests seeding at once: the other one won
    }
  }
}

export async function getCatalog(): Promise<CatalogEntry[]> {
  await ensureCatalog();
  const rows = await PlanPrice.find({}).lean();
  const byKey = new Map(rows.map((r) => [`${r.product}:${r.plan}`, r]));
  return sellablePlans().map(({ product, plan, name }) => {
    const row = byKey.get(`${product}:${plan}`)!;
    return { product, plan, name, monthlyPrice: row.monthlyPrice, history: row.history ?? [], updatedAt: row.updatedAt };
  });
}

/** The list price of a plan right now. */
export async function listPrice(product: BillingProduct, plan: string): Promise<number> {
  await ensureCatalog();
  const row = await PlanPrice.findOne({ product, plan }).lean();
  if (!row) throw new FiscalError(404, 'BILLING_PLAN_UNKNOWN', `There is no ${product} plan "${plan}"`);
  return row.monthlyPrice;
}

export function validatePrice(value: unknown): number {
  const price = typeof value === 'string' ? Number(value) : (value as number);
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new FiscalError(400, 'BILLING_INVALID', 'The price must be a number', { price: 'Precio inválido' });
  }
  if (price < 0 || price > MAX_PRICE) {
    throw new FiscalError(400, 'BILLING_INVALID', 'The price is out of range', { price: 'Precio fuera de rango' });
  }
  return round2(price);
}

/** Changes a plan's list price and records who did it. Existing contracts keep their price. */
export async function setPlanPrice(
  product: BillingProduct,
  plan: string,
  value: unknown,
  actor: { email?: string },
  now = new Date(),
): Promise<CatalogEntry> {
  if (!isSellable(product, plan)) throw new FiscalError(404, 'BILLING_PLAN_UNKNOWN', `There is no ${product} plan "${plan}"`);
  const price = validatePrice(value);
  await ensureCatalog();
  const current = await PlanPrice.findOne({ product, plan });
  if (current && current.monthlyPrice !== price) {
    await PlanPrice.updateOne(
      { product, plan },
      {
        $set: { monthlyPrice: price },
        $push: { history: { previous: current.monthlyPrice, price, changedAt: now, changedByEmail: actor.email } },
      },
    );
  }
  return (await getCatalog()).find((e) => e.product === product && e.plan === plan)!;
}
