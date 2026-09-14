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
import { postJournalEntry, getSystemAccountIds, cashAccountCodeForMethod, reversePostedEntries } from '../../services/accounting/ledger.service';
import { SYSTEM_ACCOUNT_CODES } from '../../constants/accounting';

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
async function buildBillLineItems(rawItems: RawBillLineItemInput[], defaultTaxRate: number): Promise<IBillLineItem[]> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw { status: 400, message: 'At least one line item is required' };
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
    const lineItems = await buildBillLineItems(rawLines || [], defaultTaxRate);
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

    const bill = await Bill.create({
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
    });

    res.status(201).json({ success: true, message: 'Bill created successfully', data: bill });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
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
    if (issueDate !== undefined) bill.issueDate = new Date(issueDate);
    if (dueDate !== undefined) bill.dueDate = new Date(dueDate);
    if (notes !== undefined) bill.notes = notes;

    if (rawLines !== undefined) {
      const defaultTaxRate = await resolveDefaultTaxRate(req.tenantId);
      bill.lineItems = await buildBillLineItems(rawLines, defaultTaxRate) as any;
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
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
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

    for (const li of inventoryLines) {
      await receiveStock({
        productId: String(li.product),
        warehouseId: String(bill.warehouse),
        quantity: li.stockQuantity!,
        unitCost: li.unitCost!,
        supplierId: String(bill.supplier),
        bill: String(bill._id),
        notes: `Received via ${bill.billNumber}`,
        recordedBy: req.user._id,
      });
    }

    bill.status = 'received';
    await bill.save();

    // GL posting (Phase 7.1): Dr Inventory (inventory lines, summed) / Dr each expense
    // line's own coded account, Cr Accounts Payable for bill.total. Each line's
    // tax-inclusive `total` is debited (no separate AP-side input-tax account exists in
    // the seeded chart per §5.1/§6.2 — purchase tax is capitalized into cost, a common
    // simplification for v1) — so the debit lines sum to exactly bill.total, matching the
    // AP credit. Posted best-effort: stock/cost has already moved above, so a GL failure
    // (e.g. an unseeded Chart of Accounts) is logged loudly rather than unwinding a real
    // stock receipt.
    try {
      const inventoryLineTotal = Math.round(
        (inventoryLines.reduce((sum, li) => sum + li.total, 0) + Number.EPSILON) * 100
      ) / 100;
      const accountIds = await getSystemAccountIds([
        SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
        ...(inventoryLineTotal > 0 ? [SYSTEM_ACCOUNT_CODES.INVENTORY] : []),
      ]);
      // Expense lines code directly to an Account _id already resolved in buildBillLineItems
      // (not a SYSTEM_ACCOUNT_CODES lookup) — used here as-is to post their debit lines.
      const debitLines = [
        ...(inventoryLineTotal > 0 ? [{ account: accountIds[SYSTEM_ACCOUNT_CODES.INVENTORY], debit: inventoryLineTotal }] : []),
        ...expenseLines.map((li) => ({ account: li.account as mongoose.Types.ObjectId, debit: li.total })),
      ];
      await postJournalEntry(
        [...debitLines, { account: accountIds[SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE], credit: bill.total }],
        'bill_received',
        { model: 'Bill', id: bill._id as any },
        `Bill ${bill.billNumber} received`,
        req.user._id
      );
    } catch (glErr: any) {
      console.error(`[Bill.receive] GL posting failed for bill ${bill.billNumber}:`, glErr?.message || glErr);
    }

    res.status(200).json({ success: true, message: 'Bill received successfully', data: bill });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid bill ID' });
    console.error('Receive bill error:', error);
    res.status(500).json({ success: false, message: 'Server error while receiving bill' });
  }
};

// Records a payment (partial or full) — same primitive shape as Invoice's recordPayment.
export const recordBillPayment = async (req: AuthRequest, res: Response) => {
  try {
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

    bill.payments.push({
      amount,
      method,
      date: date ? new Date(date) : new Date(),
      reference,
      recordedBy: req.user._id,
    } as any);

    await bill.save();

    // GL posting (Phase 7.1): Dr Accounts Payable, Cr Bank/Cash — best-effort, same
    // logged-not-blocking rationale as receiveBill's posting.
    try {
      const accountIds = await getSystemAccountIds([SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE, cashAccountCodeForMethod(method)]);
      await postJournalEntry(
        [
          { account: accountIds[SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE], debit: amount },
          { account: accountIds[cashAccountCodeForMethod(method)], credit: amount },
        ],
        'bill_payment',
        { model: 'Bill', id: bill._id as any },
        `Payment recorded on Bill ${bill.billNumber}`,
        req.user._id
      );
    } catch (glErr: any) {
      console.error(`[Bill.recordPayment] GL posting failed for bill ${bill.billNumber}:`, glErr?.message || glErr);
    }

    res.status(200).json({ success: true, message: 'Payment recorded successfully', data: bill });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid bill ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
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
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid bill ID' });
    console.error('Void bill error:', error);
    res.status(500).json({ success: false, message: 'Server error while voiding bill' });
  }
};
