/**
 * Exchange rates — /api/accounting/exchange-rates (multi-currency module, Pro plan and up).
 *
 *   GET  /                              recent rates (?currency=USD)
 *   GET  /latest?currency=USD&date=…    the rate a document of that date starts from
 *   POST /                              { currency, date, rate } record or correct a day's rate
 */
import express, { Response } from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../../middleware/auth';
import { requireAccountingFeature } from '../../services/entitlements';
import ExchangeRate from '../../models/ExchangeRate';
import { latestRate, setRate } from '../../services/accounting/fx.service';

const router = express.Router();
router.use(authenticate);
router.use(requireAccountingFeature('multiCurrency'));

const fail = (res: Response, err: any) =>
  err?.status ? res.status(err.status).json({ success: false, message: err.message }) : res.status(500).json({ success: false, message: 'Server error' });

router.get('/', authorizePermission('accounting', 'accounting.invoices.view', 'accounting.invoices.manage', 'accounting.bills.view', 'accounting.bills.manage', 'accounting.settings.manage'), async (req: AuthRequest, res: Response) => {
  try {
    const currency = req.query.currency === 'USD' || req.query.currency === 'EUR' ? req.query.currency : undefined;
    res.json({ success: true, data: await ExchangeRate.find(currency ? { currency } : {}).sort({ date: -1 }).limit(90) });
  } catch (err) { fail(res, err); }
});

router.get('/latest', authorizePermission('accounting', 'accounting.invoices.view', 'accounting.invoices.manage', 'accounting.bills.view', 'accounting.bills.manage', 'accounting.settings.manage'), async (req: AuthRequest, res: Response) => {
  try {
    const currency = String(req.query.currency ?? '');
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
    res.json({ success: true, data: { currency, rate: await latestRate(currency, date) } });
  } catch (err) { fail(res, err); }
});

router.post('/', authorizePermission('accounting', 'accounting.invoices.manage', 'accounting.bills.manage', 'accounting.settings.manage'), async (req: AuthRequest, res: Response) => {
  try {
    res.status(201).json({ success: true, data: await setRate(req.body?.currency, req.body?.date, req.body?.rate) });
  } catch (err) { fail(res, err); }
});

export default router;
