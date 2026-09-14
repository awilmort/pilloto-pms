import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../../middleware/auth';
import DebitNote, { IDebitNoteLineItem, DebitNoteReason, DebitNoteFiscalModificationCode, DebitNotePaymentMethod } from '../../models/DebitNote';
import Invoice from '../../models/Invoice';
import Tenant from '../../models/Tenant';
import ElectronicInvoice from '../../models/ElectronicInvoice';
import { nextSequence } from '../../models/Counter';
import { citrusEcfService, CitrusError, CitrusInvoiceResponse } from '../../services/citrusEcf';
import { mapToAccountingDebitNote, EcfMapperError, type OriginalInvoiceRef } from '../../utils/ecfMapper';
import type { IEcfLineItem } from '../../models/ElectronicInvoice';
import { postJournalEntry, getSystemAccountIds, cashAccountCodeForMethod, reversePostedEntries } from '../../services/accounting/ledger.service';
import { SYSTEM_ACCOUNT_CODES } from '../../constants/accounting';

/**
 * Debit note controller (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 8.3,
 * PILLOTO_ACCOUNTING_ARCHITECTURE.md §10). `issue` is the one action that reaches
 * outside this model — calling into the existing e-CF pipeline for an E33, same
 * shape `CreditNote.issue()`/`sendInvoice` already established. `recordPayment`/
 * `void` are the same plain lifecycle actions `Invoice`/`Bill` already use — there
 * is no `apply`/`refund` here, since a debit note is new AR to collect, not a pool
 * of credit to allocate (see the model file's header for why this differs from
 * `CreditNote`'s shape).
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const VALID_REASONS: DebitNoteReason[] = [
  'interest-on-overdue', 'price-correction', 'quantity-correction', 'additional-charge', 'other',
];
const VALID_FISCAL_CODES: DebitNoteFiscalModificationCode[] = ['1', '2', '3', '4'];
const REASON_LABELS: Record<DebitNoteReason, string> = {
  'interest-on-overdue': 'Interest on overdue balance',
  'price-correction': 'Price correction',
  'quantity-correction': 'Quantity correction',
  'additional-charge': 'Additional charge',
  other: 'Other',
};

interface RawDebitNoteLineItemInput {
  description?: string;
  product?: string;
  lineTotal?: number; // tax-exclusive amount being charged
  taxRate?: number;
}

async function resolveDefaultTaxRate(tenantId: unknown): Promise<number> {
  const tenant = await Tenant.findById(tenantId).select('ecfConfig.defaultItbisRate').lean();
  return (tenant as any)?.ecfConfig?.defaultItbisRate ?? 18;
}

function buildLineItems(rawLines: RawDebitNoteLineItemInput[], defaultTaxRate: number): IDebitNoteLineItem[] {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw { status: 400, message: 'At least one line item is required' };
  }
  const lines: IDebitNoteLineItem[] = [];
  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    if (!line.description?.trim()) throw { status: 400, message: `Line ${idx + 1}: description is required` };
    if (line.lineTotal === undefined || line.lineTotal === null || line.lineTotal < 0) {
      throw { status: 400, message: `Line ${idx + 1}: lineTotal (amount) is required and must be >= 0` };
    }
    const taxRate = line.taxRate ?? defaultTaxRate;
    if (taxRate < 0 || taxRate > 100) throw { status: 400, message: `Line ${idx + 1}: taxRate must be between 0 and 100` };

    lines.push({
      description: line.description.trim(),
      taxRate,
      lineTotal: line.lineTotal,
      taxAmount: 0,
      total: 0,
      product: line.product && mongoose.Types.ObjectId.isValid(line.product) ? new mongoose.Types.ObjectId(line.product) : undefined,
    } as IDebitNoteLineItem);
  }
  return lines;
}

export const listDebitNotes = async (req: AuthRequest, res: Response) => {
  try {
    const { status, invoice, customer, page = '1', limit = '50' } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (invoice && mongoose.Types.ObjectId.isValid(invoice)) filter.invoice = invoice;
    if (customer && mongoose.Types.ObjectId.isValid(customer)) filter.customer = customer;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [debitNotes, total] = await Promise.all([
      DebitNote.find(filter)
        .populate('customer', 'name rnc razonSocial email')
        .populate('invoice', 'invoiceNumber total')
        .populate('electronicInvoiceId', 'eNCF estadoECF urlCodigoQr')
        .sort({ issueDate: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      DebitNote.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: debitNotes,
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    console.error('List debit notes error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching debit notes' });
  }
};

export const getDebitNote = async (req: AuthRequest, res: Response) => {
  try {
    const debitNote = await DebitNote.findById(req.params.id)
      .populate('customer', 'name rnc razonSocial email phone')
      .populate('invoice', 'invoiceNumber total status')
      .populate('lineItems.product', 'name sku unitOfMeasure')
      .populate('electronicInvoiceId')
      .lean();
    if (!debitNote) return res.status(404).json({ success: false, message: 'Debit note not found' });
    res.status(200).json({ success: true, data: debitNote });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid debit note ID' });
    console.error('Get debit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching debit note' });
  }
};

export const createDebitNote = async (req: AuthRequest, res: Response) => {
  try {
    const {
      invoice: invoiceId, reason, fiscalModificationCode, dueDate, notes, lineItems: rawLines,
    } = req.body as {
      invoice?: string;
      reason?: DebitNoteReason;
      fiscalModificationCode?: DebitNoteFiscalModificationCode;
      dueDate?: string;
      notes?: string;
      lineItems?: RawDebitNoteLineItemInput[];
    };

    if (!invoiceId || !mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ success: false, message: 'invoice is required and must be a valid Invoice ID' });
    }
    const invoiceDoc = await Invoice.findById(invoiceId);
    if (!invoiceDoc) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoiceDoc.status === 'draft' || invoiceDoc.status === 'void') {
      return res.status(400).json({ success: false, message: `Cannot create a debit note against an invoice with status "${invoiceDoc.status}"` });
    }

    if (!reason || !VALID_REASONS.includes(reason)) {
      return res.status(400).json({ success: false, message: `reason must be one of: ${VALID_REASONS.join(', ')}` });
    }
    if (!fiscalModificationCode || !VALID_FISCAL_CODES.includes(fiscalModificationCode)) {
      return res.status(400).json({ success: false, message: `fiscalModificationCode must be one of: ${VALID_FISCAL_CODES.join(', ')}` });
    }

    const defaultTaxRate = await resolveDefaultTaxRate(req.tenantId);
    const lineItems = buildLineItems(rawLines || [], defaultTaxRate);

    const debitNoteNumber = `DN-${String(await nextSequence('debitNoteNumber')).padStart(6, '0')}`;

    const debitNote = await DebitNote.create({
      debitNoteNumber,
      invoice: invoiceId,
      customer: invoiceDoc.isIndividual ? undefined : invoiceDoc.customer,
      isIndividual: invoiceDoc.isIndividual,
      individualCustomer: invoiceDoc.isIndividual ? invoiceDoc.individualCustomer : undefined,
      reason,
      fiscalModificationCode,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      notes,
      lineItems,
      status: 'draft',
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, message: 'Debit note created successfully', data: debitNote });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Create debit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating debit note' });
  }
};

// Edits are only allowed on draft debit notes — same lifecycle discipline as Invoice/CreditNote.
// The originating `invoice` itself is immutable once created.
export const updateDebitNote = async (req: AuthRequest, res: Response) => {
  try {
    const debitNote = await DebitNote.findById(req.params.id);
    if (!debitNote) return res.status(404).json({ success: false, message: 'Debit note not found' });
    if (debitNote.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot edit a debit note with status "${debitNote.status}" — only draft debit notes can be edited` });
    }

    const {
      reason, fiscalModificationCode, dueDate, notes, lineItems: rawLines,
    } = req.body as {
      reason?: DebitNoteReason;
      fiscalModificationCode?: DebitNoteFiscalModificationCode;
      dueDate?: string;
      notes?: string;
      lineItems?: RawDebitNoteLineItemInput[];
    };

    if (reason !== undefined) {
      if (!VALID_REASONS.includes(reason)) return res.status(400).json({ success: false, message: `reason must be one of: ${VALID_REASONS.join(', ')}` });
      debitNote.reason = reason;
    }
    if (fiscalModificationCode !== undefined) {
      if (!VALID_FISCAL_CODES.includes(fiscalModificationCode)) {
        return res.status(400).json({ success: false, message: `fiscalModificationCode must be one of: ${VALID_FISCAL_CODES.join(', ')}` });
      }
      debitNote.fiscalModificationCode = fiscalModificationCode;
    }
    if (dueDate !== undefined) debitNote.dueDate = dueDate ? new Date(dueDate) : undefined;
    if (notes !== undefined) debitNote.notes = notes;

    if (rawLines) {
      const defaultTaxRate = await resolveDefaultTaxRate(req.tenantId);
      debitNote.lineItems = buildLineItems(rawLines, defaultTaxRate) as any;
    }

    await debitNote.save();
    res.status(200).json({ success: true, message: 'Debit note updated successfully', data: debitNote });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid debit note ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Update debit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating debit note' });
  }
};

// Issues a draft debit note: calls the existing e-CF pipeline for a real E33
// referencing the originating invoice's own eNCF, then posts Dr AR/Cr Other Revenue
// (+Sales Tax Payable) — the mirror of CreditNote.issue()'s contra-revenue entry.
export const issueDebitNote = async (req: AuthRequest, res: Response) => {
  try {
    const debitNote = await DebitNote.findById(req.params.id);
    if (!debitNote) return res.status(404).json({ success: false, message: 'Debit note not found' });
    if (debitNote.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot issue a debit note with status "${debitNote.status}" — only draft debit notes can be issued` });
    }

    const invoiceDoc = await Invoice.findById(debitNote.invoice);
    if (!invoiceDoc) return res.status(404).json({ success: false, message: 'Originating invoice not found' });
    if (!invoiceDoc.electronicInvoiceId) {
      return res.status(400).json({ success: false, message: 'The originating invoice has not been sent (no e-CF issued) — cannot issue a debit note against it' });
    }
    const originalEcf = await ElectronicInvoice.findById(invoiceDoc.electronicInvoiceId);
    if (!originalEcf) return res.status(400).json({ success: false, message: 'The originating invoice\'s e-CF record could not be found' });

    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
    if (!tenant.ecfConfig?.isActive) {
      return res.status(400).json({ success: false, message: 'e-CF invoicing is not active for this tenant' });
    }
    if (!tenant.ecfConfig?.citrusToken) {
      return res.status(400).json({ success: false, message: 'Citrus API token is not configured' });
    }

    const originalInvoiceRef: OriginalInvoiceRef = {
      eNCF: originalEcf.eNCF,
      tipo: originalEcf.tipo,
      buyerRnc: originalEcf.buyerRnc,
      buyerName: originalEcf.buyerName,
      buyerEmail: originalEcf.buyerEmail,
      issuedAt: originalEcf.issuedAt,
    };
    const razonModificacion = debitNote.notes?.trim() || REASON_LABELS[debitNote.reason];

    let payload;
    try {
      payload = mapToAccountingDebitNote(
        originalInvoiceRef,
        debitNote.fiscalModificationCode as any,
        razonModificacion,
        debitNote.lineItems.map((l) => ({ description: l.description, quantity: 1, taxRate: l.taxRate, lineTotal: l.lineTotal })),
        tenant,
      );
    } catch (err: any) {
      if (err instanceof EcfMapperError) return res.status(400).json({ success: false, message: err.message });
      throw err;
    }

    let citrusResponse: CitrusInvoiceResponse;
    let isContingency = false;
    try {
      citrusResponse = await citrusEcfService.generateNotaDebito(tenant, payload);
    } catch (err: any) {
      if (err instanceof CitrusError && err.statusCode === 503) {
        isContingency = true;
        citrusResponse = {
          TransaccionId: 0,
          eNCF: `CONTINGENCIA-${Date.now()}`,
          FechaVencimientoSecuencia: null,
          TrackId: `contingency-${Date.now()}`,
          Estatus: 'Contingencia',
          EstadoeCF: 'Emitido Contingencia',
          Mensaje: 'Issued in contingency mode — will be auto-submitted within 72h',
          UrlCodigoQr: null,
          CodigoSeguridad: null,
          SecuenciaUtilizada: false,
          FechaFirmaDigital: null,
          Url: null,
        };
      } else if (err instanceof CitrusError) {
        if (err.statusCode === 401) {
          return res.status(401).json({ success: false, message: 'Citrus API token is invalid or expired — please update the token in settings' });
        }
        if (err.statusCode === 400) {
          return res.status(400).json({ success: false, message: err.message, detail: err.citrusResponse });
        }
        return res.status(502).json({ success: false, message: `Citrus error: ${err.message}` });
      } else {
        throw err;
      }
    }

    const estadoECF = isContingency ? 'Emitido Contingencia' : citrusResponse.EstadoeCF;

    const lineItemsSnapshot: IEcfLineItem[] = debitNote.lineItems.map((l) => ({
      description: l.description,
      qty: 1,
      netPrice: l.lineTotal,
      itbisRate: l.taxRate,
      itbisAmount: l.taxAmount,
      grossAmount: l.total,
    }));

    const electronicInvoice = await ElectronicInvoice.create({
      tipo: 'E33',
      eNCF: citrusResponse.eNCF,
      transaccionId: citrusResponse.TransaccionId,
      ...(citrusResponse.TrackId ? { trackId: citrusResponse.TrackId } : {}),
      numeroFacturaInterna: debitNote.debitNoteNumber,
      estadoECF: estadoECF as any,
      estatus: citrusResponse.Estatus ?? '',
      mensaje: citrusResponse.Mensaje || undefined,
      totalFactura: debitNote.total,
      totalImpuestos: debitNote.taxAmount,
      currency: 'DOP',
      buyerRnc: originalEcf.buyerRnc,
      buyerName: originalEcf.buyerName,
      buyerEmail: originalEcf.buyerEmail,
      lineItems: lineItemsSnapshot,
      originalENCF: originalEcf.eNCF,
      codigoModificacion: debitNote.fiscalModificationCode,
      urlCodigoQr: citrusResponse.UrlCodigoQr ?? undefined,
      codigoSeguridad: citrusResponse.CodigoSeguridad ?? undefined,
      fechaFirmaDigital: citrusResponse.FechaFirmaDigital ? new Date(citrusResponse.FechaFirmaDigital) : undefined,
      fechaVencimientoSecuencia: citrusResponse.FechaVencimientoSecuencia ? new Date(citrusResponse.FechaVencimientoSecuencia) : undefined,
      generatedBy: req.user._id,
      generationSource: 'debit_note',
      issuedAt: new Date(),
      retryCount: 0,
    });

    debitNote.status = 'issued';
    debitNote.electronicInvoiceId = electronicInvoice._id as any;
    await debitNote.save();

    // GL posting: Dr Accounts Receivable / Cr Other Revenue (+Sales Tax Payable) — the mirror
    // of CreditNote.issue()'s Dr Sales Returns & Allowances / Cr AR, posted into 4200 (not
    // 4000 Sales Revenue) per PILLOTO_ACCOUNTING_ARCHITECTURE.md §10.3, so ad hoc recoveries
    // never inflate reported sales revenue. Posted best-effort, same logged-not-blocking
    // rationale as every other GL hook in this codebase — the e-CF is already real by this point.
    try {
      const accountIds = await getSystemAccountIds([
        SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
        SYSTEM_ACCOUNT_CODES.OTHER_REVENUE,
        ...(debitNote.taxAmount > 0 ? [SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE] : []),
      ]);
      const lines = [
        { account: accountIds[SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE], debit: debitNote.total },
        { account: accountIds[SYSTEM_ACCOUNT_CODES.OTHER_REVENUE], credit: debitNote.subtotal },
        ...(debitNote.taxAmount > 0
          ? [{ account: accountIds[SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE], credit: debitNote.taxAmount }]
          : []),
      ];
      await postJournalEntry(lines, 'debit_note_issue', { model: 'DebitNote', id: debitNote._id as any }, `Debit note ${debitNote.debitNoteNumber} issued`, req.user._id);
    } catch (glErr: any) {
      console.error(`[DebitNote.issue] GL posting failed for debit note ${debitNote.debitNoteNumber}:`, glErr?.message || glErr);
    }

    res.status(200).json({ success: true, message: 'Debit note issued successfully', data: { debitNote, electronicInvoice } });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid debit note ID' });
    console.error('Issue debit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while issuing debit note' });
  }
};

// Mirrors Invoice.recordPayment exactly — Dr Bank/Cash, Cr Accounts Receivable.
export const recordPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { amount, method, date, reference } = req.body as {
      amount?: number; method?: DebitNotePaymentMethod; date?: string; reference?: string;
    };
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'amount must be greater than 0' });
    const validMethods: DebitNotePaymentMethod[] = ['cash', 'card', 'transfer', 'check', 'credit'];
    if (!method || !validMethods.includes(method)) {
      return res.status(400).json({ success: false, message: `method must be one of: ${validMethods.join(', ')}` });
    }

    const debitNote = await DebitNote.findById(req.params.id);
    if (!debitNote) return res.status(404).json({ success: false, message: 'Debit note not found' });
    if (debitNote.status === 'draft' || debitNote.status === 'void') {
      return res.status(400).json({ success: false, message: `Cannot record a payment on a debit note with status "${debitNote.status}"` });
    }
    if (amount > debitNote.balanceDue + 0.01) {
      return res.status(400).json({ success: false, message: `Payment amount (${amount}) exceeds the remaining balance due (${debitNote.balanceDue})` });
    }

    debitNote.payments.push({
      amount,
      method,
      date: date ? new Date(date) : new Date(),
      reference,
      recordedBy: req.user._id,
    } as any);
    await debitNote.save();

    try {
      const accountIds = await getSystemAccountIds([cashAccountCodeForMethod(method), SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE]);
      await postJournalEntry(
        [
          { account: accountIds[cashAccountCodeForMethod(method)], debit: amount },
          { account: accountIds[SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE], credit: amount },
        ],
        'debit_note_payment',
        { model: 'DebitNote', id: debitNote._id as any },
        `Payment recorded on debit note ${debitNote.debitNoteNumber}`,
        req.user._id
      );
    } catch (glErr: any) {
      console.error(`[DebitNote.recordPayment] GL posting failed for debit note ${debitNote.debitNoteNumber}:`, glErr?.message || glErr);
    }

    res.status(200).json({ success: true, message: 'Payment recorded successfully', data: debitNote });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid debit note ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Record debit note payment error:', error);
    res.status(500).json({ success: false, message: 'Server error while recording payment' });
  }
};

// Void guardrail: only a debit note with zero payments can be voided — mirrors Invoice.voidInvoice exactly.
export const voidDebitNote = async (req: AuthRequest, res: Response) => {
  try {
    const debitNote = await DebitNote.findById(req.params.id);
    if (!debitNote) return res.status(404).json({ success: false, message: 'Debit note not found' });
    if (debitNote.status === 'void') {
      return res.status(400).json({ success: false, message: 'Debit note is already void' });
    }
    if (debitNote.amountPaid > 0) {
      return res.status(400).json({ success: false, message: 'Cannot void a debit note with payments recorded' });
    }

    const hadGlEntry = debitNote.status === 'issued';

    debitNote.status = 'void';
    debitNote.voidedAt = new Date();
    debitNote.voidReason = req.body?.reason;
    await debitNote.save();

    if (hadGlEntry) {
      try {
        await reversePostedEntries(
          'DebitNote',
          debitNote._id as any,
          'debit_note_issue',
          'debit_note_void',
          `Debit note ${debitNote.debitNoteNumber} voided`,
          req.user._id
        );
      } catch (glErr: any) {
        console.error(`[DebitNote.void] GL reversal failed for debit note ${debitNote.debitNoteNumber}:`, glErr?.message || glErr);
      }
    }

    res.status(200).json({ success: true, message: 'Debit note voided successfully', data: debitNote });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid debit note ID' });
    console.error('Void debit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while voiding debit note' });
  }
};
