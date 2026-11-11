/**
 * Pilloto as an e-CF issuer. Pilloto is itself a BillingSoft partner Organization with its own
 * certificate, sequences and DGII certification; the same partner key acts for it when no customer
 * header is sent (`OWN_ORGANIZATION`). Its e-CF go through the very pipeline a tenant's do, so an
 * issuer is anything with `_id`, `ownerEmail` and a `fiscal` link: a Tenant, or this.
 *
 * Its `ElectronicInvoice` records carry `PLATFORM_ISSUER_ID` as `tenantId`. That id belongs to no
 * Tenant, so none of a tenant's queries can ever see them.
 */
import { Types } from 'mongoose';
import PlatformSettings, { IPlatformSettings, PLATFORM_KEY } from '../../models/PlatformSettings';
import Tenant, { FiscalCertification, ITenant, ITenantFiscal } from '../../models/Tenant';
import { BillingSoftError, OWN_ORGANIZATION } from './billingsoftClient';
import { getBillingSoftClient } from './fiscalClient';

/** Anything that can issue e-CF: a Tenant, or Pilloto itself. */
export type FiscalIssuer = Pick<ITenant, '_id' | 'ownerEmail' | 'fiscal'>;

/** The `tenantId` of every document Pilloto issues for itself. Belongs to no tenant. */
export const PLATFORM_ISSUER_ID = new Types.ObjectId('0000000000000000000000f1');

export const isPlatformIssuer = (id: unknown): boolean => String(id) === String(PLATFORM_ISSUER_ID);

/** The one settings document, created with its defaults on first use. */
export async function getPlatformSettings(): Promise<IPlatformSettings> {
  const existing = await PlatformSettings.findOne({ key: PLATFORM_KEY });
  if (existing) return existing;
  try {
    return await PlatformSettings.create({ key: PLATFORM_KEY });
  } catch (err: any) {
    if (err?.code === 11000) return (await PlatformSettings.findOne({ key: PLATFORM_KEY }))!;
    throw err;
  }
}

/** Pilloto as an issuer; `fiscal` is absent until its BillingSoft link is set up. */
export async function getPlatformIssuer(): Promise<FiscalIssuer> {
  const settings = await getPlatformSettings();
  return {
    _id: PLATFORM_ISSUER_ID,
    ownerEmail: settings.billing?.notifyEmail ?? '',
    fiscal: settings.billing?.fiscal,
  } as FiscalIssuer;
}

/** The issuer of a record's `tenantId`: Pilloto, or a Tenant. Null when it no longer exists. */
export async function loadIssuer(tenantId: unknown): Promise<FiscalIssuer | null> {
  if (isPlatformIssuer(tenantId)) return getPlatformIssuer();
  return Tenant.findById(tenantId);
}

/** Writes `fiscal.*` fields on the issuer, wherever its link lives. */
export async function updateIssuerFiscal(issuerId: unknown, set: Record<string, unknown>): Promise<void> {
  if (isPlatformIssuer(issuerId)) {
    await getPlatformSettings();
    // Callers name the fiscal fields the way a tenant's are (`fiscal.webhookSecret`).
    const prefixed = Object.fromEntries(Object.entries(set).map(([k, v]) => [`billing.${k}`, v]));
    await PlatformSettings.updateOne({ key: PLATFORM_KEY }, { $set: prefixed });
    return;
  }
  await Tenant.updateOne({ _id: issuerId }, { $set: set });
}

/**
 * Links Pilloto's own Organization (or refreshes what BillingSoft says about it): environment and
 * DGII certification. Throws a BillingSoft error when the partner key cannot reach it.
 */
export async function syncPlatformFiscal(now = new Date()): Promise<ITenantFiscal> {
  const onboarding = await getBillingSoftClient().onboarding(OWN_ORGANIZATION);
  const settings = await getPlatformSettings();
  const current = settings.billing?.fiscal;
  const certification: FiscalCertification = onboarding.certification;
  const fiscal: ITenantFiscal = {
    organizationId: OWN_ORGANIZATION,
    rnc: current?.rnc,
    adminEmail: current?.adminEmail,
    environment: onboarding.environment,
    certification,
    isActive: true,
    plan: current?.plan ?? 'essential',
    webhookSecret: current?.webhookSecret,
    webhookRegisteredAt: current?.webhookRegisteredAt,
    provisionedAt: current?.provisionedAt ?? now,
    lastSyncedAt: now,
  };
  await PlatformSettings.updateOne({ key: PLATFORM_KEY }, { $set: { 'billing.fiscal': fiscal } });
  return fiscal;
}

export { BillingSoftError };
