import { addDays, chargeTotals, discountAmount, isPeriod, periodLabelEs, proration, round2, toCents } from '../services/platformBilling/billingMath';

describe('billing math', () => {
  describe('proration', () => {
    it('is the whole month for every month but the first', () => {
      expect(proration('2026-10', new Date('2026-09-15T16:00:00Z'))).toBe(1);
      expect(proration('2026-10', new Date('2025-01-01T16:00:00Z'))).toBe(1);
    });

    it('counts a first month from the day it started, inclusive', () => {
      // 16 of 31 days: the 16th to the 31st.
      expect(proration('2026-10', new Date('2026-10-16T16:00:00Z'))).toBe(0.5161);
      expect(proration('2026-10', new Date('2026-10-01T16:00:00Z'))).toBe(1);
      expect(proration('2026-10', new Date('2026-10-31T16:00:00Z'))).toBe(0.0323);
    });

    it('reads the start day in Dominican time (UTC−4), not UTC', () => {
      // 01:00 UTC on 1 Nov is still 31 October at 21:00 in the Dominican Republic.
      expect(proration('2026-10', new Date('2026-11-01T01:00:00Z'))).toBe(0.0323);
      expect(proration('2026-11', new Date('2026-11-01T01:00:00Z'))).toBe(1);
    });
  });

  describe('chargeTotals', () => {
    it('adds ITBIS per line, rounded to the centavo, like an e-CF does', () => {
      // 0.18 × 10.03 = 1.8054 → 1.81 per line, so 3.62; rounding the sum once would give 3.61.
      const t = chargeTotals([10.03, 10.03], 'itbis18');
      expect(t).toEqual({ subtotal: 20.06, itbis: 3.62, total: 23.68 });
    });

    it('matches the published example of the plans', () => {
      expect(chargeTotals([5540, 9370, 325, 480], 'itbis18')).toEqual({ subtotal: 15715, itbis: 2828.7, total: 18543.7 });
    });

    it('adds nothing when the service is exempt or at 0%', () => {
      expect(chargeTotals([2450], 'exempt')).toEqual({ subtotal: 2450, itbis: 0, total: 2450 });
      expect(chargeTotals([2450], 'itbis0').total).toBe(2450);
    });

    it('supports the 16% rate', () => {
      expect(chargeTotals([1000], 'itbis16')).toEqual({ subtotal: 1000, itbis: 160, total: 1160 });
    });

    it('never drifts on floating point (0.1 + 0.2)', () => {
      expect(chargeTotals([0.1, 0.2], 'exempt').total).toBe(0.3);
    });
  });

  describe('discountAmount', () => {
    it('takes a percentage off the line', () => {
      expect(discountAmount(5540, { type: 'percent', value: 20 })).toBe(1108);
      expect(discountAmount(100.55, { type: 'percent', value: 33.33 })).toBe(33.51);
    });

    it('takes a fixed amount off, prorated with the month', () => {
      expect(discountAmount(5540, { type: 'amount', value: 500 })).toBe(500);
      expect(discountAmount(2859.1, { type: 'amount', value: 500 }, 0.5161)).toBe(258.05);
    });

    it('never takes off more than the line', () => {
      expect(discountAmount(300, { type: 'amount', value: 500 })).toBe(300);
      expect(discountAmount(300, { type: 'percent', value: 100 })).toBe(300);
    });
  });

  it('formats a period in Spanish', () => {
    expect(periodLabelEs('2026-11')).toBe('noviembre 2026');
    expect(periodLabelEs('2027-01')).toBe('enero 2027');
  });

  it('validates periods', () => {
    expect(isPeriod('2026-10')).toBe(true);
    expect(isPeriod('2026-13')).toBe(false);
    expect(isPeriod('2026-1')).toBe(false);
    expect(isPeriod(undefined)).toBe(false);
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-11-25', 10)).toBe('2026-12-05');
    expect(addDays('2026-12-28', 10)).toBe('2027-01-07');
  });

  it('rounds to centavos', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(toCents(18543.7)).toBe(1854370);
  });
});
