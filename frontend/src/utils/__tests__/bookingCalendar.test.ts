import { getRoomIds, unassignedEntry, packLanes, occupancyByDay, moveConflict } from '../bookingCalendar';
import { Reservation, Room } from '../../types';

const room = (id: string, typeId: string): Room => ({ _id: id, name: id, roomTypeId: { _id: typeId, name: typeId } } as any);
const roomsById: Record<string, Room> = {
  t1: room('t1', 'TWIN'), t2: room('t2', 'TWIN'), d1: room('d1', 'DOUBLE'), s1: room('s1', 'SUITE'),
};
const res = (over: Partial<Reservation>): Reservation => ({
  _id: 'r1', type: 'room', status: 'confirmed', checkInDate: '2026-11-02T12:00:00.000Z', checkOutDate: '2026-11-04T12:00:00.000Z',
  guests: 2, guestDetails: { adults: 2, children: 0, infants: 0 }, estimatedTotal: 0, contactInfo: { phone: '', email: '' },
  createdAt: '', updatedAt: '', ...over,
} as Reservation);
const item = (roomTypeId: string | null, quantity = 1) => ({ kind: 'room' as const, roomTypeId, quantity });

describe('getRoomIds', () => {
  it('unions room and rooms, populated or not', () => {
    expect(getRoomIds(res({ room: 't1', rooms: ['t1', { _id: 'd1' } as any] })).sort()).toEqual(['d1', 't1']);
    expect(getRoomIds(res({}))).toEqual([]);
  });
});

describe('unassignedEntry (Unassigned lane)', () => {
  it('a room-type booking without a room is unassigned', () => {
    expect(unassignedEntry(res({ items: [item('TWIN')] }), roomsById)).toMatchObject({ missing: 1, typeIds: ['TWIN'] });
  });

  it('once assigned a room it leaves the Unassigned lane (and shows on that room’s lane)', () => {
    const assigned = res({ items: [item('TWIN')], room: 't1', rooms: ['t1'] });
    expect(unassignedEntry(assigned, roomsById)).toBeNull();
    expect(getRoomIds(assigned)).toEqual(['t1']);
  });

  it('a partly assigned multi-room booking keeps only its missing rooms in the lane', () => {
    expect(unassignedEntry(res({ items: [item('TWIN', 2), item('DOUBLE')], rooms: ['t1'] }), roomsById))
      .toMatchObject({ missing: 2, typeIds: ['TWIN', 'DOUBLE'] });
  });

  it('an upgrade covers a booked room of another type', () => {
    expect(unassignedEntry(res({ items: [item('TWIN')], room: 's1' }), roomsById)).toBeNull();
  });

  it('legacy reservations: unassigned only when no room at all', () => {
    expect(unassignedEntry(res({}), roomsById)).toMatchObject({ missing: 1, typeIds: [] });
    expect(unassignedEntry(res({ room: 't2' }), roomsById)).toBeNull();
  });
});

describe('packLanes', () => {
  it('stacks overlapping stays and reuses a lane once the earlier stay has checked out', () => {
    const spans = { a: [1, 4], b: [2, 3], c: [4, 6], d: [3, 5] } as Record<string, [number, number]>;
    const { placed, lanes } = packLanes(Object.keys(spans), k => ({ start: spans[k][0], end: spans[k][1] }));
    const laneOf = Object.fromEntries(placed.map(p => [p.item, p.lane]));
    expect(laneOf).toEqual({ a: 0, b: 1, d: 1, c: 0 });
    expect(lanes).toBe(2);
  });

  it('one lane minimum', () => {
    expect(packLanes([], () => ({ start: 0, end: 0 })).lanes).toBe(1);
  });
});

describe('occupancyByDay', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
  it('counts each night a stay holds (check-out night excluded) over active rooms', () => {
    const rows = occupancyByDay(days, [res({ room: 't1' })], roomsById, ['t1', 't2', 'd1', 's1']);
    expect(rows.map(r => r.sold)).toEqual([0, 1, 1, 0]);
    expect(rows[1].pct).toBe(25);
  });
  it('counts assigned rooms plus booked rooms still waiting for one; skips cancelled', () => {
    const multi = res({ _id: 'r2', items: [item('TWIN', 3)], rooms: ['t1'] });
    const cancelled = res({ _id: 'r3', status: 'cancelled' as any, room: 't2' });
    expect(occupancyByDay(days, [multi, cancelled], roomsById, ['t1', 't2', 'd1', 's1']).map(r => r.pct)).toEqual([0, 75, 75, 0]);
  });
  it('is 0% with no rooms', () => {
    expect(occupancyByDay(days, [res({})], roomsById, [])[1]).toEqual({ sold: 1, available: 0, pct: 0 });
  });
  it('takes active rooms out of service out of availability (end date exclusive)', () => {
    const block = { _id: 'b', roomId: 't2', startDate: '2026-11-02', endDate: '2026-11-03', reason: 'maintenance' } as any;
    const rows = occupancyByDay(days, [res({ room: 't1' })], roomsById, ['t1', 't2', 'd1', 's1'], [block]);
    expect(rows.map(r => r.available)).toEqual([4, 3, 4, 4]);
    expect(rows[1].pct).toBe(33);
  });
});

describe('moveConflict (drag and drop preview)', () => {
  const other = res({ _id: 'o1', room: 't2', checkInDate: '2026-11-05T12:00:00.000Z', checkOutDate: '2026-11-07T12:00:00.000Z' });
  const block = { _id: 'b1', roomId: 't2', startDate: '2026-11-10', endDate: '2026-11-12', reason: 'maintenance' } as any;
  const moving = res({ room: 't1' });
  it('finds a stay overlapping the new nights; check-out day is free', () => {
    expect(moveConflict(moving, 't2', '2026-11-06', '2026-11-08', [other], [])).toMatchObject({ kind: 'reservation' });
    expect(moveConflict(moving, 't2', '2026-11-03', '2026-11-05', [other], [])).toBeNull();
    expect(moveConflict(moving, 't2', '2026-11-07', '2026-11-09', [other], [])).toBeNull();
  });
  it('ignores the moving stay itself and stays that no longer hold the room', () => {
    expect(moveConflict(moving, 't1', '2026-11-03', '2026-11-05', [moving], [])).toBeNull();
    expect(moveConflict(moving, 't2', '2026-11-06', '2026-11-08', [{ ...other, status: 'checked-out' } as any], [])).toBeNull();
  });
  it('finds a room block on that room (end date exclusive)', () => {
    expect(moveConflict(moving, 't2', '2026-11-11', '2026-11-13', [], [block])).toMatchObject({ kind: 'block' });
    expect(moveConflict(moving, 't2', '2026-11-12', '2026-11-14', [], [block])).toBeNull();
    expect(moveConflict(moving, 't1', '2026-11-11', '2026-11-13', [], [block])).toBeNull();
  });
});
