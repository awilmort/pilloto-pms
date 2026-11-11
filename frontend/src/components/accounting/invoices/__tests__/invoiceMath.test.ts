/**
 * Invoice maths and rules (components/accounting/invoices/invoiceMath.ts): totals that match the
 * server's rounding, payment-term presets, the derived e-CF type and the pre-save validation.
 */
import {
  newDraftLine, lineAmounts, documentTotals, addDaysIso, daysBetweenIso, termsFromDates, termsDays, ecfKindFor, validateInvoice, isBlankLine, toIsoDate,
} from '../invoiceMath';

const line = (over: object = {}) => newDraftLine({ description: 'Servicio', quantity: '1', unitPrice: '100', ...over });

describe('lineAmounts', () => {
  it('applies the discount first, then ITBIS on the discounted amount — the same figures the server stores', () => {
    // 2 × 500 less 10% = 900; 18% of 900 = 162
    expect(lineAmounts({ quantity: '2', unitPrice: '500', discountPercent: '10', taxRate: '18' })).toEqual({ gross: 1000, discount: 100, lineTotal: 900, taxAmount: 162, total: 1062 });
  });

  it('rounds each line to cents before summing (so the total never disagrees with the saved invoice)', () => {
    // 3 × 0.335 = 1.005 → 1.01 (line), ITBIS 18% of 1.01 = 0.1818 → 0.18
    const a = lineAmounts({ quantity: '3', unitPrice: '0.335', discountPercent: '0', taxRate: '18' });
    expect(a.lineTotal).toBe(1.01);
    expect(a.taxAmount).toBe(0.18);
    expect(a.total).toBe(1.19);
  });

  it('treats blank or invalid inputs as zero instead of NaN', () => {
    expect(lineAmounts({ quantity: '', unitPrice: 'abc', discountPercent: '', taxRate: '' })).toEqual({ gross: 0, discount: 0, lineTotal: 0, taxAmount: 0, total: 0 });
  });
});

describe('documentTotals', () => {
  it('sums lines and groups ITBIS by rate, leaving exempt lines out of the ITBIS rows', () => {
    const t = documentTotals([
      line({ quantity: '2', unitPrice: '500', discountPercent: '10', taxRate: '18' }),
      line({ unitPrice: '200', taxRate: '16' }),
      line({ unitPrice: '50', taxRate: '18' }),
      line({ unitPrice: '30', taxRate: '0' }),
    ]);
    expect(t).toEqual({
      gross: 1280, discount: 100, subtotal: 1180, taxAmount: 203, total: 1383,
      byRate: [{ rate: 16, base: 200, tax: 32 }, { rate: 18, base: 950, tax: 171 }],
    });
  });

  it('an empty invoice is all zeros', () => {
    expect(documentTotals([])).toEqual({ gross: 0, discount: 0, subtotal: 0, taxAmount: 0, total: 0, byRate: [] });
  });
});

describe('payment terms and dates', () => {
  it('adds days across month and year ends without a UTC shift', () => {
    expect(addDaysIso('2026-11-09', 30)).toBe('2026-12-09');
    expect(addDaysIso('2026-12-20', 15)).toBe('2027-01-04');
    expect(addDaysIso('2026-02-27', 2)).toBe('2026-03-01');
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('daysBetweenIso counts calendar days', () => {
    expect(daysBetweenIso('2026-11-09', '2026-12-09')).toBe(30);
    expect(daysBetweenIso('2026-11-09', '2026-11-09')).toBe(0);
  });

  it('termsFromDates recognises the presets and falls back to custom', () => {
    expect(termsFromDates('2026-11-09', undefined)).toBe('cash');
    expect(termsFromDates('2026-11-09', '2026-11-09')).toBe('cash');
    expect(termsFromDates('2026-11-09', '2026-12-09')).toBe('30');
    expect(termsFromDates('2026-11-09', '2026-11-17')).toBe('8');
    expect(termsFromDates('2026-11-09', '2026-11-24')).toBe('15');
    expect(termsFromDates('2026-11-09', '2027-01-08')).toBe('60');
    expect(termsFromDates('2026-11-09', '2026-11-30')).toBe('custom');
  });

  it('termsDays: cash is 0, presets are their day count, custom has none', () => {
    expect([termsDays('cash'), termsDays('8'), termsDays('60'), termsDays('custom')]).toEqual([0, 8, 60, null]);
  });
});

describe('ecfKindFor', () => {
  it('a registered customer with an RNC is a Crédito Fiscal (E31); everything else is Consumo (E32)', () => {
    expect(ecfKindFor({ rnc: '101010101' }, false)).toBe('E31');
    expect(ecfKindFor({ rnc: '' }, false)).toBe('E32');
    expect(ecfKindFor({}, false)).toBe('E32');
    expect(ecfKindFor(null, false)).toBe('E32');
    expect(ecfKindFor({ rnc: '101010101' }, true)).toBe('E32');
  });
});

describe('validateInvoice', () => {
  const ok = { isIndividual: false, customerId: 'c1', individualName: '', lines: [line()], issueIso: '2026-11-09', dueIso: '', terms: '30' as const };

  it('accepts a complete invoice', () => {
    expect(validateInvoice(ok)).toBeNull();
  });

  it('reports the first problem in reading order', () => {
    expect(validateInvoice({ ...ok, customerId: '' })).toBe('customerRequired');
    expect(validateInvoice({ ...ok, isIndividual: true, individualName: '  ' })).toBe('individualNameRequired');
    expect(validateInvoice({ ...ok, lines: [line({ description: ' ' })] })).toBe('lineDescriptionRequired');
    expect(validateInvoice({ ...ok, lines: [line({ quantity: '0' })] })).toBe('lineQuantityRequired');
    expect(validateInvoice({ ...ok, lines: [line({ unitPrice: '' })] })).toBe('lineUnitPriceRequired');
  });

  it('a custom due date is required and cannot be before the issue date', () => {
    expect(validateInvoice({ ...ok, terms: 'custom', dueIso: '' })).toBe('dueDateRequired');
    expect(validateInvoice({ ...ok, terms: 'custom', dueIso: '2026-11-01' })).toBe('dueBeforeIssue');
    expect(validateInvoice({ ...ok, terms: 'custom', dueIso: '2026-11-09' })).toBeNull();
  });
});

describe('isBlankLine', () => {
  it('only a completely untouched row is blank', () => {
    expect(isBlankLine(newDraftLine())).toBe(true);
    expect(isBlankLine(newDraftLine({ description: 'x' }))).toBe(false);
    expect(isBlankLine(newDraftLine({ unitPrice: '0' }))).toBe(false);
    expect(isBlankLine(newDraftLine({ productId: 'p1' }))).toBe(false);
  });
});
