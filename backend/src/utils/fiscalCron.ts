/**
 * fiscalCron.ts — schedules the e-CF background jobs (services/fiscal/fiscalJobs.ts).
 *
 * Every minute: resend documents BillingSoft never confirmed, and read the ones it has not finished.
 * Every hour: close last month's statements (before any scheduled plan change, which would otherwise
 * re-price it), apply scheduled downgrades, refresh the open statements' usage and look for
 * certification progress. Does nothing when the server has no BillingSoft credential, or when
 * `FISCAL_WORKERS_DISABLED=true`. A run never overlaps itself.
 */
import cron, { ScheduledTask } from 'node-cron';
import { isFiscalConfigured } from '../config/fiscal';
import { resendPendingIntents, sweepOpenDocuments, syncCertifications } from '../services/fiscal/fiscalJobs';
import { applyScheduledPlanChanges } from '../services/fiscal/fiscalLifecycle';
import { closeDuePeriods, snapshotAllUsage } from '../services/fiscal/fiscalStatements';

const tasks: ScheduledTask[] = [];

export function guarded(name: string, work: () => Promise<unknown>): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await work();
    } catch (err: any) {
      console.error(`[Fiscal] ${name} failed: ${err?.message ?? err}`);
    } finally {
      running = false;
    }
  };
}

export function startFiscalWorkers(): void {
  if (process.env.FISCAL_WORKERS_DISABLED === 'true') {
    console.log('⚠️  e-CF workers disabled via FISCAL_WORKERS_DISABLED=true');
    return;
  }
  if (!isFiscalConfigured()) {
    console.log('ℹ️  e-CF workers not started: BILLINGSOFT_PARTNER_API_KEY is not set');
    return;
  }

  tasks.push(
    cron.schedule(
      '* * * * *',
      guarded('minute jobs', async () => {
        await resendPendingIntents();
        await sweepOpenDocuments();
      }),
    ),
    cron.schedule(
      '5 * * * *',
      guarded('hourly jobs', async () => {
        await closeDuePeriods();
        await applyScheduledPlanChanges();
        await snapshotAllUsage();
        await syncCertifications();
      }),
    ),
  );
  console.log('🧾 e-CF workers running (every minute: resend + sweep; hourly: statements, plans, certification)');
}

export function stopFiscalWorkers(): void {
  while (tasks.length) tasks.pop()?.stop();
}
