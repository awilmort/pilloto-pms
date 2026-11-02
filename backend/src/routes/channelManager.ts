/**
 * Channel manager — /api/channel-manager (CHANNEX_IMPLEMENTATION_PLAN.md Phases 5.1–7.2)
 *
 * Tenant-facing and white-label: responses never carry Channex ids, task ids, the Channex
 * environment or raw Channex errors (services/channex/tenantViews.ts). The technical view
 * of the same data is the platform console's (/api/platform/channex/tenants/:tenantId/*).
 *
 *   GET  /status              — server availability, property state in words, items needing attention, prerequisite checks
 *   PUT  /settings            — options: auto-assign rooms, guest confirmation email, rates include taxes
 *   GET  /readiness           — setup checks (ok / warning / error) with the screen that fixes each
 *   GET  /preview?days=30     — what OTAs will receive: availability and prices per room type and rate plan
 *   GET  /onboarding, PUT /onboarding — resumable setup wizard progress ({ step, answers })
 *   POST /enable              — set up the property, room types and rate plans; idempotent
 *   POST /disable[?force]     — stop the channel manager (refused while channels are active)
 *   POST /full-sync           — resend the next 500 days (refused within 10 minutes of the last one)
 *   GET  /sync-activity       — recent updates sent to the channels (paged): time, origin, what, dates, status
 *   GET  /booking-inbox       — bookings received from the channels (paged): OTA, code, guest, dates, state, reservation
 *   GET  /channels            — connected channels (state in words, health) + OTAs offered (platform setting) + who connects them
 *   GET  /channels/:id/status — one channel's live state and what blocks its activation
 *   POST /iframe-session      — one-time URL of the channel connection screen ({ otaCode?, language? });
 *                               refused when the platform connects channels for this tenant
 *   GET  /channel-onboarding/:otaCode[?live=1], PUT /channel-onboarding/:otaCode — connect-a-channel
 *                               wizard progress per OTA ({ step, answers, status }) and its channel
 *   GET  /alerts?status=active|open|acknowledged|resolved|dismissed|all&type&severity&page&limit — channel alerts
 *   GET  /alerts/summary      — counts for the nav badge (open critical) and the page header
 *   GET  /alerts/:id          — one alert with its context (reservations; Airbnb requests: availability of the nights)
 *   POST /alerts/:id/acknowledge | resolve | dismiss ({ notes? })            — admin.ota.resolve
 *   POST /alerts/:id/airbnb-answer ({ decision: accept|decline, reason?, messageToGuest?, messageToAirbnb? }) — admin.ota.resolve
 *
 * Currency, time zone and contact data are the property profile's (/api/property-profile).
 * Permissions: admin.ota.view (read), admin.ota.manage (change), admin.ota.resolve (alerts). Plan feature `channelManager`.
 * Channels are addressed by Pilloto's id (ChannexChannel `_id`), never by a Channex id.
 */

import express, { Response } from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import { requirePlanFeature } from '../middleware/planFeature';
import {
  disableChannelManager, enableChannelManager, getChannelManagerStatus, parseSettingsUpdate,
} from '../services/channex/provisioning';
import { loadBookingInbox, loadSyncActivity, toTenantStatus, toTenantSyncReport } from '../services/channex/tenantViews';
import { getReadiness } from '../services/channex/readiness';
import { getRateCalendar } from '../services/rateCalendar';
import { addDays, todayInTz } from '../services/channex/dates';
import AppSettings from '../models/AppSettings';
import Tenant from '../models/Tenant';
import ChannelOnboarding from '../models/ChannelOnboarding';
import { listMappings } from '../services/channex/structuralSync';
import { getChannexConfig, isChannexConfigured } from '../services/channex/config';
import { createChannexClient } from '../services/channex/channexClient';
import {
  createIframeSession, getChannelConnection, getOfferedChannels, iframeLanguage, isObjectId, isOtaCode, listTenantChannels, loadChannelOnboarding,
  loadChannelStatus, parseChannelOnboardingUpdate,
} from '../services/channex/channels';
import ChannexChannel from '../models/ChannexChannel';
import ChannexProperty from '../models/ChannexProperty';
import { requestManualFullSync } from '../services/channex/fullSync';
import {
  ALERT_ACTIONS, AlertAction, alertSummary, listTenantAlerts, loadTenantAlert, transitionAlert,
} from '../services/channex/alerts.service';
import { answerAirbnbRequest, isAirbnbRequestType, requestAvailability } from '../services/channex/airbnbRequests';
import ChannelAlert from '../models/ChannelAlert';

const router = express.Router();
router.use(authenticate, requirePlanFeature('channelManager'));

const view = authorizePermission('pms', 'admin.ota.view');
const manage = authorizePermission('pms', 'admin.ota.manage');
const resolvePerm = authorizePermission('pms', 'admin.ota.resolve');

async function tenantStatus(tenant: any) {
  const status = await getChannelManagerStatus(tenant);
  return toTenantStatus(status, status.property ? await listMappings(status.environment) : []);
}

router.get('/status', view, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await tenantStatus(req.tenant) });
  } catch (err) {
    console.error('Channel manager status error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/settings', manage, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseSettingsUpdate(req.body);
    if ('errors' in parsed) return res.status(400).json({ success: false, message: parsed.errors[0], errors: parsed.errors });
    if (Object.keys(parsed.appSettings).length) await AppSettings.updateOne({}, { $set: parsed.appSettings }, { upsert: true });
    const tenant = await Tenant.findById(req.tenantId);
    res.json({ success: true, data: (await getChannelManagerStatus(tenant as any)).settings });
  } catch (err) {
    console.error('Channel manager settings error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/readiness', view, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await getReadiness(req.tenant as any) });
  } catch (err) {
    console.error('Channel manager readiness error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/preview', view, async (req: AuthRequest, res: Response) => {
  try {
    const days = Math.min(60, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
    const tz = (req.tenant as any)?.settings?.timezone;
    let from: string;
    try { from = todayInTz(tz || 'UTC'); } catch { from = todayInTz('UTC'); }
    const settings = await AppSettings.findOne({}).select('channelManager.ratesIncludeTaxes').lean();
    res.json({ success: true, data: await getRateCalendar({ from, to: addDays(from, days - 1), ratesIncludeTaxes: Boolean(settings?.channelManager?.ratesIncludeTaxes) }) });
  } catch (err) {
    console.error('Channel manager preview error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

const SETUP_STEPS = 8;
const emptyOnboarding = { kind: 'setup', step: 1, answers: {}, status: 'in_progress' };

router.get('/onboarding', view, async (_req: AuthRequest, res: Response) => {
  try {
    const row = await ChannelOnboarding.findOne({ kind: 'setup' }).lean();
    res.json({ success: true, data: row ? { step: row.step, answers: row.answers, status: row.status } : emptyOnboarding });
  } catch (err) {
    console.error('Get onboarding error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/onboarding', manage, async (req: AuthRequest, res: Response) => {
  try {
    const { step, answers } = req.body ?? {};
    const set: Record<string, unknown> = {};
    if (step !== undefined) {
      if (!Number.isInteger(step) || step < 1 || step > SETUP_STEPS) return res.status(400).json({ success: false, message: `step must be a whole number from 1 to ${SETUP_STEPS}` });
      set.step = step;
    }
    if (answers !== undefined) {
      if (typeof answers !== 'object' || answers === null || Array.isArray(answers) || JSON.stringify(answers).length > 5000) {
        return res.status(400).json({ success: false, message: 'answers must be a small object' });
      }
      set.answers = answers;
    }
    const row = await ChannelOnboarding.findOneAndUpdate(
      { kind: 'setup' },
      { $set: set, $setOnInsert: { kind: 'setup', startedBy: req.user?.id, startedAt: new Date() } },
      { new: true, upsert: true, runValidators: true },
    ).lean();
    res.json({ success: true, data: { step: row!.step, answers: row!.answers, status: row!.status } });
  } catch (err) {
    console.error('Put onboarding error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/enable', manage, async (req: AuthRequest, res: Response) => {
  try {
    const result = await enableChannelManager({ tenant: req.tenant as any });
    if (!result.ok) {
      const status = result.reason === 'prerequisites' ? 422 : result.reason === 'not_configured' ? 503 : 502;
      // Channex's own error text stays in the property's lastError (platform console)
      const message = result.reason === 'channex_error'
        ? 'We could not finish setting up the channel manager. Nothing was lost; try again in a few minutes, and contact support if it keeps failing.'
        : result.message;
      return res.status(status).json({ success: false, message, reason: result.reason, prerequisites: result.prerequisites });
    }
    await ChannelOnboarding.findOneAndUpdate(
      { kind: 'setup' },
      { $set: { status: 'completed', step: SETUP_STEPS, completedAt: new Date() }, $setOnInsert: { kind: 'setup', startedBy: req.user?.id } },
      { upsert: true },
    );
    res.json({ success: true, data: { status: result.property.status, sync: toTenantSyncReport(result.sync) } });
  } catch (err) {
    console.error('Enable channel manager error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/disable', manage, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await disableChannelManager();
    if (!result.ok) return res.status(409).json({ success: false, message: result.message, activeChannels: result.activeChannels });
    res.json({ success: true, data: { status: result.property?.status ?? 'disabled' } });
  } catch (err) {
    console.error('Disable channel manager error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/full-sync', manage, async (_req: AuthRequest, res: Response) => {
  try {
    const config = getChannexConfig();
    const property = await ChannexProperty.findOne({ environment: config.environment });
    if (!property?.channexPropertyId || property.status !== 'active') return res.status(409).json({ success: false, message: 'Enable the channel manager first.' });
    const result = await requestManualFullSync(property);
    if (!result.ok) {
      res.set('Retry-After', String(result.retryAfterSeconds));
      return res.status(429).json({ success: false, message: 'Everything was resent a moment ago. Wait a few minutes before resending again.', retryAfterSeconds: result.retryAfterSeconds });
    }
    res.json({ success: true, data: { queued: result.queued } });
  } catch (err) {
    console.error('Full sync error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/sync-activity', view, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ success: true, data: await loadSyncActivity(getChannexConfig().environment, { page, limit, detailed: false }) });
  } catch (err) {
    console.error('Sync activity error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/booking-inbox', view, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ success: true, data: await loadBookingInbox({ page, limit, detailed: false }) });
  } catch (err) {
    console.error('Booking inbox error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Channels (plan 8.1–8.2) ─────────────────────────────────────────────────

const currentProperty = () => ChannexProperty.findOne({ environment: getChannexConfig().environment });
const clientIfConfigured = () => {
  const config = getChannexConfig();
  return isChannexConfigured(config) ? createChannexClient(config) : undefined;
};

router.get('/channels', view, async (_req: AuthRequest, res: Response) => {
  try {
    const [property, connection, offered] = await Promise.all([currentProperty(), getChannelConnection(), getOfferedChannels()]);
    const { rows: _rows, ...list } = await listTenantChannels({ client: clientIfConfigured(), property });
    res.json({ success: true, data: { ...list, connection: connection.mode, offered } });
  } catch (err) {
    console.error('List channels error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/channels/:id/status', view, async (req: AuthRequest, res: Response) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid channel id' });
    const row = await ChannexChannel.findOne({ _id: req.params.id, environment: getChannexConfig().environment });
    if (!row) return res.status(404).json({ success: false, message: 'Channel not found' });
    res.json({ success: true, data: await loadChannelStatus({ client: clientIfConfigured(), row }) });
  } catch (err) {
    console.error('Channel status error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export const PLATFORM_ONLY_MESSAGE = 'Pilloto connects your channels for you. Contact Pilloto support to connect a new channel; you can follow its state here.';

router.post('/iframe-session', manage, async (req: AuthRequest, res: Response) => {
  try {
    const { otaCode, language } = req.body ?? {};
    if (otaCode !== undefined && !isOtaCode(otaCode)) return res.status(400).json({ success: false, message: 'otaCode must be a channel code such as BDC' });
    const connection = await getChannelConnection();
    if (connection.mode === 'platform_only') return res.status(403).json({ success: false, reason: 'platform_only', message: PLATFORM_ONLY_MESSAGE });
    const config = getChannexConfig();
    if (!isChannexConfigured(config)) return res.status(503).json({ success: false, reason: 'not_configured', message: 'The channel manager is not available on this server yet.' });
    const property = await currentProperty();
    if (!property) return res.status(409).json({ success: false, reason: 'not_active', message: 'Activate the channel manager before connecting channels.' });
    const result = await createIframeSession({
      client: createChannexClient(config), property, username: String(req.user?.email ?? req.user?.id ?? 'pilloto-user'),
      language: iframeLanguage(language), otaCode, offered: await getOfferedChannels(),
    });
    if (!result.ok) {
      const status = result.reason === 'not_active' ? 409 : result.reason === 'unknown_channel' ? 400 : 502;
      return res.status(status).json({ success: false, reason: result.reason, message: result.message });
    }
    res.set('Cache-Control', 'no-store'); // single-use session URL
    res.json({ success: true, data: { url: result.url, expiresAt: result.expiresAt } });
  } catch (err) {
    console.error('Iframe session error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/channel-onboarding/:otaCode', view, async (req: AuthRequest, res: Response) => {
  try {
    const { otaCode } = req.params;
    if (!isOtaCode(otaCode)) return res.status(400).json({ success: false, message: 'Invalid channel code' });
    const data = await loadChannelOnboarding({ otaCode, client: clientIfConfigured(), property: await currentProperty(), live: req.query.live === '1' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('Get channel onboarding error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/channel-onboarding/:otaCode', manage, async (req: AuthRequest, res: Response) => {
  try {
    const { otaCode } = req.params;
    if (!isOtaCode(otaCode)) return res.status(400).json({ success: false, message: 'Invalid channel code' });
    const parsed = parseChannelOnboardingUpdate(req.body);
    if ('errors' in parsed) return res.status(400).json({ success: false, message: parsed.errors[0], errors: parsed.errors });
    const exists = await ChannelOnboarding.exists({ kind: 'channel', otaCode });
    if (!exists && !(await getOfferedChannels()).includes(otaCode)) return res.status(400).json({ success: false, message: 'This channel is not offered.' });
    await ChannelOnboarding.findOneAndUpdate(
      { kind: 'channel', otaCode },
      { $set: parsed.set, $setOnInsert: { kind: 'channel', otaCode, startedBy: req.user?.id, startedAt: new Date() } },
      { upsert: true, runValidators: true },
    );
    res.json({ success: true, data: await loadChannelOnboarding({ otaCode, client: clientIfConfigured(), property: await currentProperty() }) });
  } catch (err) {
    console.error('Put channel onboarding error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Channel alerts (plan 9.1–9.2) ───────────────────────────────────────────

router.get('/alerts/summary', view, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await alertSummary() });
  } catch (err) {
    console.error('Alert summary error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/alerts', view, async (req: AuthRequest, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const r = await listTenantAlerts({ status: q.status, type: q.type, severity: q.severity, page: Number(q.page), limit: Number(q.limit) });
    if (!r.ok) return res.status(400).json({ success: false, message: r.message });
    const { ok: _ok, ...data } = r;
    res.json({ success: true, data });
  } catch (err) {
    console.error('List alerts error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/alerts/:id', view, async (req: AuthRequest, res: Response) => {
  try {
    const alert = await loadTenantAlert(req.params.id);
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
    let availability = null;
    if (isAirbnbRequestType(alert.type)) {
      const doc = await ChannelAlert.findById(alert._id).select('details').lean();
      availability = doc ? await requestAvailability(doc as any) : null;
    }
    res.json({ success: true, data: { ...alert, availability } });
  } catch (err) {
    console.error('Get alert error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/alerts/:id/airbnb-answer', resolvePerm, async (req: AuthRequest, res: Response) => {
  try {
    const { decision, reason, messageToGuest, messageToAirbnb } = req.body ?? {};
    const config = getChannexConfig();
    if (!isChannexConfigured(config)) return res.status(503).json({ success: false, reason: 'not_configured', message: 'The channel manager is not available on this server yet.' });
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const r = await answerAirbnbRequest(req.params.id, { decision, reason: str(reason), messageToGuest: str(messageToGuest), messageToAirbnb: str(messageToAirbnb) },
      { client: createChannexClient(config), userId: req.user?.id });
    if (!r.ok) {
      const status = r.reason === 'not_found' ? 404 : r.reason === 'invalid' || r.reason === 'not_request' ? 400 : r.reason === 'unavailable' ? 503 : 409;
      return res.status(status).json({ success: false, reason: r.reason, message: r.message });
    }
    res.json({ success: true, data: { alreadyResolved: r.alreadyResolved, resolution: r.resolution, alert: await loadTenantAlert(req.params.id) } });
  } catch (err) {
    console.error('Airbnb answer error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/alerts/:id/:action', resolvePerm, async (req: AuthRequest, res: Response) => {
  try {
    const action = req.params.action as AlertAction;
    if (!ALERT_ACTIONS.includes(action)) return res.status(404).json({ success: false, message: 'Unknown action' });
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    const r = await transitionAlert(req.params.id, action, { userId: req.user?.id, notes });
    if (!r.ok) return res.status(r.reason === 'not_found' ? 404 : 409).json({ success: false, reason: r.reason, message: r.message });
    res.json({ success: true, data: await loadTenantAlert(req.params.id) });
  } catch (err) {
    console.error('Alert action error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
