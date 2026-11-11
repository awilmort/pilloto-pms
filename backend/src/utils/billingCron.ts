/**
 * billingCron.ts — schedules Pilloto's own subscription billing (services/platformBilling).
 *
 *  - Hourly: generate last month's charge for every tenant that does not have one. Idempotent, so
 *    a missed hour (or a server that was down on the 1st) catches up by itself. It emails tenants,
 *    so it runs by itself only in production; elsewhere set `BILLING_AUTORUN=true` to opt in
 *    (`false` switches it off in production too).
 *  - Every minute: email the e-CF of a payment once BillingSoft has confirmed it.
 *
 * The e-CF itself is never scheduled: it is issued when a payment is recorded.
 */
import cron, { ScheduledTask } from 'node-cron';
import { isFiscalConfigured } from '../config/fiscal';
import { runMonthlyBilling } from '../services/platformBilling/billingCharges';
import { sendDueReceipts } from '../services/platformBilling/billingPayments';
import { guarded } from './fiscalCron';

const tasks: ScheduledTask[] = [];

/** Whether the monthly run starts by itself on this server. */
export const billingAutorun = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.BILLING_AUTORUN === 'true' || (env.NODE_ENV === 'production' && env.BILLING_AUTORUN !== 'false');

export function startBillingWorkers(): void {
  if (billingAutorun()) {
    tasks.push(
      cron.schedule(
        '10 * * * *',
        guarded('monthly billing', async () => {
          const summary = await runMonthlyBilling();
          if (summary.created > 0 || summary.failed > 0) console.log(`[Billing] ${summary.period}: ${summary.created} charged, ${summary.existing} already charged, ${summary.skipped} skipped, ${summary.failed} failed`);
        }),
      ),
    );
    console.log('💳 Monthly billing runs hourly (idempotent)');
  } else {
    console.log('ℹ️  Monthly billing does not run by itself here (production, or BILLING_AUTORUN=true)');
  }
  if (isFiscalConfigured()) {
    tasks.push(cron.schedule('* * * * *', guarded('payment receipts', () => sendDueReceipts())));
  }
}

export function stopBillingWorkers(): void {
  while (tasks.length) tasks.pop()?.stop();
}
