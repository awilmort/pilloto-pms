import fs from 'fs';
import path from 'path';
import axios from 'axios';
import PDFDocument from 'pdfkit';

/**
 * Printable invoice (`GET /api/accounting/invoices/:id/pdf`). The controller loads and maps the
 * invoice into the plain `InvoicePdfData` below, so this layout code knows nothing about Mongoose.
 *
 * Layout, top to bottom: letterhead (logo + issuer) | document title, number, e-NCF | bill-to and
 * dates | line table (re-draws its header on every page) | totals | notes | e-CF block,
 * security code and signature date | footer with page numbers. A draft or void invoice carries a
 * diagonal watermark and a "no fiscal value" line, since only an issued e-CF is a fiscal document.
 */

export interface InvoicePdfLine {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  lineTotal: number;
  total: number;
}

export interface InvoicePdfIssuer {
  name: string;
  legalName?: string;
  rnc?: string;
  address?: string;
  phone?: string;
  email?: string;
  logo?: Buffer | null;
}

export interface InvoicePdfBuyer {
  name: string;
  rnc?: string;
  address?: string;
  email?: string;
  phone?: string;
}

export interface InvoicePdfEcf {
  tipo: string;
  eNCF: string;
  estado: string;
  securityCode?: string;
  signedAt?: Date;
  sequenceExpiresAt?: Date;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  /** IANA zone the dates are printed in (the tenant's); defaults to the Dominican Republic. */
  timezone?: string;
  status: 'draft' | 'sent' | 'partial' | 'paid' | 'void';
  issueDate: Date;
  dueDate?: Date;
  reference?: string;
  notes?: string;
  lines: InvoicePdfLine[];
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  issuer: InvoicePdfIssuer;
  buyer: InvoicePdfBuyer;
  ecf?: InvoicePdfEcf;
}

export interface InvoicePdfOptions {
  /** Turn off stream compression (tests search the raw PDF for text). */
  compress?: boolean;
}

const ACCENT = '#0F766E';
const INK = '#1A1F2E';
const MUTED = '#5B6278';
const RULE = '#D5D9E2';
const HEAD_FILL = '#EAF4F2';

const MARGIN = 48;
const PAGE_W = 612;
const PAGE_H = 792;
const CONTENT_W = PAGE_W - MARGIN * 2;

const TITLES: Record<string, string> = {
  E31: 'FACTURA DE CRÉDITO FISCAL ELECTRÓNICA',
  E32: 'FACTURA DE CONSUMO ELECTRÓNICA',
};

const STATUS_STAMP: Partial<Record<InvoicePdfData['status'], string>> = { draft: 'BORRADOR', void: 'ANULADA' };

// ── Formatting ───────────────────────────────────────────────────────────────

export const money = (n: number): string =>
  `RD$ ${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (n: number): string => (Number.isInteger(n) ? String(n) : n.toLocaleString('en-US', { maximumFractionDigits: 4 }));

export const DEFAULT_TIMEZONE = 'America/Santo_Domingo';

/** Calendar parts of an instant in a given zone (so a 9 pm invoice is not printed with tomorrow's date on a UTC server). */
const parts = (d: Date, timeZone: string) => {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d)) p[x.type] = x.value;
  return p;
};

export const fmtDate = (d: Date, timeZone = DEFAULT_TIMEZONE): string => {
  const p = parts(d, timeZone);
  return `${p.day}/${p.month}/${p.year}`;
};

const fmtDateTime = (d: Date, timeZone = DEFAULT_TIMEZONE): string => {
  const p = parts(d, timeZone);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
};

/** "Contado" when due the day it is issued, otherwise "Crédito a N días". */
export function paymentCondition(issueDate: Date, dueDate?: Date, timeZone = DEFAULT_TIMEZONE): string {
  if (!dueDate) return 'Contado';
  const day = (d: Date) => { const p = parts(d, timeZone); return Date.UTC(+p.year, +p.month - 1, +p.day); };
  const days = Math.round((day(dueDate) - day(issueDate)) / 86400000);
  return days <= 0 ? 'Contado' : `Crédito a ${days} días`;
}

/** Tax base and amount per ITBIS rate, in ascending order — what the totals block lists. */
export function taxBreakdown(lines: InvoicePdfLine[]): { rate: number; base: number; tax: number }[] {
  const byRate = new Map<number, { base: number; tax: number }>();
  for (const l of lines) {
    const row = byRate.get(l.taxRate) ?? { base: 0, tax: 0 };
    row.base += l.lineTotal;
    row.tax += l.total - l.lineTotal;
    byRate.set(l.taxRate, row);
  }
  return [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => ({ rate, base: Math.round(v.base * 100) / 100, tax: Math.round(v.tax * 100) / 100 }));
}

const discountTotal = (lines: InvoicePdfLine[]): number =>
  Math.round(lines.reduce((s, l) => s + (l.quantity * l.unitPrice - l.lineTotal), 0) * 100) / 100;

// ── Logo ─────────────────────────────────────────────────────────────────────

const isImage = (b: Buffer): boolean =>
  (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b.length > 3 && b[0] === 0xff && b[1] === 0xd8);

/** Only public https hosts: the logo URL is tenant-supplied and fetched from the server. */
const isPublicHttpsUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return !(h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')
      || /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(':'));
  } catch {
    return false;
  }
};

/**
 * The tenant's logo as PNG/JPEG bytes, or null. Accepts an uploaded file (`/uploads/<tenant>/x.png`) or a
 * public https URL; anything else (SVG, WebP, unreachable, oversized) quietly means "no logo".
 */
export async function loadLogo(logoUrl: string | undefined, uploadsDir: string): Promise<Buffer | null> {
  if (!logoUrl) return null;
  try {
    let buf: Buffer | null = null;
    if (logoUrl.startsWith('/uploads/')) {
      const resolved = path.join(uploadsDir, logoUrl.replace(/^\/uploads\//, ''));
      if (!resolved.startsWith(uploadsDir) || !fs.existsSync(resolved)) return null;
      buf = fs.readFileSync(resolved);
    } else if (isPublicHttpsUrl(logoUrl)) {
      const res = await axios.get<ArrayBuffer>(logoUrl, { responseType: 'arraybuffer', timeout: 4000, maxContentLength: 2_000_000, maxRedirects: 2 });
      buf = Buffer.from(res.data);
    }
    return buf && buf.length <= 2_000_000 && isImage(buf) ? buf : null;
  } catch {
    return null;
  }
}

// ── Drawing ──────────────────────────────────────────────────────────────────

const COLS = [
  { key: 'n', header: '#', width: 22, align: 'left' as const },
  { key: 'description', header: 'DESCRIPCIÓN', width: 0, align: 'left' as const }, // takes the remaining width
  { key: 'quantity', header: 'CANT.', width: 44, align: 'right' as const },
  { key: 'unitPrice', header: 'PRECIO', width: 72, align: 'right' as const },
  { key: 'discount', header: 'DESC.', width: 42, align: 'right' as const },
  { key: 'tax', header: 'ITBIS', width: 42, align: 'right' as const },
  { key: 'amount', header: 'IMPORTE', width: 78, align: 'right' as const },
];
const FIXED_W = COLS.reduce((s, c) => s + c.width, 0);
COLS[1].width = CONTENT_W - FIXED_W;
const CELL_PAD = 4;

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  doc.rect(MARGIN, y, CONTENT_W, 20).fill(HEAD_FILL);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ACCENT);
  let x = MARGIN;
  for (const c of COLS) {
    doc.text(c.header, x + CELL_PAD, y + 6.5, { width: c.width - CELL_PAD * 2, align: c.align, lineBreak: false });
    x += c.width;
  }
  return y + 20;
}

function drawWatermark(doc: PDFKit.PDFDocument, text: string) {
  doc.save();
  doc.fillColor('#B4232A').opacity(0.09).font('Helvetica-Bold').fontSize(110);
  doc.rotate(-35, { origin: [PAGE_W / 2, PAGE_H / 2] });
  const w = doc.widthOfString(text);
  doc.text(text, PAGE_W / 2 - w / 2, PAGE_H / 2 - 50, { lineBreak: false });
  doc.restore();
}

export async function generateInvoicePdf(data: InvoicePdfData, options: InvoicePdfOptions = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: MARGIN,
    bufferPages: true,
    compress: options.compress !== false,
    info: { Title: `Factura ${data.invoiceNumber}`, Author: data.issuer.name, Producer: 'Pilloto Contabilidad' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const tz = data.timezone || DEFAULT_TIMEZONE;
  const stamp = STATUS_STAMP[data.status];
  const isFiscal = !!data.ecf && !stamp;

  // ── Letterhead ────────────────────────────────────────────────────────────
  let y = MARGIN;
  let leftX = MARGIN;
  if (data.issuer.logo) {
    try {
      doc.image(data.issuer.logo, MARGIN, y, { fit: [96, 54] });
      leftX = MARGIN + 108;
    } catch { /* unreadable image: print without it */ }
  }
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(data.issuer.name, leftX, y, { width: 250 });
  let issuerY = doc.y + 1;
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  const issuerLines = [
    data.issuer.legalName && data.issuer.legalName !== data.issuer.name ? data.issuer.legalName : null,
    data.issuer.rnc ? `RNC ${data.issuer.rnc}` : null,
    data.issuer.address ?? null,
    [data.issuer.phone, data.issuer.email].filter(Boolean).join('  ·  ') || null,
  ].filter(Boolean) as string[];
  for (const line of issuerLines) {
    doc.text(line, leftX, issuerY, { width: 250 });
    issuerY = doc.y + 1;
  }

  // Title block (right)
  const titleX = MARGIN + 270;
  const titleW = CONTENT_W - 270;
  const title = (data.ecf && TITLES[data.ecf.tipo]) || 'FACTURA';
  doc.font('Helvetica-Bold').fontSize(data.ecf ? 10.5 : 22).fillColor(ACCENT).text(title, titleX, y, { width: titleW, align: 'right' });
  let titleY = doc.y + 4;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`No. ${data.invoiceNumber}`, titleX, titleY, { width: titleW, align: 'right' });
  titleY = doc.y + 2;
  if (data.ecf) {
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(`e-NCF: ${data.ecf.eNCF}`, titleX, titleY, { width: titleW, align: 'right' });
    titleY = doc.y + 2;
  }
  if (stamp) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#B4232A').text(`${stamp} — sin valor fiscal`, titleX, titleY, { width: titleW, align: 'right' });
    titleY = doc.y;
  }

  y = Math.max(issuerY, titleY, MARGIN + 56) + 14;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(1.5).strokeColor(ACCENT).stroke();
  y += 14;

  // ── Bill-to and dates ─────────────────────────────────────────────────────
  const blockW = CONTENT_W / 2 - 12;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('FACTURADO A', MARGIN, y);
  let buyerY = doc.y + 3;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(data.buyer.name, MARGIN, buyerY, { width: blockW });
  buyerY = doc.y + 1;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  for (const line of [data.buyer.rnc ? `RNC / Cédula: ${data.buyer.rnc}` : null, data.buyer.address ?? null, data.buyer.email ?? null, data.buyer.phone ?? null].filter(Boolean) as string[]) {
    doc.text(line, MARGIN, buyerY, { width: blockW });
    buyerY = doc.y + 1;
  }

  const metaX = MARGIN + CONTENT_W / 2 + 12;
  const rows: [string, string][] = [
    ['Fecha de emisión', fmtDate(data.issueDate, tz)],
    ['Condición de pago', paymentCondition(data.issueDate, data.dueDate, tz)],
  ];
  if (data.dueDate) rows.push(['Fecha de vencimiento', fmtDate(data.dueDate, tz)]);
  if (data.reference) rows.push(['Referencia', data.reference]);
  let metaY = y;
  for (const [label, value] of rows) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(label, metaX, metaY, { width: 110 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(value, metaX + 112, metaY - 0.5, { width: blockW - 112 });
    metaY = Math.max(doc.y, metaY + 13) + 3;
  }
  y = Math.max(buyerY, metaY) + 14;

  // ── Line table ────────────────────────────────────────────────────────────
  const bottomLimit = PAGE_H - MARGIN - 40;
  y = drawTableHeader(doc, y);
  data.lines.forEach((line, i) => {
    doc.font('Helvetica').fontSize(8.5);
    const descH = doc.heightOfString(line.description, { width: COLS[1].width - CELL_PAD * 2 });
    const rowH = Math.max(18, descH + 9);
    if (y + rowH > bottomLimit) {
      doc.addPage();
      y = drawTableHeader(doc, MARGIN);
    }
    const hasDiscount = line.discountPercent > 0;
    const cells = [
      String(i + 1), line.description, num(line.quantity), money(line.unitPrice).replace('RD$ ', ''),
      hasDiscount ? `${num(line.discountPercent)}%` : '—', line.taxRate > 0 ? `${num(line.taxRate)}%` : 'Exento', money(line.lineTotal).replace('RD$ ', ''),
    ];
    let x = MARGIN;
    COLS.forEach((c, idx) => {
      doc.font('Helvetica').fontSize(8.5).fillColor(idx === 1 ? INK : INK)
        .text(cells[idx], x + CELL_PAD, y + 5, { width: c.width - CELL_PAD * 2, align: c.align });
      x += c.width;
    });
    y += rowH;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.5).strokeColor(RULE).stroke();
  });
  y += 14;

  // ── Totals (right) and notes (left) ───────────────────────────────────────
  const totals: { label: string; value: string; bold?: boolean; big?: boolean }[] = [{ label: 'Subtotal', value: money(data.subtotal + discountTotal(data.lines)) }];
  const discount = discountTotal(data.lines);
  if (discount > 0) totals.push({ label: 'Descuento', value: `- ${money(discount)}` });
  const breakdown = taxBreakdown(data.lines).filter((b) => b.rate > 0);
  if (breakdown.length === 0) totals.push({ label: 'ITBIS', value: money(0) });
  breakdown.forEach((b) => totals.push({ label: `ITBIS ${num(b.rate)}%`, value: money(b.tax) }));
  totals.push({ label: 'TOTAL', value: money(data.total), bold: true, big: true });
  if (data.status !== 'draft') {
    totals.push({ label: 'Pagado', value: money(data.amountPaid) });
    totals.push({ label: 'Saldo pendiente', value: money(data.balanceDue), bold: true });
  }

  const totalsH = totals.reduce((s, t) => s + (t.big ? 26 : 15), 0);
  const notesText = data.notes?.trim();
  const notesH = notesText ? doc.heightOfString(notesText, { width: CONTENT_W - 250 }) + 20 : 0;
  if (y + Math.max(totalsH, notesH) > bottomLimit) { doc.addPage(); y = MARGIN; }

  const totalsX = MARGIN + CONTENT_W - 220;
  let ty = y;
  for (const t of totals) {
    if (t.big) {
      doc.rect(totalsX - 8, ty - 3, 228, 24).fill(HEAD_FILL);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT).text(t.label, totalsX, ty + 3, { width: 100 });
      doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT).text(t.value, totalsX + 100, ty + 3, { width: 112, align: 'right' });
      ty += 26;
    } else {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(t.label, totalsX, ty, { width: 100 });
      doc.font(t.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(INK).text(t.value, totalsX + 100, ty, { width: 112, align: 'right' });
      ty += 15;
    }
  }
  if (notesText) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('NOTAS', MARGIN, y);
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(notesText, MARGIN, doc.y + 3, { width: CONTENT_W - 250 });
  }
  y = Math.max(ty, doc.y) + 18;

  // ── e-CF block ────────────────────────────────────────────────────────────
  if (data.ecf && isFiscal) {
    const boxH = 96;
    if (y + boxH > PAGE_H - MARGIN - 20) { doc.addPage(); y = MARGIN; }
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 4).lineWidth(0.75).strokeColor(RULE).stroke();
    const textX = MARGIN + 14;
    const lines: [string, string][] = [
      ['e-NCF', data.ecf.eNCF],
      ['Código de seguridad', data.ecf.securityCode ?? '—'],
      ['Fecha de firma digital', data.ecf.signedAt ? fmtDateTime(data.ecf.signedAt, tz) : '—'],
      ['Estado DGII', data.ecf.estado],
    ];
    if (data.ecf.sequenceExpiresAt) lines.push(['Vencimiento de secuencia', fmtDate(data.ecf.sequenceExpiresAt, tz)]);
    let ey = y + 10;
    for (const [label, value] of lines) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, textX, ey, { width: 120 });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(value, textX + 122, ey - 0.5, { width: CONTENT_W - (textX - MARGIN) - 130 });
      ey += 14;
    }
  }

  // ── Watermark and footer on every page ───────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (stamp) drawWatermark(doc, stamp);
    doc.page.margins.bottom = 0; // footer sits inside the bottom margin; stop pdfkit adding a page for it
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(`${data.issuer.name} · Factura ${data.invoiceNumber}`, MARGIN, PAGE_H - 34, { width: CONTENT_W / 2, align: 'left', lineBreak: false });
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, MARGIN + CONTENT_W / 2, PAGE_H - 34, { width: CONTENT_W / 2, align: 'right', lineBreak: false });
  }

  doc.end();
  return done;
}
