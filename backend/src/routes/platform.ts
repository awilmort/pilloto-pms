/**
 * Platform Routes — /api/platform/*
 *
 * Accessible only from admin.pilloto.com (isPlatformRequest = true)
 * and only by users with role = 'superadmin'.
 *
 * Endpoints:
 *   GET    /api/platform/tenants            — list all tenants
 *   POST   /api/platform/tenants            — create + provision a new tenant; the owner gets an invitation email
 *   POST   /api/platform/tenants/:id/resend-invitation — new invitation for an owner who has not chosen a password
 *   GET    /api/platform/tenants/:id        — get single tenant
 *   PATCH  /api/platform/tenants/:id        — update metadata / enable-disable
 *   DELETE /api/platform/tenants/:id        — permanently delete (soft disabled instead)
 *   GET    /api/platform/tenants/:id/stats  — basic stats for a single tenant
 *   GET    /api/platform/channex/health     — Channex connectivity check (never returns the key)
 *   GET    /api/platform/channex/tenants    — every tenant with its Channex property (current environment)
 *   GET    /api/platform/channex/webhook    — webhook setup state + latest received events
 *   POST   /api/platform/channex/signing-key — create a Channex signing key; the secret is returned ONCE
 *   PUT    /api/platform/channex/webhook    — create/update the global signed webhook (idempotent)
 *   POST   /api/platform/channex/webhook/test — ask Channex to send a test delivery
 *   GET    /api/platform/channex/overview   — configuration, kill switch, this instance's worker status, webhook state, platform alerts
 *   GET    /api/platform/channex/settings   — platform settings ({ globalEnabled, iframePlatformOnly, offeredChannels })
 *   PUT    /api/platform/channex/settings   — partial: globalEnabled (kill switch for every push/poll), iframePlatformOnly (tenants
 *                                            without their own choice cannot open the channel screen), offeredChannels (OTA codes
 *                                            offered in "Conectar un canal", in order)
 *   GET    /api/platform/channex/alerts     — platform alerts (bad API key, bookings for unknown properties); ?status=
 *   POST   /api/platform/channex/alerts/:id/acknowledge | resolve | dismiss ({ notes? })
 *   Per tenant, under /api/platform/channex/tenants/:tenantId —
 *     GET status | mappings | sync-activity (task ids, values, raw errors) | booking-inbox (revision ids, errors)
 *         | channels (Channex channel ids, adapters, who connects them) | alerts (with raw details; ?status=)
 *         | repair (Pilloto room types/rate plans beside the property's Channex options)
 *     POST enable | disable[?force=true] | resync | full-sync | iframe-session ({ otaCode?, language? }; always allowed)
 *         | pause | resume (ARI pushes; changes keep queueing while paused)
 *         | repair/relink ({ kind, localId, channexId }) | repair/recreate ({ kind: 'rate_plan', localId })
 *         | repair/recreate-rate-plans ({ roomTypeId })
 *     PUT  channel-connection ({ setting: 'default' | 'tenant' | 'platform_only' })
 */

import express, { Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import Tenant from '../models/Tenant';
import User from '../models/User';
import Reservation from '../models/Reservation';
import Room from '../models/Room';
import { provisionTenant, ensureAccountingProvisioned } from '../utils/provisionTenant';
import { invitationView, sendInvitation, invitationStatus } from '../services/invitations';
import { AppCode } from '../constants/apps';
import { tenantLocalStorage } from '../middleware/tenantContext';
import { checkChannexHealth } from '../services/channex/health';
import { disableChannelManager, enableChannelManager, getChannelManagerStatus, runInTenant } from '../services/channex/provisioning';
import { listMappings, syncStructure } from '../services/channex/structuralSync';
import { getChannexConfig, isChannexConfigured } from '../services/channex/config';
import { createChannexClient } from '../services/channex/channexClient';
import { requestManualFullSync } from '../services/channex/fullSync';
import { loadBookingInbox, loadSyncActivity } from '../services/channex/tenantViews';
import { createSigningKey, testWebhook, upsertGlobalWebhook, webhookStatus } from '../services/channex/webhookSetup';
import {
  createIframeSession, getChannelConnection, getOfferedChannels, iframeLanguage, isOtaCode, listTenantChannels, parseOfferedChannels,
} from '../services/channex/channels';
import AppSettings, { CHANNEL_CONNECTION_SETTINGS } from '../models/AppSettings';
import ChannexProperty from '../models/ChannexProperty';
import PlatformSettings from '../models/PlatformSettings';
import mongoose from 'mongoose';
import ChannelAlert from '../models/ChannelAlert';
import ChannelAriChange from '../models/ChannelAriChange';
import ChannexChannel from '../models/ChannexChannel';
import { ALERT_ACTIONS, AlertAction, PLATFORM_ALERT_TYPES, transitionAlert } from '../services/channex/alerts.service';
import { loadRepairView, recreateEntity, recreateRatePlansForRoomType, relinkEntity } from '../services/channex/repair';
import { getChannexWorkerStatus, invalidateChannexSwitchCache } from '../utils/channexCron';

const router = express.Router();

// All platform routes require authentication + superadmin role
router.use(authenticate, authorize('superadmin'));

// ── List all tenants ───────────────────────────────────────────────────────────
router.get('/tenants', async (_req: AuthRequest, res: Response) => {
  try {
    const tenants = await Tenant.find().sort({ createdAt: -1 }).lean();
    // The owner's invitation (no tenant context here, so this query is not tenant-scoped)
    const owners = await User.find({ tenantId: { $in: tenants.map((t) => t._id) }, isSuperAdmin: true })
      .select('tenantId email invitedAt invitationExpires invitationAcceptedAt').lean();
    const ownerOf = (t: any) => owners.find((u: any) => String(u.tenantId) === String(t._id) && u.email === t.ownerEmail);
    res.status(200).json({
      success: true,
      data: tenants.map((t: any) => {
        const owner = ownerOf(t);
        return { ...t, ownerInvitation: owner ? invitationView(owner as any) : null };
      }),
    });
  } catch (error) {
    console.error('List tenants error:', error);
    res.status(500).json({ success: false, message: 'Failed to list tenants.' });
  }
});

// ── Get single tenant ──────────────────────────────────────────────────────────
router.get('/tenants/:id', async (req: AuthRequest, res: Response) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    res.status(200).json({ success: true, data: tenant });
  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(500).json({ success: false, message: 'Failed to get tenant.' });
  }
});

// ── Create + provision a new tenant ───────────────────────────────────────────
router.post('/tenants', async (req: AuthRequest, res: Response) => {
  try {
    const {
      name, slug, plan, ownerEmail,
      adminFirstName, adminLastName,
      settings, products, plans,
    } = req.body;

    if (!name || !slug || !ownerEmail || !adminFirstName || !adminLastName) {
      return res.status(400).json({
        success: false,
        message: 'name, slug, ownerEmail, adminFirstName and adminLastName are required.',
      });
    }

    // Validate slug uniqueness upfront for a cleaner error message
    const existing = await Tenant.findOne({ slug: slug.toLowerCase().trim() }).lean();
    if (existing) {
      return res.status(409).json({ success: false, message: `Slug '${slug}' is already taken.` });
    }

    // No password: the owner chooses one from the invitation email
    const { tenant, adminUser } = await provisionTenant({
      name, slug, plan, ownerEmail,
      adminFirstName, adminLastName,
      settings, products, plans,
    });
    const owner = await User.findById(adminUser._id);
    const invitation = owner ? await sendInvitation(owner, { isOwner: true }) : { sent: false, error: 'Owner account not found' };

    res.status(201).json({
      success: true,
      message: invitation.sent
        ? `Tenant '${tenant.name}' provisioned. An invitation was emailed to ${ownerEmail}.`
        : `Tenant '${tenant.name}' provisioned, but the invitation email could not be sent: ${invitation.error}. Use "Resend invitation".`,
      data: {
        tenant,
        adminUser,
        invitation,
        loginUrl: `https://${tenant.slug}.pilloto.com/login`,
      },
    });
  } catch (error: any) {
    console.error('Provision tenant error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Slug or email already in use.' });
    }
    res.status(500).json({ success: false, message: 'Failed to provision tenant.', error: error.message });
  }
});

// ── Resend the owner's invitation ─────────────────────────────────────────────
router.post('/tenants/:id/resend-invitation', async (req: AuthRequest, res: Response) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    const owner = await User.findOne({ tenantId: tenant._id, email: tenant.ownerEmail, isSuperAdmin: true });
    if (!owner) return res.status(404).json({ success: false, message: 'The owner account was not found.' });
    if (invitationStatus(owner) === 'accepted') return res.status(409).json({ success: false, message: 'The owner already chose a password. They can use "Forgot password" if needed.' });
    if (invitationStatus(owner) === 'none' && owner.emailVerified) {
      return res.status(409).json({ success: false, message: 'This owner account was created with a password. They can use "Forgot password" if needed.' });
    }
    const result = await sendInvitation(owner, { isOwner: true });
    if (!result.sent) return res.status(502).json({ success: false, message: `The invitation email could not be sent: ${result.error}` });
    res.json({ success: true, message: `Invitation sent to ${owner.email}.`, data: invitationView(owner) });
  } catch (error) {
    console.error('Resend invitation error:', error);
    res.status(500).json({ success: false, message: 'Failed to resend the invitation.' });
  }
});

// ── Update tenant metadata ─────────────────────────────────────────────────────
router.patch('/tenants/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await Tenant.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    const allowed = ['name', 'plan', 'isActive', 'ownerEmail', 'settings', 'products', 'plans'];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    // Standalone-sale rollout (Phase 10.2): adding 'accounting' to an existing tenant's
    // products is more than a flag flip — it needs the same Chart of Accounts /
    // accounting-role seeding a brand-new accounting tenant gets from `provisionTenant`.
    // Detect that transition here (not just "products includes accounting", so this
    // stays a no-op — and doesn't re-touch `plans` — on every other tenant edit).
    const addingAccounting =
      Array.isArray(updates.products) &&
      (updates.products as AppCode[]).includes('accounting') &&
      !existing.products.includes('accounting');

    if (addingAccounting && !updates.plans?.accounting) {
      updates.plans = { ...(updates.plans ?? existing.plans ?? {}), accounting: 'starter' };
    }

    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    if (addingAccounting) {
      await ensureAccountingProvisioned(req.params.id);
    }

    res.status(200).json({ success: true, data: tenant });
  } catch (error: any) {
    console.error('Update tenant error:', error);
    res.status(500).json({ success: false, message: 'Failed to update tenant.' });
  }
});

// ── Soft-delete (disable) tenant ───────────────────────────────────────────────
// We do NOT hard-delete to preserve data integrity
router.delete('/tenants/:id', async (req: AuthRequest, res: Response) => {
  try {
    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    res.status(200).json({ success: true, message: 'Tenant deactivated.', data: tenant });
  } catch (error: any) {
    console.error('Deactivate tenant error:', error);
    res.status(500).json({ success: false, message: 'Failed to deactivate tenant.' });
  }
});

// ── Tenant stats ───────────────────────────────────────────────────────────────
router.get('/tenants/:id/stats', async (req: AuthRequest, res: Response) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    const tenantId = (tenant as any)._id.toString();

    // Run count queries inside this tenant's context so the plugin scopes them
    const [userCount, reservationCount, roomCount] = await tenantLocalStorage.run(
      { tenantId },
      () => Promise.all([
        User.countDocuments(),
        Reservation.countDocuments(),
        Room.countDocuments(),
      ])
    );

    res.status(200).json({
      success: true,
      data: {
        tenant,
        stats: { users: userCount, reservations: reservationCount, rooms: roomCount },
      },
    });
  } catch (error) {
    console.error('Tenant stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to get tenant stats.' });
  }
});

// ── Channex: connectivity check ───────────────────────────────────────────────
router.get('/channex/health', async (_req: AuthRequest, res: Response) => {
  try {
    const health = await checkChannexHealth();
    res.json({ success: true, data: health });
  } catch (error) {
    console.error('Channex health check error:', error);
    res.status(500).json({ success: false, message: 'Failed to check Channex connectivity.' });
  }
});

// ── Channex: webhook setup (plan 7.1) ─────────────────────────────────────────
const SETUP_FAILURE_STATUS: Record<string, number> = { not_configured: 503, invalid: 400, missing_prerequisite: 409, channex_error: 502 };

const webhookAction = (fn: (req: AuthRequest) => Promise<any>) => async (req: AuthRequest, res: Response) => {
  try {
    const { ok, ...data } = await fn(req);
    if (ok === false) return res.status(SETUP_FAILURE_STATUS[data.reason] ?? 400).json({ success: false, ...data });
    res.set('Cache-Control', 'no-store'); // the signing-key response carries a secret
    res.json({ success: true, data });
  } catch (error) {
    console.error('Platform Channex webhook action error:', error);
    res.status(500).json({ success: false, message: 'Channex webhook action failed.' });
  }
};

router.get('/channex/webhook', webhookAction(async () => ({ ok: true, ...(await webhookStatus()) })));
router.post('/channex/signing-key', webhookAction((req) => createSigningKey(req.body ?? {})));
router.put('/channex/webhook', webhookAction((req) => upsertGlobalWebhook(req.body ?? {})));
router.post('/channex/webhook/test', webhookAction(() => testWebhook()));

// ── Channex: platform defaults (plan 8.1, kill switch 9.3) ────────────────────
async function platformSettingsView() {
  const doc = await PlatformSettings.findOne({ key: 'global' }).select('channex.iframePlatformOnly channex.globalEnabled').lean();
  return {
    globalEnabled: doc?.channex?.globalEnabled !== false,
    iframePlatformOnly: Boolean(doc?.channex?.iframePlatformOnly),
    offeredChannels: await getOfferedChannels(),
  };
}

router.get('/channex/settings', async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await platformSettingsView() });
  } catch (error) {
    console.error('Platform Channex settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to read Channex settings.' });
  }
});

router.put('/channex/settings', async (req: AuthRequest, res: Response) => {
  try {
    const { iframePlatformOnly, offeredChannels, globalEnabled } = req.body ?? {};
    const set: Record<string, unknown> = {};
    if (globalEnabled !== undefined) {
      if (typeof globalEnabled !== 'boolean') return res.status(400).json({ success: false, message: 'globalEnabled must be true or false.' });
      set['channex.globalEnabled'] = globalEnabled;
    }
    if (iframePlatformOnly !== undefined) {
      if (typeof iframePlatformOnly !== 'boolean') return res.status(400).json({ success: false, message: 'iframePlatformOnly must be true or false.' });
      set['channex.iframePlatformOnly'] = iframePlatformOnly;
    }
    if (offeredChannels !== undefined) {
      const parsed = parseOfferedChannels(offeredChannels);
      if ('errors' in parsed) return res.status(400).json({ success: false, message: parsed.errors[0] });
      set['channex.offeredChannels'] = parsed.codes;
    }
    if (!Object.keys(set).length) return res.status(400).json({ success: false, message: 'Nothing to save.' });
    await PlatformSettings.updateOne({ key: 'global' }, { $set: set }, { upsert: true });
    res.json({ success: true, data: await platformSettingsView() });
  } catch (error) {
    console.error('Platform Channex settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to save Channex settings.' });
  }
});

// ── Channex: overview and platform alerts (plan 9.3) ──────────────────────────
router.get('/channex/overview', async (_req: AuthRequest, res: Response) => {
  try {
    const config = getChannexConfig();
    const [settings, webhook, platformAlerts, ps] = await Promise.all([
      platformSettingsView(),
      webhookStatus(),
      ChannelAlert.countDocuments({ tenantId: { $exists: false }, type: { $in: PLATFORM_ALERT_TYPES }, status: { $in: ['open', 'acknowledged'] } }),
      PlatformSettings.findOne({ key: 'global' }).select('channex.lastFeedPollAt channex.inboxLeaseUntil').lean(),
    ]);
    res.json({
      success: true,
      data: {
        environment: config.environment, baseUrl: config.baseUrl, configured: isChannexConfigured(config),
        webhookUrl: config.webhookUrl ?? null, webhookSecretConfigured: Boolean(config.webhookSecret), workersDisabledByEnv: config.workersDisabled,
        globalEnabled: settings.globalEnabled,
        workers: { ...getChannexWorkerStatus(), lastFeedPollAt: ps?.channex?.lastFeedPollAt, inboxLeaseUntil: ps?.channex?.inboxLeaseUntil },
        webhook: { webhookId: webhook.webhookId, signingKeyId: webhook.signingKeyId, lastWebhookAt: webhook.lastWebhookAt, callbackUrl: webhook.callbackUrl, secretConfigured: webhook.secretConfigured },
        openPlatformAlerts: platformAlerts,
      },
    });
  } catch (error) {
    console.error('Platform Channex overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to load the Channex overview.' });
  }
});

router.get('/channex/alerts', async (req: AuthRequest, res: Response) => {
  try {
    const status = String(req.query.status || 'active');
    const filter: Record<string, unknown> = { tenantId: { $exists: false }, type: { $in: PLATFORM_ALERT_TYPES } };
    if (status === 'active') filter.status = { $in: ['open', 'acknowledged'] };
    else if (status !== 'all') filter.status = status;
    const alerts = await tenantLocalStorage.run(null, () => ChannelAlert.find(filter).sort({ updatedAt: -1 }).limit(100).lean());
    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error('Platform Channex alerts error:', error);
    res.status(500).json({ success: false, message: 'Failed to list platform alerts.' });
  }
});

router.post('/channex/alerts/:id/:action', async (req: AuthRequest, res: Response) => {
  try {
    const action = req.params.action as AlertAction;
    if (!ALERT_ACTIONS.includes(action)) return res.status(404).json({ success: false, message: 'Unknown action.' });
    const r = await transitionAlert(req.params.id, action, { platform: true, notes: req.body?.notes, userId: mongoose.Types.ObjectId.isValid(String(req.user?.id)) ? req.user.id : undefined });
    if (!r.ok) return res.status(r.reason === 'not_found' ? 404 : 409).json({ success: false, message: r.message });
    res.json({ success: true, data: r.alert });
  } catch (error) {
    console.error('Platform Channex alert action error:', error);
    res.status(500).json({ success: false, message: 'Alert action failed.' });
  }
});

// ── Channex: tenants overview ─────────────────────────────────────────────────
router.get('/channex/tenants', async (_req: AuthRequest, res: Response) => {
  try {
    const { environment } = getChannexConfig();
    // No tenant context here, so the tenant plugin does not scope this query
    const [tenants, properties, pending, alerts, channels] = await Promise.all([
      Tenant.find({ products: 'pms' }).sort({ name: 1 }).select('name slug plan isActive').lean(),
      ChannexProperty.find({ environment }).select('tenantId status channexPropertyId lastPushAt lastFullSyncAt pausedUntil pushesPaused consecutiveFailures lastError').lean(),
      ChannelAriChange.aggregate([{ $match: { status: 'pending' } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
      ChannelAlert.aggregate([
        { $match: { tenantId: { $exists: true }, status: { $in: ['open', 'acknowledged'] }, severity: 'critical' } },
        { $group: { _id: '$tenantId', n: { $sum: 1 } } },
      ]),
      ChannexChannel.aggregate([
        { $match: { environment, removedAt: { $exists: false } } },
        { $group: { _id: '$tenantId', total: { $sum: 1 }, active: { $sum: { $cond: ['$isActive', 1, 0] } } } },
      ]),
    ]);
    const byTenant = new Map(properties.map((p) => [String(p.tenantId), p]));
    const count = (rows: { _id: unknown; n: number }[]) => new Map(rows.map((r) => [String(r._id), r.n]));
    const pendingOf = count(pending);
    const alertsOf = count(alerts);
    const channelsOf = new Map(channels.map((c: any) => [String(c._id), { total: c.total, active: c.active }]));
    res.json({
      success: true,
      data: {
        environment,
        tenants: tenants.map((t: any) => {
          const p = byTenant.get(String(t._id));
          return {
            _id: t._id, name: t.name, slug: t.slug, plan: t.plan, isActive: t.isActive,
            property: p ? {
              status: p.status, channexPropertyId: p.channexPropertyId, lastPushAt: p.lastPushAt, lastFullSyncAt: p.lastFullSyncAt,
              pausedUntil: p.pausedUntil && p.pausedUntil.getTime() > Date.now() ? p.pausedUntil : undefined, lastError: p.lastError,
              pushesPaused: Boolean(p.pushesPaused), consecutiveFailures: p.consecutiveFailures ?? 0,
            } : null,
            pendingOutbox: pendingOf.get(String(t._id)) ?? 0,
            openCriticalAlerts: alertsOf.get(String(t._id)) ?? 0,
            channels: channelsOf.get(String(t._id)) ?? { total: 0, active: 0 },
          };
        }),
      },
    });
  } catch (error) {
    console.error('Platform Channex tenants error:', error);
    res.status(500).json({ success: false, message: 'Failed to list tenants.' });
  }
});

// ── Channex: per-tenant channel manager (technical view of /api/channel-manager) ──
router.use('/channex/tenants/:tenantId', async (req: AuthRequest, res: Response, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.tenantId)) return res.status(400).json({ success: false, message: 'Invalid tenant id.' });
  const tenant = await Tenant.findById(req.params.tenantId);
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });
  (req as any).channexTenant = tenant;
  next();
});

const withTenant = (fn: (tenant: any, req: AuthRequest) => Promise<unknown>) => async (req: AuthRequest, res: Response) => {
  try {
    const tenant = (req as any).channexTenant;
    const data: any = await runInTenant(tenant._id, () => fn(tenant, req));
    if (data?.ok === false) {
      const status = data.reason === 'prerequisites' ? 422 : data.reason === 'not_configured' ? 503 : data.reason === 'channex_error' || data.reason === 'unavailable' ? 502
        : data.reason === 'invalid' || data.reason === 'unknown_channel' ? 400 : data.reason === 'not_found' ? 404 : 409;
      return res.status(status).json({ success: false, ...data });
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error('Platform Channex tenant action error:', error);
    res.status(500).json({ success: false, message: 'Channex action failed.' });
  }
};

router.get('/channex/tenants/:tenantId/status', withTenant((tenant) => getChannelManagerStatus(tenant)));
router.post('/channex/tenants/:tenantId/enable', withTenant(async (tenant) => {
  const r = await enableChannelManager({ tenant });
  return r.ok ? { status: r.property.status, created: r.created, sync: r.sync } : r;
}));
router.post('/channex/tenants/:tenantId/disable', withTenant(async (_tenant, req) => {
  const r = await disableChannelManager({ force: req.query.force === 'true' });
  return r.ok ? { status: r.property?.status ?? 'disabled' } : r;
}));
router.post('/channex/tenants/:tenantId/resync', withTenant(async () => {
  const config = getChannexConfig();
  if (!isChannexConfigured(config)) return { ok: false, reason: 'not_configured', message: 'CHANNEX_API_KEY is not set on this server.' };
  const property = await ChannexProperty.findOne({ environment: config.environment });
  if (!property?.channexPropertyId) return { ok: false, reason: 'not_enabled', message: 'The channel manager is not enabled for this tenant.' };
  const sync = await syncStructure({ client: createChannexClient(config), property });
  return { sync, mappings: await listMappings(config.environment) };
}));
router.get('/channex/tenants/:tenantId/mappings', withTenant(() => listMappings(getChannexConfig().environment)));
router.get('/channex/tenants/:tenantId/sync-activity', withTenant((_tenant, req) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  return loadSyncActivity(getChannexConfig().environment, { page, limit, detailed: true });
}));
router.get('/channex/tenants/:tenantId/booking-inbox', withTenant((_tenant, req) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  return loadBookingInbox({ page, limit, detailed: true });
}));
router.get('/channex/tenants/:tenantId/channels', withTenant(async () => {
  const config = getChannexConfig();
  const property = await ChannexProperty.findOne({ environment: config.environment });
  const [list, connection, offered] = await Promise.all([
    listTenantChannels({ client: isChannexConfigured(config) ? createChannexClient(config) : undefined, property }),
    getChannelConnection(),
    getOfferedChannels(),
  ]);
  return {
    connection, offered, stale: list.stale, onboardings: list.onboardings,
    channels: list.rows.map((r, i) => ({
      ...list.channels[i], channexChannelId: r.channexChannelId, adapter: r.adapter, channexStatus: r.channexStatus,
      expectedRemovalDate: r.expectedRemovalDate, lastEvent: r.lastEvent, lastSeenAt: r.lastSeenAt,
    })),
  };
}));
router.put('/channex/tenants/:tenantId/channel-connection', withTenant(async (_tenant, req) => {
  const { setting } = req.body ?? {};
  if (!CHANNEL_CONNECTION_SETTINGS.includes(setting)) return { ok: false, reason: 'invalid', message: `setting must be one of ${CHANNEL_CONNECTION_SETTINGS.join(', ')}.` };
  await AppSettings.updateOne({}, { $set: { 'channelManager.channelConnection': setting } }, { upsert: true });
  return getChannelConnection();
}));
// Superadmins connect channels on the tenant's behalf (also in platform-only mode)
router.post('/channex/tenants/:tenantId/iframe-session', withTenant(async (_tenant, req) => {
  const { otaCode, language } = req.body ?? {};
  if (otaCode !== undefined && !isOtaCode(otaCode)) return { ok: false, reason: 'invalid', message: 'otaCode must be a channel code such as BDC.' };
  const config = getChannexConfig();
  if (!isChannexConfigured(config)) return { ok: false, reason: 'not_configured', message: 'CHANNEX_API_KEY is not set on this server.' };
  const property = await ChannexProperty.findOne({ environment: config.environment });
  if (!property) return { ok: false, reason: 'not_enabled', message: 'The channel manager is not enabled for this tenant.' };
  const r = await createIframeSession({
    client: createChannexClient(config), property, username: String(req.user?.email ?? 'pilloto-superadmin'),
    language: iframeLanguage(language ?? 'en'), otaCode, offered: await getOfferedChannels(),
  });
  return r.ok ? { url: r.url, expiresAt: r.expiresAt } : r;
}));
const activeProperty = async () => {
  const config = getChannexConfig();
  if (!isChannexConfigured(config)) return { error: { ok: false, reason: 'not_configured', message: 'CHANNEX_API_KEY is not set on this server.' } };
  const property = await ChannexProperty.findOne({ environment: config.environment });
  if (!property?.channexPropertyId) return { error: { ok: false, reason: 'not_enabled', message: 'The channel manager is not enabled for this tenant.' } };
  return { property, client: createChannexClient(config) };
};

// Pause / resume ARI pushes (the outbox keeps collecting; resuming sends everything pending)
router.post('/channex/tenants/:tenantId/pause', withTenant(async (_tenant, req) => {
  const property = await ChannexProperty.findOne({ environment: getChannexConfig().environment });
  if (!property) return { ok: false, reason: 'not_enabled', message: 'The channel manager is not enabled for this tenant.' };
  await ChannexProperty.updateOne({ _id: property._id }, { $set: { pushesPaused: true, pushesPausedAt: new Date() } });
  console.log(`[Channex] pushes paused for tenant ${property.tenantId} by ${req.user?.email ?? 'superadmin'}`);
  return { pushesPaused: true };
}));
router.post('/channex/tenants/:tenantId/resume', withTenant(async (_tenant, req) => {
  const property = await ChannexProperty.findOne({ environment: getChannexConfig().environment });
  if (!property) return { ok: false, reason: 'not_enabled', message: 'The channel manager is not enabled for this tenant.' };
  // Resuming also lifts an error backoff: the superadmin asked for pushes now
  await ChannexProperty.updateOne({ _id: property._id }, { $set: { pushesPaused: false, pausedUntil: new Date() }, $unset: { pushesPausedAt: '' } });
  console.log(`[Channex] pushes resumed for tenant ${property.tenantId} by ${req.user?.email ?? 'superadmin'}`);
  return { pushesPaused: false, pending: await ChannelAriChange.countDocuments({ status: 'pending' }) };
}));
router.get('/channex/tenants/:tenantId/alerts', withTenant(async (_tenant, req) => {
  const status = String(req.query.status || 'active');
  const filter: Record<string, unknown> = {};
  if (status === 'active') filter.status = { $in: ['open', 'acknowledged'] };
  else if (status !== 'all') filter.status = status;
  return ChannelAlert.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
}));
router.get('/channex/tenants/:tenantId/repair', withTenant(async () => {
  const r = await activeProperty();
  if ('error' in r) return r.error;
  try { return await loadRepairView(r.client, r.property); } catch (e: any) {
    return { ok: false, reason: 'channex_error', message: e?.message ?? 'Channex request failed.' };
  }
}));
router.post('/channex/tenants/:tenantId/repair/relink', withTenant(async (_tenant, req) => {
  const r = await activeProperty();
  if ('error' in r) return r.error;
  const out = await relinkEntity(r.client, r.property, req.body ?? {});
  return out.ok ? { ...out, view: await loadRepairView(r.client, r.property) } : out;
}));
router.post('/channex/tenants/:tenantId/repair/recreate', withTenant(async (_tenant, req) => {
  const r = await activeProperty();
  if ('error' in r) return r.error;
  const out = await recreateEntity(r.client, r.property, req.body ?? {});
  return out.ok ? { ...out, view: await loadRepairView(r.client, r.property) } : out;
}));
router.post('/channex/tenants/:tenantId/repair/recreate-rate-plans', withTenant(async (_tenant, req) => {
  const r = await activeProperty();
  if ('error' in r) return r.error;
  const out = await recreateRatePlansForRoomType(r.client, r.property, req.body?.roomTypeId);
  return out.ok ? { ...out, view: await loadRepairView(r.client, r.property) } : out;
}));
router.post('/channex/tenants/:tenantId/full-sync', withTenant(async () => {
  const property = await ChannexProperty.findOne({ environment: getChannexConfig().environment });
  if (!property?.channexPropertyId || property.status !== 'active') return { ok: false, reason: 'not_enabled', message: 'The channel manager is not active for this tenant.' };
  const r = await requestManualFullSync(property);
  return r.ok ? { queued: r.queued } : { ok: false, reason: 'too_soon', message: `A full sync was queued less than 10 minutes ago; retry in ${r.retryAfterSeconds}s.` };
}));

export default router;
