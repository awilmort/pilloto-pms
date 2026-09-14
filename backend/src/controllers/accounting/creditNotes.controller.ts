import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../../middleware/auth';
import CreditNote, { ICreditNoteLineItem, CreditNoteReason, CreditNoteFiscalModificationCode, CreditNoteRefundMethod } from '../../models/CreditNote';
import Invoice from '../../models/Invoice';
import Tenant from '../../models/Tenant';
import ElectronicInvoice from '../../models/ElectronicInvoice';
import Product from '../../models/Product';
import ProductStock from '../../models/ProductStock';
import Warehouse from '../../models/Warehouse';
import InventoryTransaction from '../../models/InventoryTransaction';
import { nextSequence } from '../../models/Counter';
import { deductStockForSale, restockReturn } from '../../services/accounting/inventory.service';
import { citrusEcfService, CitrusError, CitrusInvoiceResponse } from '../../services/citrusEcf';
import { mapToAccountingCreditNote, EcfMapperError, type OriginalInvoiceRef } from '../../utils/ecfMapper';
import type { IEcfLineItem } from '../../models/ElectronicInvoice';
import { postJournalEntry, getSystemAccountIds, cashAccountCodeForMethod, reversePostedEntries } from '../../services/accounting/ledger.service';
import { SYSTEM_ACCOUNT_CODES } from '../../constants/accounting';

/**
 * Credit note controller (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 8.1).
 * `issue` is the one action that reaches outside this model — restocking inventory
 * for 'return' lines and calling into the existing e-CF pipeline for an E34 — the
 * same shape `sendInvoice` (Phase 5.1) already established. `apply`/`refund`/`void`
 * are plain lifecycle actions on the document itself (+ a subsidiary-ledger push
 * onto the target Invoice for `apply`).
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const VALID_REASONS: CreditNoteReason[] = [
  'billing-error', 'price-adjustment', 'goods-returned', 'service-not-rendered', 'duplicate-charge', 'goodwill', 'other',
];
const VALID_FISCAL_CODES: CreditNoteFiscalModificationCode[] = ['1', '2', '3', '4'];
const REASON_LABELS: Record<CreditNoteReason, string> = {
  'billing-error': 'Billing error',
  'price-adjustment': 'Price adjustment',
  'goods-returned': 'Goods returned',
  'service-not-rendered': 'Service not rendered',
  'duplicate-charge': 'Duplicate charge',
  goodwill: 'Goodwill adjustment',
  other: 'Other',
};

interface RawCreditNoteLineItemInput {
  lineType?: 'return' | 'allowance';
  description?: string;
  product?: string;
  quantity?: number;
  unitPrice?: number;
  taxRate?: number;
  lineTotal?: number; // 'allowance' lines only — the entered credit amount, tax-exclusive
}

async function resolveDefaultTaxRate(tenantId: unknown): Promise<number> {
  const tenant = await Tenant.findById(tenantId).select('ecfConfig.defaultItbisRate').lean();
  return (tenant as any)?.ecfConfig?.defaultItbisRate ?? 18;
}

// Builds server-validated line items. 'return' lines require a traceable originating sale —
// unitCost is read from that invoice/product's own 'sale-deduction' InventoryTransaction, never
// from Product.cost (a moving weighted average that has likely changed since); a return line
// with no traceable sale is rejected rather than falling back to "current cost", which would
// silently misstate COGS (TIO_CREDIT_NOTES_PLAN.md §1).
async function buildLineItems(invoiceId: string, rawLines: RawCreditNoteLineItemInput[], defaultTaxRate: number): Promise<ICreditNoteLineItem[]> {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw { status: 400, message: 'At least one line item is required' };
  }
  const lines: ICreditNoteLineItem[] = [];
  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    if (!line.description?.trim()) throw { status: 400, message: `Line ${idx + 1}: description is required` };
    const taxRate = line.taxRate ?? defaultTaxRate;
    if (taxRate < 0 || taxRate > 100) throw { status: 400, message: `Line ${idx + 1}: taxRate must be between 0 and 100` };

    if (line.lineType === 'return') {
      if (!line.product || !mongoose.Types.ObjectId.isValid(line.product)) {
        throw { status: 400, message: `Line ${idx + 1}: product is required for a "return" line` };
      }
      if (!line.quantity || line.quantity <= 0) throw { status: 400, message: `Line ${idx + 1}: quantity must be greater than 0` };
      if (line.unitPrice === undefined || line.unitPrice === null || line.unitPrice < 0) {
        throw { status: 400, message: `Line ${idx + 1}: unitPrice is required and must be >= 0` };
      }

      const saleTxn = await InventoryTransaction.findOne({ invoice: invoiceId, product: line.product, type: 'sale-deduction' }).sort({ createdAt: -1 });
      if (!saleTxn) {
        throw {
          status: 400,
          message: `Line ${idx + 1}: no matching sale record was found for this product on the originating invoice — a "return" line requires a traceable original sale`,
        };
      }

      lines.push({
        lineType: 'return',
        description: line.description.trim(),
        taxRate,
        product: new mongoose.Types.ObjectId(line.product),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        unitCost: saleTxn.unitCost,
        lineTotal: 0,
        taxAmount: 0,
        total: 0,
      } as ICreditNoteLineItem);
    } else if (line.lineType === 'allowance') {
      if (line.lineTotal === undefined || line.lineTotal === null || line.lineTotal < 0) {
        throw { status: 400, message: `Line ${idx + 1}: lineTotal (amount) is required and must be >= 0 for an "allowance" line` };
      }
      lines.push({
        lineType: 'allowance',
        description: line.description.trim(),
        taxRate,
        product: line.product && mongoose.Types.ObjectId.isValid(line.product) ? new mongoose.Types.ObjectId(line.product) : undefined,
        lineTotal: line.lineTotal,
        taxAmount: 0,
        total: 0,
      } as ICreditNoteLineItem);
    } else {
      throw { status: 400, message: `Line ${idx + 1}: lineType must be "return" or "allowance"` };
    }
  }
  return lines;
}

export const listCreditNotes = async (req: AuthRequest, res: Response) => {
  try {
    const { status, invoice, customer, page = '1', limit = '50' } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (invoice && mongoose.Types.ObjectId.isValid(invoice)) filter.invoice = invoice;
    if (customer && mongoose.Types.ObjectId.isValid(customer)) filter.customer = customer;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [creditNotes, total] = await Promise.all([
      CreditNote.find(filter)
        .populate('customer', 'name rnc razonSocial email')
        .populate('invoice', 'invoiceNumber total')
        .populate('electronicInvoiceId', 'eNCF estadoECF urlCodigoQr')
        .sort({ issueDate: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      CreditNote.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: creditNotes,
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    console.error('List credit notes error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching credit notes' });
  }
};

export const getCreditNote = async (req: AuthRequest, res: Response) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id)
      .populate('customer', 'name rnc razonSocial email phone')
      .populate('invoice', 'invoiceNumber total status')
      .populate('warehouse', 'name')
      .populate('lineItems.product', 'name sku unitOfMeasure')
      .populate('electronicInvoiceId')
      .populate('applications.invoice', 'invoiceNumber balanceDue')
      .lean();
    if (!creditNote) return res.status(404).json({ success: false, message: 'Credit note not found' });
    res.status(200).json({ success: true, data: creditNote });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid credit note ID' });
    console.error('Get credit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching credit note' });
  }
};

export const createCreditNote = async (req: AuthRequest, res: Response) => {
  try {
    const {
      invoice: invoiceId, warehouse, reason, fiscalModificationCode, notes, lineItems: rawLines,
    } = req.body as {
      invoice?: string;
      warehouse?: string;
      reason?: CreditNoteReason;
      fiscalModificationCode?: CreditNoteFiscalModificationCode;
      notes?: string;
      lineItems?: RawCreditNoteLineItemInput[];
    };

    if (!invoiceId || !mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ success: false, message: 'invoice is required and must be a valid Invoice ID' });
    }
    const invoiceDoc = await Invoice.findById(invoiceId);
    if (!invoiceDoc) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoiceDoc.status === 'draft' || invoiceDoc.status === 'void') {
      return res.status(400).json({ success: false, message: `Cannot create a credit note against an invoice with status "${invoiceDoc.status}"` });
    }

    if (!reason || !VALID_REASONS.includes(reason)) {
      return res.status(400).json({ success: false, message: `reason must be one of: ${VALID_REASONS.join(', ')}` });
    }
    if (!fiscalModificationCode || !VALID_FISCAL_CODES.includes(fiscalModificationCode)) {
      return res.status(400).json({ success: false, message: `fiscalModificationCode must be one of: ${VALID_FISCAL_CODES.join(', ')}` });
    }

    let warehouseId: string | undefined;
    if (warehouse) {
      if (!mongoose.Types.ObjectId.isValid(warehouse)) return res.status(400).json({ success: false, message: 'Invalid warehouse ID' });
      const wh = await Warehouse.findById(warehouse).select('_id isActive').lean();
      if (!wh || !(wh as any).isActive) return res.status(400).json({ success: false, message: 'Invalid or inactive warehouse' });
      warehouseId = warehouse;
    }

    const defaultTaxRate = await resolveDefaultTaxRate(req.tenantId);
    const lineItems = await buildLineItems(invoiceId, rawLines || [], defaultTaxRate);

    if (lineItems.some((l) => l.lineType === 'return') && !warehouseId) {
      return res.status(400).json({ success: false, message: 'warehouse is required when the credit note has at least one "return" line item' });
    }

    const creditNoteNumber = `CN-${String(await nextSequence('creditNoteNumber')).padStart(6, '0')}`;

    const creditNote = await CreditNote.create({
      creditNoteNumber,
      invoice: invoiceId,
      customer: invoiceDoc.isIndividual ? undefined : invoiceDoc.customer,
      isIndividual: invoiceDoc.isIndividual,
      individualCustomer: invoiceDoc.isIndividual ? invoiceDoc.individualCustomer : undefined,
      warehouse: warehouseId,
      reason,
      fiscalModificationCode,
      notes,
      lineItems,
      status: 'draft',
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, message: 'Credit note created successfully', data: creditNote });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Create credit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating credit note' });
  }
};

// Edits are only allowed on draft credit notes — same lifecycle discipline as Invoice/Bill.
// The originating `invoice` itself is immutable once created; only warehouse/reason/
// fiscalModificationCode/notes/lineItems can change.
export const updateCreditNote = async (req: AuthRequest, res: Response) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id);
    if (!creditNote) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (creditNote.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot edit a credit note with status "${creditNote.status}" — only draft credit notes can be edited` });
    }

    const {
      warehouse, reason, fiscalModificationCode, notes, lineItems: rawLines,
    } = req.body as {
      warehouse?: string;
      reason?: CreditNoteReason;
      fiscalModificationCode?: CreditNoteFiscalModificationCode;
      notes?: string;
      lineItems?: RawCreditNoteLineItemInput[];
    };

    if (reason !== undefined) {
      if (!VALID_REASONS.includes(reason)) return res.status(400).json({ success: false, message: `reason must be one of: ${VALID_REASONS.join(', ')}` });
      creditNote.reason = reason;
    }
    if (fiscalModificationCode !== undefined) {
      if (!VALID_FISCAL_CODES.includes(fiscalModificationCode)) {
        return res.status(400).json({ success: false, message: `fiscalModificationCode must be one of: ${VALID_FISCAL_CODES.join(', ')}` });
      }
      creditNote.fiscalModificationCode = fiscalModificationCode;
    }
    if (notes !== undefined) creditNote.notes = notes;

    if (warehouse !== undefined) {
      if (warehouse) {
        if (!mongoose.Types.ObjectId.isValid(warehouse)) return res.status(400).json({ success: false, message: 'Invalid warehouse ID' });
        const wh = await Warehouse.findById(warehouse).select('_id isActive').lean();
        if (!wh || !(wh as any).isActive) return res.status(400).json({ success: false, message: 'Invalid or inactive warehouse' });
        creditNote.warehouse = new mongoose.Types.ObjectId(warehouse);
      } else {
        creditNote.warehouse = undefined;
      }
    }

    if (rawLines) {
      const defaultTaxRate = await resolveDefaultTaxRate(req.tenantId);
      const lineItems = await buildLineItems(String(creditNote.invoice), rawLines, defaultTaxRate);
      if (lineItems.some((l) => l.lineType === 'return') && !creditNote.warehouse) {
        return res.status(400).json({ success: false, message: 'warehouse is required when the credit note has at least one "return" line item' });
      }
      creditNote.lineItems = lineItems as any;
    }

    await creditNote.save();
    res.status(200).json({ success: true, message: 'Credit note updated successfully', data: creditNote });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid credit note ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Update credit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating credit note' });
  }
};

// Issues a draft credit note: re-validates the DGII cumulative value-ceiling rule, calls the
// existing e-CF pipeline for a real E34 referencing the originating invoice's own eNCF, restocks
// any 'return' lines at their snapshotted unit cost, and posts the contra-revenue (+COGS-
// reversal) GL entry — the same "e-CF first, stock/GL best-effort after" ordering sendInvoice
// (Phase 5.1) already established, since by the time stock/GL run the e-CF is already a real,
// irreversible fiscal document.
export const issueCreditNote = async (req: AuthRequest, res: Response) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id);
    if (!creditNote) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (creditNote.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot issue a credit note with status "${creditNote.status}" — only draft credit notes can be issued` });
    }

    const invoiceDoc = await Invoice.findById(creditNote.invoice);
    if (!invoiceDoc) return res.status(404).json({ success: false, message: 'Originating invoice not found' });
    if (!invoiceDoc.electronicInvoiceId) {
      return res.status(400).json({ success: false, message: 'The originating invoice has not been sent (no e-CF issued) — cannot issue a credit note against it' });
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

    const returnLines = creditNote.lineItems.filter((l) => l.lineType === 'return');
    if (returnLines.length > 0 && !creditNote.warehouse) {
      return res.status(400).json({ success: false, message: 'This credit note has "return" lines but no warehouse is set' });
    }

    // DGII cumulative value-ceiling rule: this credit note's total + every other non-void,
    // already-issued credit note against the same invoice must not exceed the invoice's total.
    const others = await CreditNote.find({
      invoice: creditNote.invoice,
      status: { $in: ['issued', 'partial', 'closed'] },
      _id: { $ne: creditNote._id },
    }).select('total').lean();
    const alreadyIssuedTotal = round2(others.reduce((sum, cn: any) => sum + cn.total, 0));
    if (round2(alreadyIssuedTotal + creditNote.total) > invoiceDoc.total + 0.01) {
      return res.status(400).json({
        success: false,
        message: `This credit note's total (${creditNote.total}) plus previously issued credit notes against this invoice (${alreadyIssuedTotal}) would exceed the original invoice's total (${invoiceDoc.total})`,
      });
    }

    const originalInvoiceRef: OriginalInvoiceRef = {
      eNCF: originalEcf.eNCF,
      tipo: originalEcf.tipo,
      buyerRnc: originalEcf.buyerRnc,
      buyerName: originalEcf.buyerName,
      buyerEmail: originalEcf.buyerEmail,
      issuedAt: originalEcf.issuedAt,
    };
    const razonModificacion = creditNote.notes?.trim() || REASON_LABELS[creditNote.reason];

    let payload;
    try {
      payload = mapToAccountingCreditNote(
        originalInvoiceRef,
        creditNote.fiscalModificationCode as any,
        razonModificacion,
        creditNote.lineItems.map((l) => ({ description: l.description, quantity: l.quantity || 1, taxRate: l.taxRate, lineTotal: l.lineTotal })),
        tenant,
      );
    } catch (err: any) {
      if (err instanceof EcfMapperError) return res.status(400).json({ success: false, message: err.message });
      throw err;
    }

    let citrusResponse: CitrusInvoiceResponse;
    let isContingency = false;
    try {
      citrusResponse = await citrusEcfService.generateNotaCredito(tenant, payload);
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

    const lineItemsSnapshot: IEcfLineItem[] = creditNote.lineItems.map((l) => ({
      description: l.description,
      qty: l.quantity || 1,
      netPrice: l.lineTotal,
      itbisRate: l.taxRate,
      itbisAmount: l.taxAmount,
      grossAmount: l.total,
    }));

    const electronicInvoice = await ElectronicInvoice.create({
      tipo: 'E34',
      eNCF: citrusResponse.eNCF,
      transaccionId: citrusResponse.TransaccionId,
      ...(citrusResponse.TrackId ? { trackId: citrusResponse.TrackId } : {}),
      numeroFacturaInterna: creditNote.creditNoteNumber,
      estadoECF: estadoECF as any,
      estatus: citrusResponse.Estatus ?? '',
      mensaje: citrusResponse.Mensaje || undefined,
      totalFactura: creditNote.total,
      totalImpuestos: creditNote.taxAmount,
      currency: 'DOP',
      buyerRnc: originalEcf.buyerRnc,
      buyerName: originalEcf.buyerName,
      buyerEmail: originalEcf.buyerEmail,
      lineItems: lineItemsSnapshot,
      originalENCF: originalEcf.eNCF,
      codigoModificacion: creditNote.fiscalModificationCode,
      urlCodigoQr: citrusResponse.UrlCodigoQr ?? undefined,
      codigoSeguridad: citrusResponse.CodigoSeguridad ?? undefined,
      fechaFirmaDigital: citrusResponse.FechaFirmaDigital ? new Date(citrusResponse.FechaFirmaDigital) : undefined,
      fechaVencimientoSecuencia: citrusResponse.FechaVencimientoSecuencia ? new Date(citrusResponse.FechaVencimientoSecuencia) : undefined,
      generatedBy: req.user._id,
      generationSource: 'credit_note',
      issuedAt: new Date(),
      retryCount: 0,
    });

    // Stock is only restocked once the e-CF has actually been issued — by this point the fiscal
    // document already exists and cannot be silently un-issued, so a restock failure here (rare)
    // is logged, not fatal. Each successful restock's own snapshotted unitCost (fixed at
    // creation time from the original sale, never recalculated) feeds the COGS-reversal below.
    let cogsTotal = 0;
    for (const line of returnLines) {
      try {
        await restockReturn({
          productId: String(line.product),
          warehouseId: String(creditNote.warehouse),
          quantity: line.quantity!,
          unitCost: line.unitCost || 0,
          invoice: creditNote.invoice as any,
          creditNote: creditNote._id as any,
          notes: `Credit note ${creditNote.creditNoteNumber}`,
          recordedBy: req.user._id,
        });
        cogsTotal += (line.unitCost || 0) * (line.quantity || 0);
      } catch (stockErr: any) {
        console.error(`[CreditNote.issue] Restock failed for credit note ${creditNote.creditNoteNumber}, product ${line.product}:`, stockErr?.message || stockErr);
      }
    }
    cogsTotal = round2(cogsTotal);

    creditNote.status = 'issued';
    creditNote.electronicInvoiceId = electronicInvoice._id as any;
    await creditNote.save();

    // GL posting: Dr Sales Returns & Allowances (+Sales Tax Payable) / Cr Accounts Receivable,
    // plus a COGS-reversal transfer out of Inventory if any 'return' line actually restocked
    // above — the exact mirror of sendInvoice's posting. Posted best-effort, same
    // logged-not-blocking rationale as every other GL hook in this codebase.
    try {
      const accountIds = await getSystemAccountIds([
        SYSTEM_ACCOUNT_CODES.SALES_RETURNS_AND_ALLOWANCES,
        SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
        ...(creditNote.taxAmount > 0 ? [SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE] : []),
        ...(cogsTotal > 0 ? [SYSTEM_ACCOUNT_CODES.INVENTORY, SYSTEM_ACCOUNT_CODES.COST_OF_GOODS_SOLD] : []),
      ]);
      const lines = [
        { account: accountIds[SYSTEM_ACCOUNT_CODES.SALES_RETURNS_AND_ALLOWANCES], debit: creditNote.subtotal },
        ...(creditNote.taxAmount > 0
          ? [{ account: accountIds[SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE], debit: creditNote.taxAmount }]
          : []),
        { account: accountIds[SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE], credit: creditNote.total },
        ...(cogsTotal > 0
          ? [
              { account: accountIds[SYSTEM_ACCOUNT_CODES.INVENTORY], debit: cogsTotal },
              { account: accountIds[SYSTEM_ACCOUNT_CODES.COST_OF_GOODS_SOLD], credit: cogsTotal },
            ]
          : []),
      ];
      await postJournalEntry(lines, 'credit_note_issue', { model: 'CreditNote', id: creditNote._id as any }, `Credit note ${creditNote.creditNoteNumber} issued`, req.user._id);
    } catch (glErr: any) {
      console.error(`[CreditNote.issue] GL posting failed for credit note ${creditNote.creditNoteNumber}:`, glErr?.message || glErr);
    }

    res.status(200).json({ success: true, message: 'Credit note issued successfully', data: { creditNote, electronicInvoice } });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid credit note ID' });
    console.error('Issue credit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while issuing credit note' });
  }
};

// Allocates unapplied credit against a specific invoice's balance — a subsidiary-ledger
// allocation, never a second JournalEntry (the AR control account was already credited in full
// at issue() time; see model file header). Pushes a `method:'credit-note'` entry onto the target
// Invoice's own `payments[]` and reuses Invoice's own pre-validate recompute, exactly the way a
// cash payment would, so there is no duplicated balance logic.
export const applyCreditNote = async (req: AuthRequest, res: Response) => {
  try {
    const { invoice: targetInvoiceId, amount, note } = req.body as { invoice?: string; amount?: number; note?: string };
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'amount must be greater than 0' });

    const creditNote = await CreditNote.findById(req.params.id);
    if (!creditNote) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (creditNote.status !== 'issued' && creditNote.status !== 'partial') {
      return res.status(400).json({ success: false, message: `Cannot apply a credit note with status "${creditNote.status}"` });
    }
    if (amount > creditNote.remainingCredit + 0.01) {
      return res.status(400).json({ success: false, message: `Amount (${amount}) exceeds the remaining credit (${creditNote.remainingCredit})` });
    }

    const resolvedInvoiceId = targetInvoiceId && mongoose.Types.ObjectId.isValid(targetInvoiceId) ? targetInvoiceId : String(creditNote.invoice);
    const targetInvoice = await Invoice.findById(resolvedInvoiceId);
    if (!targetInvoice) return res.status(404).json({ success: false, message: 'Target invoice not found' });
    if (targetInvoice.status === 'draft' || targetInvoice.status === 'void') {
      return res.status(400).json({ success: false, message: `Cannot apply credit to an invoice with status "${targetInvoice.status}"` });
    }
    if (amount > targetInvoice.balanceDue + 0.01) {
      return res.status(400).json({ success: false, message: `Amount (${amount}) exceeds the target invoice's balance due (${targetInvoice.balanceDue})` });
    }

    targetInvoice.payments.push({
      amount,
      method: 'credit-note',
      date: new Date(),
      reference: creditNote.creditNoteNumber,
      recordedBy: req.user._id,
    } as any);
    await targetInvoice.save();

    creditNote.applications.push({
      type: 'invoice',
      amount,
      invoice: targetInvoice._id as any,
      note,
      createdAt: new Date(),
      createdBy: req.user._id,
    } as any);
    await creditNote.save();

    res.status(200).json({ success: true, message: 'Credit note applied to invoice successfully', data: { creditNote, invoice: targetInvoice } });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Apply credit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while applying credit note' });
  }
};

// Refunds unapplied credit as cash — unlike apply(), this *does* post a real JournalEntry
// (Dr Accounts Receivable, Cr Bank/Cash), the exact mirror of recordInvoicePayment's Dr Bank,
// Cr Accounts Receivable, since actual cash leaves the business at this point.
export const refundCreditNote = async (req: AuthRequest, res: Response) => {
  try {
    const { amount, method, reference, note } = req.body as {
      amount?: number; method?: CreditNoteRefundMethod; reference?: string; note?: string;
    };
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'amount must be greater than 0' });
    const validMethods: CreditNoteRefundMethod[] = ['cash', 'card', 'transfer', 'check', 'other'];
    if (!method || !validMethods.includes(method)) {
      return res.status(400).json({ success: false, message: `method must be one of: ${validMethods.join(', ')}` });
    }

    const creditNote = await CreditNote.findById(req.params.id);
    if (!creditNote) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (creditNote.status !== 'issued' && creditNote.status !== 'partial') {
      return res.status(400).json({ success: false, message: `Cannot refund a credit note with status "${creditNote.status}"` });
    }
    if (amount > creditNote.remainingCredit + 0.01) {
      return res.status(400).json({ success: false, message: `Amount (${amount}) exceeds the remaining credit (${creditNote.remainingCredit})` });
    }

    creditNote.applications.push({
      type: 'refund',
      amount,
      method,
      reference,
      note,
      createdAt: new Date(),
      createdBy: req.user._id,
    } as any);
    await creditNote.save();

    try {
      const accountIds = await getSystemAccountIds([SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, cashAccountCodeForMethod(method)]);
      await postJournalEntry(
        [
          { account: accountIds[SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE], debit: amount },
          { account: accountIds[cashAccountCodeForMethod(method)], credit: amount },
        ],
        'credit_note_refund',
        { model: 'CreditNote', id: creditNote._id as any },
        `Refund issued on credit note ${creditNote.creditNoteNumber}`,
        req.user._id
      );
    } catch (glErr: any) {
      console.error(`[CreditNote.refund] GL posting failed for credit note ${creditNote.creditNoteNumber}:`, glErr?.message || glErr);
    }

    res.status(200).json({ success: true, message: 'Refund recorded successfully', data: creditNote });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid credit note ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Refund credit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while refunding credit note' });
  }
};

// Void guardrail: only unconsumed credit (amountApplied === 0) can be voided. A draft credit
// note never had any GL/stock impact and simply flips to void. An issued/partial/closed one
// (amountApplied must still be 0 to reach here) reverses whatever issue() posted: any 'return'
// line's stock via a guarded, all-or-nothing 'return-reversal' (mirrors Bill.void exactly), then
// the GL entry via the shared reversePostedEntries.
export const voidCreditNote = async (req: AuthRequest, res: Response) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id);
    if (!creditNote) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (creditNote.status === 'void') {
      return res.status(400).json({ success: false, message: 'Credit note is already void' });
    }
    if (creditNote.amountApplied > 0) {
      return res.status(400).json({ success: false, message: 'Cannot void a credit note that has been applied or refunded' });
    }

    const hadIssueImpact = creditNote.status !== 'draft';

    if (hadIssueImpact) {
      const returnLines = creditNote.lineItems.filter((l) => l.lineType === 'return');
      if (returnLines.length > 0) {
        const products = await Product.find({ _id: { $in: returnLines.map((l) => l.product) } });
        const productMap = new Map(products.map((p) => [String(p._id), p]));
        const stocks = await ProductStock.find({ warehouse: creditNote.warehouse, product: { $in: returnLines.map((l) => l.product) } });
        const stockMap = new Map(stocks.map((s) => [String(s.product), s]));

        // Pre-check every line before mutating any — keeps the reversal all-or-nothing.
        for (const line of returnLines) {
          const product = productMap.get(String(line.product));
          if (!product) continue; // product archived/removed since — nothing to reverse
          const qty = line.quantity!;
          const stockOnHand = stockMap.get(String(line.product))?.onHandQty || 0;
          if (product.onHandQty < qty || stockOnHand < qty) {
            return res.status(400).json({
              success: false,
              message: `Cannot void: stock restocked by credit note for "${product.name}" has already been used elsewhere`,
            });
          }
        }

        for (const line of returnLines) {
          const product = productMap.get(String(line.product));
          if (!product) continue;
          await deductStockForSale({
            productId: String(line.product),
            warehouseId: String(creditNote.warehouse),
            quantity: line.quantity!,
            type: 'return-reversal',
            invoice: creditNote.invoice as any,
            creditNote: creditNote._id as any,
            notes: `Stock reversed — credit note ${creditNote.creditNoteNumber} voided`,
            recordedBy: req.user._id,
          });
        }
      }
    }

    creditNote.status = 'void';
    creditNote.voidedAt = new Date();
    creditNote.voidReason = req.body?.reason;
    await creditNote.save();

    if (hadIssueImpact) {
      try {
        await reversePostedEntries(
          'CreditNote',
          creditNote._id as any,
          'credit_note_issue',
          'credit_note_void',
          `Credit note ${creditNote.creditNoteNumber} voided`,
          req.user._id
        );
      } catch (glErr: any) {
        console.error(`[CreditNote.void] GL reversal failed for credit note ${creditNote.creditNoteNumber}:`, glErr?.message || glErr);
      }
    }

    res.status(200).json({ success: true, message: 'Credit note voided successfully', data: creditNote });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid credit note ID' });
    console.error('Void credit note error:', error);
    res.status(500).json({ success: false, message: 'Server error while voiding credit note' });
  }
};
