/** Labels the subscription page and its dialogs share. */
import type { TFunction } from 'i18next';
import type { SubscriptionProduct } from '../../types/subscription';

export const PRODUCT_LABEL: Record<SubscriptionProduct, string> = { pms: 'Pilloto PMS', accounting: 'Pilloto Contabilidad' };

const FEATURE_FALLBACK: Record<string, string> = {
  // PMS
  media: 'Media library',
  daypass: 'Day-pass sales',
  pasatarde: 'Evening-pass sales',
  events: 'Events',
  wristbands: 'Wristband tracking',
  chargeRules: 'Charge rules',
  commissions: 'Agent commissions',
  corporateAccounts: 'Corporate credit accounts',
  nightAudit: 'Night audit',
  customRoles: 'Custom roles & permissions',
  bookingEngine: 'Online booking engine',
  channelManager: 'Channel manager (OTAs)',
  // Accounting
  inventory: 'Inventory & warehouses',
  generalLedger: 'General ledger & financial statements',
  bankReconciliation: 'Bank accounts & reconciliation',
  multiCurrency: 'Multi-currency (USD, EUR)',
};

export const featureLabel = (t: TFunction, product: SubscriptionProduct, key: string): string =>
  t(`subscription.features.${product}.${key}`, FEATURE_FALLBACK[key] ?? key);

/** "Up to 15 rooms", "2 users", "Unlimited users"… for a plan's limits. */
export function limitLines(t: TFunction, product: SubscriptionProduct, limits: Record<string, number | null>): string[] {
  const out: string[] = [];
  const users = limits.maxUsers;
  if (product === 'pms') {
    if (limits.maxRooms !== undefined) out.push(limits.maxRooms === null ? t('subscription.limits.roomsUnlimited', 'Unlimited rooms') : t('subscription.limits.rooms', 'Up to {{count}} rooms', { count: limits.maxRooms }));
  }
  if (users !== undefined) out.push(users === null ? t('subscription.limits.usersUnlimited', 'Unlimited users') : t('subscription.limits.users', '{{count}} users', { count: users }));
  if (product === 'accounting' && limits.maxWarehouses !== undefined) {
    if (limits.maxWarehouses === null) out.push(t('subscription.limits.warehousesUnlimited', 'Unlimited warehouses'));
    else if (limits.maxWarehouses > 0) out.push(t('subscription.limits.warehouses', '{{count}} warehouses', { count: limits.maxWarehouses }));
    else out.push(t('subscription.limits.catalogOnly', 'Products & services catalog (no stock)'));
  }
  return out;
}

/** `YYYY-MM-DD` → "1 de diciembre de 2026" / "December 1, 2026". */
export const longDate = (day: string, lang: string): string =>
  new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

/** First day of the month after `day` (`YYYY-MM-DD`). */
export function nextMonthStart(day: string): string {
  const [y, m] = day.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
