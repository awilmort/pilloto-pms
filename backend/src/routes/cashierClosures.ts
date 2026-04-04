import mongoose from 'mongoose';
import express, { Response } from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import Payment from '../models/Payment';
import CashierClosure from '../models/CashierClosure';

const router = express.Router();

const DENOMINATIONS = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];

const getPaymentTotalsForUser = async (userId: string, periodStart: Date, periodEnd: Date) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const rows = await Payment.aggregate([
    {
      $match: {
        status: 'completed',
        createdBy: userObjectId,
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

    const { shiftStart, shiftEnd } = req.query as { shiftStart?: string; shiftEnd?: string };
    if (!shiftStart || !shiftEnd) {
      return res.status(400).json({ success: false, message: 'shiftStart and shiftEnd are required' });
    }

    const periodStart = new Date(shiftStart);
    const periodEnd = new Date(shiftEnd);

    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid shiftStart or shiftEnd' });
    }
    if (periodEnd <= periodStart) {
      return res.status(400).json({ success: false, message: 'shiftEnd must be after shiftStart' });
    }

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
      if (from) filter.periodStart.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to) filter.periodStart.$lte = new Date(`${to}T23:59:59.999Z`);
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

    const { shiftStart, shiftEnd, cashDistribution: inputDistribution, note: rawNote } = req.body;

    if (!shiftStart || !shiftEnd) {
      return res.status(400).json({ success: false, message: 'shiftStart and shiftEnd are required' });
    }

    const periodStart = new Date(shiftStart);
    const periodEnd = new Date(shiftEnd);

    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid shiftStart or shiftEnd' });
    }
    if (periodEnd <= periodStart) {
      return res.status(400).json({ success: false, message: 'shiftEnd must be after shiftStart' });
    }

    const note: string | undefined = rawNote ? String(rawNote).trim() : undefined;
    const inputDist = (inputDistribution || {}) as Record<string, number>;

    const exists = await CashierClosure.findOne({ user: userId, periodStart, periodEnd });
    if (exists) {
      return res.status(400).json({ success: false, message: 'A closure already exists for this shift period' });
    }

    const paymentTotals = await getPaymentTotalsForUser(userId, periodStart, periodEnd);
    const cashDistribution = DENOMINATIONS.map((denomination) => {
      const count = Math.max(0, Number(inputDist[String(denomination)] || 0));
      return { denomination, count, subtotal: denomination * count };
    });

    const closure = await CashierClosure.create({
      user: userId,
      periodStart,
      periodEnd,
      paymentTotals,
      cashDistribution,
      ...(note ? { note } : {}),
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
