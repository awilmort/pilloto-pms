import Reservation from '../../models/Reservation';
import Folio from '../../models/Folio';
import Charge from '../../models/Charge';
import Payment from '../../models/Payment';
import Room from '../../models/Room';
import { toDateStr, parseUTCDate, addDays, round2 } from '../../utils/dateUtils';
import { ArrivalRow, DepartureRow } from '../../types/reports';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve guest display name from a reservation document */
function resolveGuestName(r: any): string {
  if (r.guestName?.firstName || r.guestName?.lastName) {
    return `${r.guestName.firstName ?? ''} ${r.guestName.lastName ?? ''}`.trim();
  }
  return r.contactInfo?.email ?? '';
}

/** Compute balance (charges - completed payments) for a folio id, or 0 if none */
async function computeFolioBalance(
  folioId: string | null,
): Promise<{ balance: number; folioStatus: 'open' | 'in_ar' | 'closed' | 'none' }> {
  if (!folioId) return { balance: 0, folioStatus: 'none' };

  const folio = await Folio.findById(folioId).select('status').lean();
  if (!folio) return { balance: 0, folioStatus: 'none' };

  const [charges, payments] = await Promise.all([
    Charge.find({ folioId }).select('amount').lean(),
    Payment.find({ folioId, status: 'completed' }).select('amount').lean(),
  ]);

  const totalCharges = (charges as any[]).reduce((s, c) => s + Number(c.amount), 0);
  const totalPaid = (payments as any[]).reduce((s, p) => s + Number(p.amount), 0);

  return {
    balance: round2(Math.max(0, totalCharges - totalPaid)),
    folioStatus: (folio as any).status as 'open' | 'in_ar' | 'closed',
  };
}

/** Classify payment status for departure rows */
function classifyPaymentStatus(
  balance: number,
  totalCharges: number,
): 'paid' | 'partial' | 'unpaid' {
  if (balance <= 0) return 'paid';
  if (balance < totalCharges) return 'partial';
  return 'unpaid';
}

// ─── Build folio balance map for a set of folio ids ───────────────────────────

interface FolioBalanceEntry {
  balance: number;
  totalCharges: number;
  totalPaid: number;
  folioStatus: 'open' | 'in_ar' | 'closed';
}

async function buildFolioBalanceMap(
  folioIds: string[],
): Promise<Map<string, FolioBalanceEntry>> {
  if (folioIds.length === 0) return new Map();

  const [folios, charges, payments] = await Promise.all([
    Folio.find({ _id: { $in: folioIds } }).select('_id status').lean(),
    Charge.find({ folioId: { $in: folioIds } }).select('folioId amount').lean(),
    Payment.find({ folioId: { $in: folioIds }, status: 'completed' })
      .select('folioId amount')
      .lean(),
  ]);

  const statusMap = new Map<string, 'open' | 'in_ar' | 'closed'>();
  for (const f of folios as any[]) {
    statusMap.set(String(f._id), f.status);
  }

  const chargeMap = new Map<string, number>();
  for (const c of charges as any[]) {
    const fid = String(c.folioId);
    chargeMap.set(fid, (chargeMap.get(fid) || 0) + Number(c.amount));
  }

  const paymentMap = new Map<string, number>();
  for (const p of payments as any[]) {
    const fid = String(p.folioId);
    paymentMap.set(fid, (paymentMap.get(fid) || 0) + Number(p.amount));
  }

  const result = new Map<string, FolioBalanceEntry>();
  for (const fid of folioIds) {
    const totalCharges = chargeMap.get(fid) || 0;
    const totalPaid = paymentMap.get(fid) || 0;
    result.set(fid, {
      balance: round2(Math.max(0, totalCharges - totalPaid)),
      totalCharges: round2(totalCharges),
      totalPaid: round2(totalPaid),
      folioStatus: statusMap.get(fid) || 'open',
    });
  }

  return result;
}

// ─── Arrivals ─────────────────────────────────────────────────────────────────

/**
 * Returns all room reservations with checkInDate on the given date.
 * Also includes reservations that are expected to arrive (confirmed / pending)
 * as well as those already checked-in on that same date.
 */
export async function computeArrivals(date: Date): Promise<ArrivalRow[]> {
  const dateStr = toDateStr(date);
  const dayStart = parseUTCDate(dateStr);
  const dayEnd = addDays(dayStart, 1);

  // Find reservations checking in on this date (not cancelled)
  const reservations = await Reservation.find({
    checkInDate: { $gte: dayStart, $lt: dayEnd },
    status: { $nin: ['cancelled'] },
  })
    .select(
      '_id reservationCode guestName contactInfo room type checkInDate checkOutDate ' +
        'guests guestDetails specialRequests status isCorporate',
    )
    .lean();

  if (reservations.length === 0) return [];

  // Resolve room names
  const roomIds = (reservations as any[])
    .map((r) => r.room)
    .filter(Boolean);
  const rooms = roomIds.length
    ? await Room.find({ _id: { $in: roomIds } }).select('_id name').lean()
    : [];
  const roomNameMap = new Map<string, string>(
    (rooms as any[]).map((r) => [String(r._id), r.name]),
  );

  // Resolve folios
  const reservationIds = (reservations as any[]).map((r) => String(r._id));
  const folios = await Folio.find({
    reservationId: { $in: reservationIds },
  })
    .select('_id reservationId status')
    .lean();

  const folioByReservation = new Map<string, string>(
    (folios as any[]).map((f) => [String(f.reservationId), String(f._id)]),
  );

  const folioIds = (folios as any[]).map((f) => String(f._id));
  const balanceMap = await buildFolioBalanceMap(folioIds);

  return (reservations as any[]).map((r) => {
    const reservationId = String(r._id);
    const folioId = folioByReservation.get(reservationId) || null;
    const balanceEntry = folioId ? balanceMap.get(folioId) : null;

    return {
      reservationId,
      reservationCode: r.reservationCode || '',
      guestName: resolveGuestName(r),
      guestEmail: r.contactInfo?.email ?? '',
      roomName: r.room ? (roomNameMap.get(String(r.room)) ?? null) : null,
      type: r.type,
      checkInDate: (r.checkInDate as Date).toISOString(),
      checkOutDate: r.checkOutDate ? (r.checkOutDate as Date).toISOString() : null,
      totalGuests: (r.guestDetails?.adults ?? 0) + (r.guestDetails?.children ?? 0),
      balanceDue: balanceEntry?.balance ?? 0,
      folioStatus: balanceEntry?.folioStatus ?? 'none',
      specialRequests: r.specialRequests || null,
      status: r.status,
      isCorporate: r.isCorporate ?? false,
    } satisfies ArrivalRow;
  });
}

// ─── Departures ───────────────────────────────────────────────────────────────

/**
 * Returns all room reservations with checkOutDate on the given date.
 * Includes checked-in, completed, and confirmed (expected checkouts not yet processed).
 */
export async function computeDepartures(date: Date): Promise<DepartureRow[]> {
  const dateStr = toDateStr(date);
  const dayStart = parseUTCDate(dateStr);
  const dayEnd = addDays(dayStart, 1);

  const reservations = await Reservation.find({
    checkOutDate: { $gte: dayStart, $lt: dayEnd },
    status: { $nin: ['cancelled'] },
  })
    .select(
      '_id reservationCode guestName contactInfo room type checkInDate checkOutDate ' +
        'guests guestDetails specialRequests status isCorporate',
    )
    .lean();

  if (reservations.length === 0) return [];

  // Resolve room names
  const roomIds = (reservations as any[])
    .map((r) => r.room)
    .filter(Boolean);
  const rooms = roomIds.length
    ? await Room.find({ _id: { $in: roomIds } }).select('_id name').lean()
    : [];
  const roomNameMap = new Map<string, string>(
    (rooms as any[]).map((r) => [String(r._id), r.name]),
  );

  // Resolve folios
  const reservationIds = (reservations as any[]).map((r) => String(r._id));
  const folios = await Folio.find({
    reservationId: { $in: reservationIds },
  })
    .select('_id reservationId status')
    .lean();

  const folioByReservation = new Map<string, string>(
    (folios as any[]).map((f) => [String(f.reservationId), String(f._id)]),
  );

  const folioIds = (folios as any[]).map((f) => String(f._id));
  const balanceMap = await buildFolioBalanceMap(folioIds);

  return (reservations as any[]).map((r) => {
    const reservationId = String(r._id);
    const folioId = folioByReservation.get(reservationId) || null;
    const balanceEntry = folioId ? balanceMap.get(folioId) : null;
    const balance = balanceEntry?.balance ?? 0;
    const totalCharges = balanceEntry?.totalCharges ?? 0;
    const folioStatus = balanceEntry?.folioStatus ?? 'none';

    return {
      reservationId,
      reservationCode: r.reservationCode || '',
      guestName: resolveGuestName(r),
      guestEmail: r.contactInfo?.email ?? '',
      roomName: r.room ? (roomNameMap.get(String(r.room)) ?? null) : null,
      type: r.type,
      checkInDate: (r.checkInDate as Date).toISOString(),
      checkOutDate: r.checkOutDate ? (r.checkOutDate as Date).toISOString() : null,
      totalGuests: (r.guestDetails?.adults ?? 0) + (r.guestDetails?.children ?? 0),
      balanceRemaining: balance,
      folioStatus: folioStatus as 'open' | 'in_ar' | 'closed' | 'none',
      paymentStatus: classifyPaymentStatus(balance, totalCharges),
      isFolioClosed: folioStatus === 'closed',
      specialRequests: r.specialRequests || null,
      status: r.status,
      isCorporate: r.isCorporate ?? false,
    } satisfies DepartureRow;
  });
}
