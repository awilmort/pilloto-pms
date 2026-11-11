/**
 * Background work of the e-CF module. Each job is a plain function the scheduler (and tests) call;
 * all of them run outside any request, so they scope to a tenant explicitly.
 *
 *  - `resendPendingIntents`: documents BillingSoft never confirmed (it was unreachable) are sent
 *    again with the same idempotency key — safe, because a repeat key never issues twice.
 *  - `sweepOpenDocuments`: documents BillingSoft has not finished with are read again, backing off
 *    as they age. Webhooks make this the exception; it is what makes a lost webhook harmless.
 *  - `syncCertifications`: tenants still being certified are checked for progress.
 */
import ElectronicInvoice, { IElectronicInvoice } from '../../models/ElectronicInvoice';
import Tenant from '../../models/Tenant';
import { tenantLocalStorage } from '../../middleware/tenantContext';
import { sendIntent } from './fiscalIssuer';
import { syncIssuerFiscal } from './fiscalLifecycle';
import { FiscalIssuer, getPlatformIssuer, loadIssuer } from './platformIssuer';
import { OPEN_ESTADOS, refreshRecord } from './fiscalSync';

const MINUTE = 60_000;
/** A saved intent is left alone this long before the sweep sends it (the original request may still be in flight). */
export const PENDING_GRACE_MS = 20_000;

/** How long to wait before asking about a document again, given how many times it has been asked. */
export function sweepDelayMs(retryCount: number): number {
  if (retryCount < 10) return MINUTE;
  if (retryCount < 40) return 10 * MINUTE;
  return 60 * MINUTE;
}

const inTenant = <T>(tenantId: unknown, fn: () => Promise<T>) => tenantLocalStorage.run({ tenantId: String(tenantId) }, fn);

/** The issuers (tenants, or Pilloto itself) of these records' `tenantId`s. */
async function tenantsById(ids: unknown[]): Promise<Map<string, FiscalIssuer>> {
  const unique = [...new Set(ids.map(String))];
  const found = await Promise.all(unique.map(async (id) => [id, await loadIssuer(id)] as const));
  return new Map(found.filter((entry): entry is readonly [string, FiscalIssuer] => entry[1] !== null));
}

export async function resendPendingIntents(now = new Date(), limit = 100): Promise<number> {
  const records: IElectronicInvoice[] = await tenantLocalStorage.run(null, () =>
    ElectronicInvoice.find({ estadoECF: 'Pendiente', updatedAt: { $lt: new Date(now.getTime() - PENDING_GRACE_MS) } })
      .sort({ updatedAt: 1 })
      .limit(limit),
  );
  const tenants = await tenantsById(records.map((r) => r.tenantId));
  let sent = 0;
  for (const record of records) {
    const tenant = tenants.get(String(record.tenantId));
    if (!tenant?.fiscal?.organizationId) continue;
    try {
      const result = await inTenant(record.tenantId, () => sendIntent(record, tenant, false, now));
      if (!result.queued) sent++;
    } catch (err: any) {
      console.warn(`[Fiscal] Could not resend ${record._id}: ${err?.message}`);
    }
  }
  return sent;
}

export async function sweepOpenDocuments(now = new Date(), limit = 300): Promise<number> {
  const candidates: IElectronicInvoice[] = await tenantLocalStorage.run(null, () =>
    ElectronicInvoice.find({
      estadoECF: { $in: OPEN_ESTADOS },
      billingsoftDocumentId: { $exists: true },
    })
      .sort({ lastStatusCheck: 1 })
      .limit(limit),
  );
  const due = candidates.filter(
    (r) => !r.lastStatusCheck || now.getTime() - r.lastStatusCheck.getTime() >= sweepDelayMs(r.retryCount),
  );
  const tenants = await tenantsById(due.map((r) => r.tenantId));
  let refreshed = 0;
  for (const record of due) {
    const tenant = tenants.get(String(record.tenantId));
    if (!tenant?.fiscal?.organizationId) continue;
    try {
      await inTenant(record.tenantId, () => refreshRecord(record, tenant));
      refreshed++;
    } catch (err: any) {
      console.warn(`[Fiscal] Could not refresh ${record._id}: ${err?.message}`);
    }
  }
  return refreshed;
}

export async function syncCertifications(now = new Date()): Promise<number> {
  const tenants = await Tenant.find({
    'fiscal.organizationId': { $exists: true },
    'fiscal.certification': { $ne: 'certified' },
  });
  let synced = 0;
  for (const tenant of tenants) {
    try {
      await syncIssuerFiscal(tenant, now);
      synced++;
    } catch (err: any) {
      console.warn(`[Fiscal] Could not sync tenant ${tenant._id}: ${err?.message}`);
    }
  }
  // Pilloto's own Organization is certified the same way.
  const platform = await getPlatformIssuer();
  if (platform.fiscal?.organizationId && platform.fiscal.certification !== 'certified') {
    try {
      await syncIssuerFiscal(platform, now);
      synced++;
    } catch (err: any) {
      console.warn(`[Fiscal] Could not sync Pilloto's own e-CF link: ${err?.message}`);
    }
  }
  return synced;
}
