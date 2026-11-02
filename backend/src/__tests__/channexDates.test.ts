/**
 * Unit tests for services/channex/dates.ts (CHANNEX_ARCHITECTURE.md §4.5).
 */

import {
  toChannexDate, fromChannexDate, isChannexDate, todayInTz, addDays, diffDays,
  eachDate, eachNight, nightsRange, clampRange, mergeRanges, weekdayCode,
} from '../services/channex/dates';

describe('YYYY-MM-DD ↔ noon UTC', () => {
  it('round-trips through noon UTC', () => {
    const d = fromChannexDate('2026-12-24');
    expect(d.toISOString()).toBe('2026-12-24T12:00:00.000Z');
    expect(toChannexDate(d)).toBe('2026-12-24');
  });

  it('reads the UTC calendar day of a Pilloto date regardless of time of day', () => {
    expect(toChannexDate(new Date('2026-03-01T00:00:00Z'))).toBe('2026-03-01');
    expect(toChannexDate(new Date('2026-03-01T23:59:59Z'))).toBe('2026-03-01');
  });

  it('validates real calendar dates only', () => {
    expect(isChannexDate('2028-02-29')).toBe(true); // leap year
    expect(isChannexDate('2027-02-29')).toBe(false);
    expect(isChannexDate('2026-13-01')).toBe(false);
    expect(isChannexDate('2026-1-01')).toBe(false);
    expect(isChannexDate(20260101)).toBe(false);
    expect(() => fromChannexDate('2026-02-30')).toThrow(RangeError);
    expect(() => toChannexDate(new Date('nope'))).toThrow(RangeError);
  });
});

describe('todayInTz', () => {
  // 2026-11-01T02:30Z — evening of Oct 31 in the Americas, Nov 1 in UTC and east of it.
  const now = new Date('2026-11-01T02:30:00Z');

  it('America/Santo_Domingo is UTC-4 all year (no DST)', () => {
    expect(todayInTz('America/Santo_Domingo', now)).toBe('2026-10-31');
    // Same offset in (northern) summer and winter
    expect(todayInTz('America/Santo_Domingo', new Date('2026-07-01T03:59:00Z'))).toBe('2026-06-30');
    expect(todayInTz('America/Santo_Domingo', new Date('2026-07-01T04:00:00Z'))).toBe('2026-07-01');
    expect(todayInTz('America/Santo_Domingo', new Date('2027-01-15T03:59:00Z'))).toBe('2027-01-14');
    expect(todayInTz('America/Santo_Domingo', new Date('2027-01-15T04:00:00Z'))).toBe('2027-01-15');
  });

  it('handles UTC-12 and UTC+12 on either side of the date line', () => {
    expect(todayInTz('Etc/GMT+12', now)).toBe('2026-10-31'); // UTC-12 → 14:30 on Oct 31
    expect(todayInTz('Etc/GMT-12', now)).toBe('2026-11-01'); // UTC+12 → 14:30 on Nov 1
    const late = new Date('2026-11-01T12:30:00Z');
    expect(todayInTz('Etc/GMT+12', late)).toBe('2026-11-01'); // 00:30 Nov 1
    expect(todayInTz('Etc/GMT-12', late)).toBe('2026-11-02'); // 00:30 Nov 2
  });

  it('UTC is the plain UTC date', () => {
    expect(todayInTz('UTC', now)).toBe('2026-11-01');
  });

  it('throws for an unknown timezone', () => {
    expect(() => todayInTz('Mars/Olympus_Mons', now)).toThrow(RangeError);
  });
});

describe('arithmetic and iteration', () => {
  it('addDays crosses months, years and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-01-01', 499)).toBe('2027-05-15');
  });

  it('diffDays', () => {
    expect(diffDays('2026-11-01', '2026-11-04')).toBe(3);
    expect(diffDays('2026-11-04', '2026-11-01')).toBe(-3);
  });

  it('eachDate is inclusive and empty when reversed', () => {
    expect(eachDate('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(eachDate('2026-01-02', '2026-01-01')).toEqual([]);
  });

  it('eachNight is checkIn ≤ d < checkOut, for Dates and strings', () => {
    expect(eachNight(fromChannexDate('2026-11-01'), fromChannexDate('2026-11-04'))).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(eachNight('2026-11-01', '2026-11-02')).toEqual(['2026-11-01']);
    expect(eachNight('2026-11-01', '2026-11-01')).toEqual([]);
    expect(nightsRange('2026-11-01', '2026-11-04')).toEqual({ dateFrom: '2026-11-01', dateTo: '2026-11-03' });
    expect(nightsRange('2026-11-01', '2026-11-01')).toBeNull();
  });

  it('clampRange intersects or returns null', () => {
    expect(clampRange({ dateFrom: '2026-10-01', dateTo: '2026-12-31' }, '2026-10-28', '2026-11-30'))
      .toEqual({ dateFrom: '2026-10-28', dateTo: '2026-11-30' });
    expect(clampRange({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }, '2026-10-28', '2027-03-11')).toBeNull();
  });

  it('mergeRanges unions overlapping and adjacent ranges', () => {
    expect(mergeRanges([
      { dateFrom: '2026-11-10', dateTo: '2026-11-12' },
      { dateFrom: '2026-11-01', dateTo: '2026-11-03' },
      { dateFrom: '2026-11-04', dateTo: '2026-11-05' }, // adjacent to the previous
      { dateFrom: '2026-11-11', dateTo: '2026-11-20' }, // overlaps
    ])).toEqual([
      { dateFrom: '2026-11-01', dateTo: '2026-11-05' },
      { dateFrom: '2026-11-10', dateTo: '2026-11-20' },
    ]);
  });

  it('weekdayCode uses Channex codes', () => {
    expect(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'].map(weekdayCode))
      .toEqual(['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']);
  });
});
