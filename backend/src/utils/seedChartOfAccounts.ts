/**
 * Idempotent Chart of Accounts seeder (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md
 * Phase 3.1, PILLOTO_ACCOUNTING_ARCHITECTURE.md §7). Called from
 * `provisionTenant.ts`'s accounting-aware branch, inside the tenant's
 * AsyncLocalStorage context, so `Account.create()` is auto-scoped by
 * `tenantPlugin`. Check-then-insert per account code — safe to run more than
 * once (e.g. re-run against a tenant that already has some accounts); a
 * renamed account is left untouched. Parent links are resolved in a second
 * pass so seed order in `DEFAULT_CHART_OF_ACCOUNTS` doesn't matter.
 */
import Account from '../models/Account';
import { DEFAULT_CHART_OF_ACCOUNTS, NORMAL_BALANCE_BY_ACCOUNT_TYPE } from '../constants/accounting';

export async function seedDefaultChartOfAccounts(): Promise<void> {
  for (const def of DEFAULT_CHART_OF_ACCOUNTS) {
    const existing = await Account.findOne({ code: def.code });
    if (existing) continue;
    await Account.create({
      code: def.code,
      name: def.name,
      type: def.type,
      normalBalance: NORMAL_BALANCE_BY_ACCOUNT_TYPE[def.type],
      isSystem: true,
      isActive: true,
    });
  }

  for (const def of DEFAULT_CHART_OF_ACCOUNTS) {
    if (!def.parentCode) continue;
    const [account, parent] = await Promise.all([
      Account.findOne({ code: def.code }),
      Account.findOne({ code: def.parentCode }),
    ]);
    if (!account || !parent) continue;
    if (account.parentAccount && String(account.parentAccount) === String(parent._id)) continue;
    account.parentAccount = parent._id as any;
    await account.save();
  }
}
