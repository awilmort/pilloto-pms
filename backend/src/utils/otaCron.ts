/**
 * otaCron.ts — manages the OTA sync cron task lifecycle.
 *
 * Decoupled from index.ts so platform routes can restart
 * the cron with a new interval without server restarts.
 */
import cron, { ScheduledTask } from 'node-cron';
import { runOtaSyncTick } from './otaWorker';

let _task: ScheduledTask | null = null;
let _currentIntervalMinutes = 5;
let _globalEnabled = true;

/** Converts interval (minutes) to a cron expression. */
function cronExpr(minutes: number): string {
  // node-cron supports seconds-level so we use standard 5-field expressions
  if (minutes <= 59) return `*/${minutes} * * * *`;
  return `0 */${Math.round(minutes / 60)} * * *`;
}

/**
 * Start the OTA cron with the given interval.
 * Called once at server startup (after DB is ready).
 */
export function initOtaCron(intervalMinutes: number, enabled: boolean): void {
  _currentIntervalMinutes = intervalMinutes;
  _globalEnabled = enabled;

  if (!enabled) {
    console.log('⚠️  OTA sync globally disabled (platform setting)');
    return;
  }

  _task = cron.schedule(cronExpr(intervalMinutes), async () => {
    try {
      await runOtaSyncTick();
    } catch (err) {
      console.error('❌ OTA sync tick error:', err);
    }
  });

  console.log(`🔄 OTA sync worker running (${intervalMinutes}-min tick)`);
}

/**
 * Stop and restart the cron with updated settings.
 * Called by platform PATCH /ota/config.
 */
export function restartOtaCron(intervalMinutes: number, enabled: boolean): void {
  if (_task) {
    _task.stop();
    _task = null;
    console.log('🔄 OTA cron stopped for restart');
  }
  initOtaCron(intervalMinutes, enabled);
}

/** Stop the cron cleanly (e.g. on SIGTERM). */
export function stopOtaCron(): void {
  if (_task) {
    _task.stop();
    _task = null;
  }
}

/** Current state, surfaced in the platform API response. */
export function getOtaCronStatus(): {
  running: boolean;
  globalEnabled: boolean;
  intervalMinutes: number;
} {
  return {
    running: _task !== null,
    globalEnabled: _globalEnabled,
    intervalMinutes: _currentIntervalMinutes,
  };
}
