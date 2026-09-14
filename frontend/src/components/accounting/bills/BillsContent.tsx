import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, TextField, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Alert, Tooltip, FormControl, InputLabel, Select, MenuItem,
  ToggleButtonGroup, ToggleButton, Divider, Menu, ListItemIcon, ListItemText,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import PaymentIcon from '@mui/icons-material/Payment';
import BlockIcon from '@mui/icons-material/Block';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePermission } from '../../../lib/permissions';
import { billsService, suppliersService, productsService, accountsService, BillLineItemInput } from '../../../services/api';
import { Bill, BillStatus, BillPaymentMethod, Supplier, Product, Account } from '../../../types';
import { UNIT_OF_MEASURE_CODES } from '../../../lib/unitsOfMeasure';
import { formatMoney } from '../../../utils/currency';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface LineItemForm {
  key: string;
  lineType: 'inventory' | 'expense';
  description: string;
  taxRate: string;
  // inventory lines only
  productId: string;
  purchaseUnitOfMeasure: string;
  purchaseQuantity: string;
  purchaseUnitCost: string;
  stockUnitOfMeasure: string;
  stockQuantity: string;
  // expense lines only
  accountId: string;
  lineTotal: string;
}

let lineKeySeq = 0;
const newLine = (overrides?: Partial<LineItemForm>): LineItemForm => ({
  key: `l${++lineKeySeq}`,
  lineType: 'inventory',
  description: '',
  taxRate: '18',
  productId: '',
  purchaseUnitOfMeasure: '',
  purchaseQuantity: '1',
  purchaseUnitCost: '',
  stockUnitOfMeasure: '',
  stockQuantity: '',
  accountId: '',
  lineTotal: '',
  ...overrides,
});

const emptyCreateState = () => ({
  supplierId: '',
  warehouseIdNote: '', // resolved server-side via default warehouse if left blank
  vendorInvoiceNumber: '',
  issueDate: '',
  dueDate: '',
  notes: '',
  lines: [newLine()],
});

const STATUS_COLOR: Record<BillStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  received: 'info',
  partial: 'warning',
  paid: 'success',
  void: 'error',
};

const supplierLabel = (bill: Bill): string => {
  const s = bill.supplier;
  return s && typeof s === 'object' ? s.name : '—';
};

const lineComputed = (l: LineItemForm) => {
  const tax = Number(l.taxRate) || 0;
  let lineTotal = 0;
  if (l.lineType === 'inventory') {
    const qty = Number(l.purchaseQuantity) || 0;
    const cost = Number(l.purchaseUnitCost) || 0;
    lineTotal = round2(qty * cost);
  } else {
    lineTotal = round2(Number(l.lineTotal) || 0);
  }
  const taxAmount = round2(lineTotal * (tax / 100));
  return { lineTotal, taxAmount, total: round2(lineTotal + taxAmount) };
};

/**
 * `/accounting/bills` — AP bill list + lifecycle (create draft, edit, receive —
 * which adds stock for inventory lines via the shared receiveStock() path —
 * record payments, void), per PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 6.2.
 * Mirrors InvoicesContent.tsx's UI conventions; line items are discriminated
 * inventory/expense (§9.4) rather than product-only like Invoice's lines, and
 * there is no e-CF section — Bills never issue an electronic document.
 */
const BillsContent: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const canManage = usePermission('accounting.bills.manage');
  const canVoid = usePermission('accounting.bills.void');

  const [bills, setBills] = useState<Bill[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BillStatus | 'all'>('all');
  // Seeded from Reports' AP Aging tab ("click a row to view its bills") — cleared once
  // the user picks it off, same cross-page hand-off shape as CreditNotes' `invoiceId`.
  const [supplierFilter, setSupplierFilter] = useState<string | undefined>((location.state as { supplierId?: string } | null)?.supplierId);

  const [createOpen, setCreateOpen] = useState(false);
  const [createState, setCreateState] = useState(emptyCreateState());
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingBill, setEditingBill] = useState<Bill | null>(null);

  const [viewBill, setViewBill] = useState<Bill | null>(null);

  const [receiveTarget, setReceiveTarget] = useState<Bill | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);

  const [paymentTarget, setPaymentTarget] = useState<Bill | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash' as BillPaymentMethod, date: '', reference: '' });
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);

  const [voidTarget, setVoidTarget] = useState<Bill | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const [actionMenu, setActionMenu] = useState<{ anchorEl: HTMLElement | null; bill: Bill | null }>({ anchorEl: null, bill: null });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [billRes, supRes, prodRes, acctRes] = await Promise.all([
        billsService.getBills({ status: statusFilter === 'all' ? undefined : statusFilter, supplier: supplierFilter, limit: 200 }),
        suppliersService.getSuppliers({ active: true, limit: 200 }),
        productsService.getProducts({ active: true, purchasable: true }),
        accountsService.getAccounts({ active: true, type: 'expense' }),
      ]);
      setBills(Array.isArray(billRes.data.data) ? billRes.data.data : []);
      setSuppliers(Array.isArray(supRes.data.data) ? supRes.data.data : []);
      setProducts(Array.isArray(prodRes.data.data) ? prodRes.data.data : []);
      setAccounts(Array.isArray(acctRes.data.data) ? acctRes.data.data : []);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.bills.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, supplierFilter, t]);

  useEffect(() => { load(); }, [load]);

  // Clear the nav-carried supplierId out of history state once read (keeps the
  // local `supplierFilter` in effect, but a refresh/back-nav won't re-seed it).
  useEffect(() => {
    if ((location.state as { supplierId?: string } | null)?.supplierId) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const openCreate = () => {
    setEditingBill(null);
    setCreateState(emptyCreateState());
    setCreateError(null);
    setCreateOpen(true);
  };

  const openEdit = (bill: Bill) => {
    setEditingBill(bill);
    setCreateState({
      supplierId: bill.supplier && typeof bill.supplier === 'object' ? bill.supplier._id : (bill.supplier as string) || '',
      warehouseIdNote: '',
      vendorInvoiceNumber: bill.vendorInvoiceNumber || '',
      issueDate: bill.issueDate ? bill.issueDate.slice(0, 10) : '',
      dueDate: bill.dueDate ? bill.dueDate.slice(0, 10) : '',
      notes: bill.notes || '',
      lines: bill.lineItems.map(l => newLine({
        lineType: l.lineType,
        description: l.description,
        taxRate: String(l.taxRate),
        productId: l.product && typeof l.product === 'object' ? l.product._id : (l.product as string) || '',
        purchaseUnitOfMeasure: l.purchaseUnitOfMeasure || '',
        purchaseQuantity: l.purchaseQuantity !== undefined ? String(l.purchaseQuantity) : '1',
        purchaseUnitCost: l.purchaseUnitCost !== undefined ? String(l.purchaseUnitCost) : '',
        stockUnitOfMeasure: l.stockUnitOfMeasure || '',
        stockQuantity: l.stockQuantity !== undefined ? String(l.stockQuantity) : '',
        accountId: l.account && typeof l.account === 'object' ? l.account._id : (l.account as string) || '',
        lineTotal: l.lineType === 'expense' ? String(l.lineTotal) : '',
      })),
    });
    setCreateError(null);
    setCreateOpen(true);
  };

  const updateLine = (key: string, patch: Partial<LineItemForm>) => {
    setCreateState(s => ({ ...s, lines: s.lines.map(l => l.key === key ? { ...l, ...patch } : l) }));
  };

  const applyProductToLine = (key: string, productId: string) => {
    const product = products.find(p => p._id === productId);
    updateLine(key, {
      productId,
      description: product ? (product.description || product.name) : '',
      purchaseUnitOfMeasure: product ? product.unitOfMeasure : '',
      stockUnitOfMeasure: product ? product.unitOfMeasure : '',
      stockQuantity: '',
      purchaseUnitCost: product ? String(product.cost || '') : '',
    });
  };

  const addLine = (lineType: 'inventory' | 'expense') => setCreateState(s => ({ ...s, lines: [...s.lines, newLine({ lineType })] }));
  const removeLine = (key: string) => setCreateState(s => ({ ...s, lines: s.lines.length > 1 ? s.lines.filter(l => l.key !== key) : s.lines }));

  const totals = useMemo(() => {
    let subtotal = 0, taxAmount = 0;
    for (const l of createState.lines) {
      const c = lineComputed(l);
      subtotal += c.lineTotal;
      taxAmount += c.taxAmount;
    }
    return { subtotal: round2(subtotal), taxAmount: round2(taxAmount), total: round2(subtotal + taxAmount) };
  }, [createState.lines]);

  const handleSave = async () => {
    setCreateError(null);
    if (!createState.supplierId) { setCreateError(t('accounting.bills.form.supplierRequired')); return; }

    const lineItems: BillLineItemInput[] = [];
    for (const l of createState.lines) {
      const taxRate = Number(l.taxRate) || 0;
      if (l.lineType === 'inventory') {
        if (!l.productId) { setCreateError(t('accounting.bills.form.lineProductRequired')); return; }
        const purchaseQuantity = Number(l.purchaseQuantity);
        if (!purchaseQuantity || purchaseQuantity <= 0) { setCreateError(t('accounting.bills.form.linePurchaseQuantityRequired')); return; }
        if (!l.purchaseUnitOfMeasure) { setCreateError(t('accounting.bills.form.linePurchaseUomRequired')); return; }
        const purchaseUnitCost = Number(l.purchaseUnitCost);
        if (l.purchaseUnitCost === '' || purchaseUnitCost < 0) { setCreateError(t('accounting.bills.form.linePurchaseCostRequired')); return; }
        const stockQuantity = Number(l.stockQuantity);
        if (!stockQuantity || stockQuantity <= 0) { setCreateError(t('accounting.bills.form.lineStockQuantityRequired')); return; }
        lineItems.push({
          lineType: 'inventory',
          description: l.description.trim() || undefined,
          taxRate,
          product: l.productId,
          purchaseUnitOfMeasure: l.purchaseUnitOfMeasure,
          purchaseQuantity,
          purchaseUnitCost,
          stockUnitOfMeasure: l.stockUnitOfMeasure,
          stockQuantity,
        });
      } else {
        if (!l.description.trim()) { setCreateError(t('accounting.bills.form.lineDescriptionRequired')); return; }
        if (!l.accountId) { setCreateError(t('accounting.bills.form.lineAccountRequired')); return; }
        const lineTotal = Number(l.lineTotal);
        if (l.lineTotal === '' || lineTotal < 0) { setCreateError(t('accounting.bills.form.lineTotalRequired')); return; }
        lineItems.push({
          lineType: 'expense',
          description: l.description.trim(),
          taxRate,
          account: l.accountId,
          lineTotal,
        });
      }
    }

    setSaving(true);
    try {
      const payload = {
        supplier: createState.supplierId,
        vendorInvoiceNumber: createState.vendorInvoiceNumber.trim() || undefined,
        issueDate: createState.issueDate || undefined,
        dueDate: createState.dueDate || undefined,
        notes: createState.notes || undefined,
        lineItems,
      };
      if (editingBill) {
        await billsService.updateBill(editingBill._id, payload);
      } else {
        await billsService.createBill(payload as any);
      }
      setCreateOpen(false);
      load();
    } catch (e: any) {
      setCreateError(e.response?.data?.message || t('accounting.bills.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (bill: Bill) => {
    try {
      const res = await billsService.getBill(bill._id);
      setViewBill(res.data.data as Bill);
    } catch {
      setViewBill(bill);
    }
  };

  const handleReceive = async () => {
    if (!receiveTarget) return;
    setReceiving(true);
    setReceiveError(null);
    try {
      await billsService.receiveBill(receiveTarget._id);
      setReceiveTarget(null);
      load();
    } catch (e: any) {
      setReceiveError(e.response?.data?.message || t('accounting.bills.messages.receiveFailed'));
    } finally {
      setReceiving(false);
    }
  };

  const openPayment = (bill: Bill) => {
    setPaymentTarget(bill);
    setPaymentForm({ amount: '', method: 'cash', date: '', reference: '' });
    setPaymentError(null);
  };

  const handleRecordPayment = async () => {
    if (!paymentTarget) return;
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) { setPaymentError(t('accounting.bills.form.paymentAmountRequired')); return; }
    setRecordingPayment(true);
    setPaymentError(null);
    try {
      await billsService.recordPayment(paymentTarget._id, {
        amount,
        method: paymentForm.method,
        date: paymentForm.date || undefined,
        reference: paymentForm.reference || undefined,
      });
      setPaymentTarget(null);
      load();
    } catch (e: any) {
      setPaymentError(e.response?.data?.message || t('accounting.bills.messages.paymentFailed'));
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await billsService.voidBill(voidTarget._id);
      setVoidTarget(null);
      load();
    } catch (e: any) {
      setVoidError(e.response?.data?.message || t('accounting.bills.messages.voidFailed'));
    } finally {
      setVoiding(false);
    }
  };

  const uomOptions = UNIT_OF_MEASURE_CODES.map(code => (
    <MenuItem key={code} value={code}>{t(`accounting.inventory.uom.${code}`)}</MenuItem>
  ));

  if (loading && bills.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>{t('accounting.bills.loading')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('accounting.bills.table.status')}</InputLabel>
            <Select value={statusFilter} label={t('accounting.bills.table.status')} onChange={(e) => setStatusFilter(e.target.value as BillStatus | 'all')}>
              <MenuItem value="all">{t('common.all', 'All')}</MenuItem>
              <MenuItem value="draft">{t('accounting.bills.status.draft')}</MenuItem>
              <MenuItem value="received">{t('accounting.bills.status.received')}</MenuItem>
              <MenuItem value="partial">{t('accounting.bills.status.partial')}</MenuItem>
              <MenuItem value="paid">{t('accounting.bills.status.paid')}</MenuItem>
              <MenuItem value="void">{t('accounting.bills.status.void')}</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>{t('accounting.reports.aging.supplier', 'Supplier')}</InputLabel>
            <Select value={supplierFilter || ''} label={t('accounting.reports.aging.supplier', 'Supplier')} onChange={(e) => setSupplierFilter(e.target.value || undefined)}>
              <MenuItem value="">{t('common.all', 'All')}</MenuItem>
              {suppliers.map((s) => <MenuItem key={s._id} value={s._id}>{s.name}</MenuItem>)}
            </Select>
          </FormControl>
          {canManage && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ ml: 'auto' }}>
              {t('accounting.bills.actions.create')}
            </Button>
          )}
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.bills.table.number')}</TableCell>
                <TableCell>{t('accounting.bills.table.supplier')}</TableCell>
                <TableCell>{t('accounting.bills.table.issueDate')}</TableCell>
                <TableCell>{t('accounting.bills.table.dueDate')}</TableCell>
                <TableCell align="right">{t('accounting.bills.table.total')}</TableCell>
                <TableCell align="right">{t('accounting.bills.table.balanceDue')}</TableCell>
                <TableCell>{t('accounting.bills.table.status')}</TableCell>
                <TableCell align="right">{t('accounting.bills.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {bills.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center">{t('accounting.bills.empty')}</TableCell></TableRow>
              ) : bills.map(bill => (
                <TableRow key={bill._id} hover>
                  <TableCell>
                    <Typography component="span" fontWeight={600} sx={{ cursor: 'pointer' }} onClick={() => openView(bill)}>
                      {bill.billNumber}
                    </Typography>
                  </TableCell>
                  <TableCell>{supplierLabel(bill)}</TableCell>
                  <TableCell>{new Date(bill.issueDate).toLocaleDateString()}</TableCell>
                  <TableCell>{new Date(bill.dueDate).toLocaleDateString()}</TableCell>
                  <TableCell align="right">{formatMoney(bill.total)}</TableCell>
                  <TableCell align="right">{formatMoney(bill.balanceDue)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={t(`accounting.bills.status.${bill.status}`)} color={STATUS_COLOR[bill.status]} />
                    {bill.isOverdue && <Chip size="small" label={t('accounting.bills.status.overdue')} color="error" variant="outlined" sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('accounting.bills.actions.view')}>
                      <IconButton size="small" onClick={() => openView(bill)}><VisibilityIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {canManage && (
                      <IconButton size="small" onClick={(e) => setActionMenu({ anchorEl: e.currentTarget, bill })}>
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Row action menu */}
      <Menu anchorEl={actionMenu.anchorEl} open={Boolean(actionMenu.anchorEl)} onClose={() => setActionMenu({ anchorEl: null, bill: null })}>
        {actionMenu.bill?.status === 'draft' && [
          <MenuItem key="edit" onClick={() => { const b = actionMenu.bill!; setActionMenu({ anchorEl: null, bill: null }); openEdit(b); }}>
            <ListItemIcon><VisibilityIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.bills.actions.edit')}</ListItemText>
          </MenuItem>,
          <MenuItem key="receive" onClick={() => { const b = actionMenu.bill!; setActionMenu({ anchorEl: null, bill: null }); setReceiveError(null); setReceiveTarget(b); }}>
            <ListItemIcon><Inventory2Icon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.bills.actions.receive')}</ListItemText>
          </MenuItem>,
        ]}
        {(actionMenu.bill?.status === 'received' || actionMenu.bill?.status === 'partial') && (
          <MenuItem onClick={() => { const b = actionMenu.bill!; setActionMenu({ anchorEl: null, bill: null }); openPayment(b); }}>
            <ListItemIcon><PaymentIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.bills.actions.recordPayment')}</ListItemText>
          </MenuItem>
        )}
        {canVoid && actionMenu.bill && actionMenu.bill.status !== 'void' && actionMenu.bill.amountPaid === 0 && (
          <MenuItem onClick={() => { const b = actionMenu.bill!; setActionMenu({ anchorEl: null, bill: null }); setVoidError(null); setVoidTarget(b); }} sx={{ color: 'error.main' }}>
            <ListItemIcon><BlockIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>{t('accounting.bills.actions.void')}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Create / Edit draft dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingBill ? t('accounting.bills.dialog.editTitle', { number: editingBill.billNumber }) : t('accounting.bills.dialog.createTitle')}</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <FormControl fullWidth required>
              <InputLabel>{t('accounting.bills.form.supplier')}</InputLabel>
              <Select value={createState.supplierId} label={t('accounting.bills.form.supplier')} onChange={(e) => setCreateState(s => ({ ...s, supplierId: e.target.value }))}>
                {suppliers.map(s => <MenuItem key={s._id} value={s._id}>{s.name}{s.taxId ? ` (${s.taxId})` : ''}</MenuItem>)}
              </Select>
            </FormControl>

            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr 1fr' } }}>
              <TextField label={t('accounting.bills.form.vendorInvoiceNumber')} value={createState.vendorInvoiceNumber} onChange={(e) => setCreateState(s => ({ ...s, vendorInvoiceNumber: e.target.value }))} />
              <TextField label={t('accounting.bills.table.issueDate')} type="date" InputLabelProps={{ shrink: true }} value={createState.issueDate} onChange={(e) => setCreateState(s => ({ ...s, issueDate: e.target.value }))} />
              <TextField label={t('accounting.bills.table.dueDate')} type="date" InputLabelProps={{ shrink: true }} value={createState.dueDate} onChange={(e) => setCreateState(s => ({ ...s, dueDate: e.target.value }))} helperText={t('accounting.bills.form.dueDateHelp')} />
            </Box>

            <Divider />
            <Typography variant="subtitle2">{t('accounting.bills.form.lineItems')}</Typography>

            {createState.lines.map((l) => {
              const computed = lineComputed(l);
              return (
                <Paper key={l.key} variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                    <ToggleButtonGroup exclusive size="small" value={l.lineType} onChange={(_, v) => { if (v) updateLine(l.key, { lineType: v }); }}>
                      <ToggleButton value="inventory">{t('accounting.bills.form.lineTypeInventory')}</ToggleButton>
                      <ToggleButton value="expense">{t('accounting.bills.form.lineTypeExpense')}</ToggleButton>
                    </ToggleButtonGroup>
                    <IconButton size="small" onClick={() => removeLine(l.key)} disabled={createState.lines.length === 1}><DeleteIcon fontSize="small" /></IconButton>
                  </Box>

                  {l.lineType === 'inventory' ? (
                    <>
                      <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
                        <InputLabel>{t('accounting.bills.form.product')}</InputLabel>
                        <Select value={l.productId} label={t('accounting.bills.form.product')} onChange={(e) => applyProductToLine(l.key, e.target.value)}>
                          {products.map(p => <MenuItem key={p._id} value={p._id}>{p.name}</MenuItem>)}
                        </Select>
                      </FormControl>
                      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(3, 1fr)' }}>
                        <FormControl size="small">
                          <InputLabel>{t('accounting.bills.form.purchaseUom')}</InputLabel>
                          <Select value={l.purchaseUnitOfMeasure} label={t('accounting.bills.form.purchaseUom')} onChange={(e) => updateLine(l.key, { purchaseUnitOfMeasure: e.target.value })}>
                            {uomOptions}
                          </Select>
                        </FormControl>
                        <TextField size="small" type="number" label={t('accounting.bills.form.purchaseQuantity')} value={l.purchaseQuantity} onChange={(e) => updateLine(l.key, { purchaseQuantity: e.target.value })} inputProps={{ min: 0 }} required />
                        <TextField size="small" type="number" label={t('accounting.bills.form.purchaseUnitCost')} value={l.purchaseUnitCost} onChange={(e) => updateLine(l.key, { purchaseUnitCost: e.target.value })} inputProps={{ min: 0 }} required />
                      </Box>
                      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(3, 1fr)', mt: 1.5 }}>
                        <TextField size="small" label={t('accounting.bills.form.stockUom')} value={l.stockUnitOfMeasure ? t(`accounting.inventory.uom.${l.stockUnitOfMeasure}`) : ''} disabled helperText={t('accounting.bills.form.stockUomHelp')} />
                        <TextField size="small" type="number" label={t('accounting.bills.form.stockQuantity')} value={l.stockQuantity} onChange={(e) => updateLine(l.key, { stockQuantity: e.target.value })} inputProps={{ min: 0 }} required />
                        <TextField size="small" type="number" label={t('accounting.invoices.form.taxRate')} value={l.taxRate} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} inputProps={{ min: 0, max: 100 }} />
                      </Box>
                    </>
                  ) : (
                    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
                      <TextField size="small" label={t('accounting.invoices.form.description')} value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} required fullWidth />
                      <FormControl fullWidth size="small">
                        <InputLabel>{t('accounting.bills.form.account')}</InputLabel>
                        <Select value={l.accountId} label={t('accounting.bills.form.account')} onChange={(e) => updateLine(l.key, { accountId: e.target.value })}>
                          {accounts.map(a => <MenuItem key={a._id} value={a._id}>{a.code} — {a.name}</MenuItem>)}
                        </Select>
                      </FormControl>
                      <TextField size="small" type="number" label={t('accounting.bills.form.lineTotal')} value={l.lineTotal} onChange={(e) => updateLine(l.key, { lineTotal: e.target.value })} inputProps={{ min: 0 }} required />
                      <TextField size="small" type="number" label={t('accounting.invoices.form.taxRate')} value={l.taxRate} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} inputProps={{ min: 0, max: 100 }} />
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
                    <Typography variant="body2" fontWeight={600}>{formatMoney(computed.total)}</Typography>
                  </Box>
                </Paper>
              );
            })}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" startIcon={<AddIcon />} onClick={() => addLine('inventory')}>{t('accounting.bills.form.addInventoryLine')}</Button>
              <Button size="small" startIcon={<AddIcon />} onClick={() => addLine('expense')}>{t('accounting.bills.form.addExpenseLine')}</Button>
            </Box>

            <TextField label={t('common.notes', 'Notes')} value={createState.notes} onChange={(e) => setCreateState(s => ({ ...s, notes: e.target.value }))} multiline minRows={2} />

            <Paper variant="outlined" sx={{ p: 2, ml: 'auto', minWidth: 260 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.subtotal')}</Typography><Typography variant="body2">{formatMoney(totals.subtotal)}</Typography></Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.tax')}</Typography><Typography variant="body2">{formatMoney(totals.taxAmount)}</Typography></Box>
              <Divider sx={{ my: 0.5 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography fontWeight={700}>{t('accounting.invoices.table.total')}</Typography><Typography fontWeight={700}>{formatMoney(totals.total)}</Typography></Box>
            </Paper>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={18} /> : t('common.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewBill} onClose={() => setViewBill(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{viewBill?.billNumber}</DialogTitle>
        <DialogContent>
          {viewBill && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1" fontWeight={600}>{supplierLabel(viewBill)}</Typography>
                <Chip size="small" label={t(`accounting.bills.status.${viewBill.status}`)} color={STATUS_COLOR[viewBill.status]} />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t('accounting.bills.table.issueDate')}: {new Date(viewBill.issueDate).toLocaleDateString()}
                {' · '}{t('accounting.bills.table.dueDate')}: {new Date(viewBill.dueDate).toLocaleDateString()}
                {viewBill.vendorInvoiceNumber ? ` · ${t('accounting.bills.form.vendorInvoiceNumber')}: ${viewBill.vendorInvoiceNumber}` : ''}
              </Typography>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('accounting.invoices.form.description')}</TableCell>
                      <TableCell align="right">{t('accounting.invoices.form.taxRate')}</TableCell>
                      <TableCell align="right">{t('accounting.invoices.table.total')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {viewBill.lineItems.map((l, i) => (
                      <TableRow key={l._id || i}>
                        <TableCell>
                          {l.description}
                          {l.lineType === 'inventory' && l.purchaseQuantity !== undefined && (
                            <Typography variant="caption" display="block" color="text.secondary">
                              {l.purchaseQuantity} {l.purchaseUnitOfMeasure} × {formatMoney(l.purchaseUnitCost)}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{l.taxRate}%</TableCell>
                        <TableCell align="right">{formatMoney(l.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ display: 'grid', gap: 0.5, ml: 'auto', minWidth: 220 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.subtotal')}</Typography><Typography variant="body2">{formatMoney(viewBill.subtotal)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.tax')}</Typography><Typography variant="body2">{formatMoney(viewBill.taxAmount)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography fontWeight={700}>{t('accounting.invoices.table.total')}</Typography><Typography fontWeight={700}>{formatMoney(viewBill.total)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.amountPaid')}</Typography><Typography variant="body2">{formatMoney(viewBill.amountPaid)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2" fontWeight={600}>{t('accounting.invoices.table.balanceDue')}</Typography><Typography variant="body2" fontWeight={600}>{formatMoney(viewBill.balanceDue)}</Typography></Box>
              </Box>

              {viewBill.payments.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('accounting.invoices.dialog.paymentsTitle')}</Typography>
                  {viewBill.payments.map((p, i) => (
                    <Box key={p._id || i} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <Typography variant="body2">{new Date(p.date).toLocaleDateString()} · {t(`accounting.bills.paymentMethod.${p.method}`)}{p.reference ? ` (${p.reference})` : ''}</Typography>
                      <Typography variant="body2">{formatMoney(p.amount)}</Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewBill(null)}>{t('common.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Receive confirmation */}
      <Dialog open={!!receiveTarget} onClose={() => setReceiveTarget(null)} maxWidth="xs">
        <DialogTitle>{t('accounting.bills.dialog.receiveConfirmTitle')}</DialogTitle>
        <DialogContent>
          {receiveError && <Alert severity="error" sx={{ mb: 2 }}>{receiveError}</Alert>}
          <Typography variant="body2">{t('accounting.bills.dialog.receiveConfirmBody', { number: receiveTarget?.billNumber })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReceiveTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleReceive} disabled={receiving}>
            {receiving ? <CircularProgress size={18} /> : t('accounting.bills.actions.receive')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record payment */}
      <Dialog open={!!paymentTarget} onClose={() => setPaymentTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.bills.dialog.paymentTitle', { number: paymentTarget?.billNumber })}</DialogTitle>
        <DialogContent>
          {paymentError && <Alert severity="error" sx={{ mb: 2 }}>{paymentError}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('accounting.invoices.table.balanceDue')}: {formatMoney(paymentTarget?.balanceDue)}
          </Typography>
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField label={t('accounting.invoices.form.paymentAmount')} type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm(f => ({ ...f, amount: e.target.value }))} required inputProps={{ min: 0, step: 0.01 }} />
            <FormControl fullWidth>
              <InputLabel>{t('accounting.invoices.form.paymentMethod')}</InputLabel>
              <Select value={paymentForm.method} label={t('accounting.invoices.form.paymentMethod')} onChange={(e) => setPaymentForm(f => ({ ...f, method: e.target.value as BillPaymentMethod }))}>
                <MenuItem value="cash">{t('accounting.bills.paymentMethod.cash')}</MenuItem>
                <MenuItem value="card">{t('accounting.bills.paymentMethod.card')}</MenuItem>
                <MenuItem value="transfer">{t('accounting.bills.paymentMethod.transfer')}</MenuItem>
                <MenuItem value="check">{t('accounting.bills.paymentMethod.check')}</MenuItem>
                <MenuItem value="other">{t('accounting.bills.paymentMethod.other')}</MenuItem>
              </Select>
            </FormControl>
            <TextField label={t('accounting.invoices.form.paymentReference')} value={paymentForm.reference} onChange={(e) => setPaymentForm(f => ({ ...f, reference: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleRecordPayment} disabled={recordingPayment}>
            {recordingPayment ? <CircularProgress size={18} /> : t('accounting.bills.actions.recordPayment')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Void confirmation */}
      <Dialog open={!!voidTarget} onClose={() => setVoidTarget(null)} maxWidth="xs">
        <DialogTitle>{t('accounting.bills.dialog.voidConfirmTitle')}</DialogTitle>
        <DialogContent>
          {voidError && <Alert severity="error" sx={{ mb: 2 }}>{voidError}</Alert>}
          <Typography variant="body2">{t('accounting.bills.dialog.voidConfirmBody', { number: voidTarget?.billNumber })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleVoid} disabled={voiding}>
            {voiding ? <CircularProgress size={18} /> : t('accounting.bills.actions.void')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BillsContent;
