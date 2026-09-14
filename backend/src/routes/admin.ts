import express, { Request, Response } from 'express';
import User from '../models/User';
import Role from '../models/Role';
import Room from '../models/Room';
import Reservation from '../models/Reservation';
import Media from '../models/Media';
import WristbandDelivery from '../models/WristbandDelivery';
import Folio from '../models/Folio';
import Charge from '../models/Charge';
import Payment from '../models/Payment';
import CreditAccount from '../models/CreditAccount';
import { authenticate, authorize, authorizePermission, userHasAppAccess, userHasPermission, AuthRequest } from '../middleware/auth';
import { getSortObject } from '../utils/helpers';
import { sendVerificationEmail } from '../utils/email';
import { AppCode, isAppCode } from '../constants/apps';
import { PERMISSIONS_BY_APP, APP_ACCESS_PERMISSION, APP_USERS_PERMISSION } from '../constants/permissions';
import { getAccountingPlanFeatures } from '../config/accountingPlans';
import { postPaymentCompletedEntry } from '../services/accounting/pmsLedgerHooks';

const router = express.Router();

async function getFolioTotalsByReservationIds(reservationIds: string[]) {
  if (!reservationIds.length) return new Map<string, { totalCharges: number; totalPayments: number; balance: number; folioStatus?: string }>();

  const folios = await Folio.find({ reservationId: { $in: reservationIds as any } }).select('_id reservationId status').lean();
  const folioIds = folios.map((f: any) => f._id);

  const [chargeAgg, paymentAgg] = await Promise.all([
    Charge.aggregate([
      { $match: { folioId: { $in: folioIds } } },
      { $group: { _id: '$folioId', total: { $sum: '$amount' } } },
    ]),
    Payment.aggregate([
      { $match: { folioId: { $in: folioIds }, status: { $ne: 'reversed' } } },
      { $group: { _id: '$folioId', total: { $sum: '$amount' } } },
    ]),
  ]);

  const chargeMap = new Map<string, number>(chargeAgg.map((r: any) => [String(r._id), Number(r.total || 0)]));
  const paymentMap = new Map<string, number>(paymentAgg.map((r: any) => [String(r._id), Number(r.total || 0)]));

  const byReservation = new Map<string, { totalCharges: number; totalPayments: number; balance: number; folioStatus?: string }>();
  for (const f of folios as any[]) {
    const totalCharges = chargeMap.get(String(f._id)) || 0;
    const totalPayments = paymentMap.get(String(f._id)) || 0;
    const balance = Math.max(0, totalCharges - totalPayments);
    byReservation.set(String(f.reservationId), { totalCharges, totalPayments, balance, folioStatus: f.status });
  }
  return byReservation;
}

async function getSettledReservationIdSet(reservationIds: string[]) {
  const totals = await getFolioTotalsByReservationIds(reservationIds);
  const settled = new Set<string>();
  for (const id of reservationIds) {
    const t = totals.get(String(id));
    if (t && t.totalCharges > 0 && t.balance <= 0) settled.add(String(id));
  }
  return settled;
}

// Permission catalog to support role management UIs
// Exposes the canonical, verified-by-grep permission list for the requested app
// (backend/src/constants/permissions.ts is the single source of truth).
// @route   GET /api/admin/permissions?app=pms|accounting
// @desc    List known permissions for an app (defaults to pms)
// @access  Private — caller must have that app's master access permission
router.get('/permissions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const appParam = (req.query.app as string | undefined) ?? 'pms';
    if (!isAppCode(appParam)) {
      return res.status(400).json({ success: false, message: 'Invalid app' });
    }
    const app: AppCode = appParam;
    const allowed = await userHasPermission(req.user, app, [APP_ACCESS_PERMISSION[app]], req.tenantId, (req.tenant as any)?.products);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied for this app.' });
    }

    res.status(200).json({ success: true, data: PERMISSIONS_BY_APP[app] });
  } catch (error: any) {
    console.error('List permissions error:', error);
    res.status(500).json({ success: false, message: 'Server error while listing permissions' });
  }
});

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard statistics
// @access  Private (Admin or roles with dashboard/access permission)
router.get('/dashboard', authenticate, authorizePermission('pms', 'admin.dashboard', 'admin.access'), async (req, res) => {
  try {
    // Get basic counts
    const totalUsers = await User.countDocuments({ role: 'customer' });
    const totalRooms = await Room.countDocuments();
    const totalReservations = await Reservation.countDocuments();

    // Get revenue statistics from standalone payments (completed only)
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const [revenueData, paidReservationsAgg] = await Promise.all([
      Payment.aggregate([
        { $match: { createdAt: { $gte: yearStart }, status: 'completed' } },
        { $group: { _id: null, totalRevenue: { $sum: '$amount' } } }
      ]),
      Payment.aggregate([
        { $match: { createdAt: { $gte: yearStart }, status: 'completed' } },
        {
          $lookup: {
            from: 'folios',
            localField: 'folioId',
            foreignField: '_id',
            as: 'folio'
          }
        },
        { $unwind: '$folio' },
        { $group: { _id: '$folio.reservationId' } },
        { $count: 'count' }
      ]),
    ]);

    // Monthly reservation count + payment revenue
    const [monthlyCounts, monthlyRevenue] = await Promise.all([
      Reservation.aggregate([
        { $match: { createdAt: { $gte: yearStart } } },
        {
          $group: {
            _id: {
              month: { $month: '$createdAt' },
              year: { $year: '$createdAt' }
            },
            count: { $sum: 1 },
          }
        },
      ]),
      Payment.aggregate([
        { $match: { createdAt: { $gte: yearStart }, status: 'completed' } },
        {
          $group: {
            _id: {
              month: { $month: '$createdAt' },
              year: { $year: '$createdAt' }
            },
            revenue: { $sum: '$amount' }
          }
        },
      ])
    ]);

    const monthlyRevenueMap = new Map(monthlyRevenue.map((r: any) => [`${r._id.year}-${r._id.month}`, Number(r.revenue || 0)]));
    const monthlyReservations = monthlyCounts
      .map((m: any) => ({
        _id: m._id,
        count: m.count,
        revenue: monthlyRevenueMap.get(`${m._id.year}-${m._id.month}`) || 0,
      }))
      .sort((a: any, b: any) => (a._id.year - b._id.year) || (a._id.month - b._id.month));

    // Get room occupancy rates
    const roomOccupancy = await Room.aggregate([
      {
        $lookup: {
          from: 'reservations',
          localField: '_id',
          foreignField: 'room',
          as: 'reservations'
        }
      },
      {
        $project: {
          name: 1,
          type: 1,
          status: 1,
          totalReservations: { $size: '$reservations' },
          confirmedReservations: {
            $size: {
              $filter: {
                input: '$reservations',
                cond: { $eq: ['$$this.status', 'confirmed'] }
              }
            }
          }
        }
      }
    ]);

    // Get recent activities
    const recentReservations = await Reservation.find()
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .sort('-createdAt')
      .limit(5);

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalUsers,
          totalRooms,
          totalReservations,
          totalRevenue: revenueData[0]?.totalRevenue || 0,
          paidReservations: paidReservationsAgg[0]?.count || 0
        },
        charts: {
          monthlyReservations,
          roomOccupancy
        },
        recentActivity: {
          reservations: recentReservations
        }
      }
    });
  } catch (error: any) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching dashboard data'
    });
  }
});

// @route   GET /api/admin/revenue
// @desc    Get revenue and guest totals by category for a date range, plus pending payments
// @access  Private (permission: admin.revenue)
router.get('/revenue', authenticate, authorizePermission('pms', 'admin.revenue', 'admin.access'), async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };

    // Default to today for both from and to
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // Parse YYYY-MM-DD as local date to avoid UTC offset issues
    const parseLocalDate = (s: string) => {
      const parts = s.split('-');
      if (parts.length === 3) {
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        const d = Number(parts[2]);
        // Construct using local timezone at midnight
        return new Date(y, (m - 1), d, 0, 0, 0, 0);
      }
      // Fallback to native parsing
      return new Date(s);
    };

    let fromDate = from ? parseLocalDate(from) : todayStart;
    let toDate = to ? parseLocalDate(to) : todayEnd;

    // Clamp to not exceed current date (no future payments)
    if (fromDate.getTime() > todayEnd.getTime()) fromDate = todayStart;
    if (toDate.getTime() > todayEnd.getTime()) toDate = todayEnd;

    // Normalize to day boundaries
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    // 1) Load completed payments in range joined to reservation
    const paymentRows = await Payment.aggregate([
      { $match: { status: 'completed' } },
      {
        $addFields: {
          effectiveDate: {
            $cond: [
              { $and: [{ $eq: ['$method', 'credit'] }, { $ne: ['$creditPaymentDate', null] }] },
              '$creditPaymentDate',
              '$createdAt'
            ]
          }
        }
      },
      { $match: { effectiveDate: { $gte: fromDate, $lte: toDate } } },
      {
        $lookup: {
          from: 'folios',
          localField: 'folioId',
          foreignField: '_id',
          as: 'folio'
        }
      },
      { $unwind: '$folio' },
      {
        $lookup: {
          from: 'reservations',
          localField: 'folio.reservationId',
          foreignField: '_id',
          as: 'reservation'
        }
      },
      { $unwind: '$reservation' },
      {
        $project: {
          amount: 1,
          method: {
            $cond: [
              { $and: [{ $eq: ['$method', 'credit'] }, { $ne: ['$creditPaymentMethod', null] }] },
              '$creditPaymentMethod',
              '$method'
            ]
          },
          reservationId: '$reservation._id',
          type: '$reservation.type',
          guestName: '$reservation.guestName',
          userId: '$reservation.user',
          adults: '$reservation.guestDetails.adults',
          children: '$reservation.guestDetails.children',
          guests: '$reservation.guests',
          adultPrice: '$reservation.adultPrice',
          childrenPrice: '$reservation.childrenPrice',
          totalPrice: { $ifNull: ['$reservation.estimatedTotal', '$reservation.totalPrice'] }
        }
      }
    ]);

    // 2) Revenue by type and method from completed payments
    const revenueByTypeMap = new Map<string, number>();
    const revenueByMethodMap = new Map<string, number>();
    for (const row of paymentRows as any[]) {
      const type = String(row.type || 'other');
      const method = String(row.method || 'other');
      revenueByTypeMap.set(type, (revenueByTypeMap.get(type) || 0) + Number(row.amount || 0));
      revenueByMethodMap.set(method, (revenueByMethodMap.get(method) || 0) + Number(row.amount || 0));
    }

    // 3) Distinct reservation rows represented in the selected payment range
    const reservationDetailMap = new Map<string, any>();
    for (const row of paymentRows as any[]) {
      const id = String(row.reservationId);
      if (!reservationDetailMap.has(id)) reservationDetailMap.set(id, row);
    }
    const reservationDetailAgg = Array.from(reservationDetailMap.values());

    // 4) Guest totals by type from distinct reservations in-range
    const guestsByTypeMap = new Map<string, { adults: number; children: number; guests: number }>();
    for (const r of reservationDetailAgg as any[]) {
      const key = String(r.type);
      const cur = guestsByTypeMap.get(key) || { adults: 0, children: 0, guests: 0 };
      cur.adults += Number(r.adults || 0);
      cur.children += Number(r.children || 0);
      cur.guests += Number(r.guests || 0);
      guestsByTypeMap.set(key, cur);
    }

    // Build category map
    const getCat = (type: string) => {
      const key = type === 'PasaTarde' ? 'pasatarde' : type; // normalize key
      return key as 'room' | 'daypass' | 'event' | 'pasatarde';
    };

    const categories: Record<'room' | 'daypass' | 'event' | 'pasatarde', { adults: number; children: number; guests: number; revenue: number }> = {
      room: { adults: 0, children: 0, guests: 0, revenue: 0 },
      daypass: { adults: 0, children: 0, guests: 0, revenue: 0 },
      event: { adults: 0, children: 0, guests: 0, revenue: 0 },
      pasatarde: { adults: 0, children: 0, guests: 0, revenue: 0 },
    };

    for (const [type, revenue] of revenueByTypeMap.entries()) {
      const key = getCat(type);
      if (!categories[key]) continue;
      categories[key].revenue = revenue || 0;
    }
    for (const [type, g] of guestsByTypeMap.entries()) {
      const key = getCat(type);
      if (!categories[key]) continue;
      categories[key].adults = g.adults || 0;
      categories[key].children = g.children || 0;
      categories[key].guests = g.guests || 0;
    }

    // Build per-type reservation lists for UI breakdown
    const missingDetailUserIds = reservationDetailAgg
      .filter((r: any) => !r.guestName?.firstName && r.userId)
      .map((r: any) => r.userId);
    const detailUsers = missingDetailUserIds.length > 0
      ? await User.find({ _id: { $in: missingDetailUserIds } }).select('firstName lastName')
      : [];
    const detailUserMap = new Map((detailUsers as any[]).map((u: any) => [String(u._id), u]));

    type ReservationEntry = { id: string; guest: string; adults: number; children: number; adultPrice: number; childrenPrice: number; totalPrice: number };
    const reservations: Record<'room' | 'daypass' | 'event' | 'pasatarde', ReservationEntry[]> = { room: [], daypass: [], event: [], pasatarde: [] };

    for (const r of reservationDetailAgg) {
      const key = getCat(r.type);
      let guest = 'Guest';
      if (r.guestName?.firstName) {
        guest = `${r.guestName.firstName} ${r.guestName.lastName || ''}`.trim();
      } else if (r.userId) {
        const u = detailUserMap.get(String(r.userId));
        if (u) guest = `${(u as any).firstName} ${(u as any).lastName}`.trim();
      }
      reservations[key].push({
        id: String(r._id),
        guest,
        adults: r.adults || 0,
        children: r.children || 0,
        adultPrice: r.adultPrice || 0,
        childrenPrice: r.childrenPrice || 0,
        totalPrice: r.totalPrice || 0,
      });
    }

    // Payment method totals
    const income = { total: 0, cash: 0, transfer: 0, card: 0 };
    for (const [m, amountRaw] of revenueByMethodMap.entries()) {
      const method = m as 'cash' | 'transfer' | 'card';
      const amount = Number(amountRaw || 0);
      if (method === 'cash') income.cash = amount;
      else if (method === 'transfer') income.transfer = amount;
      else if (method === 'card') income.card = amount;
      income.total += amount;
    }

    // Account receivable: pending credit payments
    const pendingCreditRows = await Payment.aggregate([
      { $match: { method: 'credit', status: 'pending' } },
      {
        $lookup: {
          from: 'folios',
          localField: 'folioId',
          foreignField: '_id',
          as: 'folio'
        }
      },
      { $unwind: '$folio' },
      {
        $lookup: {
          from: 'reservations',
          localField: 'folio.reservationId',
          foreignField: '_id',
          as: 'reservation'
        }
      },
      { $unwind: '$reservation' },
      {
        $lookup: {
          from: 'guests',
          localField: 'reservation.guestRecord',
          foreignField: '_id',
          as: 'guestRecord'
        }
      },
      { $unwind: { path: '$guestRecord', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'companies',
          localField: 'reservation.company',
          foreignField: '_id',
          as: 'company'
        }
      },
      { $unwind: { path: '$company', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          paymentId: '$_id',
          reservationId: '$reservation._id',
          reservationCode: '$reservation.reservationCode',
          type: '$reservation.type',
          amount: '$amount',
          createdAt: '$createdAt',
          folioStatus: '$folio.status',
          totalPrice: { $ifNull: ['$reservation.estimatedTotal', '$reservation.totalPrice'] },
          guestName: '$reservation.guestName',
          userId: '$reservation.user',
          guestRecord: {
            firstName: '$guestRecord.firstName',
            lastName: '$guestRecord.lastName',
            email: '$guestRecord.email'
          },
          company: {
            _id: '$company._id',
            name: '$company.name',
            email: '$company.email'
          }
        }
      },
      { $sort: { createdAt: -1 } },
      { $limit: 300 }
    ]);

    const pendingUserIds = pendingCreditRows
      .filter((row: any) => !row.guestRecord?.firstName && !row.guestName?.firstName && row.userId)
      .map((row: any) => row.userId);
    const pendingUsers = pendingUserIds.length > 0
      ? await User.find({ _id: { $in: pendingUserIds } }).select('firstName lastName email').lean()
      : [];
    const pendingUserMap = new Map((pendingUsers as any[]).map((u: any) => [String(u._id), u]));

    res.status(200).json({
      success: true,
      data: {
        filters: { from: fromDate, to: toDate },
        categories,
        income,
        pending: pendingCreditRows.map((row: any) => {
          let guest = 'Guest';
          if (row.guestRecord?.firstName) {
            guest = `${row.guestRecord.firstName} ${row.guestRecord.lastName || ''}`.trim();
          } else if (row.guestName?.firstName) {
            guest = `${row.guestName.firstName} ${row.guestName.lastName || ''}`.trim();
          } else if (row.userId) {
            const user = pendingUserMap.get(String(row.userId));
            if (user) guest = `${(user as any).firstName} ${(user as any).lastName}`.trim();
          }

          return {
            id: row.reservationId,
            paymentId: row.paymentId,
            reservationCode: row.reservationCode || String(row.reservationId).slice(-6),
            type: row.type,
            guest,
            company: row.company || null,
            endedOn: row.createdAt,
            balanceDue: Number(row.amount || 0),
            totalPrice: Number(row.totalPrice || 0),
            totalPayments: 0
          };
        }),
        reservations
      }
    });
  } catch (error: any) {
    console.error('Get revenue error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching revenue data' });
  }
});

// @route   POST /api/admin/revenue/account-receivable/:paymentId/process
// @desc    Settle pending credit payment and close folio
// @access  Private (permission: admin.revenue)
router.post('/revenue/account-receivable/:paymentId/process', authenticate, authorizePermission('pms', 'admin.revenue', 'admin.access'), async (req: Request, res: Response) => {
  try {
    const { creditPaymentMethod } = req.body as { creditPaymentMethod?: 'cash' | 'card' | 'transfer' | 'check' };
    const allowedMethods = ['cash', 'card', 'transfer', 'check'];
    if (!creditPaymentMethod || !allowedMethods.includes(creditPaymentMethod)) {
      return res.status(400).json({ success: false, message: 'creditPaymentMethod is required and must be cash, card, transfer, or check' });
    }

    const payment = await Payment.findById(req.params.paymentId);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.method !== 'credit' || payment.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending credit payments can be processed' });
    }

    const folio = await Folio.findById(payment.folioId);
    if (!folio) return res.status(404).json({ success: false, message: 'Folio not found' });

    const reservation = await Reservation.findById(folio.reservationId).select('company guestRecord totalPayments');
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });

    let creditAccount: any = null;
    if (reservation.company) {
      creditAccount = await CreditAccount.findOne({ scope: 'company', referenceId: reservation.company });
    }
    if (!creditAccount && reservation.guestRecord) {
      creditAccount = await CreditAccount.findOne({ scope: 'guest', referenceId: reservation.guestRecord });
    }

    if (creditAccount) {
      creditAccount.currentExposure = Math.max(0, Number(creditAccount.currentExposure || 0) - Number(payment.amount || 0));
      await creditAccount.save();
    }

    payment.status = 'completed';
    payment.creditPaymentMethod = creditPaymentMethod;
    payment.creditPaymentDate = new Date();
    payment.createdBy = (req as any).user?._id || (req as any).user?.id;
    await payment.save();

    // Phase 7.2: this is the CreditAccount "settlement" event from architecture §6.2 —
    // cash/card/transfer/check actually received against the company/guest credit line.
    await postPaymentCompletedEntry(
      (req as any).tenant,
      payment,
      (req as any).user?._id || (req as any).user?.id,
      creditPaymentMethod
    );

    folio.status = 'closed';
    await folio.save();

    const totalPaymentsAgg = await Payment.aggregate([
      { $match: { folioId: folio._id, status: { $ne: 'reversed' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    reservation.totalPayments = Number(totalPaymentsAgg?.[0]?.total || 0);
    await reservation.save();

    res.status(200).json({
      success: true,
      message: 'Account receivable payment processed successfully',
      data: {
        paymentId: payment._id,
        creditPaymentMethod: payment.creditPaymentMethod,
        creditPaymentDate: payment.creditPaymentDate,
      }
    });
  } catch (error: any) {
    console.error('Process account receivable payment error:', error);
    res.status(500).json({ success: false, message: 'Server error while processing account receivable payment' });
  }
});

// @route   GET /api/admin/commissions
// @desc    List users with Salesman permission and total guests on reservations they created within a date range; supports name/email filters
// @access  Private (permission: admin.commissions or admin.access)
router.get('/commissions', authenticate, authorizePermission('pms', 'admin.commissions', 'admin.access'), async (req: Request, res: Response) => {
  try {
    const { from, to, name, email } = req.query as { from?: string; to?: string; name?: string; email?: string };

    // Parse local dates and clamp
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const parseLocalDate = (s?: string) => {
      if (!s) return undefined;
      const parts = s.split('-');
      if (parts.length === 3) {
        const y = Number(parts[0]); const m = Number(parts[1]); const d = Number(parts[2]);
        return new Date(y, m - 1, d, 0, 0, 0, 0);
      }
      return new Date(s);
    };
    let fromDate = parseLocalDate(from) || todayStart;
    let toDate = parseLocalDate(to) || todayEnd;
    if (fromDate.getTime() > todayEnd.getTime()) fromDate = todayStart;
    if (toDate.getTime() > todayEnd.getTime()) toDate = todayEnd;
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    // Find roles that have the 'salesman' permission
    const salesmanRoles = await Role.find({ permissions: 'salesman' }).select('name');
    const roleNames = salesmanRoles.map((r: any) => String(r.name).toLowerCase());

    // Find users with those roles, applying optional name/email filters
    const userFilter: any = { role: { $in: roleNames } };
    if (name && name.trim()) {
      const n = name.trim();
      userFilter.$or = [
        { firstName: { $regex: n, $options: 'i' } },
        { lastName: { $regex: n, $options: 'i' } }
      ];
    }
    if (email && email.trim()) {
      userFilter.email = { $regex: email.trim(), $options: 'i' };
    }

    const users = await User.find(userFilter).select('firstName lastName email role');

    // Aggregate reservations per user within date range based on standalone completed payments
    const userIds = users.map(u => u._id);
    const paymentRows = await Payment.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate }, status: 'completed' } },
      {
        $lookup: {
          from: 'folios',
          localField: 'folioId',
          foreignField: '_id',
          as: 'folio'
        }
      },
      { $unwind: '$folio' },
      {
        $lookup: {
          from: 'reservations',
          localField: 'folio.reservationId',
          foreignField: '_id',
          as: 'reservation'
        }
      },
      { $unwind: '$reservation' },
      {
        $match: {
          'reservation.user': { $in: userIds }
        }
      },
      {
        $project: {
          reservationId: '$reservation._id',
          user: '$reservation.user',
          guests: '$reservation.guests'
        }
      }
    ]);

    const distinctReservations = new Map<string, { reservationId: string; user: string; guests: number }>();
    for (const row of paymentRows as any[]) {
      const id = String(row.reservationId);
      if (!distinctReservations.has(id)) {
        distinctReservations.set(id, {
          reservationId: id,
          user: String(row.user),
          guests: Number(row.guests || 0),
        });
      }
    }

    const settledSet = await getSettledReservationIdSet(Array.from(distinctReservations.keys()));
    const aggMap = new Map<string, { totalGuests: number; bookings: number }>();
    for (const row of distinctReservations.values()) {
      if (!settledSet.has(row.reservationId)) continue;
      const cur = aggMap.get(row.user) || { totalGuests: 0, bookings: 0 };
      cur.totalGuests += row.guests;
      cur.bookings += 1;
      aggMap.set(row.user, cur);
    }

    const agg = Array.from(aggMap.entries()).map(([userId, stats]) => ({ _id: userId, ...stats }));

    const statsByUser: Record<string, { totalGuests: number; bookings: number }> = {};
    for (const a of agg) {
      statsByUser[String(a._id)] = { totalGuests: a.totalGuests || 0, bookings: a.bookings || 0 };
    }

    const result = users.map(u => ({
      id: u._id,
      name: `${u.firstName} ${u.lastName}`,
      email: u.email,
      role: u.role,
      totalGuests: statsByUser[String(u._id)]?.totalGuests || 0,
      bookings: statsByUser[String(u._id)]?.bookings || 0,
    }));

    res.status(200).json({
      success: true,
      data: {
        filters: { from: fromDate, to: toDate, name: name || '', email: email || '' },
        salesmen: result
      }
    });
  } catch (error: any) {
    console.error('Get commissions error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching commissions data' });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users with pagination
// @access  Private (Admin only)

    // Wristband Control
    // @route   POST /api/admin/wristbands/deliveries
    // @desc    Register a wristband delivery for a given date with counts per category
    // @access  Private (permission: admin.wristbands.manage or admin.access)
    router.post('/wristbands/deliveries', authenticate, authorizePermission('pms', 'admin.wristbands.manage', 'admin.access'), async (req: Request, res: Response) => {
      try {
        const { date, recipient, counts, notes, type } = req.body as {
          date?: string | Date;
          recipient?: string;
          counts?: { daypassAdults?: number; daypassChildren?: number; accommodations?: number; pasatarde?: number };
          notes?: string;
          type?: 'delivery' | 'collection';
        };

        const parseLocalDate = (s?: string | Date) => {
          if (!s) return null;
          if (s instanceof Date) return s;
          const str = String(s);
          const strict = /^\d{4}-\d{2}-\d{2}$/.test(str);
          if (strict) {
            const [y, m, d] = str.split('-').map(Number);
            return new Date(y, m - 1, d, 0, 0, 0, 0);
          }
          const d2 = new Date(str);
          return isNaN(d2.getTime()) ? null : d2;
        };

        const deliveryDate = parseLocalDate(date) || new Date();
        if (!deliveryDate || isNaN(deliveryDate.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid or missing delivery date' });
        }

        const payload = {
          date: deliveryDate,
          deliveredBy: (req as any).user?._id,
          recipient: recipient ? String(recipient).trim() : undefined,
          counts: {
            daypassAdults: Number(counts?.daypassAdults ?? 0),
            daypassChildren: Number(counts?.daypassChildren ?? 0),
            accommodations: Number(counts?.accommodations ?? 0),
            pasatarde: Number(counts?.pasatarde ?? 0),
          },
          notes: notes ? String(notes).trim() : undefined,
          type: type || 'delivery',
        };

        const created = await WristbandDelivery.create(payload as any);
        res.status(201).json({ success: true, message: 'Wristband delivery registered', data: created });
      } catch (error: any) {
        console.error('Create wristband delivery error:', error);
        if (error?.name === 'ValidationError') {
          const messages = Object.values(error.errors || {}).map((e: any) => e?.message || 'Validation error');
          return res.status(400).json({ success: false, message: 'Validation failed', errors: messages });
        }
        res.status(500).json({ success: false, message: 'Server error while creating wristband delivery' });
      }
    });

    // @route   GET /api/admin/wristbands/deliveries
    // @desc    List all wristband deliveries/collections (no date filter)
    // @access  Private (permission: admin.wristbands.view or admin.access)
    router.get('/wristbands/deliveries', authenticate, authorizePermission('pms', 'admin.wristbands.view', 'admin.access'), async (req: Request, res: Response) => {
      try {
        const deliveries = await WristbandDelivery.find().sort({ date: -1 }).exec();
        res.status(200).json({ success: true, count: deliveries.length, data: deliveries });
      } catch (error: any) {
        console.error('List wristband deliveries error:', error);
        res.status(500).json({ success: false, message: 'Server error while retrieving wristband deliveries' });
      }
    });

    // @route   PUT /api/admin/wristbands/deliveries/:id
    // @desc    Update a wristband delivery
    // @access  Private (permission: admin.wristbands.manage or admin.access)
    router.put('/wristbands/deliveries/:id', authenticate, authorizePermission('pms', 'admin.wristbands.manage', 'admin.access'), async (req: Request, res: Response) => {
      try {
        const { date, recipient, counts, notes, type } = req.body as {
          date?: string | Date;
          recipient?: string;
          counts?: { daypassAdults?: number; daypassChildren?: number; accommodations?: number; pasatarde?: number };
          notes?: string;
          type?: 'delivery' | 'collection';
        };

        const parseLocalDate = (s?: string | Date) => {
          if (!s) return null;
          if (s instanceof Date) return s;
          const str = String(s);
          const strict = /^\d{4}-\d{2}-\d{2}$/.test(str);
          if (strict) {
            const [y, m, d] = str.split('-').map(Number);
            return new Date(y, m - 1, d, 0, 0, 0, 0);
          }
          const d2 = new Date(str);
          return isNaN(d2.getTime()) ? null : d2;
        };

        const update: any = {};
        if (date) {
          const deliveryDate = parseLocalDate(date);
          if (!deliveryDate || isNaN(deliveryDate.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid delivery date' });
          }
          update.date = deliveryDate;
        }
        if (recipient !== undefined) update.recipient = recipient ? String(recipient).trim() : undefined;
        if (notes !== undefined) update.notes = notes ? String(notes).trim() : undefined;
        if (type !== undefined) update.type = type;
        if (counts) {
          update.counts = {
            daypassAdults: Number(counts.daypassAdults ?? 0),
            daypassChildren: Number(counts.daypassChildren ?? 0),
            accommodations: Number(counts.accommodations ?? 0),
            pasatarde: Number(counts.pasatarde ?? 0),
          };
        }

        const updated = await WristbandDelivery.findByIdAndUpdate(
          req.params.id,
          { $set: update },
          { new: true, runValidators: true }
        );

        if (!updated) {
          return res.status(404).json({ success: false, message: 'Wristband delivery not found' });
        }

        res.status(200).json({ success: true, message: 'Wristband delivery updated', data: updated });
      } catch (error: any) {
        console.error('Update wristband delivery error:', error);
        if (error?.name === 'ValidationError') {
          const messages = Object.values(error.errors || {}).map((e: any) => e?.message || 'Validation error');
          return res.status(400).json({ success: false, message: 'Validation failed', errors: messages });
        }
        if (error?.name === 'CastError') {
          return res.status(400).json({ success: false, message: 'Invalid delivery ID' });
        }
        res.status(500).json({ success: false, message: 'Server error while updating wristband delivery' });
      }
    });

    // @route   GET /api/admin/wristbands/usage
    // @desc    Get wristband usage counts by category for a date range
    //          - accommodations: room reservations with actualCheckInAt in range (arrived)
    //          - daypass: fully paid daypass reservations in range
    //          - pasatarde: fully paid PasaTarde reservations in range
    // @access  Private (permission: admin.wristbands.view or admin.access)
    router.get('/wristbands/usage', authenticate, authorizePermission('pms', 'admin.wristbands.view', 'admin.access'), async (req: Request, res: Response) => {
      try {
        const { from, to } = req.query as { from?: string; to?: string };
        const parseLocalDate = (s?: string) => {
          if (!s) return null;
          const [y, m, d] = s.split('-').map(Number);
          if (!y || !m || !d) return null;
          // Normalize to start of day UTC to avoid TZ drift
          return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
        };
        // Use half-open [from, toNext) interval to include full days reliably
        const today = new Date();
        const utcStart = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0));
        const fromDate = parseLocalDate(from) || utcStart;
        const toBase = parseLocalDate(to) || utcStart; // end bound is computed as next day
        const toNextDay = new Date(toBase.getTime() + 24 * 60 * 60 * 1000);

        // Rooms: count guests for reservations that have checked in
        const roomsAgg = await Reservation.aggregate([
          { $match: { type: 'room', actualCheckInAt: { $gte: fromDate, $lt: toNextDay } } },
          { $group: { _id: null, guests: { $sum: '$guests' } } }
        ]);
        const accommodations = roomsAgg[0]?.guests || 0;

        // DayPass/PasaTarde: settled folio reservations within range
        const paidCandidates = await Reservation.find({
          type: { $in: ['daypass', 'PasaTarde'] },
          checkInDate: { $gte: fromDate, $lt: toNextDay }
        }).select('_id type guestDetails guests');

        const settledSet = await getSettledReservationIdSet(paidCandidates.map((r: any) => String(r._id)));
        let daypassAdults = 0;
        let daypassChildren = 0;
        let pasatarde = 0;
        for (const r of paidCandidates as any[]) {
          if (!settledSet.has(String(r._id))) continue;
          if (r.type === 'daypass') {
            daypassAdults += Number(r.guestDetails?.adults || 0);
            daypassChildren += Number(r.guestDetails?.children || 0);
          } else if (r.type === 'PasaTarde') {
            pasatarde += Number(r.guests || 0);
          }
        }

        res.status(200).json({ success: true, data: { accommodations, daypassAdults, daypassChildren, pasatarde } });
      } catch (error) {
        console.error('Get wristband usage error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching wristband usage' });
      }
    });

    // @route   DELETE /api/admin/wristbands/deliveries/:id
    // @desc    Delete a wristband delivery
    // @access  Private (permission: admin.wristbands.manage or admin.access)
    router.delete('/wristbands/deliveries/:id', authenticate, authorizePermission('pms', 'admin.wristbands.manage', 'admin.access'), async (req: Request, res: Response) => {
      try {
        const deleted = await WristbandDelivery.findByIdAndDelete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ success: false, message: 'Wristband delivery not found' });
        }
        res.status(200).json({ success: true, message: 'Wristband delivery deleted' });
      } catch (error: any) {
        console.error('Delete wristband delivery error:', error);
        if (error?.name === 'CastError') {
          return res.status(400).json({ success: false, message: 'Invalid delivery ID' });
        }
        res.status(500).json({ success: false, message: 'Server error while deleting wristband delivery' });
      }
    });
router.get('/users', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const {
      role,
      isActive,
      search,
      page = 1,
      limit = 20,
      sort = '-createdAt'
    } = req.query;

    const appParam = (req.query.app as string | undefined) ?? 'pms';
    if (!isAppCode(appParam)) {
      return res.status(400).json({ success: false, message: 'Invalid app' });
    }
    const app: AppCode = appParam;
    const allowed = await userHasPermission(req.user, app, [APP_USERS_PERMISSION[app]], req.tenantId, (req.tenant as any)?.products);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied for this app.' });
    }

    // Build filter object — scoped to users who have a role assignment in this app
    const filter: any = { 'appRoles.app': app };

    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const users = await User.find(filter)
      .sort(getSortObject(sort))
      .limit(limitNum)
      .skip(skip)
      .select('-password');

    const total = await User.countDocuments(filter);
    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalUsers: total,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error: any) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users'
    });
  }
});

// @route   POST /api/admin/users
// @desc    Create a new user (admin only)
// @access  Private (Admin only)
router.post('/users', authenticate, authorizePermission('pms', 'admin.users'), async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, phone, role = 'customer', password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    const user = new User({ firstName, lastName, email, phone, role, password });
    await user.save();

    // Generate verification token and send welcome/activation email
    const verificationToken = user.generateEmailVerificationToken();
    await user.save();
    try {
      await sendVerificationEmail(user, verificationToken);
    } catch (emailError) {
      console.error('Verification email error on user create:', emailError);
      // Do not fail the creation if email sending fails
    }

    const userSafe = await User.findById(user._id).select('-password');
    res.status(201).json({ success: true, message: 'User created successfully', data: userSafe });
  } catch (error: any) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating user' });
  }
});

// @route   PUT /api/admin/users/:id
// @desc    Update user details (admin only)
// @access  Private (Admin only)
router.put('/users/:id', authenticate, authorizePermission('pms', 'admin.users'), async (req, res) => {
  try {
    const { firstName, lastName, email, phone, role, isActive, emailVerified } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (emailVerified !== undefined) user.emailVerified = emailVerified;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error: any) {
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user'
    });
  }
});

// @route   PATCH /api/admin/users/:id/role
// @desc    Update a user's role (admin only)
// @access  Private — caller must hold the target app's users-management permission
router.patch('/users/:id/role', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { role, roleId, app: appFromBody } = req.body;

    // App-scoped path: assign or remove a specific app's role. `roleId: null`
    // (with `app` given explicitly) removes that app's assignment.
    if (roleId !== undefined) {
      let app: AppCode;
      let roleDoc: any = null;
      if (roleId) {
        roleDoc = await Role.findById(roleId);
        if (!roleDoc) {
          return res.status(404).json({ success: false, message: 'Role not found' });
        }
        app = roleDoc.app as AppCode;
      } else {
        if (!isAppCode(appFromBody)) {
          return res.status(400).json({ success: false, message: 'Invalid or missing app' });
        }
        app = appFromBody;
      }

      const allowed = await userHasPermission(req.user, app, [APP_USERS_PERMISSION[app]], req.tenantId, (req.tenant as any)?.products);
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'Access denied for this app.' });
      }

      const target = await User.findById(req.params.id);
      if (!target) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Accounting plan ladder (Phase 10.2): granting a *new* accounting seat is
      // gated on the tenant's plan-tier user limit — per architecture §7's "gated
      // on ... user count". Only checked when this user doesn't already hold an
      // accounting seat (re-assigning/removing one is always allowed).
      if (app === 'accounting' && roleDoc && !target.appRoles.some((ar) => ar.app === 'accounting')) {
        const { maxUsers } = getAccountingPlanFeatures((req.tenant as any)?.plans?.accounting);
        if (maxUsers !== null) {
          const currentSeats = await User.countDocuments({ 'appRoles.app': 'accounting' });
          if (currentSeats >= maxUsers) {
            return res.status(403).json({
              success: false,
              message: `Your Accounting plan allows up to ${maxUsers} user(s). Upgrade your plan to add more.`,
            });
          }
        }
      }

      target.appRoles = [
        ...target.appRoles.filter((ar) => ar.app !== app),
        ...(roleDoc ? [{ app, role: roleDoc._id as any }] : []),
      ];
      // Keep the legacy flat `role` field in sync for pms — still read by authorize()/legacy checks
      // when no pms appRoles entry exists. Reset to 'customer' on removal so the legacy
      // by-name fallback doesn't silently restore the access this call just revoked.
      if (app === 'pms') {
        target.role = roleDoc ? roleDoc.name : 'customer';
      }
      await target.save();

      const safe = await User.findById(target._id).select('-password');
      return res.status(200).json({ success: true, message: 'User role updated', data: safe });
    }

    // Legacy path: flat role-name assignment (pms-implied, behavior unchanged).
    if (!role) {
      return res.status(400).json({ success: false, message: 'Role is required' });
    }
    const legacyAllowed = await userHasPermission(req.user, 'pms', [APP_USERS_PERMISSION.pms], req.tenantId, (req.tenant as any)?.products);
    if (!legacyAllowed) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
    }

    const normalizedRole = String(role).toLowerCase();

    // Update role without revalidating required fields like password
    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { role: normalizedRole } },
      { new: true, runValidators: false, projection: { password: 0 } }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, message: 'User role updated', data: updated });
  } catch (error: any) {
    console.error('Update user role error:', error);
    res.status(500).json({ success: false, message: error?.message || 'Server error while updating user role' });
  }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete user (admin only)
// @access  Private (Admin only)
router.delete('/users/:id', authenticate, authorizePermission('pms', 'admin.users'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deleting admin users
    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete admin users'
      });
    }

    // Check if user has active reservations
    const activeReservations = await Reservation.countDocuments({
      user: req.params.id,
      status: { $in: ['pending', 'confirmed'] }
    });

    if (activeReservations > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete user with active reservations'
      });
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting user'
    });
  }
});

// @route   GET /api/admin/analytics
// @desc    Get detailed analytics data
// @access  Private (Admin only)
router.get('/analytics', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate, period = 'month' } = req.query;

    let matchCondition: any = {};

    if (startDate && endDate) {
      matchCondition.createdAt = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string)
      };
    }

    // Revenue analytics from completed standalone payments
    const revenueAnalytics = await Payment.aggregate([
      {
        $match: {
          ...(matchCondition.createdAt ? { createdAt: matchCondition.createdAt } : {}),
          status: 'completed'
        }
      },
      {
        $lookup: {
          from: 'folios',
          localField: 'folioId',
          foreignField: '_id',
          as: 'folio'
        }
      },
      { $unwind: '$folio' },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            ...(period === 'day' && { day: { $dayOfMonth: '$createdAt' } })
          },
          totalRevenue: { $sum: '$amount' },
          reservationIds: { $addToSet: '$folio.reservationId' }
        }
      },
      {
        $project: {
          _id: 1,
          totalRevenue: 1,
          totalReservations: { $size: '$reservationIds' },
          averageBookingValue: {
            $cond: [
              { $gt: [{ $size: '$reservationIds' }, 0] },
              { $divide: ['$totalRevenue', { $size: '$reservationIds' }] },
              0
            ]
          }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Room type analytics removed

    // Customer analytics
    const customerAnalytics = await User.aggregate([
      { $match: { role: 'customer', ...matchCondition } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          newCustomers: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        revenue: revenueAnalytics,
        roomTypes: [],
        customers: customerAnalytics
      }
    });
  } catch (error: any) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching analytics'
    });
  }
});

// @route   POST /api/admin/backup
// @desc    Create database backup (admin only)
// @access  Private (Admin only)
router.post('/backup', authenticate, authorize('admin'), async (req, res) => {
  try {
    // This is a placeholder for backup functionality
    // In a real application, you would implement database backup logic here

    res.status(200).json({
      success: true,
      message: 'Backup functionality not implemented yet',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Backup error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating backup'
    });
  }
});

export default router;
