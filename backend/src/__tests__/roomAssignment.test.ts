/**
 * Room assignment matching (services/roomAssignment.ts, plan Phase 3.3).
 */

import { bookedRoomUnits, matchRoomsToUnits, AssignableRoom } from '../services/roomAssignment';

const twin = (id: string): AssignableRoom => ({ _id: id, name: `Twin ${id}`, roomTypeId: 'T', roomTypeName: 'Twin', capacity: 2 });
const double = (id: string): AssignableRoom => ({ _id: id, name: `Double ${id}`, roomTypeId: 'D', roomTypeName: 'Double', capacity: 2 });
const family = (id: string): AssignableRoom => ({ _id: id, name: `Family ${id}`, roomTypeId: 'F', roomTypeName: 'Family', capacity: 4 });

describe('bookedRoomUnits', () => {
  it('expands room items by quantity and ignores services', () => {
    const units = bookedRoomUnits([
      { kind: 'room', roomTypeId: 'T', adults: 2, children: 1, quantity: 2 },
      { kind: 'service', quantity: 3 },
      { kind: 'room', roomTypeId: null, adults: 1 },
    ], new Map([['T', 'Twin']]));
    expect(units).toEqual([
      { roomTypeId: 'T', roomTypeName: 'Twin', guests: 3 },
      { roomTypeId: 'T', roomTypeName: 'Twin', guests: 3 },
      { roomTypeId: null, roomTypeName: undefined, guests: 1 },
    ]);
  });
});

describe('matchRoomsToUnits', () => {
  it('accepts rooms of the booked types, in any order', () => {
    const units = [{ roomTypeId: 'T', guests: 2 }, { roomTypeId: 'D', guests: 2 }];
    expect(matchRoomsToUnits([double('d1'), twin('t1')], units)).toBeNull();
  });

  it('accepts a partial assignment (the rest stays unassigned)', () => {
    expect(matchRoomsToUnits([twin('t1')], [{ roomTypeId: 'T', guests: 2 }, { roomTypeId: 'T', guests: 2 }])).toBeNull();
  });

  it('rejects more rooms than booked', () => {
    expect(matchRoomsToUnits([twin('t1'), twin('t2')], [{ roomTypeId: 'T', guests: 2 }]))
      .toBe('This reservation booked 1 room; 2 were selected.');
  });

  it('accepts an upgrade to a room that holds the party', () => {
    expect(matchRoomsToUnits([family('f1')], [{ roomTypeId: 'T', roomTypeName: 'Twin', guests: 2 }])).toBeNull();
  });

  it('rejects a different room type that is too small', () => {
    expect(matchRoomsToUnits([twin('t1')], [{ roomTypeId: 'F', roomTypeName: 'Family', guests: 4 }]))
      .toBe('Twin t1 (Twin) holds 2 guests; the booked Family is for 4.');
  });

  it('matches same type before using a room as an upgrade', () => {
    // Family booked for 4 + Twin for 2; rooms Family + Twin → both same-type, valid
    const units = [{ roomTypeId: 'T', guests: 2 }, { roomTypeId: 'F', guests: 4 }];
    expect(matchRoomsToUnits([twin('t1'), family('f1')], units)).toBeNull();
    // Rooms Double + Family: Family takes the Family unit, Double upgrades the Twin unit (2 ≤ 2)
    expect(matchRoomsToUnits([double('d1'), family('f1')], units)).toBeNull();
  });

  it('places largest parties in the largest leftover rooms', () => {
    const units = [{ roomTypeId: 'X', guests: 2 }, { roomTypeId: 'Y', guests: 4 }];
    expect(matchRoomsToUnits([twin('t1'), family('f1')], units)).toBeNull();
  });

  it('legacy reservations without room items have no type rule', () => {
    expect(matchRoomsToUnits([twin('t1'), twin('t2'), family('f1')], [])).toBeNull();
  });
});
