/**
 * Setup readiness (CHANNEX_ARCHITECTURE.md §8.2–8.3; plan Phase 5.3): every check the setup
 * wizard shows before activation, each with a status and the screen that fixes it.
 *
 * Errors block activation (they are the provisioning prerequisites); warnings do not but are
 * shown with their fix link (a room type nobody can book, bookings availability cannot
 * attribute to a room type, nights that will be sold closed because they have no price).
 */

import Reservation from '../../models/Reservation';
import RatePlan from '../../models/RatePlan';
import { auditReservations } from '../../scripts/audit-room-reservations';
import { BLOCKING_RESERVATION_STATUSES } from './inventory.service';
import { Prerequisite, ProvisioningInput, computePrerequisites, loadProvisioningInput } from './provisioning';
import { resolveRates } from './rateResolver';
import { isOnChannels } from './structuralSync';
import { addDays, fromChannexDate, todayInTz } from './dates';

export type ReadinessStatus = 'ok' | 'warning' | 'error';
export type ReadinessId = Prerequisite['id'] | 'roomTypesWithoutRooms' | 'unattributableReservations' | 'noPriceNights';

export interface ReadinessCheck {
  id: ReadinessId;
  status: ReadinessStatus;
  /** Plain-language problem or confirmation (English fallback; the UI translates by id) */
  message: string;
  fixRoute: string;
  /** How many things are affected (room types, reservations, nights) */
  count?: number;
}

export interface ReadinessFacts {
  roomTypesWithoutRooms: string[];
  unattributableReservations: number;
  noPriceNights: number;
}

/** Pure: prerequisites become errors, the extra facts become warnings. */
export function computeReadiness(prerequisites: Prerequisite[], facts: ReadinessFacts): ReadinessCheck[] {
  const checks: ReadinessCheck[] = prerequisites.map((p) => ({
    id: p.id, status: p.ok ? 'ok' : 'error', message: p.ok ? '' : p.message, fixRoute: p.fixRoute,
  }));
  checks.push(
    {
      id: 'roomTypesWithoutRooms', fixRoute: '/admin/rooms', count: facts.roomTypesWithoutRooms.length,
      status: facts.roomTypesWithoutRooms.length ? 'warning' : 'ok',
      message: facts.roomTypesWithoutRooms.length
        ? `These room types have no active rooms and will not be offered on OTAs: ${facts.roomTypesWithoutRooms.join(', ')}.` : '',
    },
    {
      id: 'unattributableReservations', fixRoute: '/admin/reservations', count: facts.unattributableReservations,
      status: facts.unattributableReservations ? 'warning' : 'ok',
      message: facts.unattributableReservations
        ? `${facts.unattributableReservations} upcoming reservation(s) have no room or room type, so they do not reduce availability on OTAs. Assign them a room.` : '',
    },
    {
      id: 'noPriceNights', fixRoute: '/admin/pricing', count: facts.noPriceNights,
      status: facts.noPriceNights ? 'warning' : 'ok',
      message: facts.noPriceNights
        ? `${facts.noPriceNights} night(s) in the next 30 days have a price of 0 or less. They are sent as closed to sale.` : '',
    },
  );
  return checks;
}

export const hasBlockingErrors = (checks: ReadinessCheck[]) => checks.some((c) => c.status === 'error');

/** DB facts for the warnings, in the current tenant context. */
export async function loadReadinessFacts(input: ProvisioningInput, today: string): Promise<ReadinessFacts> {
  const activeTypes = input.roomTypes.filter(isOnChannels);
  const roomTypesWithoutRooms = activeTypes.filter((rt) => !(input.activeRooms[String(rt._id)] > 0)).map((rt) => rt.name);

  const midnight = fromChannexDate(today);
  midnight.setUTCHours(0, 0, 0, 0);
  const [reservations, plans] = await Promise.all([
    Reservation.find({ type: 'room', status: { $in: [...BLOCKING_RESERVATION_STATUSES] }, checkOutDate: { $gte: midnight } })
      .select('status checkInDate checkOutDate room rooms items.kind items.roomTypeId').lean(),
    RatePlan.find({ isActive: true, sellOnChannels: { $ne: false }, roomTypeId: { $in: activeTypes.map((rt) => rt._id) } }).select('_id').lean(),
  ]);
  const unattributableReservations = auditReservations(reservations as any, new Set(activeTypes.map((rt) => String(rt._id))))
    .filter((f) => f.kind === 'unattributable').length;

  let noPriceNights = 0;
  if (plans.length) {
    const resolved = await resolveRates({ dateFrom: today, dateTo: addDays(today, 29), ratePlanIds: plans.map((p) => p._id as any) });
    for (const days of Object.values(resolved)) for (const d of Object.values(days)) if (d.forcedStopSell === 'no_price') noPriceNights++;
  }
  return { roomTypesWithoutRooms, unattributableReservations, noPriceNights };
}

export async function getReadiness(tenant: Parameters<typeof loadProvisioningInput>[0]): Promise<ReadinessCheck[]> {
  const input = await loadProvisioningInput(tenant);
  let today: string;
  try { today = todayInTz(tenant.settings?.timezone || 'UTC'); } catch { today = todayInTz('UTC'); }
  return computeReadiness(computePrerequisites(input), await loadReadinessFacts(input, today));
}
