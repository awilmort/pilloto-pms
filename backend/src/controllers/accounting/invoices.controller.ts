import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../../middleware/auth';
import Invoice, { IInvoiceLineItem, InvoicePaymentMethod } from '../../models/Invoice';
import Customer from '../../models/Customer';
import Tenant from '../../models/Tenant';
import ElectronicInvoice from '../../models/ElectronicInvoice';
import { nextSequence } from '../../models/Counter';
import { resolveWarehouseId, getAvailableQty, deductStockForSale } from '../../services/accounting/inventory.service';
import { citrusEcfService, CitrusError, CitrusInvoiceResponse } from '../../services/citrusEcf';
import { mapToAccountingInvoice, EcfMapperError, type EcfBuyerInfo } from '../../utils/ecfMapper';
import type { IEcfLineItem } from '../../models/ElectronicInvoice';
import { postJournalEntry, getSystemAccountIds, cashAccountCodeForMethod, reversePostedEntries } from '../../services/accounting/ledger.service';
import { SYSTEM_ACCOUNT_CODES } from '../../constants/accounting';

/**
 * Invoice controller (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5.1).
 * `send` is the one action that reaches outside this model — deducting inventory
 * stock and calling into the existing e-CF pipeline — everything else is plain
 * CRUD/lifecycle on the Invoice document itself.
 */

interface RawLineItemInput {
  description?: string;
  product?: string;
  quantity?: number;
  unitPrice?: number;
  discountPercent?: number;
  taxRate?: number;
  warehouseId?: string; // only used at send() time to resolve which warehouse to deduct from
}

async function resolveDefaultTaxRate(tenantId: unknown): Promise<number> {
  const tenant = await Tenant.findById(tenantId).select('ecfConfig.defaultItbisRate').lean();
  return (tenant as any)?.ecfConfig?.defaultItbisRate ?? 18;
}

async function buildLineItems(rawLines: RawLineItemInput[], defaultTaxRate: number): Promise<IInvoiceLineItem[]> {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw { status: 400, message: 'At least one line item is required' };
  }
  return rawLines.map((line, idx) => {
    if (!line.description?.trim()) throw { status: 400, message: `Line ${idx + 1}: description is required` };
    if (!line.quantity || line.quantity <= 0) throw { status: 400, message: `Line ${idx + 1}: quantity must be greater than 0` };
    if (line.unitPrice === undefined || line.unitPrice === null || line.unitPrice < 0) {
      throw { status: 400, message: `Line ${idx + 1}: unitPrice is required and must be >= 0` };
    }
    const discountPercent = line.discountPercent ?? 0;
    if (discountPercent < 0 || discountPercent > 100) {
      throw { status: 400, message: `Line ${idx + 1}: discountPercent must be between 0 and 100` };
    }
    const taxRate = line.taxRate ?? defaultTaxRate;
    if (taxRate < 0 || taxRate > 100) {
      throw { status: 400, message: `Line ${idx + 1}: taxRate must be between 0 and 100` };
    }
    return {
      description: line.description.trim(),
      product: line.product && mongoose.Types.ObjectId.isValid(line.product) ? new mongoose.Types.ObjectId(line.product) : undefined,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent,
      taxRate,
      // recomputed by the model's pre-validate hook — placeholder values only
      lineTotal: 0,
      taxAmount: 0,
      total: 0,
    } as IInvoiceLineItem;
  });
}

export const listInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const { status, customer, page = '1', limit = '50' } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (customer && mongoose.Types.ObjectId.isValid(customer)) filter.customer = customer;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .populate('customer', 'name rnc razonSocial email')
        .populate('electronicInvoiceId', 'eNCF estadoECF urlCodigoQr')
        .sort({ issueDate: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean({ virtuals: true }),
      Invoice.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: invoices,
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    console.error('List invoices error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching invoices' });
  }
};

export const getInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('customer', 'name rnc razonSocial email phone')
      .populate('lineItems.product', 'name sku unitOfMeasure')
      .populate('electronicInvoiceId')
      .lean({ virtuals: true });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.status(200).json({ success: true, data: invoice });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    console.error('Get invoice error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching invoice' });
  }
};

export const createInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const {
      customer, isIndividual, individualCustomer, dueDate, notes, lineItems: rawLines,
    } = req.body as {
      customer?: string;
      isIndividual?: boolean;
      individualCustomer?: { name?: string; email?: string; phone?: string };
      dueDate?: string;
      notes?: string;
      lineItems?: RawLineItemInput[];
    };

    if (isIndividual) {
      if (!individualCustomer?.name?.trim()) {
        return res.status(400).json({ success: false, message: 'individualCustomer.name is required when isIndividual is true' });
      }
    } else {
      if (!customer || !mongoose.Types.ObjectId.isValid(customer)) {
        return res.status(400).json({ success: false, message: 'customer is required and must be a valid Customer ID unless isIndividual is true' });
      }
      const existingCustomer = await Customer.findById(customer).select('_id').lean();
      if (!existingCustomer) return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const defaultTaxRate = await resolveDefaultTaxRate(req.tenantId);
    const lineItems = await buildLineItems(rawLines || [], defaultTaxRate);

    const invoiceNumber = `INV-${String(await nextSequence('invoiceNumber')).padStart(6, '0')}`;

    const invoice = await Invoice.create({
      invoiceNumber,
      customer: isIndividual ? undefined : customer,
      isIndividual: !!isIndividual,
      individualCustomer: isIndividual
        ? { name: individualCustomer!.name!.trim(), email: individualCustomer?.email?.trim(), phone: individualCustomer?.phone?.trim() }
        : undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      notes,
      lineItems,
      status: 'draft',
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, message: 'Invoice created successfully', data: invoice });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Create invoice error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating invoice' });
  }
};

// Edits are only allowed on draft invoices — once sent, a real e-CF/stock event has
// happened and the line items become historical record (mirrors Bill/CreditNote lifecycle).
export const updateInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot edit an invoice with status "${invoice.status}" — only draft invoices can be edited` });
    }

    const {
      customer, isIndividual, individualCustomer, dueDate, notes, lineItems: rawLines,
    } = req.body as {
      customer?: string;
      isIndividual?: boolean;
      individualCustomer?: { name?: string; email?: string; phone?: string };
      dueDate?: string;
      notes?: string;
      lineItems?: RawLineItemInput[];
    };

    if (isIndividual !== undefined) invoice.isIndividual = isIndividual;
    if (invoice.isIndividual) {
      if (individualCustomer) {
        if (!individualCustomer.name?.trim()) {
          return res.status(400).json({ success: false, message: 'individualCustomer.name is required' });
        }
        invoice.individualCustomer = {
          name: individualCustomer.name.trim(),
          email: individualCustomer.email?.trim(),
          phone: individualCustomer.phone?.trim(),
        };
      }
    } else if (customer !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(customer)) {
        return res.status(400).json({ success: false, message: 'customer must be a valid Customer ID' });
      }
      const existingCustomer = await Customer.findById(customer).select('_id').lean();
      if (!existingCustomer) return res.status(404).json({ success: false, message: 'Customer not found' });
      invoice.customer = new mongoose.Types.ObjectId(customer);
    }

    if (dueDate !== undefined) invoice.dueDate = dueDate ? new Date(dueDate) : undefined;
    if (notes !== undefined) invoice.notes = notes;

    if (rawLines) {
      const defaultTaxRate = await resolveDefaultTaxRate(req.tenantId);
      invoice.lineItems = await buildLineItems(rawLines, defaultTaxRate) as any;
    }

    await invoice.save();
    res.status(200).json({ success: true, message: 'Invoice updated successfully', data: invoice });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Update invoice error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating invoice' });
  }
};

// Resolves the Customer/individual customer fields on an Invoice into the shape
// ecfMapper's buyer-facing functions expect.
function resolveBuyer(invoice: { isIndividual: boolean; individualCustomer?: any; customer?: any }): EcfBuyerInfo {
  if (invoice.isIndividual) {
    return {
      name: invoice.individualCustomer?.name,
      email: invoice.individualCustomer?.email,
    };
  }
  const customer = invoice.customer;
  return {
    rnc: customer?.rnc || undefined,
    name: customer?.name,
    email: customer?.email,
    razonSocial: customer?.razonSocial || customer?.name,
  };
}

// Sends a draft invoice: deducts stock for any inventory-backed lines, calls the existing
// e-CF pipeline (reusing citrusEcfService the same way the Folio-driven /api/ecf/invoices
// route does), and links the resulting ElectronicInvoice back onto this Invoice.
export const sendInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'name rnc razonSocial email');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot send an invoice with status "${invoice.status}" — only draft invoices can be sent` });
    }

    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
    if (!tenant.ecfConfig?.isActive) {
      return res.status(400).json({ success: false, message: 'e-CF invoicing is not active for this tenant' });
    }
    if (!tenant.ecfConfig?.citrusToken) {
      return res.status(400).json({ success: false, message: 'Citrus API token is not configured' });
    }

    // ── Pre-check stock availability for every inventory-backed line before touching
    // anything externally irreversible (issuing a real e-CF). Resolves a warehouse per
    // line, defaulting to the tenant's default warehouse when none is specified. ──
    const rawLines = req.body?.lineItemWarehouses as Record<string, string> | undefined; // optional { lineItemId: warehouseId } override
    const stockPlan: { lineId: string; productId: string; warehouseId: string; quantity: number }[] = [];
    for (const line of invoice.lineItems) {
      if (!line.product) continue;
      const lineId = String(line._id);
      const warehouseId = await resolveWarehouseId(rawLines?.[lineId]);
      const available = await getAvailableQty(line.product, warehouseId);
      if (available < line.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for line "${line.description}" (available: ${available}, requested: ${line.quantity})`,
        });
      }
      stockPlan.push({ lineId, productId: String(line.product), warehouseId, quantity: line.quantity });
    }

    const buyer = resolveBuyer(invoice as any);
    const tipo: 'E31' | 'E32' = buyer.rnc ? 'E31' : 'E32';

    let payload;
    try {
      payload = mapToAccountingInvoice(
        tipo,
        invoice.lineItems.map(l => ({ description: l.description, quantity: l.quantity, taxRate: l.taxRate, lineTotal: l.lineTotal })),
        buyer,
        tenant,
        invoice.invoiceNumber,
      );
    } catch (err: any) {
      if (err instanceof EcfMapperError) return res.status(400).json({ success: false, message: err.message });
      throw err;
    }

    let citrusResponse: CitrusInvoiceResponse;
    let isContingency = false;
    try {
      citrusResponse = tipo === 'E31'
        ? await citrusEcfService.generateFactura(tenant, payload)
        : await citrusEcfService.generateFacturaConsumo(tenant, payload);
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

    const lineItemsSnapshot: IEcfLineItem[] = invoice.lineItems.map(l => ({
      description: l.description,
      qty: l.quantity,
      netPrice: l.lineTotal,
      itbisRate: l.taxRate,
      itbisAmount: l.taxAmount,
      grossAmount: l.total,
    }));

    const electronicInvoice = await ElectronicInvoice.create({
      invoiceId: invoice._id,
      tipo,
      eNCF: citrusResponse.eNCF,
      transaccionId: citrusResponse.TransaccionId,
      ...(citrusResponse.TrackId ? { trackId: citrusResponse.TrackId } : {}),
      numeroFacturaInterna: invoice.invoiceNumber,
      estadoECF: estadoECF as any,
      estatus: citrusResponse.Estatus ?? '',
      mensaje: citrusResponse.Mensaje || undefined,
      totalFactura: invoice.total,
      totalImpuestos: invoice.taxAmount,
      currency: 'DOP',
      buyerRnc: buyer.rnc,
      buyerName: buyer.name,
      buyerEmail: buyer.email,
      lineItems: lineItemsSnapshot,
      tipoPago: '2',
      urlCodigoQr: citrusResponse.UrlCodigoQr ?? undefined,
      codigoSeguridad: citrusResponse.CodigoSeguridad ?? undefined,
      fechaFirmaDigital: citrusResponse.FechaFirmaDigital ? new Date(citrusResponse.FechaFirmaDigital) : undefined,
      fechaVencimientoSecuencia: citrusResponse.FechaVencimientoSecuencia ? new Date(citrusResponse.FechaVencimientoSecuencia) : undefined,
      generatedBy: req.user._id,
      generationSource: 'accounting_invoice',
      issuedAt: new Date(),
      retryCount: 0,
    });

    // Stock is only deducted once the e-CF has actually been issued — an insufficient-stock
    // race here (vanishingly rare given the pre-check above) is logged, not fatal, since the
    // fiscal document already exists and cannot be silently un-issued. Each successful
    // deduction's snapshotted unitCost (the product's weighted-average cost at that instant)
    // feeds the COGS posting below.
    let cogsTotal = 0;
    for (const plan of stockPlan) {
      try {
        const { transaction } = await deductStockForSale({
          productId: plan.productId,
          warehouseId: plan.warehouseId,
          quantity: plan.quantity,
          invoice: invoice._id as any,
          notes: `Invoice ${invoice.invoiceNumber}`,
          recordedBy: req.user._id,
        });
        cogsTotal += (transaction.unitCost || 0) * plan.quantity;
      } catch (stockErr: any) {
        console.error(`[Invoice.send] Stock deduction failed for invoice ${invoice.invoiceNumber}, product ${plan.productId}:`, stockErr?.message || stockErr);
      }
    }
    cogsTotal = Math.round((cogsTotal + Number.EPSILON) * 100) / 100;

    invoice.status = 'sent';
    invoice.electronicInvoiceId = electronicInvoice._id as any;
    await invoice.save();

    // GL posting (Phase 7.1): Dr AR / Cr Sales Revenue (+ Sales Tax Payable), plus a COGS
    // transfer out of Inventory if any inventory line actually deducted stock above. Posted
    // best-effort, same as the stock-deduction loop just above it — by this point the e-CF is
    // already a real, irreversible fiscal document, so a GL failure (e.g. an unseeded Chart
    // of Accounts) is logged loudly rather than unwinding an invoice that already has a
    // DGII-issued NCF.
    try {
      const accountIds = await getSystemAccountIds([
        SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
        SYSTEM_ACCOUNT_CODES.SALES_REVENUE,
        SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE,
        ...(cogsTotal > 0 ? [SYSTEM_ACCOUNT_CODES.COST_OF_GOODS_SOLD, SYSTEM_ACCOUNT_CODES.INVENTORY] : []),
      ]);
      const lines = [
        { account: accountIds[SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE], debit: invoice.total },
        { account: accountIds[SYSTEM_ACCOUNT_CODES.SALES_REVENUE], credit: invoice.subtotal },
        ...(invoice.taxAmount > 0
          ? [{ account: accountIds[SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE], credit: invoice.taxAmount }]
          : []),
        ...(cogsTotal > 0
          ? [
              { account: accountIds[SYSTEM_ACCOUNT_CODES.COST_OF_GOODS_SOLD], debit: cogsTotal },
              { account: accountIds[SYSTEM_ACCOUNT_CODES.INVENTORY], credit: cogsTotal },
            ]
          : []),
      ];
      await postJournalEntry(lines, 'invoice_sent', { model: 'Invoice', id: invoice._id as any }, `Invoice ${invoice.invoiceNumber} sent`, req.user._id);
    } catch (glErr: any) {
      console.error(`[Invoice.send] GL posting failed for invoice ${invoice.invoiceNumber}:`, glErr?.message || glErr);
    }

    res.status(200).json({ success: true, message: 'Invoice sent successfully', data: { invoice, electronicInvoice } });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    console.error('Send invoice error:', error);
    res.status(500).json({ success: false, message: 'Server error while sending invoice' });
  }
};

export const recordPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { amount, method, date, reference } = req.body as {
      amount?: number; method?: InvoicePaymentMethod; date?: string; reference?: string;
    };
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'amount must be greater than 0' });
    const validMethods: InvoicePaymentMethod[] = ['cash', 'card', 'transfer', 'check', 'credit'];
    if (!method || !validMethods.includes(method)) {
      return res.status(400).json({ success: false, message: `method must be one of: ${validMethods.join(', ')}` });
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.status === 'draft' || invoice.status === 'void') {
      return res.status(400).json({ success: false, message: `Cannot record a payment on an invoice with status "${invoice.status}"` });
    }
    if (amount > invoice.balanceDue + 0.01) {
      return res.status(400).json({ success: false, message: `Payment amount (${amount}) exceeds the remaining balance due (${invoice.balanceDue})` });
    }

    invoice.payments.push({
      amount,
      method,
      date: date ? new Date(date) : new Date(),
      reference,
      recordedBy: req.user._id,
    } as any);

    await invoice.save();

    // GL posting (Phase 7.1): Dr Bank/Cash, Cr Accounts Receivable — best-effort, same
    // logged-not-blocking rationale as sendInvoice's posting (the payment itself is already
    // recorded on the invoice by the time this runs).
    try {
      const accountIds = await getSystemAccountIds([cashAccountCodeForMethod(method), SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE]);
      await postJournalEntry(
        [
          { account: accountIds[cashAccountCodeForMethod(method)], debit: amount },
          { account: accountIds[SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE], credit: amount },
        ],
        'invoice_payment',
        { model: 'Invoice', id: invoice._id as any },
        `Payment recorded on Invoice ${invoice.invoiceNumber}`,
        req.user._id
      );
    } catch (glErr: any) {
      console.error(`[Invoice.recordPayment] GL posting failed for invoice ${invoice.invoiceNumber}:`, glErr?.message || glErr);
    }

    res.status(200).json({ success: true, message: 'Payment recorded successfully', data: invoice });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Record invoice payment error:', error);
    res.status(500).json({ success: false, message: 'Server error while recording payment' });
  }
};

// Void guardrail: only an invoice with zero payments recorded can be voided — anything with
// money against it needs a credit note (Phase 8), not a silent void.
export const voidInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.status === 'void') {
      return res.status(400).json({ success: false, message: 'Invoice is already void' });
    }
    if (invoice.amountPaid > 0) {
      return res.status(400).json({ success: false, message: 'Cannot void an invoice with payments recorded — issue a credit note instead' });
    }

    // Only a 'sent' invoice ever reached GL (a 'draft' invoice never posted) — reverse that
    // entry before flipping status, so the reversal's own memo still sees the pre-void state.
    const hadGlEntry = invoice.status === 'sent';

    invoice.status = 'void';
    await invoice.save();

    if (hadGlEntry) {
      try {
        await reversePostedEntries(
          'Invoice',
          invoice._id as any,
          'invoice_sent',
          'invoice_void',
          `Invoice ${invoice.invoiceNumber} voided`,
          req.user._id
        );
      } catch (glErr: any) {
        console.error(`[Invoice.void] GL reversal failed for invoice ${invoice.invoiceNumber}:`, glErr?.message || glErr);
      }
    }

    res.status(200).json({ success: true, message: 'Invoice voided successfully', data: invoice });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    console.error('Void invoice error:', error);
    res.status(500).json({ success: false, message: 'Server error while voiding invoice' });
  }
};
