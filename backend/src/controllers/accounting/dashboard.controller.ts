import { Response } from 'express';
import { AuthRequest, userHasPermission } from '../../middleware/auth';
import { AppCode } from '../../constants/apps';
import * as dashboard from '../../services/accounting/dashboard.service';

/**
 * `GET /api/accounting/dashboard?period=month|lastMonth|quarter|year`. The route only requires
 * `accounting.dashboard`; each block of the response is additionally gated by the permission of the
 * module it summarizes, so a user without e.g. `accounting.reports.view` simply gets no financial
 * block instead of a 403 for the whole page.
 */
export const getDashboardData = async (req: AuthRequest, res: Response) => {
  try {
    const requested = String(req.query.period || 'month') as dashboard.DashboardPeriod;
    const period = dashboard.DASHBOARD_PERIODS.includes(requested) ? requested : 'month';

    const tenantProducts = (req.tenant as any)?.products as AppCode[] | undefined;
    const can = (...permissions: string[]) => userHasPermission(req.user, 'accounting', permissions, req.tenantId, tenantProducts);
    const [financial, receivables, payables, cityLedger, inventory, ecf] = await Promise.all([
      can('accounting.reports.view'),
      can('accounting.invoices.view', 'accounting.invoices.manage'),
      can('accounting.bills.view', 'accounting.bills.manage'),
      can('accounting.cityLedger.view', 'accounting.cityLedger.authorize'),
      can('accounting.inventory.view', 'accounting.inventory.manage'),
      can('accounting.invoices.view', 'accounting.invoices.manage'),
    ]);

    const data = await dashboard.getDashboard(new Date(), period, { financial, receivables, payables, cityLedger, inventory, ecf });
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Accounting dashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error while loading the dashboard' });
  }
};
