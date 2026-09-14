import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../../middleware/auth';
import Quote, { IQuoteLineItem } from '../../models/Quote';
import Invoice, { IInvoiceLineItem } from '../../models/Invoice';
import Customer from '../../models/Customer';
import Tenant from '../../models/Tenant';
import { nextSequence } from '../../models/Counter';

/**
 * Quote controller (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5.3,
 * PILLOTO_ACCOUNTING_ARCHITECTURE.md §9.3). A quote never touches stock, GL,
 * or e-CF — `convert` is the one action that reaches outside this model, and
 * even that only creates a new *draft* Invoice; all fiscal/stock/ledger
 * effects happen normally once that resulting Invoice is sent, same as any
 * other hand-created draft Invoice.
 */

interface RawLineItemInput {
  description?: string;
  product?: string;
  quantity?: number;
  unitPrice?: number;
  discountPercent?: number;
  taxRate?: number;
}

async function resolveDefaultTaxRate(tenantId: unknown): Promise<number> {
  const tenant = await Tenant.findById(tenantId).select('ecfConfig.defaultItbisRate').lean();
  return (tenant as any)?.ecfConfig?.defaultItbisRate ?? 18;
}

async function buildLineItems(rawLines: RawLineItemInput[], defaultTaxRate: number): Promise<IQuoteLineItem[]> {
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
    } as IQuoteLineItem;
  });
}

export const listQuotes = async (req: AuthRequest, res: Response) => {
  try {
    const { status, customer, page = '1', limit = '50' } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (customer && mongoose.Types.ObjectId.isValid(customer)) filter.customer = customer;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [quotes, total] = await Promise.all([
      Quote.find(filter)
        .populate('customer', 'name rnc razonSocial email')
        .sort({ issueDate: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Quote.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: quotes,
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    console.error('List quotes error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching quotes' });
  }
};

export const getQuote = async (req: AuthRequest, res: Response) => {
  try {
    const quote = await Quote.findById(req.params.id)
      .populate('customer', 'name rnc razonSocial email phone')
      .populate('lineItems.product', 'name sku unitOfMeasure')
      .populate('convertedInvoiceId', 'invoiceNumber status')
      .lean();
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    res.status(200).json({ success: true, data: quote });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid quote ID' });
    console.error('Get quote error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching quote' });
  }
};

export const createQuote = async (req: AuthRequest, res: Response) => {
  try {
    const {
      customer, isIndividual, individualCustomer, expiryDate, notes, lineItems: rawLines,
    } = req.body as {
      customer?: string;
      isIndividual?: boolean;
      individualCustomer?: { name?: string; email?: string; phone?: string };
      expiryDate?: string;
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

    const quoteNumber = `QUO-${String(await nextSequence('quoteNumber')).padStart(6, '0')}`;

    const quote = await Quote.create({
      quoteNumber,
      customer: isIndividual ? undefined : customer,
      isIndividual: !!isIndividual,
      individualCustomer: isIndividual
        ? { name: individualCustomer!.name!.trim(), email: individualCustomer?.email?.trim(), phone: individualCustomer?.phone?.trim() }
        : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      notes,
      lineItems,
      status: 'draft',
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, message: 'Quote created successfully', data: quote });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Create quote error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating quote' });
  }
};

// Edits are only allowed on draft quotes — once sent (or beyond), it's been shown to the
// customer and becomes a stable record; a converted quote is additionally read-only forever.
export const updateQuote = async (req: AuthRequest, res: Response) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (quote.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot edit a quote with status "${quote.status}" — only draft quotes can be edited` });
    }

    const {
      customer, isIndividual, individualCustomer, expiryDate, notes, lineItems: rawLines,
    } = req.body as {
      customer?: string;
      isIndividual?: boolean;
      individualCustomer?: { name?: string; email?: string; phone?: string };
      expiryDate?: string;
      notes?: string;
      lineItems?: RawLineItemInput[];
    };

    if (isIndividual !== undefined) quote.isIndividual = isIndividual;
    if (quote.isIndividual) {
      if (individualCustomer) {
        if (!individualCustomer.name?.trim()) {
          return res.status(400).json({ success: false, message: 'individualCustomer.name is required' });
        }
        quote.individualCustomer = {
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
      quote.customer = new mongoose.Types.ObjectId(customer);
    }

    if (expiryDate !== undefined) quote.expiryDate = expiryDate ? new Date(expiryDate) : undefined;
    if (notes !== undefined) quote.notes = notes;

    if (rawLines) {
      const defaultTaxRate = await resolveDefaultTaxRate(req.tenantId);
      quote.lineItems = await buildLineItems(rawLines, defaultTaxRate) as any;
    }

    await quote.save();
    res.status(200).json({ success: true, message: 'Quote updated successfully', data: quote });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid quote ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Update quote error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating quote' });
  }
};

// draft → sent. No side effects beyond the status change — sending a quote is not a fiscal event.
export const sendQuote = async (req: AuthRequest, res: Response) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (quote.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot send a quote with status "${quote.status}" — only draft quotes can be sent` });
    }
    quote.status = 'sent';
    await quote.save();
    res.status(200).json({ success: true, message: 'Quote sent successfully', data: quote });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid quote ID' });
    console.error('Send quote error:', error);
    res.status(500).json({ success: false, message: 'Server error while sending quote' });
  }
};

// Manual accepted/rejected status actions — a dead-end for rejected/expired quotes (no
// conversion possible once in that terminal state).
async function setManualStatus(req: AuthRequest, res: Response, target: 'accepted' | 'rejected') {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (quote.status !== 'sent' && quote.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot mark a quote with status "${quote.status}" as ${target}` });
    }
    quote.status = target;
    await quote.save();
    res.status(200).json({ success: true, message: `Quote marked as ${target}`, data: quote });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid quote ID' });
    console.error(`Set quote ${target} error:`, error);
    res.status(500).json({ success: false, message: `Server error while marking quote as ${target}` });
  }
}

export const acceptQuote = (req: AuthRequest, res: Response) => setManualStatus(req, res, 'accepted');
export const rejectQuote = (req: AuthRequest, res: Response) => setManualStatus(req, res, 'rejected');

// Creates a new draft Invoice pre-filled from the quote's customer/lines/discounts/tax rates,
// sets convertedInvoiceId, and makes the quote permanently read-only. The quote itself never
// touches stock, GL, or e-CF — all of that happens normally once the resulting Invoice is sent.
export const convertQuote = async (req: AuthRequest, res: Response) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (quote.status === 'converted') {
      return res.status(400).json({ success: false, message: 'Quote has already been converted to an invoice' });
    }
    if (quote.status === 'rejected' || quote.status === 'expired') {
      return res.status(400).json({ success: false, message: `Cannot convert a quote with status "${quote.status}"` });
    }

    const invoiceLineItems: IInvoiceLineItem[] = quote.lineItems.map(line => ({
      description: line.description,
      product: line.product,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
      // recomputed by Invoice's own pre-validate hook — placeholder values only
      lineTotal: 0,
      taxAmount: 0,
      total: 0,
    })) as any;

    const invoiceNumber = `INV-${String(await nextSequence('invoiceNumber')).padStart(6, '0')}`;

    const invoice = await Invoice.create({
      invoiceNumber,
      customer: quote.isIndividual ? undefined : quote.customer,
      isIndividual: quote.isIndividual,
      individualCustomer: quote.isIndividual ? quote.individualCustomer : undefined,
      notes: quote.notes,
      lineItems: invoiceLineItems,
      status: 'draft',
      createdBy: req.user._id,
    });

    quote.status = 'converted';
    quote.convertedInvoiceId = invoice._id as any;
    await quote.save();

    res.status(200).json({ success: true, message: 'Quote converted to invoice successfully', data: { quote, invoice } });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid quote ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Convert quote error:', error);
    res.status(500).json({ success: false, message: 'Server error while converting quote' });
  }
};
