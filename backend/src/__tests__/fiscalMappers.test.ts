/**
 * Mappers: Pilloto documents → BillingSoft requests. The totals each request produces are checked
 * through `totalsOfLines`, so a mapper that drifts from the folio's total fails here.
 */
import { totalsOfLines } from '../services/fiscal/fiscalCore';
import {
  accountingInvoiceRequest,
  dgiiEmail,
  folioInvoiceRequest,
  grossNoteLines,
  modificationOfCode,
  noteRequest,
  normalizeRnc,
} from '../services/fiscal/mappers';

const NOW = new Date('2026-11-10T15:00:00Z'); // 11:00 in Santo Domingo

describe('folioInvoiceRequest', () => {
  const charges = [
    { description: 'Habitación 101 · 2 noches', amount: 11800 },
    { description: 'Desayuno', amount: 590 },
  ];

  it('is a consumer invoice (32) without an RNC, with no buyer when nobody was named', () => {
    const r = folioInvoiceRequest({ charges, payments: [{ method: 'cash' }] });
    expect(r.type).toBe('32');
    expect(r.buyer).toBeUndefined();
    expect(r.payment).toEqual({ type: 'cash' });
    expect(r.incomeType).toBe('01');
  });

  it('is a credit-fiscal invoice (31) when the buyer has an RNC, which it normalizes', () => {
    const r = folioInvoiceRequest({ charges, payments: [], buyer: { rnc: '1-31-88068-1', razonSocial: 'Grupo Caribe SRL', email: 'cxc@caribe.com' } });
    expect(r.type).toBe('31');
    expect(r.buyer).toEqual({ name: 'Grupo Caribe SRL', rnc: '131880681', email: 'cxc@caribe.com' });
  });

  it('turns tax-inclusive charges into net prices whose total is the folio\'s', () => {
    const r = folioInvoiceRequest({ charges, payments: [] });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ kind: 'service', quantity: '1', unitPrice: '10000.00', tax: 'itbis18' });
    expect(totalsOfLines(r.lines).totalFactura).toBe(12390);
  });

  it('stays within a centavo of the folio for an amount ITBIS rounding cannot hit exactly', () => {
    const r = folioInvoiceRequest({ charges: [{ description: 'Cargo', amount: 100 }], payments: [] });
    expect(totalsOfLines(r.lines).totalFactura).toBe(99.99);
  });

  it('is on credit only when every payment is on credit, due in 30 days', () => {
    const credit = folioInvoiceRequest({ charges, payments: [{ method: 'credit' }], now: NOW });
    expect(credit.payment).toEqual({ type: 'credit', dueOn: '2026-12-10' });
    expect(folioInvoiceRequest({ charges, payments: [{ method: 'credit' }, { method: 'card' }] }).payment).toEqual({ type: 'cash' });
    expect(folioInvoiceRequest({ charges, payments: [{ method: 'credit', status: 'reversed' }] }).payment).toEqual({ type: 'cash' });
  });

  it('refuses what BillingSoft would: a 31 with no RNC, an empty folio, a zero total, a malformed RNC', () => {
    expect(() => folioInvoiceRequest({ charges, payments: [], type: '31' })).toThrow(/RNC/);
    expect(() => folioInvoiceRequest({ charges: [], payments: [] })).toThrow(/no charges/);
    expect(() => folioInvoiceRequest({ charges: [{ description: 'x', amount: 0 }], payments: [] })).toThrow(/greater than zero/);
    expect(() => folioInvoiceRequest({ charges, payments: [], buyer: { rnc: '12345', name: 'X' } })).toThrow(/RNC/);
  });

  it('cleans text DGII would refuse: control characters, long names, an email it does not accept', () => {
    const long = 'A'.repeat(200);
    const r = folioInvoiceRequest({ charges: [{ description: `Cena\u0007${long}`, amount: 118 }], payments: [], buyer: { name: 'Ana', email: 'ana..@x' } });
    expect(r.lines[0].name).not.toMatch(/\u0007/);
    expect(r.lines[0].name.length).toBeLessThanOrEqual(80);
    expect(r.buyer).toEqual({ name: 'Ana' }); // the odd email is dropped, not fatal
  });
});

describe('accountingInvoiceRequest', () => {
  const lines = [
    { description: 'Consultoría', quantity: 3, taxRate: 18, lineTotal: 900 },
    { description: 'Libro', quantity: 1, taxRate: 0, lineTotal: 250 },
  ];

  it('spreads each net line over its quantity and keeps the rate', () => {
    const r = accountingInvoiceRequest({ type: '31', lines, buyer: { rnc: '101010101', name: 'Grupo Caribe' }, now: NOW });
    expect(r.lines[0]).toMatchObject({ quantity: '3.00', unitPrice: '300.00', tax: 'itbis18' });
    expect(r.lines[1]).toMatchObject({ tax: 'exempt' });
    expect(totalsOfLines(r.lines)).toMatchObject({ totalFactura: 900 * 1.18 + 250, totalImpuestos: 162 });
  });

  it('is on credit, due on the invoice due date, never in the past', () => {
    const due = accountingInvoiceRequest({ type: '32', lines, buyer: { name: 'Ana' }, dueDate: new Date('2026-12-20T12:00:00Z'), now: NOW });
    expect(due.payment).toEqual({ type: 'credit', dueOn: '2026-12-20' });
    const past = accountingInvoiceRequest({ type: '32', lines, buyer: { name: 'Ana' }, dueDate: new Date('2026-10-01T12:00:00Z'), now: NOW });
    expect(past.payment).toEqual({ type: 'credit', dueOn: '2026-11-10' });
  });

  it('refuses a 31 without an RNC and an unsupported ITBIS rate', () => {
    expect(() => accountingInvoiceRequest({ type: '31', lines, buyer: { name: 'Ana' } })).toThrow(/RNC/);
    expect(() => accountingInvoiceRequest({ type: '32', lines: [{ ...lines[0], taxRate: 12 }], buyer: { name: 'Ana' } })).toThrow(/ITBIS 12%/);
  });
});

describe('noteRequest', () => {
  const original = { eNCF: 'E310000000123', issuedAt: new Date('2026-11-08T02:00:00Z'), buyerRnc: '101010101', buyerName: 'Grupo Caribe', buyerEmail: 'cxc@caribe.com' };

  it('references the original with its Dominican issue date and DGII\'s modification', () => {
    const r = noteRequest({ note: 'credit', original, modificationCode: '3', reason: 'Descuento acordado', lines: grossNoteLines([{ description: 'Descuento', amount: 118 }]) });
    expect(r.type).toBe('34');
    expect(r.reference).toEqual({ ncf: 'E310000000123', issuedOn: '2026-11-07', modification: 'correctsAmounts', reason: 'Descuento acordado' });
    expect(r.buyer).toEqual({ name: 'Grupo Caribe', rnc: '101010101', email: 'cxc@caribe.com' });
    expect(totalsOfLines(r.lines).totalFactura).toBe(118);
  });

  it('is a debit note (33) for a debit', () => {
    expect(noteRequest({ note: 'debit', original, modificationCode: '3', reason: 'Mora', lines: grossNoteLines([{ description: 'Mora', amount: 59 }]) }).type).toBe('33');
  });

  it('refuses a missing reason, no lines, or an original with no e-NCF yet', () => {
    const lines = grossNoteLines([{ description: 'x', amount: 118 }]);
    expect(() => noteRequest({ note: 'credit', original, modificationCode: '1', reason: '  ', lines })).toThrow(/reason/i);
    expect(() => noteRequest({ note: 'credit', original, modificationCode: '1', reason: 'x', lines: [] })).toThrow(/line/);
    expect(() => noteRequest({ note: 'credit', original: { ...original, eNCF: undefined }, modificationCode: '1', reason: 'x', lines })).toThrow(/no e-NCF/);
  });
});

describe('helpers', () => {
  it('maps DGII\'s modification codes to BillingSoft\'s names', () => {
    expect(['1', '2', '3', '4', '5'].map(modificationOfCode)).toEqual(['void', 'correctsText', 'correctsAmounts', 'replacesContingency', 'consumerInvoice']);
    expect(() => modificationOfCode('9')).toThrow(/Unknown/);
  });
  it('accepts only 9- and 11-digit tax ids', () => {
    expect(normalizeRnc('131-88068-1')).toBe('131880681');
    expect(normalizeRnc('001-1234567-8')).toBe('00112345678');
    expect(normalizeRnc('1234')).toBeUndefined();
    expect(normalizeRnc(undefined)).toBeUndefined();
  });
  it('accepts only emails in DGII\'s pattern', () => {
    expect(dgiiEmail('ana@hotel.com')).toBe('ana@hotel.com');
    expect(dgiiEmail('ana.maria+x@hotel.com.do')).toBe('ana.maria+x@hotel.com.do');
    expect(dgiiEmail('ana@@hotel')).toBeUndefined();
    expect(dgiiEmail(undefined)).toBeUndefined();
  });
});
