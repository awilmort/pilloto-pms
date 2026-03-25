/**
 * chargeWorker.ts
 *
 * Enterprise night audit engine.
 *
 * SOLID design:
 *  S — Each function handles one concern (detect, resolve amount, post, lock).
 *  O — New trigger types extend the detector registry without touching runAuditForTenant.
 *  L — All detector functions share the DetectorFn signature.
 *  I — Only runAudit / runAuditForTenant are public surface.
 *  D — All models are imported (no singletons built inside helpers).
 *
 * Enterprise guarantees:
 *  • Run-level idempotency — one real AuditRun per tenant per businessDate.
 *  • DB-level concurrency lock — 'running' AuditRun blocks concurrent invocations.
 *  • Stale-lock recovery — 'running' locks older than STALE_LOCK_MINUTES are evicted.
 *  • Per-execution idempotency — ChargeRuleExecution unique index prevents double-charging.
 *  • Dry-run mode — full simulation without writing charges or executions.
 *  • AppSettings toggle — tenant can disable automated audit.
 *  • Persistent audit trail — AuditRun records visible in UI and queryable.
 */
import Reservation from '../models/Reservation';
import Folio from '../models/Folio';
import Charge from '../models/Charge';
import ChargeRule, { IChargeRule } from '../models/ChargeRule';
import ChargeTemplate, { IChargeTemplate } from '../models/ChargeTemplate';
import ChargeRuleExecution from '../models/ChargeRuleExecution';
import AuditRun, { IAuditRun, IAuditRunSummary } from '../models/AuditRun';
import AppSettings from '../models/AppSettings';
import Tenant from '../models/Tenant';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Minutes after which a stuck 'running' lock is considered stale and evicted. */
const STALE_LOCK_MINUTES = 30;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface AuditContext {
  now: Date;
  businessDate: string; // YYYY-MM-DD
  tenantId: string;
}

interface DetectionResult {
  detected: boolean;
  /** Nightly rate of reservation used for amount resolution */
  nightlyRate?: number;
  nights?: number;
}

type DetectorFn = (reservation: any, rule: IChargeRule, ctx: AuditContext) => DetectionResult;

export interface AuditSummary extends IAuditRunSummary {
  tenantId: string;
  businessDate: string;
  dryRun: boolean;
  auditRunId?: string;
}

export interface RunAuditOptions {
  triggeredBy?: 'cron' | 'manual';
  dryRun?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function toBusinessDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function nightlyRateOf(reservation: any): number {
  const total = Number(reservation.estimatedTotal ?? reservation.totalPrice ?? 0);
  const ciDate = new Date(reservation.checkInDate);
  const coDate = reservation.checkOutDate ? new Date(reservation.checkOutDate) : null;
  const nights = coDate ? Math.max(1, daysBetween(ciDate, coDate)) : 1;
  return nights > 0 ? total / nights : total;
}

// ─────────────────────────────────────────────────────────────
// Detectors  (one per trigger type — Open/Closed via registry)
// ─────────────────────────────────────────────────────────────

/**
 * checkout_overdue: checkout date has passed, guest has NOT checked out,
 * and we've exceeded the configured grace threshold (default 2 h).
 */
const detectCheckoutOverdue: DetectorFn = (reservation, rule, ctx) => {
  if (!reservation.checkOutDate) return { detected: false };
  const checkOut = new Date(reservation.checkOutDate);
  const thresholdMs = (rule.conditions.timeThresholdHours ?? 2) * 60 * 60 * 1000;
  if (ctx.now.getTime() <= checkOut.getTime() + thresholdMs) return { detected: false };
  if (reservation.actualCheckOutAt || !reservation.actualCheckInAt) return { detected: false };
  return { detected: true, nightlyRate: nightlyRateOf(reservation), nights: 1 };
};

/**
 * no_show: check-in date has passed, guest never checked in, reservation still confirmed.
 */
const detectNoShow: DetectorFn = (reservation, rule, ctx) => {
  const checkIn = new Date(reservation.checkInDate);
  const thresholdMs = (rule.conditions.timeThresholdHours ?? 12) * 60 * 60 * 1000;
  if (ctx.now.getTime() <= checkIn.getTime() + thresholdMs) return { detected: false };
  if (reservation.actualCheckInAt || reservation.status !== 'confirmed') return { detected: false };
  return { detected: true, nightlyRate: nightlyRateOf(reservation), nights: 1 };
};

/**
 * early_departure: guest checked out at least 1 night before scheduled checkout.
 */
const detectEarlyDeparture: DetectorFn = (reservation) => {
  if (!reservation.actualCheckOutAt || !reservation.checkOutDate) return { detected: false };
  const scheduled = new Date(reservation.checkOutDate);
  const actual = new Date(reservation.actualCheckOutAt);
  const nightsEarly = daysBetween(actual, scheduled);
  if (nightsEarly < 1) return { detected: false };
  return { detected: true, nightlyRate: nightlyRateOf(reservation), nights: nightsEarly };
};

// Registry — add new trigger → detector mappings here without touching runAudit
const detectorRegistry: Record<string, DetectorFn> = {
  checkout_overdue: detectCheckoutOverdue,
  no_show: detectNoShow,
  early_departure: detectEarlyDeparture,
};

// ─────────────────────────────────────────────────────────────
// Amount resolution
// ─────────────────────────────────────────────────────────────

function resolveAmount(
  template: IChargeTemplate,
  multiplier: number,
  nightlyRate: number,
  nights: number
): number {
  let base: number;
  switch (template.calculationMethod) {
    case 'fixed':
      base = template.amount;
      break;
    case 'extra_night':
      base = nightlyRate * nights;
      break;
    case 'percent_of_nightly_rate':
      base = (nightlyRate * nights * template.amount) / 100;
      break;
    default:
      base = template.amount;
  }
  return Math.round(base * multiplier * 100) / 100;
}

function buildDescription(template: IChargeTemplate, reservation: any, nights: number): string {
  const code = reservation.reservationCode || String(reservation._id).slice(-6);
  const rate = nightlyRateOf(reservation);
  return template.descriptionTemplate
    .replace('{code}', code)
    .replace('{nights}', String(nights))
    .replace('{rate}', String(rate));
}

// ─────────────────────────────────────────────────────────────
// Rule applicability check (conditions filter)
// ─────────────────────────────────────────────────────────────

function ruleAppliesToReservation(rule: IChargeRule, reservation: any, ctx: AuditContext): boolean {
  const { conditions } = rule;

  // Reservation type filter
  if (conditions.reservationTypes && conditions.reservationTypes.length > 0) {
    if (!conditions.reservationTypes.includes(reservation.type)) return false;
  }

  // Room type filter
  if (conditions.roomTypeId) {
    const rooms: any[] = Array.isArray(reservation.rooms) ? reservation.rooms : (reservation.room ? [reservation.room] : []);
    const rtId = String(conditions.roomTypeId);
    const match = rooms.some((r: any) => {
      const roomTypeId = typeof r === 'object' ? String(r.roomTypeId) : null;
      return roomTypeId === rtId;
    });
    if (!match) return false;
  }

  // Date window filter (business date within range)
  if (conditions.dateStart && new Date(ctx.businessDate) < new Date(conditions.dateStart)) return false;
  if (conditions.dateEnd && new Date(ctx.businessDate) > new Date(conditions.dateEnd)) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────
// Lock management (DB-level)
// ─────────────────────────────────────────────────────────────

/**
 * Attempt to acquire a run lock for (tenantId, businessDate).
 *
 * Rules:
 *  1. If a 'completed' or 'skipped' non-dry-run already exists today → return null (skip).
 *  2. If a 'running' lock exists but is older than STALE_LOCK_MINUTES → evict it and proceed.
 *  3. If a fresh 'running' lock exists → return null (concurrent run in progress, skip).
 *  4. Otherwise → create a new AuditRun with status='running' and return it.
 */
async function acquireLock(
  tenantId: string,
  businessDate: string,
  triggeredBy: 'cron' | 'manual',
  dryRun: boolean
): Promise<IAuditRun | null> {
  if (!dryRun) {
    const completed = await AuditRun.findOne({ tenantId, businessDate, status: { $in: ['completed', 'skipped'] }, dryRun: false });
    if (completed) return null;

    const running = await AuditRun.findOne({ tenantId, businessDate, status: 'running', dryRun: false });
    if (running) {
      const staleCutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000);
      if (running.startedAt > staleCutoff) return null; // fresh lock — another process owns it
      // Stale lock — evict so we can proceed
      await AuditRun.updateOne({ _id: running._id }, { status: 'failed', error: 'Evicted as stale lock', completedAt: new Date() });
    }
  }

  const run = await AuditRun.create({ tenantId, businessDate, status: 'running', triggeredBy, dryRun, startedAt: new Date() });
  return run;
}

async function releaseLock(run: IAuditRun, summary: IAuditRunSummary, error?: string): Promise<void> {
  await AuditRun.updateOne(
    { _id: run._id },
    { status: error ? 'failed' : 'completed', completedAt: new Date(), summary, ...(error ? { error } : {}) }
  );
}

// ─────────────────────────────────────────────────────────────
// Core audit runner — single tenant
// ─────────────────────────────────────────────────────────────

export async function runAuditForTenant(tenantId: string, options: RunAuditOptions = {}): Promise<AuditSummary> {
  const { triggeredBy = 'cron', dryRun = false } = options;
  const now = new Date();
  const businessDate = toBusinessDate(now);
  const ctx: AuditContext = { now, businessDate, tenantId };

  const summary: AuditSummary = {
    tenantId, businessDate, dryRun,
    rulesEvaluated: 0, reservationsScanned: 0, chargesPosted: 0, skipped: 0, errors: 0,
  };

  // ── 1. Check per-tenant AppSettings (enabled toggle + scheduled hour) ──
  if (!dryRun) {
    const settings = await (AppSettings as any).findOne({ tenantId }).lean();

    if (settings && settings.nightAuditEnabled === false) {
      await AuditRun.create({ tenantId, businessDate, status: 'skipped', triggeredBy, dryRun: false, startedAt: now, completedAt: now, summary: { rulesEvaluated: 0, reservationsScanned: 0, chargesPosted: 0, skipped: 0, errors: 0 } });
      return summary;
    }

    // Time-window guard: for cron triggers only run in the tenant's configured hour.
    if (triggeredBy === 'cron') {
      const timeStr: string = settings?.nightAuditTime || process.env.NIGHT_AUDIT_DEFAULT_TIME || '03:00';
      const configuredHour = parseInt(timeStr.split(':')[0] ?? '3', 10);
      if (!isNaN(configuredHour) && now.getHours() !== configuredHour) {
        return summary; // not the right hour yet — silent no-op
      }
    }
  }

  // ── 2. Acquire run-level DB lock ──
  const run = await acquireLock(tenantId, businessDate, triggeredBy, dryRun);
  if (!run) return summary; // already ran today or concurrent run in progress
  summary.auditRunId = String(run._id);

  try {
    // ── 3. Load active rules ──
    const rules = await (ChargeRule as any).find({ isActive: true, tenantId }).sort({ priority: -1 }).populate('chargeTemplateId').lean();
    summary.rulesEvaluated = rules.length;

    if (rules.length > 0) {
      // ── 4. Load candidate reservations ──
      const candidates = await (Reservation as any).find({ tenantId, status: { $nin: ['cancelled'] }, checkInDate: { $lte: now } }).lean();
      summary.reservationsScanned = candidates.length;

      // ── 5. Evaluate each rule × reservation ──
      for (const rule of rules) {
        const detector = detectorRegistry[rule.trigger];
        if (!detector) continue;
        const template = rule.chargeTemplateId as unknown as IChargeTemplate;
        if (!template || !(template as any).isActive) continue;
        const multiplier = rule.multiplierOverride ?? 1;

        for (const reservation of candidates) {
          if (!ruleAppliesToReservation(rule, reservation, ctx)) continue;

          // Per-execution idempotency (skip for dry runs)
          if (!dryRun) {
            const key = { chargeRuleId: rule._id, reservationId: reservation._id, businessDate, tenantId };
            if (await ChargeRuleExecution.findOne(key)) continue;
          }

          const detection = detector(reservation, rule, ctx);

          if (!detection.detected) {
            summary.skipped++;
            if (!dryRun) {
              await ChargeRuleExecution.create({ chargeRuleId: rule._id, reservationId: reservation._id, businessDate, tenantId, status: 'skipped', executedAt: now });
            }
            continue;
          }

          try {
            const amount = resolveAmount(template, multiplier, detection.nightlyRate ?? 0, detection.nights ?? 1);
            const description = buildDescription(template, reservation, detection.nights ?? 1);

            if (!dryRun) {
              const folio = await Folio.findOneAndUpdate(
                { reservationId: reservation._id, tenantId },
                { $setOnInsert: { reservationId: reservation._id, tenantId, status: 'open' } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
              );
              const charge = await Charge.create({ folioId: folio._id, description, amount, type: 'auto_rule', category: template.category, chargeTemplateId: template._id, tenantId });
              await ChargeRuleExecution.create({ chargeRuleId: rule._id, reservationId: reservation._id, businessDate, tenantId, status: 'success', chargeId: charge._id, executedAt: now });
            }
            summary.chargesPosted++;
          } catch (err: any) {
            summary.errors++;
            if (!dryRun) {
              try { await ChargeRuleExecution.create({ chargeRuleId: rule._id, reservationId: reservation._id, businessDate, tenantId, status: 'error', errorMessage: err?.message || 'Unknown error', executedAt: now }); } catch { /* race */ }
            }
          }
        }
      }
    }

    // ── 6. Release lock ──
    if (!dryRun) {
      await releaseLock(run, { rulesEvaluated: summary.rulesEvaluated, reservationsScanned: summary.reservationsScanned, chargesPosted: summary.chargesPosted, skipped: summary.skipped, errors: summary.errors });
    } else {
      // Dry runs leave no trace
      await AuditRun.deleteOne({ _id: run._id });
      summary.auditRunId = undefined;
    }
  } catch (err: any) {
    if (!dryRun) await releaseLock(run, { rulesEvaluated: 0, reservationsScanned: 0, chargesPosted: 0, skipped: 0, errors: 1 }, err?.message || 'Unknown error');
    summary.errors++;
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────
// Bounded-concurrency worker pool
// ─────────────────────────────────────────────────────────────
//
// Each "worker" is a coroutine that continuously pulls the next task from a
// shared index until the queue is drained. `concurrency` workers run in parallel,
// so no single long-running tenant can block others. A tenant that throws is
// caught and recorded as rejected without affecting any other worker.
//
// This mirrors how enterprise job-queue systems (Bull, Sidekiq, Celery) operate:
// workers are independent consumers of a shared work list. When the workload
// eventually warrants an external queue (Redis/Bull), only this function needs
// to change — the rest of the engine is unchanged.

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const i = cursor++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  // Spawn exactly min(concurrency, tasks.length) workers and wait for all to drain.
  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// ─────────────────────────────────────────────────────────────
// Run audit across all active tenants
// ─────────────────────────────────────────────────────────────

export async function runAudit(options: RunAuditOptions = {}): Promise<AuditSummary[]> {
  const concurrency = Math.max(1, parseInt(process.env.NIGHT_AUDIT_CONCURRENCY || '5', 10));
  const tenants = await Tenant.find({ isActive: true }).select('_id').lean();
  const tasks = tenants.map(t => () => runAuditForTenant(String((t as any)._id), options));
  const settled = await runWithConcurrency(tasks, concurrency);

  const results: AuditSummary[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      results.push(r.value);
    } else {
      // runAuditForTenant catches internally, so a rejection here is unexpected.
      // Log it so it surfaces in monitoring without crashing the entire run.
      console.error('[night-audit] Unexpected worker failure:', r.reason);
    }
  }
  return results;
}
