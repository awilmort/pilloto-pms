import { accountingPlanOf, featureDenial, hasAccountingFeature } from '../../services/entitlements';
import { smallestAccountingPlanWith } from '../../config/accountingPlans';
import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../../middleware/auth';
import Bill, { IBillLineItem, BillPaymentMethod } from '../../models/Bill';
import Supplier from '../../models/Supplier';
import Product from '../../models/Product';
import Account from '../../models/Account';
import ProductStock from '../../models/ProductStock';
import Tenant from '../../models/Tenant';
import { nextSequence } from '../../models/Counter';
import { resolveWarehouseId, receiveStock, deductStockForSale } from '../../services/accounting/inventory.service';
import { UNIT_OF_MEASURE_CODES } from '../../constants/unitsOfMeasure';
import { postJournalEntry, getSystemAccountIds, reversePostedEntries, inFunctional, settlementLines } from '../../services/accounting/ledger.service';
import { resolveDocumentCurrency, resolvePaymentRate } from '../../services/accounting/fx.service';
import { assertBankAccount, settlementAccountId } from '../../services/accounting/bank.service';
import { SYSTEM_ACCOUNT_CODES } from '../../constants/accounting';
import { EXPENSE_TYPE_CODES, ExpenseType, ISR_WITHHOLDING_CODES, IsrWithholdingType, isNcf, normalizeNcf } from '../../constants/dgii';

/**
 * Bill controller (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 6.1) — the AP mirror
 * of `invoices.controller.ts` (Phase 5.1). `receiveBill` is the one action that reaches
 * outside this model, calling the shared `receiveStock()` service (Phase 4.1) so a formal
 * Bill receipt and the ad hoc `/products/:id/purchase` endpoint post through the exact
 * same stock-and-cost path. GL posting (receive/payment/void) is wired in per Phase 7.1,
 * mirroring Invoice's posting in `invoices.controller.ts`.
 */

interface RawBillLineItemInput {
  lineType?: 'inventory' | 'expense';
  description?: string;
  taxRate?: number;
  product?: string;
  purchaseUnitOfMeasure?: string;
  purchaseQuantity?: number;
  purchaseUnitCost?: number;
  stockUnitOfMeasure?: string;
  stockQuantity?: number;
  account?: string;
  lineTotal?: number; // expense lines only — the entered amount
  isGoods?: boolean; // expense lines only — 606 goods vs services
}

/** The 606/withholding fields of a bill, from a request body. Throws { status, message } when invalid. */
function fiscalFieldsOf(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body.ncf !== undefined) {
    const ncf = normalizeNcf(body.ncf);
    if (ncf && !isNcf(ncf)) throw { status: 400, message: 'The NCF must be B + 10 digits (e.g. B0100000123) or an e-CF E + 12 digits (e.g. E310000000123)' };
    out.ncf = ncf || undefined;
  }
  if (body.expenseType !== undefined) {
    if (body.expenseType && !EXPENSE_TYPE_CODES.includes(body.expenseType as ExpenseType)) throw { status: 400, message: 'Invalid 606 expense type' };
    out.expenseType = body.expenseType || undefined;
  }
  if (body.itbisToCost !== undefined) out.itbisToCost = body.itbisToCost === true;
  for (const key of ['itbisWithheld', 'isrWithheld'] as const) {
    if (body[key] === undefined || body[key] === null || body[key] === '') continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0) throw { status: 400, message: `${key} must be a number >= 0` };
    out[key] = n;
  }
  if (body.isrWithholdingType !== undefined) {
    if (body.isrWithholdingType && !ISR_WITHHOLDING_CODES.includes(body.isrWithholdingType as IsrWithholdingType)) throw { status: 400, message: 'Invalid ISR withholding type' };
    out.isrWithholdingType = body.isrWithholdingType || undefined;
  }
  return out;
}

async function resolveDefaultTaxRate(tenantId: unknown): Promise<number> {
  const tenant = await Tenant.findById(tenantId).select('ecfConfig.defaultItbisRate').lean();
  return (tenant as any)?.ecfConfig?.defaultItbisRate ?? 18;
}

// Builds validated line items from raw request input, discriminated by lineType. Existence/
// validity checks that need a DB lookup (product/account exist, unit matches) happen here;
// the resulting lineTotal/unitCost/taxAmount/total placeholders are recomputed for real by
// Bill's own pre-validate hook once assigned to the document — same split of responsibility
// as invoices.controller.ts's buildLineItems.
async function buildBillLineItems(rawItems: RawBillLineItemInput[], defaultTaxRate: number, tenant?: unknown): Promise<IBillLineItem[]> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw { status: 400, message: 'At least one line item is required' };
  }
  // Inventory lines are the inventory module; plans without it record purchases as expense lines.
  if (rawItems.some((i) => i?.lineType === 'inventory') && !hasAccountingFeature(tenant as any, 'inventory')) {
    throw { status: 403, body: featureDenial('accounting', 'inventory', accountingPlanOf(tenant as any), smallestAccountingPlanWith('inventory')) };
  }

  const productIds = rawItems.filter(i => i?.lineType === 'inventory' && i.product).map(i => i.product as string);
  const accountIds = rawItems.filter(i => i?.lineType === 'expense' && i.account).map(i => i.account as string);
  const [products, accounts] = await Promise.all([
    Product.find({ _id: { $in: productIds } }),
    Account.find({ _id: { $in: accountIds } }),
  ]);
  const productMap = new Map(products.map(p => [String(p._id), p]));
  const accountMap = new Map(accounts.map(a => [String(a._id), a]));

  return rawItems.map((item, idx) => {
    if (item?.lineType !== 'inventory' && item?.lineType !== 'expense') {
      throw { status: 400, message: `Line ${idx + 1}: lineType must be 'inventory' or 'expense'` };
    }
    const taxRate = item.taxRate ?? defaultTaxRate;
    if (taxRate < 0 || taxRate > 100) {
      throw { status: 400, message: `Line ${idx + 1}: taxRate must be between 0 and 100` };
    }

    if (item.lineType === 'inventory') {
      const product = item.product ? productMap.get(String(item.product)) : undefined;
      if (!product) throw { status: 400, message: `Line ${idx + 1}: invalid product` };
      if (product.tracksStock === false) throw { status: 400, message: `Line ${idx + 1} (${product.name}): this item does not track stock — record it as an expense line` };

      const purchaseQuantity = Number(item.purchaseQuantity);
      if (!item.purchaseQuantity || Number.isNaN(purchaseQuantity) || purchaseQuantity <= 0) {
        throw { status: 400, message: `Line ${idx + 1} (${product.name}): purchaseQuantity must be greater than 0` };
      }
      if (!item.purchaseUnitOfMeasure || !UNIT_OF_MEASURE_CODES.includes(item.purchaseUnitOfMeasure as any)) {
        throw { status: 400, message: `Line ${idx + 1} (${product.name}): a valid purchaseUnitOfMeasure is required` };
      }
      const purchaseUnitCost = Number(item.purchaseUnitCost);
      if (item.purchaseUnitCost === undefined || item.purchaseUnitCost === null || Number.isNaN(purchaseUnitCost) || purchaseUnitCost < 0) {
        throw { status: 400, message: `Line ${idx + 1} (${product.name}): purchaseUnitCost must be >= 0` };
      }
      const stockQuantity = Number(item.stockQuantity);
      if (!item.stockQuantity || Number.isNaN(stockQuantity) || stockQuantity <= 0) {
        throw { status: 400, message: `Line ${idx + 1} (${product.name}): stockQuantity must be greater than 0` };
      }
      if (item.stockUnitOfMeasure !== product.unitOfMeasure) {
        throw { status: 400, message: `Line ${idx + 1} (${product.name}): stockUnitOfMeasure must match the product's base unit (${product.unitOfMeasure})` };
      }

      return {
        lineType: 'inventory',
        description: (item.description && item.description.trim()) || product.description || product.name,
        taxRate,
        product: product._id,
        purchaseUnitOfMeasure: item.purchaseUnitOfMeasure,
        purchaseQuantity,
        purchaseUnitCost,
        stockUnitOfMeasure: item.stockUnitOfMeasure,
        stockQuantity,
        // recomputed by Bill's pre-validate hook — placeholder values only
        lineTotal: 0,
        unitCost: 0,
        taxAmount: 0,
        total: 0,
      } as IBillLineItem;
    }

    // expense
    if (!item.description?.trim()) throw { status: 400, message: `Line ${idx + 1}: expense lines require a description` };
    const account = item.account ? accountMap.get(String(item.account)) : undefined;
    if (!account) throw { status: 400, message: `Line ${idx + 1} (${item.description}): invalid account` };
    const lineTotal = Number(item.lineTotal);
    if (item.lineTotal === undefined || item.lineTotal === null || Number.isNaN(lineTotal) || lineTotal < 0) {
      throw { status: 400, message: `Line ${idx + 1} (${item.description}): lineTotal must be >= 0` };
    }

    return {
      lineType: 'expense',
      description: item.description.trim(),
      taxRate,
      account: account._id,
      lineTotal,
      isGoods: item.isGoods === true,
      // recomputed by Bill's pre-validate hook — placeholder values only
      taxAmount: 0,
      total: 0,
    } as IBillLineItem;
  });
}

export const listBills = async (req: AuthRequest, res: Response) => {
  try {
    const { status, supplier, search, page = '1', limit = '50' } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (supplier && mongoose.Types.ObjectId.isValid(supplier)) filter.supplier = supplier;
    if (search) {
      filter.$or = [
        { billNumber: { $regex: search, $options: 'i' } },
        { vendorInvoiceNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [bills, total] = await Promise.all([
      Bill.find(filter)
        .populate('supplier', 'name email taxId')
        .populate('warehouse', 'name code')
        .sort({ issueDate: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean({ virtuals: true }),
      Bill.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: bills,
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    console.error('List bills error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching bills' });
  }
};

export const getBill = async (req: AuthRequest, res: Response) => {
  try {
    const bill = await Bill.findById(req.params.id)
      .populate('supplier')
      .populate('warehouse', 'name code')
      .populate('lineItems.product', 'name sku unitOfMeasure onHandQty')
      .populate('lineItems.account', 'code name type')
      .populate('payments.recordedBy', 'firstName lastName')
      .populate('createdBy', 'firstName lastName')
      .lean({ virtuals: true });
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });
    res.status(200).json({ success: true, data: bill });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid bill ID' });
    console.error('Get bill error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching bill' });
  }
};

export const createBill = async (req: AuthRequest, res: Response) => {
  try {
    const {
      supplier: supplierId, warehouse: warehouseId, vendorInvoiceNumber, issueDate, dueDate, notes, lineItems: rawLines,
    } = req.body as {
      supplier?: string; warehouse?: string; vendorInvoiceNumber?: string; issueDate?: string; dueDate?: string; notes?: string; lineItems?: RawBillLineItemInput[];
    };

    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'supplier is required and must be a valid Supplier ID' });
    }
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });

    const defaultTaxRate = await resolveDefaultTaxRate(req.tenantId);
    const lineItems = await buildBillLineItems(rawLines || [], defaultTaxRate, req.tenant);
    const hasInventoryLine = lineItems.some(li => li.lineType === 'inventory');

    let resolvedWarehouseId: string | undefined;
    if (hasInventoryLine || warehouseId) {
      resolvedWarehouseId = await resolveWarehouseId(warehouseId);
    }

    const resolvedIssueDate = issueDate ? new Date(issueDate) : new Date();
    let resolvedDueDate = dueDate ? new Date(dueDate) : undefined;
    if (!resolvedDueDate) {
      const termsDays = supplier.paymentTermsDays ?? 15;
      resolvedDueDate = new Date(resolvedIssueDate.getTime() + termsDays * 24 * 60 * 60 * 1000);
    }

    const billNumber = `BILL-${String(await nextSequence('billNumber')).padStart(6, '0')}`;

    const fiscal = fiscalFieldsOf(req.body ?? {});
    const fx = await resolveDocumentCurrency(req.tenant, req.body ?? {}, resolvedIssueDate);
    const bill = await Bill.create({
      ...fx,
      billNumber,
      supplier: supplier._id,
      warehouse: resolvedWarehouseId,
      vendorInvoiceNumber,
      issueDate: resolvedIssueDate,
      dueDate: resolvedDueDate,
      notes,
      lineItems,
      status: 'draft',
      createdBy: req.user._id,
      ...fiscal,
      expenseType: (fiscal.expenseType as string | undefined) ?? supplier.defaultExpenseType ?? (hasInventoryLine ? '09' : '02'),
    });

    res.status(201).json({ success: true, message: 'Bill created successfully', data: bill });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json(error.body ?? { success: false, message: error.message });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Create bill error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating bill' });
  }
};

// Edits are only allowed on draft bills — once received, stock/cost effects are real and
// the line items become historical record (mirrors updateInvoice).
export const updateBill = async (req: AuthRequest, res: Response) => {
  try {
    const bill = await Bill.findById(req.params.id);
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });
    if (bill.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot edit a bill with status "${bill.status}" — only draft bills can be edited` });
    }

    const {
      supplier: supplierId, warehouse: warehouseId, vendorInvoiceNumber, issueDate, dueDate, notes, lineItems: rawLines,
    } = req.body as {
      supplier?: string; warehouse?: string; vendorInvoiceNumber?: string; issueDate?: string; dueDate?: string; notes?: string; lineItems?: RawBillLineItemInput[];
    };

    if (supplierId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(supplierId)) return res.status(400).json({ success: false, message: 'supplier must be a valid Supplier ID' });
      const supplier = await Supplier.findById(supplierId);
      if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
      bill.supplier = supplier._id as any;
    }
    if (vendorInvoiceNumber !== undefined) bill.vendorInvoiceNumber = vendorInvoiceNumber;
    bill.set(fiscalFieldsOf(req.body ?? {}));
    if (req.body?.currency !== undefined || req.body?.exchangeRate !== undefined) {
      bill.set(await resolveDocumentCurrency(req.tenant, req.body, issueDate ?? bill.issueDate, bill));
    }
    if (issueDate !== undefined) bill.issueDate = new Date(issueDate);
    if (dueDate !== undefined) bill.dueDate = new Date(dueDate);
    if (notes !== undefined) bill.notes = notes;

    if (rawLines !== undefined) {
      const defaultTaxRate = await resolveDefaultTaxRate(req.tenantId);
      bill.lineItems = await buildBillLineItems(rawLines, defaultTaxRate, req.tenant) as any;
    }

    const hasInventoryLine = bill.lineItems.some(li => li.lineType === 'inventory');
    if (warehouseId !== undefined) {
      bill.warehouse = (await resolveWarehouseId(warehouseId)) as any;
    } else if (hasInventoryLine && !bill.warehouse) {
      bill.warehouse = (await resolveWarehouseId(undefined)) as any;
    }

    await bill.save();
    res.status(200).json({ success: true, message: 'Bill updated successfully', data: bill });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json(error.body ?? { success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid bill ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Update bill error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating bill' });
  }
};

// Transitions draft -> received: receives stock for every inventory line (via the shared
// receiveStock() service — same path a Phase 4 ad hoc purchase uses) and requires every
// expense line's account to still exist and be active. Products/accounts are re-validated
// here (not just trusted from draft creation) since either could have changed since the
// draft was built — same rigor level as Invoice.send's stock-sufficiency pre-check.
export const receiveBill = async (req: AuthRequest, res: Response) => {
  try {
    const bill = await Bill.findById(req.params.id);
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });
    if (bill.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot receive a bill with status "${bill.status}" — only draft bills can be received` });
    }

    const inventoryLines = bill.lineItems.filter(li => li.lineType === 'inventory');
    const expenseLines = bill.lineItems.filter(li => li.lineType === 'expense');

    if (inventoryLines.length > 0 && !bill.warehouse) {
      return res.status(400).json({ success: false, message: 'This bill has inventory lines but no warehouse is set' });
    }

    const products = await Product.find({ _id: { $in: inventoryLines.map(li => li.product) } });
    const productMap = new Map(products.map(p => [String(p._id), p]));
    for (const li of inventoryLines) {
      const product = productMap.get(String(li.product));
      if (!product) return res.status(400).json({ success: false, message: `Product ${li.product} no longer exists` });
      if (li.stockUnitOfMeasure !== product.unitOfMeasure) {
        return res.status(400).json({
          success: false,
          message: `${product.name}'s stock unit no longer matches its base unit (${product.unitOfMeasure})`,
        });
      }
    }

    const accounts = await Account.find({ _id: { $in: expenseLines.map(li => li.account) } });
    const accountMap = new Map(accounts.map(a => [String(a._id), a]));
    for (const li of expenseLines) {
      const account = accountMap.get(String(li.account));
      if (!account) return res.status(400).json({ success: false, message: `Account ${li.account} no longer exists` });
      if (!account.isActive) return res.status(400).json({ success: false, message: `Account "${account.name}" is not active` });
    }

    await receiveBillCore(bill, req.user._id);

    res.status(200).json({ success: true, message: 'Bill received successfully', data: bill });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json(error.body ?? { success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid bill ID' });
    console.error('Receive bill error:', error);
    res.status(500).json({ success: false, message: 'Server error while receiving bill' });
  }
};

// Records a payment (partial or full) — same primitive shape as Invoice's recordPayment.
export const recordBillPayment = async (req: AuthRequest, res: Response) => {
  try {
    if (req.body?.bankAccount) {
      try { await assertBankAccount(req.body.bankAccount); } catch { return res.status(400).json({ success: false, message: 'Invalid bank account' }); }
    }
    const { amount, method, date, reference } = req.body as {
      amount?: number; method?: BillPaymentMethod; date?: string; reference?: string;
    };
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'amount must be greater than 0' });
    const validMethods: BillPaymentMethod[] = ['cash', 'card', 'transfer', 'check', 'other'];
    if (!method || !validMethods.includes(method)) {
      return res.status(400).json({ success: false, message: `method must be one of: ${validMethods.join(', ')}` });
    }

    const bill = await Bill.findById(req.params.id);
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });
    if (bill.status !== 'received' && bill.status !== 'partial') {
      return res.status(400).json({ success: false, message: `Cannot record a payment on a bill with status "${bill.status}"` });
    }
    if (amount > bill.balanceDue + 0.01) {
      return res.status(400).json({ success: false, message: `Payment amount (${amount}) exceeds the remaining balance due (${bill.balanceDue})` });
    }

    await payBillCore(bill, { amount, method, date, reference, bankAccount: req.body?.bankAccount, exchangeRate: req.body?.exchangeRate }, req.user._id);

    res.status(200).json({ success: true, message: 'Payment recorded successfully', data: bill });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid bill ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    if (error?.status) return res.status(error.status).json(error.body ?? { success: false, message: error.message });
    console.error('Record bill payment error:', error);
    res.status(500).json({ success: false, message: 'Server error while recording payment' });
  }
};

// Void guardrail: only a bill with zero payments recorded can be voided — same rule as
// voidInvoice. If the bill had been received, reverses the stock it added via the shared
// deductStockForSale() service (type:'purchase-reversal') — blocked, all-or-nothing, if any
// of that stock has already been consumed elsewhere (can't go negative).
export const voidBill = async (req: AuthRequest, res: Response) => {
  try {
    const bill = await Bill.findById(req.params.id);
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });
    if (bill.status === 'void') {
      return res.status(400).json({ success: false, message: 'Bill is already void' });
    }
    if (bill.amountPaid > 0) {
      return res.status(400).json({ success: false, message: 'Cannot void a bill with payments recorded' });
    }

    if (bill.status === 'received' || bill.status === 'partial') {
      const inventoryLines = bill.lineItems.filter(li => li.lineType === 'inventory');
      if (inventoryLines.length > 0) {
        const products = await Product.find({ _id: { $in: inventoryLines.map(li => li.product) } });
        const productMap = new Map(products.map(p => [String(p._id), p]));
        const stocks = await ProductStock.find({ warehouse: bill.warehouse, product: { $in: inventoryLines.map(li => li.product) } });
        const stockMap = new Map(stocks.map(s => [String(s.product), s]));

        // Pre-check every line before mutating any — keeps the reversal all-or-nothing.
        for (const li of inventoryLines) {
          const product = productMap.get(String(li.product));
          if (!product) continue; // product archived/removed since — nothing to reverse
          const qty = li.stockQuantity!;
          const stockOnHand = stockMap.get(String(li.product))?.onHandQty || 0;
          if (product.onHandQty < qty || stockOnHand < qty) {
            return res.status(400).json({
              success: false,
              message: `Cannot void: stock from "${product.name}" on this bill has already been used elsewhere`,
            });
          }
        }

        for (const li of inventoryLines) {
          const product = productMap.get(String(li.product));
          if (!product) continue;
          await deductStockForSale({
            productId: String(li.product),
            warehouseId: String(bill.warehouse),
            quantity: li.stockQuantity!,
            type: 'purchase-reversal',
            supplier: String(bill.supplier),
            bill: String(bill._id),
            notes: `Stock reversed — bill ${bill.billNumber} voided`,
            recordedBy: req.user._id,
          });
        }
      }
    }

    // Only a 'received'/'partial' bill ever reached GL (a 'draft' bill never posted) —
    // reverse that entry before flipping status, mirroring Invoice.void.
    const hadGlEntry = bill.status === 'received' || bill.status === 'partial';

    bill.status = 'void';
    bill.voidedAt = new Date();
    bill.voidReason = req.body?.reason;
    await bill.save();

    if (hadGlEntry) {
      try {
        await reversePostedEntries(
          'Bill',
          bill._id as any,
          'bill_received',
          'bill_void',
          `Bill ${bill.billNumber} voided`,
          req.user._id
        );
      } catch (glErr: any) {
        console.error(`[Bill.void] GL reversal failed for bill ${bill.billNumber}:`, glErr?.message || glErr);
      }
    }

    res.status(200).json({ success: true, message: 'Bill voided successfully', data: bill });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json(error.body ?? { success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid bill ID' });
    console.error('Void bill error:', error);
    res.status(500).json({ success: false, message: 'Server error while voiding bill' });
  }
};

// ─── Receipt and payment (shared by the bill actions and the quick expense) ──

/**
 * Receives a draft bill: stock for inventory lines, then the GL entry —
 *   Dr Inventory / each expense line's account   (net of ITBIS; with it when `itbisToCost`)
 *   Dr ITBIS pagado por adelantar                (the bill's ITBIS, unless `itbisToCost`)
 *   Cr Cuentas por pagar                         (payableTotal: what the supplier is owed)
 *   Cr ITBIS retenido por pagar / ISR retenido   (the withholdings, owed to the DGII)
 * The GL entry is best-effort (stock has already moved): a failure is logged, not unwound.
 */
async function receiveBillCore(bill: InstanceType<typeof Bill>, userId: unknown): Promise<void> {
  const inventoryLines = bill.lineItems.filter(li => li.lineType === 'inventory');
  const expenseLines = bill.lineItems.filter(li => li.lineType === 'expense');
  for (const li of inventoryLines) {
    await receiveStock({
      productId: String(li.product),
      warehouseId: String(bill.warehouse),
      quantity: li.stockQuantity!,
      unitCost: li.unitCost! * (bill.exchangeRate || 1), // stock is valued in DOP
      supplierId: String(bill.supplier),
      bill: String(bill._id),
      notes: `Received via ${bill.billNumber}`,
      recordedBy: userId as any,
    });
  }

  bill.status = 'received';
  await bill.save();

  try {
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const cost = (li: IBillLineItem) => (bill.itbisToCost ? li.total : li.lineTotal);
    const inventoryCost = r2(inventoryLines.reduce((sum, li) => sum + cost(li), 0));
    const advance = bill.itbisToCost ? 0 : bill.taxAmount;
    const codes = [
      SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
      ...(inventoryCost > 0 ? [SYSTEM_ACCOUNT_CODES.INVENTORY] : []),
      ...(advance > 0 ? [SYSTEM_ACCOUNT_CODES.ITBIS_ADVANCE] : []),
      ...(bill.itbisWithheld > 0 ? [SYSTEM_ACCOUNT_CODES.ITBIS_WITHHELD] : []),
      ...(bill.isrWithheld > 0 ? [SYSTEM_ACCOUNT_CODES.ISR_WITHHELD] : []),
    ];
    const ids = await getSystemAccountIds(codes);
    const lines = [
      ...(inventoryCost > 0 ? [{ account: ids[SYSTEM_ACCOUNT_CODES.INVENTORY], debit: inventoryCost }] : []),
      ...expenseLines.filter((li) => cost(li) > 0).map((li) => ({ account: li.account as mongoose.Types.ObjectId, debit: cost(li) })),
      ...(advance > 0 ? [{ account: ids[SYSTEM_ACCOUNT_CODES.ITBIS_ADVANCE], debit: advance }] : []),
      ...(bill.payableTotal > 0 ? [{ account: ids[SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE], credit: bill.payableTotal }] : []),
      ...(bill.itbisWithheld > 0 ? [{ account: ids[SYSTEM_ACCOUNT_CODES.ITBIS_WITHHELD], credit: bill.itbisWithheld }] : []),
      ...(bill.isrWithheld > 0 ? [{ account: ids[SYSTEM_ACCOUNT_CODES.ISR_WITHHELD], credit: bill.isrWithheld }] : []),
    ];
    if (lines.length >= 2) {
      // In the bill's currency, converted to DOP at its rate (rounding on the payable).
      const plug = Math.max(0, lines.findIndex((l) => String(l.account) === String(ids[SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE])));
      await postJournalEntry(inFunctional(lines, bill.exchangeRate || 1, plug), 'bill_received', { model: 'Bill', id: bill._id as any }, `Bill ${bill.billNumber} received`, userId as any, bill.issueDate);
    }
  } catch (glErr: any) {
    console.error(`[Bill.receive] GL posting failed for bill ${bill.billNumber}:`, glErr?.message || glErr);
  }
}

export interface BillPaymentInput {
  amount: number;
  method: BillPaymentMethod;
  date?: string | Date;
  reference?: string;
  /** Where a non-cash payment leaves from (default bank account when absent). */
  bankAccount?: string;
  /** Rate on the payment day, for a foreign-currency bill (the day's latest recorded otherwise). */
  exchangeRate?: unknown;
}

/** Records a payment on a received bill and posts Dr Cuentas por pagar / Cr Caja o Banco (best-effort). */
async function payBillCore(bill: InstanceType<typeof Bill>, input: BillPaymentInput, userId: unknown): Promise<void> {
  const { amount, method, date, reference } = input;
  const paymentRate = await resolvePaymentRate(bill, input.exchangeRate, date);
  bill.payments.push({
    amount,
    method,
    date: date ? new Date(date) : new Date(),
    reference,
    exchangeRate: paymentRate,
    recordedBy: userId,
  } as any);
  await bill.save();
  try {
    const accountIds = await getSystemAccountIds([SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE]);
    const settlement = await settlementAccountId(method, input.bankAccount);
    await postJournalEntry(
      await settlementLines({
        amount, documentRate: bill.exchangeRate || 1, paymentRate, direction: 'out',
        cashAccount: settlement, controlAccount: accountIds[SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE],
      }),
      'bill_payment',
      { model: 'Bill', id: bill._id as any },
      `Payment recorded on Bill ${bill.billNumber}`,
      userId as any,
      date ? new Date(date) : new Date(),
    );
  } catch (glErr: any) {
    console.error(`[Bill.recordPayment] GL posting failed for bill ${bill.billNumber}:`, glErr?.message || glErr);
  }
}

/**
 * Quick expense: a purchase already paid (a receipt, a utility bill) recorded in one step — the
 * bill is created with expense lines, received and paid in full. Expense lines only; stocked
 * purchases go through a regular bill.
 */
export const createQuickExpense = async (req: AuthRequest, res: Response) => {
  try {
    if (req.body?.payment?.bankAccount) {
      try { await assertBankAccount(req.body.payment.bankAccount); } catch { return res.status(400).json({ success: false, message: 'Invalid bank account' }); }
    }
    const body = (req.body ?? {}) as Record<string, any>;
    if (!body.supplier || !mongoose.Types.ObjectId.isValid(body.supplier)) {
      return res.status(400).json({ success: false, message: 'supplier is required' });
    }
    const supplier = await Supplier.findById(body.supplier);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
    const rawLines: RawBillLineItemInput[] = (Array.isArray(body.lineItems) ? body.lineItems : []).map((l: RawBillLineItemInput) => ({ ...l, lineType: 'expense' }));
    const lineItems = await buildBillLineItems(rawLines, await resolveDefaultTaxRate(req.tenantId), req.tenant);
    const method = body.payment?.method as BillPaymentMethod;
    if (!['cash', 'card', 'transfer', 'check', 'other'].includes(method)) {
      return res.status(400).json({ success: false, message: 'payment.method is required' });
    }
    const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();
    const fiscal = fiscalFieldsOf(body);
    const fx = await resolveDocumentCurrency(req.tenant, body, issueDate);
    const bill = await Bill.create({
      ...fx,
      billNumber: `BILL-${String(await nextSequence('billNumber')).padStart(6, '0')}`,
      supplier: supplier._id,
      vendorInvoiceNumber: body.vendorInvoiceNumber,
      issueDate,
      dueDate: issueDate,
      notes: body.notes,
      lineItems,
      status: 'draft',
      createdBy: req.user._id,
      ...fiscal,
      expenseType: (fiscal.expenseType as string | undefined) ?? supplier.defaultExpenseType ?? '02',
    });
    await receiveBillCore(bill, req.user._id);
    if (bill.balanceDue > 0) {
      await payBillCore(bill, { amount: bill.balanceDue, method, date: body.payment?.date ?? issueDate, reference: body.payment?.reference, bankAccount: body.payment?.bankAccount }, req.user._id);
    }
    res.status(201).json({ success: true, message: 'Expense recorded', data: bill });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json(error.body ?? { success: false, message: error.message });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Quick expense error:', error);
    res.status(500).json({ success: false, message: 'Server error while recording the expense' });
  }
};
