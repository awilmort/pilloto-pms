/**
 * Invoice PDF (services/accounting/invoicePdf.service.ts): the pure helpers and the generated
 * document — letterhead, bill-to, line table, totals, the draft/void stamp, the e-CF block, and
 * page breaks for long invoices. Text is read back out of the (uncompressed) PDF stream.
 */
import { generateInvoicePdf, InvoicePdfData, InvoicePdfLine, loadLogo, money, paymentCondition, taxBreakdown } from '../services/accounting/invoicePdf.service';

/** Every text run drawn on the page, in drawing order (pdfkit writes text as hex segments inside TJ arrays). */
function extractText(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const out: string[] = [];
  for (const tj of raw.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    out.push([...tj[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  }
  return out;
}
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

const line = (over: Partial<InvoicePdfLine> = {}): InvoicePdfLine => ({
  description: 'Alquiler de salón', quantity: 2, unitPrice: 500, discountPercent: 10, taxRate: 18, lineTotal: 900, total: 1062, ...over,
});

const base = (over: Partial<InvoicePdfData> = {}): InvoicePdfData => ({
  invoiceNumber: 'INV-000012', status: 'draft', issueDate: new Date('2026-11-09T16:00:00Z'), dueDate: new Date('2026-12-09T16:00:00Z'), reference: 'OC-77', notes: 'Pago por transferencia',
  lines: [line()], subtotal: 900, taxAmount: 162, total: 1062, amountPaid: 0, balanceDue: 1062,
  issuer: { name: 'Hotel Verificación', legalName: 'Hotel Verificación SRL', rnc: '131880681', address: 'Av. Principal 1, Santo Domingo' },
  buyer: { name: 'Grupo Caribe SRL', rnc: '101010101', address: 'Calle 2 #5' },
  ...over,
});

const gen = (data: InvoicePdfData) => generateInvoicePdf(data, { compress: false });

describe('helpers', () => {
  it('money always shows two decimals and the peso sign', () => {
    expect(money(1062)).toBe('RD$ 1,062.00');
    expect(money(0.5)).toBe('RD$ 0.50');
  });

  it('paymentCondition: due the same day is cash, otherwise credit with the day count', () => {
    const issue = new Date('2026-11-09T16:00:00Z'); // noon in Santo Domingo
    expect(paymentCondition(issue, undefined)).toBe('Contado');
    expect(paymentCondition(issue, new Date('2026-11-09T16:00:00Z'))).toBe('Contado');
    expect(paymentCondition(issue, new Date('2026-12-09T16:00:00Z'))).toBe('Crédito a 30 días');
    // counted in calendar days of the tenant's zone, not 24h blocks: 9pm and the next noon are 1 day apart
    expect(paymentCondition(new Date('2026-11-10T01:00:00Z'), new Date('2026-11-10T16:00:00Z'))).toBe('Crédito a 1 días');
  });

  it('taxBreakdown groups the base and ITBIS by rate, lowest rate first', () => {
    const rows = taxBreakdown([
      line({ taxRate: 18, lineTotal: 100, total: 118 }),
      line({ taxRate: 16, lineTotal: 200, total: 232 }),
      line({ taxRate: 18, lineTotal: 50, total: 59 }),
      line({ taxRate: 0, lineTotal: 30, total: 30 }),
    ]);
    expect(rows).toEqual([{ rate: 0, base: 30, tax: 0 }, { rate: 16, base: 200, tax: 32 }, { rate: 18, base: 150, tax: 27 }]);
  });
});

describe('loadLogo', () => {
  it('ignores missing, non-image and non-https sources instead of failing the PDF', async () => {
    expect(await loadLogo(undefined, '/tmp')).toBeNull();
    expect(await loadLogo('http://insecure.example.com/logo.png', '/tmp')).toBeNull();
    expect(await loadLogo('https://localhost/logo.png', '/tmp')).toBeNull();
    expect(await loadLogo('https://10.0.0.5/logo.png', '/tmp')).toBeNull();
    expect(await loadLogo('/uploads/../../etc/passwd', '/tmp/uploads')).toBeNull();
  });
});

describe('generateInvoicePdf', () => {
  it('produces a PDF with the letterhead, parties, dates and line table', async () => {
    const pdf = await gen(base());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = extractText(pdf).join('\n');
    for (const expected of ['Hotel Verificación', 'RNC 131880681', 'FACTURA', 'No. INV-000012', 'Grupo Caribe SRL', 'RNC / Cédula: 101010101',
      '09/11/2026', '09/12/2026', 'Crédito a 30 días', 'OC-77', 'Alquiler de salón', '10%', '18%', 'Pago por transferencia']) {
      expect(text).toContain(expected);
    }
  });

  it('prints dates in the tenant time zone: a 9 pm invoice is not dated tomorrow just because the server is on UTC', async () => {
    const text = extractText(await gen(base({ issueDate: new Date('2026-11-10T01:00:00Z'), dueDate: undefined }))).join('\n'); // 9 pm on the 9th in Santo Domingo
    expect(text).toContain('09/11/2026');
    expect(text).not.toContain('10/11/2026');
    const utc = extractText(await gen(base({ timezone: 'UTC', issueDate: new Date('2026-11-10T01:00:00Z'), dueDate: undefined }))).join('\n');
    expect(utc).toContain('10/11/2026');
  });

  it('totals: gross subtotal, discount, ITBIS by rate and the grand total add up', async () => {
    const text = extractText(await gen(base())).join('\n');
    expect(text).toContain('RD$ 1,000.00'); // 2 × 500 before discount
    expect(text).toContain('- RD$ 100.00'); // 10% discount
    expect(text).toContain('ITBIS 18%');
    expect(text).toContain('RD$ 162.00');
    expect(text).toContain('RD$ 1,062.00');
  });

  it('a draft is stamped and labelled as having no fiscal value, and shows no payment lines', async () => {
    const text = extractText(await gen(base({ status: 'draft' }))).join('\n');
    expect(text).toContain('BORRADOR');
    expect(text).toContain('sin valor fiscal');
    expect(text).not.toContain('Saldo pendiente');
  });

  it('an issued e-CF invoice carries the e-NCF, type title, security code and signature date — and no stamp', async () => {
    const pdf = await gen(base({
      status: 'partial', amountPaid: 500, balanceDue: 562,
      ecf: { tipo: 'E31', eNCF: 'E310000000045', estado: 'Aceptado', securityCode: 'AbC123', signedAt: new Date('2026-11-09T19:30:05Z'), sequenceExpiresAt: new Date('2027-12-31T16:00:00Z') },
    }));
    const text = extractText(pdf).join('\n');
    expect(text).toContain('FACTURA DE CRÉDITO FISCAL ELECTRÓNICA');
    expect(text).toContain('e-NCF: E310000000045');
    expect(text).toContain('AbC123');
    expect(text).toContain('09/11/2026 15:30:05');
    expect(text).toContain('Aceptado');
    expect(text).toContain('31/12/2027');
    expect(text).toContain('Saldo pendiente');
    expect(text).toContain('RD$ 562.00');
    expect(text).not.toContain('BORRADOR');
    expect(text).not.toContain('sin valor fiscal');
  });

  it('a consumer invoice (E32) is titled accordingly', async () => {
    const text = extractText(await gen(base({ status: 'paid', ecf: { tipo: 'E32', eNCF: 'E320000000001', estado: 'Aceptado' } }))).join('\n');
    expect(text).toContain('FACTURA DE CONSUMO ELECTRÓNICA');
  });

  it('a void invoice is stamped ANULADA even if it was once issued as an e-CF', async () => {
    const text = extractText(await gen(base({ status: 'void', ecf: { tipo: 'E31', eNCF: 'E310000000045', estado: 'Aceptado', securityCode: 'ZZ9' } }))).join('\n');
    expect(text).toContain('ANULADA');
    expect(text).not.toContain('Código de seguridad'); // no fiscal block on a void document
  });

  it('exempt lines read "Exento"; free-form buyers without an RNC print only what they have', async () => {
    const text = extractText(await gen(base({ lines: [line({ taxRate: 0, total: 900 })], taxAmount: 0, total: 900, buyer: { name: 'Juan Pérez', email: 'juan@example.com' } }))).join('\n');
    expect(text).toContain('Exento');
    expect(text).toContain('juan@example.com');
    expect(text).not.toContain('RNC / Cédula');
  });

  it('a long invoice flows onto further pages, with page numbers on every page', async () => {
    const lines = Array.from({ length: 55 }, (_, i) => line({ description: `Servicio número ${i + 1}` }));
    const pdf = await gen(base({ lines }));
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
    const pages = pageCount(pdf);
    const text = extractText(pdf).join('\n');
    expect(text).toContain(`Página 1 de ${pages}`);
    expect(text).toContain(`Página ${pages} de ${pages}`);
    expect(text).toContain('Servicio número 55');
  });
});
