/**
 * Foreign-currency documents (PLANS_AND_SUBSCRIPTIONS_PLAN.md phase 4): the rates the company
 * records, and the currency/rate a document or payment is given. The books are kept in DOP; a
 * document in USD or EUR keeps its own amounts and the rate it was booked at.
 */
import ExchangeRate from '../../models/ExchangeRate';
import { CURRENCIES, Currency } from '../../constants/accounting';
import { accountingPlanOf, featureDenial, hasAccountingFeature } from '../entitlements';
import { smallestAccountingPlanWith } from '../../config/accountingPlans';

const fail = (status: number, message: string, body?: unknown) => Object.assign(new Error(message), { status, ...(body ? { body } : {}) });
const r6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/** The latest rate recorded for `currency` on or before `day` (YYYY-MM-DD), or null. */
export async function latestRate(currency: string, day?: string): Promise<number | null> {
  if (currency === 'DOP') return 1;
  const row = await ExchangeRate.findOne({ currency, ...(day ? { date: { $lte: day } } : {}) }).sort({ date: -1 }).lean();
  return row?.rate ?? null;
}

/** Records (or corrects) the rate of a day. */
export async function setRate(currency: unknown, day: unknown, rate: unknown) {
  if (currency !== 'USD' && currency !== 'EUR') throw fail(400, 'currency must be USD or EUR');
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw fail(400, 'date must be YYYY-MM-DD');
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) throw fail(400, 'rate must be greater than zero');
  return ExchangeRate.findOneAndUpdate({ currency, date: day }, { $set: { rate: r6(n) } }, { upsert: true, new: true });
}

const dayOf = (d?: string | Date) => (d ? new Date(d).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

/**
 * The currency and rate of a new or edited document. DOP is always rate 1. Another currency needs
 * the multi-currency module, and a rate: the one given, else the latest recorded on or before the
 * document's date. Throws { status, message, body? }.
 */
export async function resolveDocumentCurrency(
  tenant: unknown,
  body: { currency?: unknown; exchangeRate?: unknown },
  date?: string | Date,
  current?: { currency?: string; exchangeRate?: number },
): Promise<{ currency: Currency; exchangeRate: number }> {
  const currency = (body.currency ?? current?.currency ?? 'DOP') as Currency;
  if (!CURRENCIES.includes(currency)) throw fail(400, `currency must be one of ${CURRENCIES.join(', ')}`);
  if (currency === 'DOP') return { currency, exchangeRate: 1 };
  if (!hasAccountingFeature(tenant as any, 'multiCurrency')) {
    throw fail(403, 'Multi-currency is not available on your current plan.', featureDenial('accounting', 'multiCurrency', accountingPlanOf(tenant as any), smallestAccountingPlanWith('multiCurrency')));
  }
  const given = body.exchangeRate !== undefined && body.exchangeRate !== null && body.exchangeRate !== '' ? Number(body.exchangeRate) : undefined;
  if (given !== undefined) {
    if (!Number.isFinite(given) || given <= 0) throw fail(400, 'exchangeRate must be greater than zero');
    return { currency, exchangeRate: r6(given) };
  }
  if (current?.currency === currency && current.exchangeRate && current.exchangeRate !== 1) return { currency, exchangeRate: current.exchangeRate };
  const recorded = await latestRate(currency, dayOf(date));
  if (!recorded) throw fail(400, `Enter the ${currency} exchange rate (none is recorded yet)`);
  return { currency, exchangeRate: recorded };
}

/** The rate of a payment on a foreign-currency document: the one given, else the day's latest, else the document's. */
export async function resolvePaymentRate(doc: { currency?: string; exchangeRate?: number }, given: unknown, date?: string | Date): Promise<number> {
  if (!doc.currency || doc.currency === 'DOP') return 1;
  if (given !== undefined && given !== null && given !== '') {
    const n = Number(given);
    if (!Number.isFinite(n) || n <= 0) throw fail(400, 'exchangeRate must be greater than zero');
    return r6(n);
  }
  return (await latestRate(doc.currency, dayOf(date))) ?? doc.exchangeRate ?? 1;
}
