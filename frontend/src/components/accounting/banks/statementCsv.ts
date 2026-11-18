/**
 * Reading a bank statement file (CSV) into statement rows. Dominican banks export CSV with commas
 * or semicolons, dates as DD/MM/YYYY, and amounts either signed in one column or split into
 * debit/credit columns — the mapping says which.
 */

/** Splits CSV text into rows of cells: quoted fields, doubled quotes, `,` `;` or tab separators. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((sep) => [sep, firstLine.split(sep).length] as const).sort((a, b) => b[1] - a[1]);
  const sep = counts[0][1] > 1 ? counts[0][0] : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type DecimalSeparator = '.' | ',';

/** `YYYY-MM-DD`, or null when the text is not a date in `format`. */
export function parseDate(text: string, format: DateFormat): string | null {
  const parts = text.trim().split(/[/\-. ]/).filter(Boolean);
  if (parts.length < 3) return null;
  let y: number, m: number, d: number;
  if (format === 'YYYY-MM-DD') [y, m, d] = parts.map(Number);
  else if (format === 'DD/MM/YYYY') [d, m, y] = parts.map(Number);
  else [m, d, y] = parts.map(Number);
  if (y < 100) y += 2000;
  if (!y || !m || !d || m > 12 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** A number from bank text: `1,234.56`, `1.234,56`, `(500.00)`, `-500`, `RD$ 500`. */
export function parseAmount(text: string, decimal: DecimalSeparator): number | null {
  let t = (text ?? '').trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || /^-/.test(t) || /-$/.test(t);
  t = t.replace(/[^\d.,]/g, '');
  t = decimal === '.' ? t.replace(/,/g, '') : t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  if (!Number.isFinite(n) || t === '') return null;
  return negative ? -n : n;
}

export interface Mapping {
  hasHeader: boolean;
  date: number;
  description: number;
  reference: number | null;
  /** One signed column, or `debit` (money out) and `credit` (money in) columns. */
  amountMode: 'signed' | 'split';
  amount: number | null;
  debit: number | null;
  credit: number | null;
  dateFormat: DateFormat;
  decimal: DecimalSeparator;
}

export interface MappedRow { date: string; description: string; amount: number; reference?: string }

/** Rows ready to import, and how many lines could not be read. */
export function mapRows(rows: string[][], m: Mapping): { rows: MappedRow[]; skipped: number } {
  const body = m.hasHeader ? rows.slice(1) : rows;
  const out: MappedRow[] = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseDate(r[m.date] ?? '', m.dateFormat);
    let amount: number | null = null;
    if (m.amountMode === 'signed' && m.amount !== null) amount = parseAmount(r[m.amount] ?? '', m.decimal);
    if (m.amountMode === 'split') {
      const out_ = m.debit !== null ? parseAmount(r[m.debit] ?? '', m.decimal) : null;
      const in_ = m.credit !== null ? parseAmount(r[m.credit] ?? '', m.decimal) : null;
      if (in_ || out_) amount = Math.abs(in_ ?? 0) - Math.abs(out_ ?? 0);
    }
    const description = (r[m.description] ?? '').trim();
    if (!date || amount === null || amount === 0 || !description) { skipped++; continue; }
    out.push({ date, description, amount: Math.round(amount * 100) / 100, ...(m.reference !== null && r[m.reference] ? { reference: r[m.reference] } : {}) });
  }
  return { rows: out, skipped };
}

/** A first guess at the mapping from the header names. */
export function guessMapping(header: string[]): Mapping {
  const find = (...words: string[]) => {
    const i = header.findIndex((h) => words.some((w) => h.toLowerCase().includes(w)));
    return i >= 0 ? i : null;
  };
  const debit = find('débito', 'debito', 'debit', 'retiro', 'cargo');
  const credit = find('crédito', 'credito', 'credit', 'depósito', 'deposito', 'abono');
  return {
    hasHeader: true,
    date: find('fecha', 'date') ?? 0,
    description: find('descrip', 'concepto', 'detalle', 'description') ?? 1,
    reference: find('ref', 'documento', 'número', 'numero'),
    amountMode: debit !== null && credit !== null ? 'split' : 'signed',
    amount: find('monto', 'importe', 'amount', 'valor'),
    debit,
    credit,
    dateFormat: 'DD/MM/YYYY',
    decimal: '.',
  };
}
