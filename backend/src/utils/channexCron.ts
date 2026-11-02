/**
 * channexCron.ts — lifecycle of the Channex workers (plan Phases 6.2, 6.3, 7.2).
 *
 * `ariTick` runs on a 5-second node-cron tick and, so that a sold or freed room reaches the
 * channels at once, also just after availability rows are written (change capture's outbox
 * listener; the worker's 1 s availability quiet period groups one action's writes). The
 * booking feed poller runs every 2 minutes (safety net for missed webhooks, and the only
 * booking source without a public URL). New critical channel alerts are emailed every minute
 * (at most one email per tenant per 15 minutes, alerts.service.ts). It does nothing when Channex is not configured,
 * when `CHANNEX_WORKERS_DISABLED=true`, or when the platform kill switch
 * (`PlatformSettings.channex.globalEnabled`) is off — the switch is re-read at most every
 * 30 s, so flipping it takes effect without a restart.
 */
import cron, { ScheduledTask } from 'node-cron';
import PlatformSettings from '../models/PlatformSettings';
import { runNightlyFullSyncs } from '../services/channex/fullSync';
import { ariTick } from '../services/channex/ariWorker';
import { pollFeed } from '../services/channex/bookingInbox';
import { createChannexClient } from '../services/channex/channexClient';
import { getChannexConfig, isChannexConfigured } from '../services/channex/config';
import { AVAILABILITY_QUIET_MS } from '../services/channex/ariWorker';
import { onOutboxWrite } from '../services/channex/changeCapture';
import { sendAlertDigests } from '../services/channex/alerts.service';

const TICK_CRON = '*/5 * * * * *';
const SWITCH_TTL_MS = 30_000;

let task: ScheduledTask | null = null;
let nightlyTask: ScheduledTask | null = null;
let nightlyRunning = false;
let feedTask: ScheduledTask | null = null;
let feedRunning = false;
let digestTask: ScheduledTask | null = null;
let digestRunning = false;
let tickAgain = false;
let kickTimer: NodeJS.Timeout | null = null;
let stopListening: (() => void) | null = null;
let running = false;
let switchCache: { enabled: boolean; at: number } | null = null;

/** What this instance's workers did last (platform console, plan 9.3) */
export interface ChannexWorkerStatus {
  running: boolean;
  /** Why the workers are not running here */
  notRunningReason?: 'disabled_by_env' | 'not_configured';
  startedAt?: Date;
  lastTickAt?: Date;
  lastTickError?: string;
  lastFeedPollAt?: Date;
  lastFeedError?: string;
  lastDigestAt?: Date;
}
const workerStatus: ChannexWorkerStatus = { running: false };
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export function getChannexWorkerStatus(): ChannexWorkerStatus {
  return { ...workerStatus };
}

async function globallyEnabled(): Promise<boolean> {
  if (switchCache && Date.now() - switchCache.at < SWITCH_TTL_MS) return switchCache.enabled;
  const settings = await PlatformSettings.findOne({ key: 'global' }).select('channex.globalEnabled').lean();
  const enabled = settings?.channex?.globalEnabled !== false;
  switchCache = { enabled, at: Date.now() };
  return enabled;
}

/** Forget the cached kill-switch value (call after changing it). */
export function invalidateChannexSwitchCache() {
  switchCache = null;
}

export function startChannexWorkers(): void {
  const config = getChannexConfig();
  if (config.workersDisabled) {
    workerStatus.notRunningReason = 'disabled_by_env';
    console.log('⚠️  Channex workers disabled via CHANNEX_WORKERS_DISABLED=true');
    return;
  }
  if (!isChannexConfigured(config)) { workerStatus.notRunningReason = 'not_configured'; return; }
  if (task) return;
  Object.assign(workerStatus, { running: true, notRunningReason: undefined, startedAt: new Date() });

  const client = createChannexClient(config);
  const runTick = async (): Promise<void> => {
    if (running) { tickAgain = true; return; } // a slow flush must not stack ticks; run once more after it
    running = true;
    try {
      do {
        tickAgain = false;
        if (await globallyEnabled()) await ariTick({ client });
        workerStatus.lastTickAt = new Date();
        workerStatus.lastTickError = undefined;
      } while (tickAgain);
    } catch (err) {
      workerStatus.lastTickError = errText(err);
      console.error('❌ Channex ARI tick error:', err);
    } finally {
      running = false;
    }
  };
  task = cron.schedule(TICK_CRON, runTick);
  // Availability written → tick as soon as its quiet period has passed (one timer for a burst)
  stopListening = onOutboxWrite((_tenantId, kinds) => {
    if (!kinds.has('availability') || kickTimer) return;
    kickTimer = setTimeout(() => { kickTimer = null; void runTick(); }, AVAILABILITY_QUIET_MS + 100);
    kickTimer.unref();
  });
  // Nightly full sync: checked every minute; properties whose local time is 03:xx are queued a few per tick
  nightlyTask = cron.schedule('0 * * * * *', async () => {
    if (nightlyRunning) return;
    nightlyRunning = true;
    try {
      if (await globallyEnabled()) await runNightlyFullSyncs(config.environment);
    } catch (err) {
      console.error('❌ Channex nightly sync error:', err);
    } finally {
      nightlyRunning = false;
    }
  });
  // Booking feed: unacked revisions → inbox → apply → ack. With the kill switch off nothing is
  // lost: unacked revisions stay in the feed until it is back on.
  feedTask = cron.schedule('30 */2 * * * *', async () => {
    if (feedRunning) return;
    feedRunning = true;
    try {
      if (!(await globallyEnabled())) return;
      const r = await pollFeed({ client });
      workerStatus.lastFeedPollAt = new Date();
      workerStatus.lastFeedError = undefined;
      if (r.received || r.applied || r.failed) console.log(`📥 Channex feed: ${r.received} unacked, ${r.applied} applied, ${r.stale} stale, ${r.failed} failed, ${r.acked} acked`);
    } catch (err) {
      workerStatus.lastFeedError = errText(err);
      console.error('❌ Channex booking feed error:', err);
    } finally {
      feedRunning = false;
    }
  });
  // Alert emails do not depend on the kill switch: problems still need people
  digestTask = cron.schedule('15 * * * * *', async () => {
    if (digestRunning) return;
    digestRunning = true;
    try {
      const emailed = await sendAlertDigests();
      workerStatus.lastDigestAt = new Date();
      if (emailed.length) console.log(`🔔 Channel alert digest sent for ${emailed.length} tenant(s)`);
    } catch (err) {
      console.error('❌ Channel alert digest error:', err);
    } finally {
      digestRunning = false;
    }
  });
  console.log('🔌 Channex workers running (ARI 5 s tick, booking feed every 2 min, nightly full sync at 03:00 property time)');
}

export function stopChannexWorkers(): void {
  task?.stop();
  task = null;
  nightlyTask?.stop();
  nightlyTask = null;
  feedTask?.stop();
  feedTask = null;
  digestTask?.stop();
  digestTask = null;
  workerStatus.running = false;
  stopListening?.();
  stopListening = null;
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = null;
}
