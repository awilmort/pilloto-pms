/**
 * Process-wide BillingSoft client, built from the server's environment on first use. Tests replace
 * it with `setBillingSoftClient`.
 */
import { getFiscalConfig } from '../../config/fiscal';
import { BillingSoftClient, createBillingSoftClient } from './billingsoftClient';

let override: BillingSoftClient | null = null;
let cached: { key: string; client: BillingSoftClient } | null = null;

export function getBillingSoftClient(): BillingSoftClient {
  if (override) return override;
  const cfg = getFiscalConfig();
  const key = `${cfg.apiUrl}|${cfg.partnerApiKey}`;
  if (!cached || cached.key !== key) {
    cached = { key, client: createBillingSoftClient({ baseUrl: cfg.apiUrl, apiKey: cfg.partnerApiKey }) };
  }
  return cached.client;
}

/** Test seam: pass a fake client, or `null` to go back to the real one. */
export function setBillingSoftClient(client: BillingSoftClient | null): void {
  override = client;
}
