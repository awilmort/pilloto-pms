import { matchesReservationRef, reservationHref } from '../reservationPaths';

describe('reservationHref', () => {
  it('uses the reservation code when there is one', () => {
    expect(reservationHref({ _id: '64b0', reservationCode: 'B26X7KQ' })).toBe('/admin/reservations/B26X7KQ');
  });
  it('falls back to the id when there is no code (older or imported reservations)', () => {
    expect(reservationHref({ _id: '64b0' })).toBe('/admin/reservations/64b0');
    expect(reservationHref({ _id: '64b0', reservationCode: '' })).toBe('/admin/reservations/64b0');
    expect(reservationHref({ _id: '64b0', reservationCode: null })).toBe('/admin/reservations/64b0');
  });
});

describe('matchesReservationRef', () => {
  const r = { _id: '64b0', reservationCode: 'B26X7KQ' };
  it('matches by id, by code and by code in any case', () => {
    expect(matchesReservationRef(r, '64b0')).toBe(true);
    expect(matchesReservationRef(r, 'B26X7KQ')).toBe(true);
    expect(matchesReservationRef(r, 'b26x7kq')).toBe(true);
  });
  it('does not match something else, nor a codeless reservation by an empty code', () => {
    expect(matchesReservationRef(r, 'B26ZZZZ')).toBe(false);
    expect(matchesReservationRef({ _id: '64b0' }, '')).toBe(false);
  });
});
