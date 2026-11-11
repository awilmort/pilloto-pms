/**
 * The pure pieces of the e-CF module: Dominican time, the tenant's lifecycle state, the issuing
 * gate, BillingSoft-status mapping and the totals math (done in integers, to the centavo).
 */
import {
  assertCanIssue,
  decimalString,
  dominicanDate,
  dominicanPeriod,
  estadoOfStatus,
  FiscalError,
  firstDayOfNextMonth,
  fiscalState,
  netFromGross,
  nextPeriod,
  periodBounds,
  previousPeriod,
  totalsOfLines,
} from '../services/fiscal/fiscalCore';
import { FiscalConfig } from '../config/fiscal';

const cfg = (over: Partial<FiscalConfig> = {}): FiscalConfig => ({
  apiUrl: 'https://api.example',
  partnerApiKey: 'k',
  appUrl: 'https://app.example',
  backendPublicUrl: 'https://backend.example',
  allowUncertified: false,
  ...over,
});
const tenantWith = (fiscal: any) => ({ fiscal }) as any;
const certified = { organizationId: 'org', isActive: true, certification: 'certified', environment: 'ecf', plan: 'essential' };

describe('Dominican time (UTC-4, no daylight saving)', () => {
  it('reads the date in Santo Domingo, not UTC', () => {
    // 01:30 UTC on the 1st is still the evening of the 31st there.
    expect(dominicanDate(new Date('2026-12-01T01:30:00Z'))).toBe('2026-11-30');
    expect(dominicanDate(new Date('2026-12-01T04:00:00Z'))).toBe('2026-12-01');
    expect(dominicanPeriod(new Date('2026-12-01T03:59:59Z'))).toBe('2026-11');
  });

  it('walks months across year ends', () => {
    expect(previousPeriod('2026-01')).toBe('2025-12');
    expect(previousPeriod('2026-03')).toBe('2026-02');
    expect(nextPeriod('2026-12')).toBe('2027-01');
    expect(firstDayOfNextMonth(new Date('2026-12-15T12:00:00Z'))).toBe('2027-01-01');
  });

  it('knows the last day of a month, leap years included', () => {
    expect(periodBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodBounds('2027-02')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });
});

describe('fiscalState', () => {
  it.each([
    [undefined, 'inactive'],
    [{ isActive: true, certification: 'certified' }, 'inactive'], // no Organization
    [{ ...certified, isActive: false }, 'suspended'],
    [{ ...certified, certification: 'not_started' }, 'not_started'],
    [{ ...certified, certification: 'in_progress' }, 'in_progress'],
    [certified, 'ready'],
  ])('%j → %s', (fiscal, expected) => {
    expect(fiscalState(tenantWith(fiscal))).toBe(expected);
  });
});

describe('assertCanIssue', () => {
  const code = (fn: () => unknown) => {
    try { fn(); } catch (e) { return (e as FiscalError).code; }
    return null;
  };

  it('returns the Organization of a certified, active company', () => {
    expect(assertCanIssue(tenantWith(certified), cfg())).toBe('org');
  });

  it('refuses when the server has no BillingSoft credential', () => {
    expect(code(() => assertCanIssue(tenantWith(certified), cfg({ partnerApiKey: '' })))).toBe('FISCAL_NOT_CONFIGURED');
  });

  it('refuses a company that never activated, one that is suspended, and one DGII has not certified', () => {
    expect(code(() => assertCanIssue(tenantWith(undefined), cfg()))).toBe('FISCAL_NOT_ACTIVATED');
    expect(code(() => assertCanIssue(tenantWith({ ...certified, isActive: false }), cfg()))).toBe('FISCAL_SUSPENDED');
    expect(code(() => assertCanIssue(tenantWith({ ...certified, certification: 'in_progress' }), cfg()))).toBe('FISCAL_NOT_CERTIFIED');
  });

  it('lets development opt out of the certification gate, never of activation', () => {
    const dev = cfg({ allowUncertified: true });
    expect(assertCanIssue(tenantWith({ ...certified, certification: 'not_started' }), dev)).toBe('org');
    expect(code(() => assertCanIssue(tenantWith(undefined), dev))).toBe('FISCAL_NOT_ACTIVATED');
  });
});

describe('estadoOfStatus', () => {
  it('maps every BillingSoft status to a Pilloto state', () => {
    expect(estadoOfStatus('signed')).toBe('Firmado');
    expect(estadoOfStatus('in_process')).toBe('En Proceso');
    expect(estadoOfStatus('accepted')).toBe('Aceptado');
    expect(estadoOfStatus('conditionally_accepted')).toBe('Aceptado Condicional');
    expect(estadoOfStatus('rejected')).toBe('Rechazado');
    expect(estadoOfStatus('unresolved')).toBe('Sin Resolver');
    expect(estadoOfStatus('annulled')).toBe('Anulado');
  });
});

describe('totalsOfLines', () => {
  it('computes each line to the centavo, then its ITBIS, like DGII does', () => {
    const t = totalsOfLines([
      { name: 'Habitación', kind: 'service', quantity: '2', unitPrice: '2500.00', tax: 'itbis18' },
      { name: 'Propina', kind: 'service', quantity: '1', unitPrice: '100.00', tax: 'exempt' },
    ]);
    expect(t.totalFactura).toBe(5000 * 1.18 + 100);
    expect(t.totalImpuestos).toBe(900);
    expect(t.lineItems[0]).toMatchObject({ description: 'Habitación', qty: 2, netPrice: 5000, itbisRate: 18, itbisAmount: 900, grossAmount: 5900 });
  });

  it('has no floating-point drift (0.1 + 0.2 style sums)', () => {
    const t = totalsOfLines([
      { name: 'a', kind: 'good', quantity: '3', unitPrice: '0.1000', tax: 'exempt' },
      { name: 'b', kind: 'good', quantity: '3', unitPrice: '0.2000', tax: 'exempt' },
    ]);
    expect(t.totalFactura).toBe(0.9);
  });

  it('rounds an ITBIS half-centavo up', () => {
    // 84.75 × 18% = 15.255
    expect(totalsOfLines([{ name: 'x', kind: 'service', quantity: '1', unitPrice: '84.75', tax: 'itbis18' }]).totalImpuestos).toBe(15.26);
  });
});

describe('netFromGross — PMS charges include ITBIS, BillingSoft prices do not', () => {
  const grossOf = (net: string, rate = 18) => totalsOfLines([{ name: 'x', kind: 'service', quantity: '1', unitPrice: net, tax: rate === 18 ? 'itbis18' : 'itbis16' }]).totalFactura;

  it('converts a round amount exactly', () => {
    expect(netFromGross(5900, 18)).toBe('5000.00');
    expect(netFromGross(118, 18)).toBe('100.00');
  });

  it('picks the centavo whose total is exactly the folio\'s where one exists', () => {
    // 3.54 / 1.18 = 3.00 → 3.00 + 0.54
    expect(netFromGross(3.54, 18)).toBe('3.00');
    expect(grossOf(netFromGross(3.54, 18))).toBe(3.54);
  });

  it('when no net amount gives the exact total (100.00 at 18%), takes the nearest and never bills more', () => {
    // 84.74 totals 99.99 and 84.75 totals 100.01: equally near, so the lower one.
    expect(netFromGross(100, 18)).toBe('84.74');
    expect(grossOf(netFromGross(100, 18))).toBe(99.99);
  });

  it('is never more than a centavo off the folio, and exact for most amounts', () => {
    let exact = 0;
    const total = 4000;
    for (let cents = 1; cents <= total; cents++) {
      const gross = cents / 100;
      const diff = Math.abs(grossOf(netFromGross(gross, 18)) - gross);
      expect(diff).toBeLessThanOrEqual(0.0100001);
      if (diff < 0.000001) exact++;
    }
    expect(exact / total).toBeGreaterThan(0.8);
  });
});

describe('decimalString', () => {
  it('keeps at least two decimals and trims useless zeros beyond them', () => {
    expect(decimalString(2500, 4)).toBe('2500.00');
    expect(decimalString(84.7457, 4)).toBe('84.7457');
    expect(decimalString(10.5, 4)).toBe('10.50');
  });
});
