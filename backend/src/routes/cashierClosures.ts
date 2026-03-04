import express, { Response } from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import AppSettings from '../models/AppSettings';
import Payment from '../models/Payment';
import CashierClosure from '../models/CashierClosure';

const router = express.Router();

const DENOMINATIONS = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];

const parseShiftTime = (timeValue: string, baseDate: Date) => {
  const [rawHour, rawMinute] = String(timeValue || '').split(':');
  const hour = Number(rawHour || 0);
  const minute = Number(rawMinute || 0);
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hour,
    minute,
    0,
    0
  );
};

const resolveShiftPeriod = async () => {
  const settings = await AppSettings.findOne({ key: 'global' }).lean();
  const openTime = settings?.cashierShift?.openTime || '08:00';
  const closeTime = settings?.cashierShift?.closeTime || '17:00';

  const now = new Date();
  let periodStart = parseShiftTime(openTime, now);
  let periodEnd = parseShiftTime(closeTime, now);

  if (periodEnd <= periodStart) {
    periodEnd.setDate(periodEnd.getDate() + 1);
  }

  if (now < periodStart) {
    periodStart.setDate(periodStart.getDate() - 1);
    periodEnd.setDate(periodEnd.getDate() - 1);
  }

  return { periodStart, periodEnd, openTime, closeTime };
};

const getPaymentTotalsForUser = async (userId: string, periodStart: Date, periodEnd: Date) => {
  const rows = await Payment.aggregate([
    {
      $match: {
        status: 'completed',
        createdBy: userId as any,
      }
    },
    {
      $addFields: {
        effectiveDate: {
          $cond: [
            { $and: [{ $eq: ['$method', 'credit'] }, { $ne: ['$creditPaymentDate', null] }] },
            '$creditPaymentDate',
            '$createdAt'
          ]
        },
        effectiveMethod: {
          $cond: [
            { $and: [{ $eq: ['$method', 'credit'] }, { $ne: ['$creditPaymentMethod', null] }] },
            '$creditPaymentMethod',
            '$method'
          ]
        }
      }
    },
    {
      $match: {
        effectiveDate: { $gte: periodStart, $lte: periodEnd },
        effectiveMethod: { $in: ['cash', 'card', 'transfer', 'check'] }
      }
    },
    {
      $group: {
        _id: '$effectiveMethod',
        amount: { $sum: '$amount' }
      }
    }
  ]);

  const totals = { cash: 0, card: 0, transfer: 0, check: 0, total: 0 };
  for (const row of rows as any[]) {
    const method = String(row._id);
    const amount = Number(row.amount || 0);
    if (method === 'cash') totals.cash = amount;
    if (method === 'card') totals.card = amount;
    if (method === 'transfer') totals.transfer = amount;
    if (method === 'check') totals.check = amount;
    totals.total += amount;
  }

  return totals;
};

router.get('/preview', authenticate, authorizePermission('cashier', 'admin.access'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = String(req.user?._id || req.user?.id || '');
    if (!userId) return res.status(401).json({ success: false, message: 'Authentication required' });

    const { periodStart, periodEnd } = await resolveShiftPeriod();
    const paymentTotals = await getPaymentTotalsForUser(userId, periodStart, periodEnd);

    res.status(200).json({
      success: true,
      data: {
        periodStart,
        periodEnd,
        paymentTotals,
        denominations: DENOMINATIONS,
      }
    });
  } catch (error: any) {
    console.error('Cashier closure preview error:', error);
    res.status(500).json({ success: false, message: 'Failed to build cashier closure preview' });
  }
});

router.get('/', authenticate, authorizePermission('cashier', 'admin.access'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = String(req.user?._id || req.user?.id || '');
    if (!userId) return res.status(401).json({ success: false, message: 'Authentication required' });

    const { from, to } = req.query as { from?: string; to?: string };
    const filter: any = { user: userId };

    if (from || to) {
      filter.periodStart = {};
      if (from) filter.periodStart.$gte = new Date(`${from}T00:00:00.000`);
      if (to) filter.periodStart.$lte = new Date(`${to}T23:59:59.999`);
    }

    const closures = await CashierClosure.find(filter)
      .populate('user', 'firstName lastName email')
      .sort({ periodStart: -1 })
      .lean();

    res.status(200).json({ success: true, data: closures });
  } catch (error: any) {
    console.error('Cashier closure list error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve cashier closures' });
  }
});

router.post('/', authenticate, authorizePermission('cashier', 'admin.access'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = String(req.user?._id || req.user?.id || '');
    if (!userId) return res.status(401).json({ success: false, message: 'Authentication required' });

    const inputDistribution = (req.body?.cashDistribution || {}) as Record<string, number>;
    const { periodStart, periodEnd } = await resolveShiftPeriod();

    const exists = await CashierClosure.findOne({ user: userId, periodStart, periodEnd });
    if (exists) {
      return res.status(400).json({ success: false, message: 'A closure already exists for this shift period' });
    }

    const paymentTotals = await getPaymentTotalsForUser(userId, periodStart, periodEnd);
    const cashDistribution = DENOMINATIONS.map((denomination) => {
      const count = Math.max(0, Number(inputDistribution[String(denomination)] || 0));
      return {
        denomination,
        count,
        subtotal: denomination * count,
      };
    });

    const closure = await CashierClosure.create({
      user: userId,
      periodStart,
      periodEnd,
      paymentTotals,
      cashDistribution,
    });

    const populated = await CashierClosure.findById(closure._id)
      .populate('user', 'firstName lastName email');

    res.status(201).json({ success: true, data: populated });
  } catch (error: any) {
    console.error('Cashier closure create error:', error);
    res.status(500).json({ success: false, message: 'Failed to create cashier closure' });
  }
});

export default router;
