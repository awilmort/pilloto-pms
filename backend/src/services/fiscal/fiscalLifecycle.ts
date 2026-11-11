/**
 * A tenant's electronic invoicing lifecycle: activate it (create the BillingSoft Organization),
 * follow DGII's certification, change plan, suspend and resume.
 *
 * The company, not the app, owns this: it reads and writes `Tenant.fiscal`, which PMS and Accounting
 * both see. Pilloto never handles the digital certificate or DGII's certification — the company's
 * administrator does both in BillingSoft, and Pilloto follows the progress.
 */
import { Types } from 'mongoose';
import { fiscalPlanRank, getFiscalConfig, includedFiscalPlan, isFiscalConfigured, isFiscalPlan } from '../../config/fiscal';
import Tenant, { FiscalPlan, ITenant, ITenantFiscal } from '../../models/Tenant';
import { encrypt } from '../../utils/encryption';
import { BillingSoftError } from './billingsoftClient';
import { getBillingSoftClient } from './fiscalClient';
import { dominicanDate, FiscalError, firstDayOfNextMonth } from './fiscalCore';
import { toFiscalError } from './fiscalIssuer';
import { getPlanCatalog, planChangeKind, selectablePlans } from './fiscalPlans';
import { BsPartnerOrganization } from './billingsoftTypes';
import { hasUnclosedPreviousPeriod, recordPlanChange } from './fiscalStatements';
import { FiscalIssuer, isPlatformIssuer, syncPlatformFiscal, updateIssuerFiscal } from './platformIssuer';

export interface ActivateInput {
  plan: FiscalPlan;
  /** The taxpayer, as it will appear on every e-CF. */
  rnc: string;
  razonSocial: string;
  address: string;
  /** Who BillingSoft invites to upload the certificate and run DGII's certification. */
  admin: { name: string; email: string };
  /** The administrator confirms any earlier postulation with another provider is concluded. */
  confirmPreviousPostulationConcluded: boolean;
}

export interface Actor {
  userId?: Types.ObjectId | string;
  email?: string;
}

const RNC_PATTERN = /^(\d{9}|\d{11})$/;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

function reject(message: string, fields: Record<string, string>): never {
  throw new FiscalError(400, 'FISCAL_REJECTED', message, fields);
}

/** Wraps a BillingSoft failure for the API. */
async function viaBillingSoft<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof BillingSoftError) throw toFiscalError(err);
    throw err;
  }
}

/**
 * Webhook URL BillingSoft posts this company's events to. The tenant is in the path so the signing
 * secret can be chosen before the body is trusted.
 */
export function webhookUrlFor(tenantId: Types.ObjectId | string): string | null {
  const base = getFiscalConfig().backendPublicUrl;
  return base ? `${base}/api/webhooks/billingsoft/${String(tenantId)}` : null;
}

/**
 * Registers (or re-registers) the webhook with BillingSoft and keeps its secret, encrypted. Failing
 * is not fatal — BillingSoft's own polling and Pilloto's sweep still move documents forward — so
 * this reports instead of throwing.
 */
export async function ensureWebhook(tenant: FiscalIssuer): Promise<boolean> {
  const organizationId = tenant.fiscal?.organizationId;
  const url = webhookUrlFor(tenant._id as Types.ObjectId);
  if (!organizationId || !url) return false;
  try {
    const client = getBillingSoftClient();
    const state = await client.getWebhook(organizationId);
    // Already pointing here with a secret we hold: nothing to do.
    if (state.webhook?.url === url && tenant.fiscal?.webhookSecret) return true;
    const result = await client.setWebhook(organizationId, url);
    // The secret is shown once, on creation. If the URL changed but the webhook existed, rotate to learn one.
    const secret = result.secret ?? (await client.rotateWebhookSecret(organizationId)).secret;
    if (!secret) return false;
    await updateIssuerFiscal(tenant._id, { 'fiscal.webhookSecret': encrypt(secret), 'fiscal.webhookRegisteredAt': new Date() });
    return true;
  } catch (err: any) {
    console.warn(`[Fiscal] Could not register the webhook for tenant ${tenant._id}: ${err?.message}`);
    return false;
  }
}

/** Fills the company profile fields that are still empty, so both apps share one identity. */
function profileFill(tenant: ITenant, input: ActivateInput, rnc: string): Record<string, string> {
  const set: Record<string, string> = {};
  if (!tenant.profile?.legalName) set['profile.legalName'] = input.razonSocial.trim();
  if (!tenant.profile?.rnc) set['profile.rnc'] = rnc;
  if (!tenant.profile?.address) set['profile.address'] = input.address.trim();
  return set;
}

/**
 * Activates electronic invoicing: creates the company's Organization in BillingSoft (or finds the
 * one an interrupted attempt created), invites its administrator, and registers the webhook.
 */
export async function activateFiscal(tenant: ITenant, input: ActivateInput, actor: Actor, now = new Date()): Promise<ITenant> {
  if (!isFiscalConfigured()) {
    throw new FiscalError(503, 'FISCAL_NOT_CONFIGURED', 'Electronic invoicing is not available on this server');
  }
  if (tenant.fiscal?.organizationId) {
    throw new FiscalError(409, 'FISCAL_ALREADY_ACTIVE', 'Electronic invoicing is already activated');
  }
  const rnc = (input.rnc ?? '').replace(/\D/g, '');
  const errors: Record<string, string> = {};
  if (!input.confirmPreviousPostulationConcluded) errors.confirmPreviousPostulationConcluded = 'Debe confirmar';
  if (!RNC_PATTERN.test(rnc)) errors.rnc = 'RNC inválido';
  if (!input.razonSocial?.trim()) errors.razonSocial = 'Requerido';
  else if (input.razonSocial.trim().length > 150) errors.razonSocial = 'Máximo 150 caracteres';
  if (!input.address?.trim()) errors.address = 'Requerido';
  else if (input.address.trim().length > 100) errors.address = 'Máximo 100 caracteres';
  if (!input.admin?.name?.trim()) errors['admin.name'] = 'Requerido';
  if (!EMAIL_PATTERN.test(input.admin?.email ?? '')) errors['admin.email'] = 'Correo inválido';
  if (!isFiscalPlan(input.plan)) errors.plan = 'Plan inválido';
  if (Object.keys(errors).length > 0) {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'Review the highlighted fields', errors);
  }

  const catalog = await viaBillingSoft(() => getPlanCatalog());
  if (!selectablePlans(tenant, catalog).includes(input.plan)) {
    reject('That plan is below the one your Pilloto plan includes', { plan: 'Plan no disponible' });
  }

  const client = getBillingSoftClient();
  const externalRef = String(tenant._id);
  const organization: BsPartnerOrganization = await viaBillingSoft(async () => {
    const existing = await client.findOrganizationByRef(externalRef);
    if (existing) return existing;
    try {
      const created = await client.provisionOrganization({
        externalRef,
        rnc,
        razonSocial: input.razonSocial.trim(),
        address: input.address.trim(),
        plan: input.plan,
        admin: { name: input.admin.name.trim(), email: input.admin.email.trim().toLowerCase() },
      });
      return created.organization;
    } catch (err) {
      if (err instanceof BillingSoftError && err.statusCode === 409) {
        throw new FiscalError(409, 'FISCAL_RNC_IN_USE', 'Another account already uses this RNC. Contact support.');
      }
      throw err;
    }
  });

  const fiscal: ITenantFiscal = {
    organizationId: organization.id,
    rnc: organization.rnc,
    adminEmail: input.admin.email.trim().toLowerCase(),
    environment: organization.environment,
    certification: organization.certification,
    isActive: organization.isActive,
    previousPostulationConfirmed: { at: now, byUserId: actor.userId as any, byEmail: actor.email },
    plan: (isFiscalPlan(organization.plan) ? organization.plan : input.plan) as FiscalPlan,
    provisionedAt: now,
    lastSyncedAt: now,
  };
  const updated = await Tenant.findByIdAndUpdate(
    tenant._id,
    { $set: { fiscal, ...profileFill(tenant, input, rnc) } },
    { new: true },
  );
  if (!updated) throw new FiscalError(404, 'TENANT_NOT_FOUND', 'Tenant not found');

  await ensureWebhook(updated);
  return (await Tenant.findById(tenant._id)) ?? updated;
}

/**
 * Refreshes any issuer's link with BillingSoft: a tenant's Organization, or Pilloto's own (which
 * has no partner record to read, only its onboarding state).
 */
export async function syncIssuerFiscal(issuer: FiscalIssuer, now = new Date()): Promise<void> {
  if (isPlatformIssuer(issuer._id)) {
    await viaBillingSoft(() => syncPlatformFiscal(now));
    return;
  }
  await syncFiscal(issuer as ITenant, now);
}

/** Pulls the Organization's environment, certification, plan and status from BillingSoft. */
export async function syncFiscal(tenant: ITenant, now = new Date()): Promise<ITenant> {
  const organizationId = tenant.fiscal?.organizationId;
  if (!organizationId) return tenant;
  const organization = await viaBillingSoft(() => getBillingSoftClient().getOrganization(organizationId));
  const set: Record<string, unknown> = {
    'fiscal.environment': organization.environment,
    'fiscal.certification': organization.certification,
    'fiscal.isActive': organization.isActive,
    'fiscal.lastSyncedAt': now,
  };
  if (isFiscalPlan(organization.plan)) set['fiscal.plan'] = organization.plan;
  const updated = await Tenant.findByIdAndUpdate(tenant._id, { $set: set }, { new: true });
  return updated ?? tenant;
}

export interface PlanChangeResult {
  tenant: ITenant;
  /** `applied` now, `scheduled` for the 1st of next month, or `unchanged`. */
  outcome: 'applied' | 'scheduled' | 'unchanged' | 'cancelled';
}

/**
 * Changes the tenant's BillingSoft plan. An upgrade applies at once; a downgrade waits for the 1st
 * of next month, so a month's allowance always matches what was paid for. Never below the plan the
 * tenant's Pilloto plan includes.
 */
export async function changeFiscalPlan(tenant: ITenant, plan: FiscalPlan, now = new Date()): Promise<PlanChangeResult> {
  const f = tenant.fiscal;
  if (!f?.organizationId) throw new FiscalError(409, 'FISCAL_NOT_ACTIVATED', 'Electronic invoicing is not activated');
  if (!isFiscalPlan(plan)) reject('Choose a plan', { plan: 'Plan inválido' });

  const catalog = await viaBillingSoft(() => getPlanCatalog());
  if (!selectablePlans(tenant, catalog).includes(plan)) {
    reject('That plan is below the one your Pilloto plan includes', { plan: 'Plan no disponible' });
  }

  const kind = planChangeKind(f.plan, plan);
  if (kind === 'none') {
    if (!f.pendingPlan) return { tenant, outcome: 'unchanged' };
    const cleared = await Tenant.findByIdAndUpdate(tenant._id, { $unset: { 'fiscal.pendingPlan': '' } }, { new: true });
    return { tenant: cleared ?? tenant, outcome: 'cancelled' };
  }

  if (kind === 'downgrade') {
    const scheduled = await Tenant.findByIdAndUpdate(
      tenant._id,
      { $set: { 'fiscal.pendingPlan': { plan, effectiveOn: firstDayOfNextMonth(now) } } },
      { new: true },
    );
    return { tenant: scheduled ?? tenant, outcome: 'scheduled' };
  }

  await viaBillingSoft(() => getBillingSoftClient().updateOrganization(f.organizationId!, { plan }));
  const updated = await Tenant.findByIdAndUpdate(
    tenant._id,
    { $set: { 'fiscal.plan': plan }, $unset: { 'fiscal.pendingPlan': '' } },
    { new: true },
  );
  await recordPlanChange(updated ?? tenant, f.plan, plan, now);
  return { tenant: updated ?? tenant, outcome: 'applied' };
}

/** Applies every downgrade whose day has come. Run by the scheduler; returns how many it applied. */
export async function applyScheduledPlanChanges(now = new Date()): Promise<number> {
  const today = dominicanDate(now);
  const due = await Tenant.find({ 'fiscal.pendingPlan.effectiveOn': { $lte: today } });
  let applied = 0;
  for (const tenant of due) {
    const pending = tenant.fiscal?.pendingPlan;
    const organizationId = tenant.fiscal?.organizationId;
    if (!pending || !organizationId) continue;
    // Last month is priced at the plan it ran on: close it before the plan changes.
    if (await hasUnclosedPreviousPeriod(tenant, now)) continue;
    try {
      const included = includedFiscalPlan(tenant);
      // Pilloto's plan may have changed since the downgrade was asked: never land below what it includes.
      const target = included && fiscalPlanRank(pending.plan) < fiscalPlanRank(included) ? included : pending.plan;
      await getBillingSoftClient().updateOrganization(organizationId, { plan: target });
      const from = tenant.fiscal!.plan;
      const updated = await Tenant.findByIdAndUpdate(
        tenant._id,
        { $set: { 'fiscal.plan': target }, $unset: { 'fiscal.pendingPlan': '' } },
        { new: true },
      );
      if (updated) await recordPlanChange(updated, from, target, now);
      applied++;
    } catch (err: any) {
      console.warn(`[Fiscal] Could not apply the scheduled plan change for tenant ${tenant._id}: ${err?.message}`);
    }
  }
  return applied;
}

/** Platform operators: stop (or resume) a company's electronic invoicing. Nothing is deleted. */
export async function setFiscalActive(tenant: ITenant, isActive: boolean): Promise<ITenant> {
  const organizationId = tenant.fiscal?.organizationId;
  if (!organizationId) throw new FiscalError(409, 'FISCAL_NOT_ACTIVATED', 'Electronic invoicing is not activated');
  await viaBillingSoft(() => getBillingSoftClient().updateOrganization(organizationId, { isActive }));
  const updated = await Tenant.findByIdAndUpdate(tenant._id, { $set: { 'fiscal.isActive': isActive } }, { new: true });
  return updated ?? tenant;
}
