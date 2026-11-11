import { useLocation } from 'react-router-dom';
import { AppCode } from '../../types';
import { getAppFromPath, usePermission } from '../../lib/permissions';

/**
 * What the signed-in user may do with electronic invoicing in the app they are in. Mirrors the
 * backend (routes/fiscal.ts): a higher level includes the lower ones. The server enforces it; this
 * only keeps buttons from being offered that would be refused.
 */
const VIEW: Record<AppCode, string[]> = {
  pms: ['admin.ecf.view'],
  accounting: ['accounting.invoices.view', 'accounting.invoices.manage', 'accounting.creditNotes.view', 'accounting.debitNotes.view'],
};
const ISSUE: Record<AppCode, string[]> = {
  pms: ['admin.reservations.managePayments', 'cashier'],
  accounting: ['accounting.invoices.manage', 'accounting.creditNotes.manage', 'accounting.debitNotes.manage'],
};
const MANAGE: Record<AppCode, string[]> = {
  pms: ['admin.settings'],
  accounting: ['accounting.settings.manage'],
};

export interface FiscalAccess {
  app: AppCode;
  canView: boolean;
  canIssue: boolean;
  canManage: boolean;
}

export function useFiscalAccess(): FiscalAccess {
  const app = getAppFromPath(useLocation().pathname);
  const canManage = usePermission(MANAGE[app]);
  const canIssue = usePermission([...ISSUE[app], ...MANAGE[app]]);
  const canView = usePermission([...VIEW[app], ...ISSUE[app], ...MANAGE[app]]);
  return { app, canView, canIssue, canManage };
}

/** Where each app keeps its Fiscal Center and its settings. */
export const FISCAL_PATHS: Record<AppCode, { center: string; settings: string }> = {
  pms: { center: '/admin/invoices/ecf', settings: '/admin/settings/e-invoicing' },
  accounting: { center: '/accounting/fiscal', settings: '/accounting/settings?tab=fiscal' },
};
