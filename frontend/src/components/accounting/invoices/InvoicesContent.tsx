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
import SendIcon from '@mui/icons-material/Send';
import PaymentIcon from '@mui/icons-material/Payment';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import PostAddIcon from '@mui/icons-material/PostAdd';
import BlockIcon from '@mui/icons-material/Block';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePermission } from '../../../lib/permissions';
import { invoicesService, accountingCustomersService, productsService, InvoiceLineItemInput } from '../../../services/api';
import { Invoice, InvoiceStatus, InvoicePaymentMethod, Customer, Product, ElectronicInvoice } from '../../../types';
import { formatMoney } from '../../../utils/currency';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface LineItemForm {
  key: string;
  description: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
}

let lineKeySeq = 0;
const newLine = (overrides?: Partial<LineItemForm>): LineItemForm => ({
  key: `l${++lineKeySeq}`,
  description: '',
  productId: '',
  quantity: '1',
  unitPrice: '',
  discountPercent: '0',
  taxRate: '18',
  ...overrides,
});

const emptyCreateState = () => ({
  customerMode: 'company' as 'company' | 'individual',
  companyId: '',
  individualName: '',
  individualEmail: '',
  individualPhone: '',
  dueDate: '',
  notes: '',
  lines: [newLine()],
});

const STATUS_COLOR: Record<InvoiceStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  sent: 'info',
  partial: 'warning',
  paid: 'success',
  void: 'error',
};

const customerLabel = (inv: Invoice): string => {
  if (inv.isIndividual) return inv.individualCustomer?.name || '—';
  const c = inv.customer;
  return c && typeof c === 'object' ? c.name : '—';
};

const lineComputed = (l: LineItemForm) => {
  const qty = Number(l.quantity) || 0;
  const price = Number(l.unitPrice) || 0;
  const disc = Number(l.discountPercent) || 0;
  const tax = Number(l.taxRate) || 0;
  const lineTotal = round2(qty * price * (1 - disc / 100));
  const taxAmount = round2(lineTotal * (tax / 100));
  return { lineTotal, taxAmount, total: round2(lineTotal + taxAmount) };
};

/**
 * `/accounting/invoices` — AR invoice list + lifecycle (create draft, edit,
 * send through the e-CF pipeline, record payments, void), per
 * PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5.2. Line items carry their
 * own tax rate/discount (§9.1/§9.2) — no invoice-level flat rate.
 */
const InvoicesContent: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const canManage = usePermission('accounting.invoices.manage');
  const canVoid = usePermission('accounting.invoices.void');

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  // Seeded from Reports' AR Aging tab ("click a row to view its invoices") — same
  // cross-page hand-off shape as `openInvoiceId` below, distinct state key so the two
  // never collide.
  const [customerFilter, setCustomerFilter] = useState<string | undefined>((location.state as { customerId?: string } | null)?.customerId);

  const [createOpen, setCreateOpen] = useState(false);
  const [createState, setCreateState] = useState(emptyCreateState());
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);

  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);

  const [sendTarget, setSendTarget] = useState<Invoice | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [paymentTarget, setPaymentTarget] = useState<Invoice | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash' as InvoicePaymentMethod, date: '', reference: '' });
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);

  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const [actionMenu, setActionMenu] = useState<{ anchorEl: HTMLElement | null; invoice: Invoice | null }>({ anchorEl: null, invoice: null });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [invRes, custRes, prodRes] = await Promise.all([
        invoicesService.getInvoices({ status: statusFilter === 'all' ? undefined : statusFilter, customer: customerFilter, limit: 200 }),
        accountingCustomersService.getCustomers({ active: true, limit: 200 }),
        productsService.getProducts({ active: true, sellable: true }),
      ]);
      setInvoices(Array.isArray(invRes.data.data) ? invRes.data.data : []);
      setCustomers(Array.isArray(custRes.data.data) ? custRes.data.data : []);
      setProducts(Array.isArray(prodRes.data.data) ? prodRes.data.data : []);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.invoices.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, customerFilter, t]);

  useEffect(() => { load(); }, [load]);

  // Clear the nav-carried customerId out of history state once read (keeps the
  // local `customerFilter` in effect, but a refresh/back-nav won't re-seed it).
  useEffect(() => {
    if ((location.state as { customerId?: string } | null)?.customerId) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const openCreate = () => {
    setEditingInvoice(null);
    setCreateState(emptyCreateState());
    setCreateError(null);
    setCreateOpen(true);
  };

  const openEdit = (inv: Invoice) => {
    setEditingInvoice(inv);
    setCreateState({
      customerMode: inv.isIndividual ? 'individual' : 'company',
      companyId: !inv.isIndividual && inv.customer && typeof inv.customer === 'object' ? inv.customer._id : (typeof inv.customer === 'string' ? inv.customer : ''),
      individualName: inv.individualCustomer?.name || '',
      individualEmail: inv.individualCustomer?.email || '',
      individualPhone: inv.individualCustomer?.phone || '',
      dueDate: inv.dueDate ? inv.dueDate.slice(0, 10) : '',
      notes: inv.notes || '',
      lines: inv.lineItems.map(l => newLine({
        description: l.description,
        productId: l.product && typeof l.product === 'object' ? l.product._id : (l.product as string) || '',
        quantity: String(l.quantity),
        unitPrice: String(l.unitPrice),
        discountPercent: String(l.discountPercent),
        taxRate: String(l.taxRate),
      })),
    });
    setCreateError(null);
    setCreateOpen(true);
  };

  // Deep-link support: QuotesContent's "Convert to Invoice" navigates here with
  // { openInvoiceId } so the newly-created draft invoice opens pre-filled and
  // editable immediately, per Phase 5.4's "Done when". Cleared from history state
  // right after opening so a later back/refresh doesn't reopen it.
  useEffect(() => {
    const openInvoiceId = (location.state as { openInvoiceId?: string } | null)?.openInvoiceId;
    if (openInvoiceId && invoices.length > 0) {
      const inv = invoices.find(i => i._id === openInvoiceId);
      if (inv) {
        openEdit(inv);
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, location.state]);

  const updateLine = (key: string, patch: Partial<LineItemForm>) => {
    setCreateState(s => ({ ...s, lines: s.lines.map(l => l.key === key ? { ...l, ...patch } : l) }));
  };

  const applyProductToLine = (key: string, productId: string) => {
    const product = products.find(p => p._id === productId);
    updateLine(key, {
      productId,
      description: product ? product.name : '',
      unitPrice: product ? String(product.defaultUnitPrice) : '',
    });
  };

  const addLine = () => setCreateState(s => ({ ...s, lines: [...s.lines, newLine()] }));
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
    if (createState.customerMode === 'company' && !createState.companyId) {
      setCreateError(t('accounting.invoices.form.customerRequired')); return;
    }
    if (createState.customerMode === 'individual' && !createState.individualName.trim()) {
      setCreateError(t('accounting.invoices.form.individualNameRequired')); return;
    }
    const lineItems: InvoiceLineItemInput[] = [];
    for (const l of createState.lines) {
      if (!l.description.trim()) { setCreateError(t('accounting.invoices.form.lineDescriptionRequired')); return; }
      const quantity = Number(l.quantity);
      if (!quantity || quantity <= 0) { setCreateError(t('accounting.invoices.form.lineQuantityRequired')); return; }
      const unitPrice = Number(l.unitPrice);
      if (l.unitPrice === '' || unitPrice < 0) { setCreateError(t('accounting.invoices.form.lineUnitPriceRequired')); return; }
      lineItems.push({
        description: l.description.trim(),
        product: l.productId || undefined,
        quantity,
        unitPrice,
        discountPercent: Number(l.discountPercent) || 0,
        taxRate: Number(l.taxRate) || 0,
      });
    }

    setSaving(true);
    try {
      const payload = {
        customer: createState.customerMode === 'company' ? createState.companyId : undefined,
        isIndividual: createState.customerMode === 'individual',
        individualCustomer: createState.customerMode === 'individual' ? {
          name: createState.individualName.trim(),
          email: createState.individualEmail.trim() || undefined,
          phone: createState.individualPhone.trim() || undefined,
        } : undefined,
        dueDate: createState.dueDate || undefined,
        notes: createState.notes || undefined,
        lineItems,
      };
      if (editingInvoice) {
        await invoicesService.updateInvoice(editingInvoice._id, payload);
      } else {
        await invoicesService.createInvoice(payload);
      }
      setCreateOpen(false);
      load();
    } catch (e: any) {
      setCreateError(e.response?.data?.message || t('accounting.invoices.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (inv: Invoice) => {
    try {
      const res = await invoicesService.getInvoice(inv._id);
      setViewInvoice(res.data.data as Invoice);
    } catch {
      setViewInvoice(inv);
    }
  };

  const handleSend = async () => {
    if (!sendTarget) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await invoicesService.sendInvoice(sendTarget._id);
      setSendTarget(null);
      await load();
      if (res.data.data) setViewInvoice(res.data.data.invoice);
    } catch (e: any) {
      setSendError(e.response?.data?.message || t('accounting.invoices.messages.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  const openPayment = (inv: Invoice) => {
    setPaymentTarget(inv);
    setPaymentForm({ amount: '', method: 'cash', date: '', reference: '' });
    setPaymentError(null);
  };

  const handleRecordPayment = async () => {
    if (!paymentTarget) return;
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) { setPaymentError(t('accounting.invoices.form.paymentAmountRequired')); return; }
    setRecordingPayment(true);
    setPaymentError(null);
    try {
      await invoicesService.recordPayment(paymentTarget._id, {
        amount,
        method: paymentForm.method,
        date: paymentForm.date || undefined,
        reference: paymentForm.reference || undefined,
      });
      setPaymentTarget(null);
      load();
    } catch (e: any) {
      setPaymentError(e.response?.data?.message || t('accounting.invoices.messages.paymentFailed'));
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await invoicesService.voidInvoice(voidTarget._id);
      setVoidTarget(null);
      load();
    } catch (e: any) {
      setVoidError(e.response?.data?.message || t('accounting.invoices.messages.voidFailed'));
    } finally {
      setVoiding(false);
    }
  };

  const electronicInvoiceOf = (inv: Invoice | null): ElectronicInvoice | null =>
    inv?.electronicInvoiceId && typeof inv.electronicInvoiceId === 'object' ? inv.electronicInvoiceId : null;

  if (loading && invoices.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>{t('accounting.invoices.loading')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('accounting.invoices.table.status')}</InputLabel>
            <Select value={statusFilter} label={t('accounting.invoices.table.status')} onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'all')}>
              <MenuItem value="all">{t('common.all', 'All')}</MenuItem>
              <MenuItem value="draft">{t('accounting.invoices.status.draft')}</MenuItem>
              <MenuItem value="sent">{t('accounting.invoices.status.sent')}</MenuItem>
              <MenuItem value="partial">{t('accounting.invoices.status.partial')}</MenuItem>
              <MenuItem value="paid">{t('accounting.invoices.status.paid')}</MenuItem>
              <MenuItem value="void">{t('accounting.invoices.status.void')}</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>{t('accounting.reports.aging.customer', 'Customer')}</InputLabel>
            <Select value={customerFilter || ''} label={t('accounting.reports.aging.customer', 'Customer')} onChange={(e) => setCustomerFilter(e.target.value || undefined)}>
              <MenuItem value="">{t('common.all', 'All')}</MenuItem>
              {customers.map((c) => <MenuItem key={c._id} value={c._id}>{c.razonSocial || c.name}</MenuItem>)}
            </Select>
          </FormControl>
          {canManage && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ ml: 'auto' }}>
              {t('accounting.invoices.actions.create')}
            </Button>
          )}
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.invoices.table.number')}</TableCell>
                <TableCell>{t('accounting.invoices.table.customer')}</TableCell>
                <TableCell>{t('accounting.invoices.table.issueDate')}</TableCell>
                <TableCell align="right">{t('accounting.invoices.table.total')}</TableCell>
                <TableCell align="right">{t('accounting.invoices.table.balanceDue')}</TableCell>
                <TableCell>{t('accounting.invoices.table.status')}</TableCell>
                <TableCell align="right">{t('accounting.invoices.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center">{t('accounting.invoices.empty')}</TableCell></TableRow>
              ) : invoices.map(inv => (
                <TableRow key={inv._id} hover>
                  <TableCell>
                    <Typography component="span" fontWeight={600} sx={{ cursor: 'pointer' }} onClick={() => openView(inv)}>
                      {inv.invoiceNumber}
                    </Typography>
                  </TableCell>
                  <TableCell>{customerLabel(inv)}</TableCell>
                  <TableCell>{new Date(inv.issueDate).toLocaleDateString()}</TableCell>
                  <TableCell align="right">{formatMoney(inv.total)}</TableCell>
                  <TableCell align="right">{formatMoney(inv.balanceDue)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={t(`accounting.invoices.status.${inv.status}`)} color={STATUS_COLOR[inv.status]} />
                    {inv.isOverdue && <Chip size="small" label={t('accounting.invoices.status.overdue')} color="error" variant="outlined" sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('accounting.invoices.actions.view')}>
                      <IconButton size="small" onClick={() => openView(inv)}><VisibilityIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {canManage && (
                      <IconButton size="small" onClick={(e) => setActionMenu({ anchorEl: e.currentTarget, invoice: inv })}>
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
      <Menu anchorEl={actionMenu.anchorEl} open={Boolean(actionMenu.anchorEl)} onClose={() => setActionMenu({ anchorEl: null, invoice: null })}>
        {actionMenu.invoice?.status === 'draft' && [
          <MenuItem key="edit" onClick={() => { const inv = actionMenu.invoice!; setActionMenu({ anchorEl: null, invoice: null }); openEdit(inv); }}>
            <ListItemIcon><VisibilityIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.invoices.actions.edit')}</ListItemText>
          </MenuItem>,
          <MenuItem key="send" onClick={() => { const inv = actionMenu.invoice!; setActionMenu({ anchorEl: null, invoice: null }); setSendError(null); setSendTarget(inv); }}>
            <ListItemIcon><SendIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.invoices.actions.send')}</ListItemText>
          </MenuItem>,
        ]}
        {(actionMenu.invoice?.status === 'sent' || actionMenu.invoice?.status === 'partial') && (
          <MenuItem onClick={() => { const inv = actionMenu.invoice!; setActionMenu({ anchorEl: null, invoice: null }); openPayment(inv); }}>
            <ListItemIcon><PaymentIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.invoices.actions.recordPayment')}</ListItemText>
          </MenuItem>
        )}
        {actionMenu.invoice && ['sent', 'partial', 'paid'].includes(actionMenu.invoice.status) && [
          <MenuItem key="credit-note" onClick={() => { const inv = actionMenu.invoice!; setActionMenu({ anchorEl: null, invoice: null }); navigate('/accounting/credit-notes', { state: { invoiceId: inv._id } }); }}>
            <ListItemIcon><AssignmentReturnIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.invoices.actions.issueCreditNote')}</ListItemText>
          </MenuItem>,
          <MenuItem key="debit-note" onClick={() => { const inv = actionMenu.invoice!; setActionMenu({ anchorEl: null, invoice: null }); navigate('/accounting/debit-notes', { state: { debitNoteInvoiceId: inv._id } }); }}>
            <ListItemIcon><PostAddIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.invoices.actions.issueDebitNote')}</ListItemText>
          </MenuItem>,
        ]}
        {canVoid && actionMenu.invoice && actionMenu.invoice.status !== 'void' && actionMenu.invoice.amountPaid === 0 && (
          <MenuItem onClick={() => { const inv = actionMenu.invoice!; setActionMenu({ anchorEl: null, invoice: null }); setVoidError(null); setVoidTarget(inv); }} sx={{ color: 'error.main' }}>
            <ListItemIcon><BlockIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>{t('accounting.invoices.actions.void')}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Create / Edit draft dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingInvoice ? t('accounting.invoices.dialog.editTitle', { number: editingInvoice.invoiceNumber }) : t('accounting.invoices.dialog.createTitle')}</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <ToggleButtonGroup exclusive size="small" value={createState.customerMode} onChange={(_, v) => { if (v) setCreateState(s => ({ ...s, customerMode: v })); }}>
              <ToggleButton value="company">{t('accounting.invoices.form.customerModeCompany')}</ToggleButton>
              <ToggleButton value="individual">{t('accounting.invoices.form.customerModeIndividual')}</ToggleButton>
            </ToggleButtonGroup>

            {createState.customerMode === 'company' ? (
              <FormControl fullWidth required>
                <InputLabel>{t('accounting.invoices.form.customer')}</InputLabel>
                <Select value={createState.companyId} label={t('accounting.invoices.form.customer')} onChange={(e) => setCreateState(s => ({ ...s, companyId: e.target.value }))}>
                  {customers.map(c => <MenuItem key={c._id} value={c._id}>{c.name}{c.rnc ? ` (RNC ${c.rnc})` : ''}</MenuItem>)}
                </Select>
              </FormControl>
            ) : (
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
                <TextField label={t('accounting.invoices.form.individualName')} value={createState.individualName} onChange={(e) => setCreateState(s => ({ ...s, individualName: e.target.value }))} required sx={{ gridColumn: { sm: '1 / -1' } }} />
                <TextField label={t('common.email', 'Email')} value={createState.individualEmail} onChange={(e) => setCreateState(s => ({ ...s, individualEmail: e.target.value }))} />
                <TextField label={t('common.phone', 'Phone')} value={createState.individualPhone} onChange={(e) => setCreateState(s => ({ ...s, individualPhone: e.target.value }))} />
              </Box>
            )}

            <TextField label={t('accounting.invoices.form.dueDate')} type="date" InputLabelProps={{ shrink: true }} value={createState.dueDate} onChange={(e) => setCreateState(s => ({ ...s, dueDate: e.target.value }))} sx={{ maxWidth: 220 }} />

            <Divider />
            <Typography variant="subtitle2">{t('accounting.invoices.form.lineItems')}</Typography>

            {createState.lines.map((l) => {
              const computed = lineComputed(l);
              return (
                <Paper key={l.key} variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('accounting.invoices.form.product')}</InputLabel>
                      <Select value={l.productId} label={t('accounting.invoices.form.product')} onChange={(e) => applyProductToLine(l.key, e.target.value)}>
                        <MenuItem value=""><em>{t('accounting.invoices.form.productNone')}</em></MenuItem>
                        {products.map(p => <MenuItem key={p._id} value={p._id}>{p.name} ({p.onHandQty} {p.unitOfMeasure} {t('accounting.invoices.form.available')})</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField size="small" label={t('accounting.invoices.form.description')} value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} required fullWidth />
                  </Box>
                  <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(5, 1fr)', mt: 1.5 }}>
                    <TextField size="small" type="number" label={t('accounting.invoices.form.quantity')} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} inputProps={{ min: 0 }} required />
                    <TextField size="small" type="number" label={t('accounting.invoices.form.unitPrice')} value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} inputProps={{ min: 0 }} required />
                    <TextField size="small" type="number" label={t('accounting.invoices.form.discountPercent')} value={l.discountPercent} onChange={(e) => updateLine(l.key, { discountPercent: e.target.value })} inputProps={{ min: 0, max: 100 }} />
                    <TextField size="small" type="number" label={t('accounting.invoices.form.taxRate')} value={l.taxRate} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} inputProps={{ min: 0, max: 100 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="body2" fontWeight={600}>{formatMoney(computed.total)}</Typography>
                      <IconButton size="small" onClick={() => removeLine(l.key)} disabled={createState.lines.length === 1}><DeleteIcon fontSize="small" /></IconButton>
                    </Box>
                  </Box>
                </Paper>
              );
            })}
            <Button size="small" startIcon={<AddIcon />} onClick={addLine} sx={{ justifySelf: 'start' }}>{t('accounting.invoices.form.addLine')}</Button>

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

      {/* View / print dialog */}
      <Dialog open={!!viewInvoice} onClose={() => setViewInvoice(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{viewInvoice?.invoiceNumber}</DialogTitle>
        <DialogContent>
          {viewInvoice && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1" fontWeight={600}>{customerLabel(viewInvoice)}</Typography>
                <Chip size="small" label={t(`accounting.invoices.status.${viewInvoice.status}`)} color={STATUS_COLOR[viewInvoice.status]} />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t('accounting.invoices.table.issueDate')}: {new Date(viewInvoice.issueDate).toLocaleDateString()}
                {viewInvoice.dueDate ? ` · ${t('accounting.invoices.form.dueDate')}: ${new Date(viewInvoice.dueDate).toLocaleDateString()}` : ''}
              </Typography>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('accounting.invoices.form.description')}</TableCell>
                      <TableCell align="right">{t('accounting.invoices.form.quantity')}</TableCell>
                      <TableCell align="right">{t('accounting.invoices.form.unitPrice')}</TableCell>
                      <TableCell align="right">{t('accounting.invoices.form.taxRate')}</TableCell>
                      <TableCell align="right">{t('accounting.invoices.table.total')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {viewInvoice.lineItems.map((l, i) => (
                      <TableRow key={l._id || i}>
                        <TableCell>{l.description}</TableCell>
                        <TableCell align="right">{l.quantity}</TableCell>
                        <TableCell align="right">{formatMoney(l.unitPrice)}</TableCell>
                        <TableCell align="right">{l.taxRate}%</TableCell>
                        <TableCell align="right">{formatMoney(l.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ display: 'grid', gap: 0.5, ml: 'auto', minWidth: 220 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.subtotal')}</Typography><Typography variant="body2">{formatMoney(viewInvoice.subtotal)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.tax')}</Typography><Typography variant="body2">{formatMoney(viewInvoice.taxAmount)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography fontWeight={700}>{t('accounting.invoices.table.total')}</Typography><Typography fontWeight={700}>{formatMoney(viewInvoice.total)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.amountPaid')}</Typography><Typography variant="body2">{formatMoney(viewInvoice.amountPaid)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2" fontWeight={600}>{t('accounting.invoices.table.balanceDue')}</Typography><Typography variant="body2" fontWeight={600}>{formatMoney(viewInvoice.balanceDue)}</Typography></Box>
              </Box>

              {viewInvoice.payments.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('accounting.invoices.dialog.paymentsTitle')}</Typography>
                  {viewInvoice.payments.map((p, i) => (
                    <Box key={p._id || i} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <Typography variant="body2">{new Date(p.date).toLocaleDateString()} · {t(`accounting.invoices.paymentMethod.${p.method}`)}{p.reference ? ` (${p.reference})` : ''}</Typography>
                      <Typography variant="body2">{formatMoney(p.amount)}</Typography>
                    </Box>
                  ))}
                </Box>
              )}

              {electronicInvoiceOf(viewInvoice) && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('accounting.invoices.dialog.ecfTitle')}</Typography>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2"><strong>NCF:</strong> {electronicInvoiceOf(viewInvoice)?.eNCF}</Typography>
                      <Typography variant="body2"><strong>{t('accounting.invoices.dialog.ecfStatus')}:</strong> {electronicInvoiceOf(viewInvoice)?.estadoECF}</Typography>
                    </Box>
                    {electronicInvoiceOf(viewInvoice)?.urlCodigoQr && (
                      // eslint-disable-next-line jsx-a11y/img-redundant-alt
                      <img src={electronicInvoiceOf(viewInvoice)?.urlCodigoQr} alt="QR" style={{ width: 96, height: 96 }} />
                    )}
                  </Box>
                </Paper>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewInvoice(null)}>{t('common.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Send confirmation */}
      <Dialog open={!!sendTarget} onClose={() => setSendTarget(null)} maxWidth="xs">
        <DialogTitle>{t('accounting.invoices.dialog.sendConfirmTitle')}</DialogTitle>
        <DialogContent>
          {sendError && <Alert severity="error" sx={{ mb: 2 }}>{sendError}</Alert>}
          <Typography variant="body2">{t('accounting.invoices.dialog.sendConfirmBody', { number: sendTarget?.invoiceNumber })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSendTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleSend} disabled={sending}>
            {sending ? <CircularProgress size={18} /> : t('accounting.invoices.actions.send')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record payment */}
      <Dialog open={!!paymentTarget} onClose={() => setPaymentTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.invoices.dialog.paymentTitle', { number: paymentTarget?.invoiceNumber })}</DialogTitle>
        <DialogContent>
          {paymentError && <Alert severity="error" sx={{ mb: 2 }}>{paymentError}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('accounting.invoices.table.balanceDue')}: {formatMoney(paymentTarget?.balanceDue)}
          </Typography>
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField label={t('accounting.invoices.form.paymentAmount')} type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm(f => ({ ...f, amount: e.target.value }))} required inputProps={{ min: 0, step: 0.01 }} />
            <FormControl fullWidth>
              <InputLabel>{t('accounting.invoices.form.paymentMethod')}</InputLabel>
              <Select value={paymentForm.method} label={t('accounting.invoices.form.paymentMethod')} onChange={(e) => setPaymentForm(f => ({ ...f, method: e.target.value as InvoicePaymentMethod }))}>
                <MenuItem value="cash">{t('accounting.invoices.paymentMethod.cash')}</MenuItem>
                <MenuItem value="card">{t('accounting.invoices.paymentMethod.card')}</MenuItem>
                <MenuItem value="transfer">{t('accounting.invoices.paymentMethod.transfer')}</MenuItem>
                <MenuItem value="check">{t('accounting.invoices.paymentMethod.check')}</MenuItem>
                <MenuItem value="credit">{t('accounting.invoices.paymentMethod.credit')}</MenuItem>
              </Select>
            </FormControl>
            <TextField label={t('accounting.invoices.form.paymentReference')} value={paymentForm.reference} onChange={(e) => setPaymentForm(f => ({ ...f, reference: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleRecordPayment} disabled={recordingPayment}>
            {recordingPayment ? <CircularProgress size={18} /> : t('accounting.invoices.actions.recordPayment')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Void confirmation */}
      <Dialog open={!!voidTarget} onClose={() => setVoidTarget(null)} maxWidth="xs">
        <DialogTitle>{t('accounting.invoices.dialog.voidConfirmTitle')}</DialogTitle>
        <DialogContent>
          {voidError && <Alert severity="error" sx={{ mb: 2 }}>{voidError}</Alert>}
          <Typography variant="body2">{t('accounting.invoices.dialog.voidConfirmBody', { number: voidTarget?.invoiceNumber })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleVoid} disabled={voiding}>
            {voiding ? <CircularProgress size={18} /> : t('accounting.invoices.actions.void')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default InvoicesContent;
