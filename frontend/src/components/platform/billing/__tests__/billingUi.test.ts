import { billingErrorMessage, canRetryEcf, currentPeriod, ecfState, upcomingPeriods } from '../billingUi';
import { ecf, payment } from '../testFixtures';

const t = ((key: string, opts?: any) => (opts?.defaultValue === '' ? '' : typeof opts === 'string' ? opts : opts?.defaultValue ?? key)) as any;

describe('billing UI helpers', () => {
  describe('ecfState', () => {
    it('tells a reversed payment, a missing e-CF, a moving one, one needing a person, and a finished one apart', () => {
      expect(ecfState(payment({ status: 'reversed' }))).toBe('reversed');
      expect(ecfState(payment({ ecf: null }))).toBe('missing');
      expect(ecfState(payment({ ecf: ecf({ estado: 'En Proceso' }) }))).toBe('processing');
      expect(ecfState(payment({ ecf: ecf({ estado: 'Firmado' }) }))).toBe('processing');
      expect(ecfState(payment({ ecf: ecf({ estado: 'Rechazado' }) }))).toBe('attention');
      expect(ecfState(payment({ ecf: ecf({ estado: 'Sin Resolver' }) }))).toBe('attention');
      expect(ecfState(payment({ ecf: ecf({ estado: 'Aceptado' }) }))).toBe('issued');
      expect(ecfState(payment({ ecf: ecf({ estado: 'Aceptado Condicional' }) }))).toBe('issued');
    });
  });

  describe('canRetryEcf', () => {
    it('is offered when there is no e-CF, or it was rejected or never confirmed — never for a good one or a reversed payment', () => {
      expect(canRetryEcf(payment({ ecf: null }))).toBe(true);
      expect(canRetryEcf(payment({ ecf: ecf({ estado: 'Rechazado' }) }))).toBe(true);
      expect(canRetryEcf(payment({ ecf: ecf({ estado: 'Pendiente' }) }))).toBe(true);
      expect(canRetryEcf(payment({ ecf: ecf({ estado: 'Error' }) }))).toBe(true);
      expect(canRetryEcf(payment({ ecf: ecf({ estado: 'Aceptado' }) }))).toBe(false);
      expect(canRetryEcf(payment({ ecf: ecf({ estado: 'En Proceso' }) }))).toBe(false);
      expect(canRetryEcf(payment({ status: 'reversed', ecf: null }))).toBe(false);
    });
  });

  describe('periods', () => {
    it('reads the month in Dominican time (UTC−4)', () => {
      expect(currentPeriod(new Date('2026-12-01T02:00:00Z'))).toBe('2026-11'); // still 30 Nov at 22:00 in Santo Domingo
      expect(currentPeriod(new Date('2026-12-01T05:00:00Z'))).toBe('2026-12');
    });

    it('lists the current month and the following ones, across the year end', () => {
      expect(upcomingPeriods(4, new Date('2026-11-10T16:00:00Z'))).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
      expect(upcomingPeriods(1, new Date('2026-01-10T16:00:00Z'))).toEqual(['2026-01']);
    });
  });

  describe('billingErrorMessage', () => {
    it('prefers a translation of the code, then the server message, then a generic line', () => {
      const translated = ((key: string) => (key === 'platformBilling.errors.BILLING_STATE' ? 'Not in this state.' : '')) as any;
      expect(billingErrorMessage({ response: { data: { code: 'BILLING_STATE', message: 'raw' } } }, translated)).toBe('Not in this state.');
      expect(billingErrorMessage({ response: { data: { code: 'OTHER', message: 'BillingSoft says no' } } }, translated)).toBe('BillingSoft says no');
      expect(billingErrorMessage(new Error('x'), t)).toBe('Something went wrong. Try again.');
    });
  });
});
