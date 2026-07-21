import Reservation from '../../models/Reservation';
import Room from '../../models/Room';
import Folio from '../../models/Folio';
import Charge from '../../models/Charge';
import Payment from '../../models/Payment';
import CashierClosure from '../../models/CashierClosure';
import {
  toDateStr,
  parseUTCDate,
  addDays,
  round2,
  buildDateRange,
} from '../../utils/dateUtils';
import {
  NightAuditData,
  NightAuditRevenue,
  NightAuditPayments,
  NightAuditRangeRow,
  CashierClosureSummary,
} from '../../types/reports';

// ─── Single-date full audit ───────────────────────────────────────────────────

export async function computeNightAudit(date: Date): Promise<NightAuditData> {
  const dateStr = toDateStr(date);
  const dayStart = parseUTCDate(dateStr);
  const dayEnd = addDays(dayStart, 1);

  // ── Room Stats ──────────────────────────────────────────────────────────────
  const [totalRooms, movingReservations, occupiedReservations] = await Promise.all([
    Room.countDocuments({ status: 'active' }),
    Reservation.find({
      type: 'room',
      $or: [
        { checkInDate: { $gte: dayStart, $lt: dayEnd } },
        { checkOutDate: { $gte: dayStart, $lt: dayEnd } },
      ],
    })
      .select('_id status checkInDate checkOutDate')
      .lean(),
    Reservation.find({
      type: 'room',
      status: 'checked-in',
      checkInDate: { $lt: dayEnd },
      checkOutDate: { $gt: dayStart },
    })
      .select('_id checkInDate checkOutDate')
      .lean(),
  ]);

  const arriving = (movingReservations as any[]).filter((r) => {
    const cin = new Date(r.checkInDate);
    return cin >= dayStart && cin < dayEnd;
  });

  const departing = (movingReservations as any[]).filter((r) => {
    const cout = r.checkOutDate ? new Date(r.checkOutDate) : null;
    return (
      cout &&
      cout >= dayStart &&
      cout < dayEnd &&
      ['checked-in', 'completed'].includes(r.status)
    );
  });

  const arrivals = arriving.length;
  const arrivalsDone = arriving.filter((r) =>
    ['checked-in', 'completed'].includes(r.status),
  ).length;
  const departures = departing.length;
  const departuresDone = departing.filter((r) => r.status === 'completed').length;
  const noShows = arriving.filter((r) =>
    ['pending', 'confirmed'].includes(r.status),
  ).length;
  const occupied = (occupiedReservations as any[]).length;

  const departingIds = new Set(departing.map((r: any) => String(r._id)));
  const stayOvers = (occupiedReservations as any[]).filter(
    (r) => !departingIds.has(String(r._id)),
  ).length;

  // ── Revenue ─────────────────────────────────────────────────────────────────
  const charges = await Charge.find({
    createdAt: { $gte: dayStart, $lt: dayEnd },
  })
    .select('amount category')
    .lean();

  const revenue: NightAuditRevenue = {
    room: 0,
    service: 0,
    lateFee: 0,
    damage: 0,
    adjustment: 0,
    other: 0,
    total: 0,
  };
  for (const c of charges as any[]) {
    const amt = Number(c.amount);
    switch (c.category) {
      case 'room':       revenue.room       += amt; break;
      case 'service':    revenue.service    += amt; break;
      case 'late_fee':   revenue.lateFee    += amt; break;
      case 'damage':     revenue.damage     += amt; break;
      case 'adjustment': revenue.adjustment += amt; break;
      default:           revenue.other      += amt;
    }
    revenue.total += amt;
  }
  revenue.room       = round2(revenue.room);
  revenue.service    = round2(revenue.service);
  revenue.lateFee    = round2(revenue.lateFee);
  revenue.damage     = round2(revenue.damage);
  revenue.adjustment = round2(revenue.adjustment);
  revenue.other      = round2(revenue.other);
  revenue.total      = round2(revenue.total);

  // ── Payments ────────────────────────────────────────────────────────────────
  const paymentsToday = await Payment.find({
    createdAt: { $gte: dayStart, $lt: dayEnd },
    status: 'completed',
  })
    .select('amount method')
    .lean();

  const payments: NightAuditPayments = {
    cash: 0, card: 0, transfer: 0, check: 0, credit: 0, total: 0,
  };
  for (const p of paymentsToday as any[]) {
    const amt = Number(p.amount);
    switch (p.method) {
      case 'cash':     payments.cash     += amt; break;
      case 'card':     payments.card     += amt; break;
      case 'transfer': payments.transfer += amt; break;
      case 'check':    payments.check    += amt; break;
      case 'credit':   payments.credit   += amt; break;
    }
    payments.total += amt;
  }
  payments.cash     = round2(payments.cash);
  payments.card     = round2(payments.card);
  payments.transfer = round2(payments.transfer);
  payments.check    = round2(payments.check);
  payments.credit   = round2(payments.credit);
  payments.total    = round2(payments.total);

  // ── Outstanding Balances ────────────────────────────────────────────────────
  const openFolios = await Folio.find({ status: { $in: ['open', 'in_ar'] } })
    .select('_id')
    .lean();
  const openFolioIds = (openFolios as any[]).map((f) => f._id);

  let totalOutstanding = 0;
  let openFoliosWithBalance = 0;

  if (openFolioIds.length > 0) {
    const [folioCharges, folioPayments] = await Promise.all([
      Charge.find({ folioId: { $in: openFolioIds } }).select('folioId amount').lean(),
      Payment.find({ folioId: { $in: openFolioIds }, status: 'completed' })
        .select('folioId amount')
        .lean(),
    ]);

    const chargesByFolio = new Map<string, number>();
    for (const c of folioCharges as any[]) {
      const fid = String(c.folioId);
      chargesByFolio.set(fid, (chargesByFolio.get(fid) || 0) + Number(c.amount));
    }

    const paymentsByFolio = new Map<string, number>();
    for (const p of folioPayments as any[]) {
      const fid = String(p.folioId);
      paymentsByFolio.set(fid, (paymentsByFolio.get(fid) || 0) + Number(p.amount));
    }

    for (const folioId of openFolioIds) {
      const fid = String(folioId);
      const balance = (chargesByFolio.get(fid) || 0) - (paymentsByFolio.get(fid) || 0);
      if (balance > 0.005) {
        openFoliosWithBalance++;
        totalOutstanding += balance;
      }
    }
  }

  // ── Cashier Closures ────────────────────────────────────────────────────────
  const closures = await CashierClosure.find({
    periodStart: { $lt: dayEnd },
    periodEnd: { $gte: dayStart },
  })
    .select('periodStart periodEnd paymentTotals')
    .lean();

  const cashierClosures: CashierClosureSummary[] = (closures as any[]).map((c) => ({
    id: String(c._id),
    periodStart: (c.periodStart as Date).toISOString(),
    periodEnd: (c.periodEnd as Date).toISOString(),
    totalCash:     round2((c.paymentTotals?.cash     as number) || 0),
    totalCard:     round2((c.paymentTotals?.card     as number) || 0),
    totalTransfer: round2((c.paymentTotals?.transfer as number) || 0),
    totalCheck:    round2((c.paymentTotals?.check    as number) || 0),
    total:         round2((c.paymentTotals?.total    as number) || 0),
  }));

  return {
    date: dateStr,
    roomStats: {
      totalRooms,
      occupied,
      arrivals,
      arrivalsDone,
      departures,
      departuresDone,
      noShows,
      stayOvers,
    },
    revenue,
    payments,
    outstanding: {
      openFoliosCount: openFoliosWithBalance,
      totalOutstanding: round2(totalOutstanding),
    },
    cashierClosures,
  };
}

// ─── Range summary row ────────────────────────────────────────────────────────

export async function computeNightAuditRow(date: Date): Promise<NightAuditRangeRow> {
  const dateStr = toDateStr(date);
  const dayStart = parseUTCDate(dateStr);
  const dayEnd = addDays(dayStart, 1);

  const [totalRooms, movingReservations, occupiedCount, totalRevenue, totalPayments] =
    await Promise.all([
      Room.countDocuments({ status: 'active' }),
      Reservation.find({
        type: 'room',
        $or: [
          { checkInDate: { $gte: dayStart, $lt: dayEnd } },
          { checkOutDate: { $gte: dayStart, $lt: dayEnd } },
        ],
      })
        .select('status checkInDate checkOutDate')
        .lean(),
      Reservation.countDocuments({
        type: 'room',
        status: 'checked-in',
        checkInDate: { $lt: dayEnd },
        checkOutDate: { $gt: dayStart },
      }),
      Charge.aggregate([
        { $match: { createdAt: { $gte: dayStart, $lt: dayEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).then((r) => round2(r[0]?.total || 0)),
      Payment.aggregate([
        { $match: { createdAt: { $gte: dayStart, $lt: dayEnd }, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).then((r) => round2(r[0]?.total || 0)),
    ]);

  const arriving = (movingReservations as any[]).filter((r) => {
    const cin = new Date(r.checkInDate);
    return cin >= dayStart && cin < dayEnd;
  });
  const departing = (movingReservations as any[]).filter((r) => {
    const cout = r.checkOutDate ? new Date(r.checkOutDate) : null;
    return (
      cout &&
      cout >= dayStart &&
      cout < dayEnd &&
      ['checked-in', 'completed'].includes(r.status)
    );
  });

  return {
    date: dateStr,
    totalRooms,
    occupied: occupiedCount,
    arrivals: arriving.length,
    departures: departing.length,
    noShows: arriving.filter((r) => ['pending', 'confirmed'].includes(r.status)).length,
    totalRevenue,
    totalPayments,
  };
}

// ─── Range computation ────────────────────────────────────────────────────────

export async function computeNightAuditRange(
  fromDate: Date,
  toDate: Date,
): Promise<NightAuditRangeRow[]> {
  const days = buildDateRange(fromDate, toDate);
  return Promise.all(days.map((d) => computeNightAuditRow(parseUTCDate(d))));
}
