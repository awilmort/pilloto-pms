/**
 * Turns Pilloto's documents into BillingSoft requests. Each app builds a request and hands it to
 * the issuer; nothing here talks to BillingSoft.
 *
 * PMS charges are tax-inclusive (a room costs 5,900 with ITBIS), BillingSoft prices exclude ITBIS,
 * so folio and note amounts are converted with `netFromGross`. Accounting lines already carry a net
 * amount and a tax rate.
 */
import { IEcfLineItem } from '../../models/ElectronicInvoice';
import { dominicanDate, FiscalError, netFromGross, round2, decimalString } from './fiscalCore';
import { BsBuyer, BsDocumentRequest, BsLine, BsLineTax, BsModification, BsPayment } from './billingsoftTypes';

/** Credit sales without a stated due date are due this many days after issue. */
export const DEFAULT_CREDIT_DAYS = 30;
const PMS_ITBIS_RATE = 18;
/** BillingSoft/DGII text limits. */
const LINE_NAME_MAX = 80;
const BUYER_NAME_MAX = 150;
const REASON_MAX = 90;

export interface BuyerInfo {
  rnc?: string;
  name?: string;
  email?: string;
  razonSocial?: string;
}

// ─── Text and contact cleanup ────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
/** DGII's own e-mail pattern, stricter than RFC 5322 (BillingSoft refuses anything else). */
const DGII_EMAIL = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;

const clean = (text: string, max: number): string => text.replace(XML_INVALID, '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The email if DGII would accept it; an unusual address must not block an invoice, so it is dropped. */
export function dgiiEmail(email?: string): string | undefined {
  const e = (email ?? '').trim();
  return e && e.length <= 80 && DGII_EMAIL.test(e) ? e : undefined;
}

export function normalizeRnc(value?: string): string | undefined {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 9 || digits.length === 11 ? digits : undefined;
}

function toBuyer(buyer: BuyerInfo | undefined, requireName: boolean): BsBuyer | undefined {
  if (!buyer) return undefined;
  const name = clean(buyer.razonSocial || buyer.name || '', BUYER_NAME_MAX);
  const rnc = normalizeRnc(buyer.rnc);
  const email = dgiiEmail(buyer.email);
  if (buyer.rnc && !rnc) {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'The buyer RNC must have 9 digits (11 for a cédula)', { 'buyer.rnc': 'RNC inválido' });
  }
  if (!name) {
    if (requireName || rnc) {
      throw new FiscalError(400, 'FISCAL_REJECTED', 'The buyer name is required', { 'buyer.name': 'Ingrese el nombre' });
    }
    return undefined;
  }
  return { name, ...(rnc ? { rnc } : {}), ...(email ? { email } : {}) };
}

// ─── Payment ─────────────────────────────────────────────────────────────────

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const creditPayment = (now: Date, dueDate?: Date): BsPayment => {
  const today = dominicanDate(now);
  const due = dueDate ? dominicanDate(dueDate) : addDays(today, DEFAULT_CREDIT_DAYS);
  return { type: 'credit', dueOn: due < today ? today : due };
};

// ─── PMS: a folio ────────────────────────────────────────────────────────────

export interface FolioInput {
  charges: { description: string; amount: number }[];
  payments: { method: string; status?: string }[];
  buyer?: BuyerInfo;
  /** Force 31 or 32; by default 31 when the buyer has an RNC, else 32. */
  type?: '31' | '32';
  now?: Date;
}

/** An e-CF for a folio's charges: B2B (31) when the buyer has an RNC, consumer (32) otherwise. */
export function folioInvoiceRequest(input: FolioInput): BsDocumentRequest {
  const { charges } = input;
  if (charges.length === 0) throw new FiscalError(400, 'FISCAL_REJECTED', 'There are no charges on this folio');
  if (round2(charges.reduce((s, c) => s + c.amount, 0)) <= 0) {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'The folio total must be greater than zero');
  }
  const type = input.type ?? (normalizeRnc(input.buyer?.rnc) ? '31' : '32');
  if (type === '31' && !normalizeRnc(input.buyer?.rnc)) {
    throw new FiscalError(400, 'FISCAL_REJECTED', "A credit-fiscal invoice (31) needs the buyer's RNC", { 'buyer.rnc': 'Ingrese el RNC' });
  }
  const buyer = toBuyer(input.buyer, type === '31');

  const lines: BsLine[] = charges
    .filter((c) => c.amount > 0)
    .map((c) => ({
      name: clean(c.description, LINE_NAME_MAX) || 'Servicio',
      kind: 'service',
      quantity: '1',
      unitPrice: netFromGross(c.amount, PMS_ITBIS_RATE),
      tax: 'itbis18',
    }));

  const active = input.payments.filter((p) => p.status !== 'reversed');
  const allCredit = active.length > 0 && active.every((p) => p.method === 'credit');

  return {
    type,
    ...(buyer ? { buyer } : {}),
    incomeType: '01',
    payment: allCredit ? creditPayment(input.now ?? new Date()) : { type: 'cash' },
    lines,
  };
}

// ─── Accounting: an invoice ──────────────────────────────────────────────────

export interface AccountingLine {
  description: string;
  quantity: number;
  /** Percent, e.g. 18 or 0 — 0 is exempt. */
  taxRate: number;
  /** Net amount of the line, after discount, before tax. */
  lineTotal: number;
}

const taxOfRate = (rate: number): BsLineTax => {
  if (rate === 18) return 'itbis18';
  if (rate === 16) return 'itbis16';
  if (rate === 0) return 'exempt';
  throw new FiscalError(400, 'FISCAL_REJECTED', `ITBIS ${rate}% is not a rate DGII accepts (18, 16 or exempt)`);
};

function accountingLines(lines: AccountingLine[]): BsLine[] {
  if (lines.length === 0) throw new FiscalError(400, 'FISCAL_REJECTED', 'At least one line is required');
  return lines.map((l) => {
    const quantity = l.quantity > 0 ? l.quantity : 1;
    return {
      name: clean(l.description, LINE_NAME_MAX) || 'Servicio',
      kind: 'service' as const,
      quantity: decimalString(quantity, 2),
      // The net amount of the line spread over its quantity, to the 4 decimals DGII allows.
      unitPrice: decimalString(l.lineTotal / quantity, 4),
      tax: taxOfRate(l.taxRate),
    };
  });
}

export interface AccountingInvoiceInput {
  type: '31' | '32';
  lines: AccountingLine[];
  buyer: BuyerInfo;
  dueDate?: Date;
  now?: Date;
}

/** An e-CF for a sent Accounting invoice: always on credit, due on its due date. */
export function accountingInvoiceRequest(input: AccountingInvoiceInput): BsDocumentRequest {
  const buyer = toBuyer(input.buyer, input.type === '31');
  if (input.type === '31' && !buyer?.rnc) {
    throw new FiscalError(400, 'FISCAL_REJECTED', "A credit-fiscal invoice (31) needs the buyer's RNC", { 'buyer.rnc': 'Ingrese el RNC' });
  }
  return {
    type: input.type,
    ...(buyer ? { buyer } : {}),
    incomeType: '01',
    payment: creditPayment(input.now ?? new Date(), input.dueDate),
    lines: accountingLines(input.lines),
  };
}

// ─── Notes ───────────────────────────────────────────────────────────────────

/** DGII's `CodigoModificacion` → BillingSoft's name for it. */
const MODIFICATION_OF_CODE: Record<string, BsModification> = {
  '1': 'void',
  '2': 'correctsText',
  '3': 'correctsAmounts',
  '4': 'replacesContingency',
  '5': 'consumerInvoice',
};

export function modificationOfCode(code: string): BsModification {
  const modification = MODIFICATION_OF_CODE[code];
  if (!modification) throw new FiscalError(400, 'FISCAL_REJECTED', `Unknown modification code "${code}"`);
  return modification;
}

/** The e-CF being modified, as the record stores it. */
export interface OriginalRef {
  eNCF?: string;
  issuedAt: Date;
  buyerRnc?: string;
  buyerName?: string;
  buyerEmail?: string;
}

export interface NoteInput {
  note: 'credit' | 'debit';
  original: OriginalRef;
  /** DGII's `CodigoModificacion`, '1'–'4'. */
  modificationCode: string;
  reason: string;
  lines: BsLine[];
}

/** A credit (34) or debit (33) note on an issued e-CF. */
export function noteRequest(input: NoteInput): BsDocumentRequest {
  if (!input.original.eNCF) {
    throw new FiscalError(409, 'FISCAL_NO_DOCUMENT', 'The original e-CF has no e-NCF yet');
  }
  if (!input.reason.trim()) {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'A reason is required', { reason: 'Indique el motivo' });
  }
  if (input.lines.length === 0) throw new FiscalError(400, 'FISCAL_REJECTED', 'At least one line is required');
  const buyer = toBuyer(
    { rnc: input.original.buyerRnc, name: input.original.buyerName, email: input.original.buyerEmail },
    false,
  );
  return {
    type: input.note === 'credit' ? '34' : '33',
    ...(buyer ? { buyer } : {}),
    incomeType: '01',
    payment: { type: 'cash' },
    reference: {
      ncf: input.original.eNCF,
      issuedOn: dominicanDate(input.original.issuedAt),
      modification: modificationOfCode(input.modificationCode),
      reason: clean(input.reason, REASON_MAX),
    },
    lines: input.lines,
  };
}

/** PMS note lines: description and tax-inclusive amount each. */
export function grossNoteLines(items: { description: string; amount: number }[]): BsLine[] {
  return items.map((i) => ({
    name: clean(i.description, LINE_NAME_MAX) || 'Servicio',
    kind: 'service',
    quantity: '1',
    unitPrice: netFromGross(i.amount, PMS_ITBIS_RATE),
    tax: 'itbis18',
  }));
}

/** Accounting note lines (net amounts and tax rates). */
export const accountingNoteLines = accountingLines;

export type { IEcfLineItem };
