/**
 * InventoryService core (services/channex/inventory.service.ts, architecture §6.1).
 * Pure `computeInventory` — no database.
 */

import {
  computeInventory, unmatchedUnitTypes, minAvailable, toAvailabilityGrid,
  InventoryRoom, InventoryReservation, InventoryBlock,
} from '../services/channex/inventory.service';
import { fromChannexDate as D } from '../services/channex/dates';

const TWIN = 'rt-twin';
const DOUBLE = 'rt-double';
const SUITE = 'rt-suite';

/** 3 Twin, 2 Double, 1 Suite — all active */
const baseRooms = (): InventoryRoom[] => [
  { _id: 't1', roomTypeId: TWIN, status: 'active' },
  { _id: 't2', roomTypeId: TWIN, status: 'active' },
  { _id: 't3', roomTypeId: TWIN, status: 'active' },
  { _id: 'd1', roomTypeId: DOUBLE, status: 'active' },
  { _id: 'd2', roomTypeId: DOUBLE, status: 'active' },
  { _id: 's1', roomTypeId: SUITE, status: 'active' },
];

let seq = 0;
const res = (over: Partial<InventoryReservation> & { checkIn: string; checkOut: string }): InventoryReservation => ({
  _id: `r${++seq}`,
  status: 'confirmed',
  checkInDate: D(over.checkIn),
  checkOutDate: D(over.checkOut),
  ...over,
});
const roomItem = (roomTypeId: string | null, extra: Record<string, unknown> = {}) => ({ kind: 'room', roomTypeId, quantity: 1, ...extra });

const WINDOW = { dateFrom: '2026-11-01', dateTo: '2026-11-07' };

function avail(opts: { rooms?: InventoryRoom[]; reservations?: InventoryReservation[]; blocks?: InventoryBlock[]; dateFrom?: string; dateTo?: string }) {
  return toAvailabilityGrid(computeInventory({
    rooms: opts.rooms ?? baseRooms(),
    reservations: opts.reservations ?? [],
    blocks: opts.blocks ?? [],
    dateFrom: opts.dateFrom ?? WINDOW.dateFrom,
    dateTo: opts.dateTo ?? WINDOW.dateTo,
    roomTypeIds: [TWIN, DOUBLE, SUITE],
  }));
}

describe('computeInventory', () => {
  it('no reservations → every active room is available', () => {
    const a = avail({});
    expect(a[TWIN]['2026-11-01']).toBe(3);
    expect(a[DOUBLE]['2026-11-07']).toBe(2);
    expect(Object.keys(a[TWIN])).toHaveLength(7);
  });

  it('one assigned room takes its room on its nights only (check-out night is free)', () => {
    const a = avail({ reservations: [res({ checkIn: '2026-11-02', checkOut: '2026-11-04', room: 't1' })] });
    expect(a[TWIN]['2026-11-01']).toBe(3);
    expect(a[TWIN]['2026-11-02']).toBe(2);
    expect(a[TWIN]['2026-11-03']).toBe(2);
    expect(a[TWIN]['2026-11-04']).toBe(3);
    expect(a[DOUBLE]['2026-11-02']).toBe(2);
  });

  it('an unassigned room-type item counts as demand for its type', () => {
    const a = avail({ reservations: [res({ checkIn: '2026-11-02', checkOut: '2026-11-03', items: [roomItem(DOUBLE)] })] });
    expect(a[DOUBLE]['2026-11-02']).toBe(1);
    expect(a[DOUBLE]['2026-11-03']).toBe(2);
    expect(a[TWIN]['2026-11-02']).toBe(3);
  });

  it('an assigned room of the same type covers its item (no double counting)', () => {
    const a = avail({ reservations: [res({ checkIn: '2026-11-02', checkOut: '2026-11-03', items: [roomItem(TWIN)], room: 't2' })] });
    expect(a[TWIN]['2026-11-02']).toBe(2);
  });

  it('item quantity > 1 counts each room', () => {
    const a = avail({ reservations: [res({ checkIn: '2026-11-02', checkOut: '2026-11-03', items: [roomItem(TWIN, { quantity: 2 })] })] });
    expect(a[TWIN]['2026-11-02']).toBe(1);
  });

  it('upgrade: two items of different types and one assigned room of a third type', () => {
    // Twin + Double booked; the guest got the Suite for one of them.
    const r = res({
      checkIn: '2026-11-02', checkOut: '2026-11-03',
      items: [roomItem(TWIN), roomItem(DOUBLE)],
      room: 's1',
    });
    const a = avail({ reservations: [r] });
    expect(a[SUITE]['2026-11-02']).toBe(0); // the suite is physically taken
    // One of the two items is covered by the suite; exactly one unit of demand remains
    expect(a[TWIN]['2026-11-02'] + a[DOUBLE]['2026-11-02']).toBe(3 + 2 - 1);
  });

  it('same-type matching comes before upgrades', () => {
    // Twin + Double booked, assigned a Double and the Suite: the Double covers the Double item,
    // the Suite upgrades the Twin item → no demand left.
    const a = avail({
      reservations: [res({ checkIn: '2026-11-02', checkOut: '2026-11-03', items: [roomItem(TWIN), roomItem(DOUBLE)], rooms: ['d1', 's1'] })],
    });
    expect(a[TWIN]['2026-11-02']).toBe(3);
    expect(a[DOUBLE]['2026-11-02']).toBe(1);
    expect(a[SUITE]['2026-11-02']).toBe(0);
  });

  it('cancelled and completed reservations never block; pending and checked-in do', () => {
    const a = avail({
      reservations: [
        res({ checkIn: '2026-11-02', checkOut: '2026-11-03', room: 't1', status: 'cancelled' }),
        res({ checkIn: '2026-11-02', checkOut: '2026-11-03', room: 't2', status: 'completed' }), // early checkout
        res({ checkIn: '2026-11-02', checkOut: '2026-11-03', items: [roomItem(DOUBLE)], status: 'cancelled' }),
        res({ checkIn: '2026-11-02', checkOut: '2026-11-03', items: [roomItem(TWIN)], status: 'pending' }),
        res({ checkIn: '2026-11-02', checkOut: '2026-11-03', room: 'd1', status: 'checked-in' }),
      ],
    });
    expect(a[TWIN]['2026-11-02']).toBe(2); // only the pending item
    expect(a[DOUBLE]['2026-11-02']).toBe(1); // only the checked-in stay
  });

  it('a multi-night stay spanning the window edges counts only nights inside the window', () => {
    const a = avail({
      reservations: [
        res({ checkIn: '2026-10-28', checkOut: '2026-11-03', room: 't1' }),       // starts before
        res({ checkIn: '2026-11-06', checkOut: '2026-11-12', items: [roomItem(TWIN)] }), // ends after
      ],
    });
    expect(a[TWIN]['2026-11-01']).toBe(2);
    expect(a[TWIN]['2026-11-02']).toBe(2);
    expect(a[TWIN]['2026-11-03']).toBe(3);
    expect(a[TWIN]['2026-11-05']).toBe(3);
    expect(a[TWIN]['2026-11-06']).toBe(2);
    expect(a[TWIN]['2026-11-07']).toBe(2);
    expect(a[TWIN]['2026-11-08']).toBeUndefined();
  });

  it('an overbooked type returns 0, never negative, and reports the shortfall', () => {
    const reservations = [
      res({ checkIn: '2026-11-02', checkOut: '2026-11-03', items: [roomItem(DOUBLE, { quantity: 2 })] }),
      res({ checkIn: '2026-11-02', checkOut: '2026-11-03', items: [roomItem(DOUBLE)] }),
    ];
    const grid = computeInventory({ rooms: baseRooms(), reservations, blocks: [], ...WINDOW, roomTypeIds: [DOUBLE] });
    expect(grid[DOUBLE]['2026-11-02']).toMatchObject({ total: 2, available: 0, unassignedDemand: 3, overbooked: 1 });
  });

  it('inactive rooms are excluded from the count', () => {
    const rooms = baseRooms().map((r) => (r._id === 't3' ? { ...r, status: 'inactive' } : r));
    const a = avail({ rooms });
    expect(a[TWIN]['2026-11-01']).toBe(2);
  });

  it('an inactive room assigned to a stay still covers that stay’s item', () => {
    const rooms = baseRooms().map((r) => (r._id === 't3' ? { ...r, status: 'inactive' } : r));
    const a = avail({ rooms, reservations: [res({ checkIn: '2026-11-02', checkOut: '2026-11-03', items: [roomItem(TWIN)], room: 't3' })] });
    expect(a[TWIN]['2026-11-02']).toBe(2); // no extra demand
  });

  it('room blocks take the room on exactly their nights (end date exclusive)', () => {
    const a = avail({ blocks: [{ roomId: 'd2', startDate: D('2026-11-03'), endDate: D('2026-11-06') }] });
    expect(a[DOUBLE]['2026-11-02']).toBe(2);
    expect(a[DOUBLE]['2026-11-03']).toBe(1);
    expect(a[DOUBLE]['2026-11-05']).toBe(1);
    expect(a[DOUBLE]['2026-11-06']).toBe(2);
  });

  it('a blocked room that is also assigned is counted once', () => {
    const grid = computeInventory({
      rooms: baseRooms(),
      blocks: [{ roomId: 'd1', startDate: D('2026-11-02'), endDate: D('2026-11-03') }],
      reservations: [res({ checkIn: '2026-11-02', checkOut: '2026-11-03', room: 'd1' })],
      ...WINDOW, roomTypeIds: [DOUBLE],
    });
    expect(grid[DOUBLE]['2026-11-02']).toMatchObject({ blocked: 1, assigned: 0, available: 1 });
  });

  it('item-level dates are used for demand', () => {
    const r = res({
      checkIn: '2026-11-02', checkOut: '2026-11-06',
      items: [roomItem(TWIN, { checkIn: D('2026-11-02'), checkOut: D('2026-11-06') }), roomItem(DOUBLE, { checkIn: D('2026-11-04'), checkOut: D('2026-11-06') })],
    });
    const a = avail({ reservations: [r] });
    expect(a[DOUBLE]['2026-11-03']).toBe(2);
    expect(a[DOUBLE]['2026-11-04']).toBe(1);
    expect(a[TWIN]['2026-11-02']).toBe(2);
  });

  it('unmapped room items (no type) consume no typed inventory', () => {
    const a = avail({ reservations: [res({ checkIn: '2026-11-02', checkOut: '2026-11-03', items: [roomItem(null)] })] });
    expect(a[TWIN]['2026-11-02']).toBe(3);
    expect(a[DOUBLE]['2026-11-02']).toBe(2);
  });

  it('legacy reservations with an assigned room but no items still block the room', () => {
    const a = avail({ reservations: [res({ checkIn: '2026-11-02', checkOut: '2026-11-03', rooms: ['t1', 't2'] })] });
    expect(a[TWIN]['2026-11-02']).toBe(1);
  });

  it('reports requested types even without rooms', () => {
    const grid = computeInventory({ rooms: [], blocks: [], reservations: [], ...WINDOW, roomTypeIds: ['rt-empty'] });
    expect(grid['rt-empty']['2026-11-01']).toMatchObject({ total: 0, available: 0 });
  });

  it('minAvailable takes the tightest night', () => {
    const grid = computeInventory({
      rooms: baseRooms(), blocks: [], ...WINDOW,
      reservations: [res({ checkIn: '2026-11-03', checkOut: '2026-11-04', rooms: ['t1', 't2'] })],
    });
    expect(minAvailable(grid, TWIN, ['2026-11-02', '2026-11-03', '2026-11-04'])).toBe(1);
    expect(minAvailable(grid, 'unknown', ['2026-11-02'])).toBe(0);
  });
});

describe('unmatchedUnitTypes', () => {
  it('matches same type first, then upgrades; leftover rooms prefer unmapped units', () => {
    expect(unmatchedUnitTypes(['A', 'B'], ['B'])).toEqual(['A']);
    expect(unmatchedUnitTypes(['A', 'B'], ['C'])).toHaveLength(1);
    expect(unmatchedUnitTypes(['A', null], ['C'])).toEqual(['A']);
    expect(unmatchedUnitTypes(['A'], [])).toEqual(['A']);
    expect(unmatchedUnitTypes([], ['A'])).toEqual([]);
  });
});

describe('audit-room-reservations classification', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { auditReservations } = require('../scripts/audit-room-reservations');
  const base = { status: 'confirmed', checkInDate: D('2026-11-02'), checkOutDate: D('2026-11-03') };

  it('flags reservations with neither rooms nor room items, and items on inactive/deleted types', () => {
    const findings = auditReservations([
      { _id: 'a', ...base },                                                     // unattributable
      { _id: 'b', ...base, items: [{ kind: 'service' }] },                        // service only → unattributable
      { _id: 'c', ...base, room: 't1' },                                          // fine
      { _id: 'd', ...base, items: [{ kind: 'room', roomTypeId: TWIN }] },          // fine
      { _id: 'e', ...base, items: [{ kind: 'room', roomTypeId: 'rt-old' }] },      // inactive type
      { _id: 'f', ...base, rooms: ['t1'], items: [{ kind: 'room', roomTypeId: 'rt-old' }, { kind: 'room', roomTypeId: 'rt-old' }] },
    ], new Set([TWIN, DOUBLE]));
    expect(findings.map((f: any) => [f.reservation._id, f.kind])).toEqual([
      ['a', 'unattributable'], ['b', 'unattributable'], ['e', 'inactive_room_type'], ['f', 'inactive_room_type'],
    ]);
    expect(findings[3].roomTypeIds).toEqual(['rt-old']);
  });
});
