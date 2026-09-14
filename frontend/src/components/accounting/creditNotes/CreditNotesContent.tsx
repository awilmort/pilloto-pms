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
import EditIcon from '@mui/icons-material/Edit';
import SendIcon from '@mui/icons-material/Send';
import PaymentIcon from '@mui/icons-material/Payment';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import BlockIcon from '@mui/icons-material/Block';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePermission } from '../../../lib/permissions';
import { creditNotesService, invoicesService, warehousesService, CreditNoteLineItemInput } from '../../../services/api';
import { CreditNote, CreditNoteStatus, CreditNoteReason, CreditNoteFiscalModificationCode, CreditNoteRefundMethod, Invoice, Warehouse, ElectronicInvoice } from '../../../types';
import { formatMoney } from '../../../utils/currency';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// A credit note can only reference an invoice that has actually issued an e-CF
// (backend guard in creditNotes.controller.ts) — 'sent'/'partial'/'paid' invoices only.
const ELIGIBLE_INVOICE_STATUSES = ['sent', 'partial', 'paid'];

interface LineItemForm {
  key: string;
  lineType: 'return' | 'allowance';
  description: string;
  taxRate: string;
  // 'return' lines only:
  productId: string;
  quantity: string;
  unitPrice: string;
  // 'allowance' lines only:
  lineTotal: string;
}

let lineKeySeq = 0;
const newLine = (overrides?: Partial<LineItemForm>): LineItemForm => ({
  key: `l${++lineKeySeq}`,
  lineType: 'allowance',
  description: '',
  taxRate: '18',
  productId: '',
  quantity: '1',
  unitPrice: '',
  lineTotal: '',
  ...overrides,
});

const emptyCreateState = () => ({
  invoiceId: '',
  warehouseId: '',
  reason: 'goods-returned' as CreditNoteReason,
  fiscalModificationCode: '3' as CreditNoteFiscalModificationCode,
  notes: '',
  lines: [newLine()],
});

const STATUS_COLOR: Record<CreditNoteStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  issued: 'info',
  partial: 'warning',
  closed: 'success',
  void: 'error',
};

const REASONS: CreditNoteReason[] = ['billing-error', 'price-adjustment', 'goods-returned', 'service-not-rendered', 'duplicate-charge', 'goodwill', 'other'];
const FISCAL_CODES: CreditNoteFiscalModificationCode[] = ['1', '2', '3', '4'];
const REFUND_METHODS: CreditNoteRefundMethod[] = ['cash', 'card', 'transfer', 'check', 'other'];

const customerLabel = (cn: CreditNote): string => {
  if (cn.isIndividual) return cn.individualCustomer?.name || '—';
  const c = cn.customer;
  return c && typeof c === 'object' ? c.name : '—';
};

const invoiceLabel = (inv: Invoice): string => {
  const name = inv.isIndividual ? (inv.individualCustomer?.name || '—') : (inv.customer && typeof inv.customer === 'object' ? inv.customer.name : '—');
  return `${inv.invoiceNumber} — ${name} (${formatMoney(inv.total)})`;
};

const lineComputed = (l: LineItemForm) => {
  const tax = Number(l.taxRate) || 0;
  let lineTotal = 0;
  if (l.lineType === 'return') {
    const qty = Number(l.quantity) || 0;
    const price = Number(l.unitPrice) || 0;
    lineTotal = round2(qty * price);
  } else {
    lineTotal = round2(Number(l.lineTotal) || 0);
  }
  const taxAmount = round2(lineTotal * (tax / 100));
  return { lineTotal, taxAmount, total: round2(lineTotal + taxAmount) };
};

/**
 * `/accounting/credit-notes` — AR credit note list + lifecycle (create draft against
 * a sent invoice, issue through the e-CF pipeline as an E34, apply unapplied credit
 * to an invoice or refund it as cash, void), per
 * PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 8.2. Discriminated
 * return/allowance line items per §9.1 (each line carries its own tax rate; no
 * per-line discount on credit notes — §9.2 only extends Invoice/Quote).
 */
const CreditNotesContent: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const canManage = usePermission('accounting.creditNotes.manage');
  const canVoid = usePermission('accounting.creditNotes.void');

  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [eligibleInvoices, setEligibleInvoices] = useState<Invoice[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CreditNoteStatus | 'all'>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [createState, setCreateState] = useState(emptyCreateState());
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingCreditNote, setEditingCreditNote] = useState<CreditNote | null>(null);

  const [sourceInvoice, setSourceInvoice] = useState<Invoice | null>(null);
  const [sourceInvoiceLoading, setSourceInvoiceLoading] = useState(false);

  const [viewCreditNote, setViewCreditNote] = useState<CreditNote | null>(null);

  const [issueTarget, setIssueTarget] = useState<CreditNote | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [applyTarget, setApplyTarget] = useState<CreditNote | null>(null);
  const [applyForm, setApplyForm] = useState({ invoiceId: '', amount: '', note: '' });
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const [refundTarget, setRefundTarget] = useState<CreditNote | null>(null);
  const [refundForm, setRefundForm] = useState({ amount: '', method: 'cash' as CreditNoteRefundMethod, reference: '', note: '' });
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);

  const [voidTarget, setVoidTarget] = useState<CreditNote | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const [actionMenu, setActionMenu] = useState<{ anchorEl: HTMLElement | null; creditNote: CreditNote | null }>({ anchorEl: null, creditNote: null });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [cnRes, invRes, whRes] = await Promise.all([
        creditNotesService.getCreditNotes({ status: statusFilter === 'all' ? undefined : statusFilter, limit: 200 }),
        invoicesService.getInvoices({ limit: 200 }),
        warehousesService.getWarehouses({ active: true }),
      ]);
      setCreditNotes(Array.isArray(cnRes.data.data) ? cnRes.data.data : []);
      const allInvoices = Array.isArray(invRes.data.data) ? invRes.data.data : [];
      setEligibleInvoices(allInvoices.filter(i => ELIGIBLE_INVOICE_STATUSES.includes(i.status)));
      setWarehouses(Array.isArray(whRes.data.data) ? whRes.data.data : []);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.creditNotes.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => { load(); }, [load]);

  // Loads the full originating invoice (line items populated with product) once an
  // invoice is chosen in the create/edit dialog — its own sent line items are the
  // source list for the 'return' line product picker below.
  useEffect(() => {
    if (!createState.invoiceId) { setSourceInvoice(null); return; }
    let cancelled = false;
    setSourceInvoiceLoading(true);
    invoicesService.getInvoice(createState.invoiceId)
      .then(res => { if (!cancelled) setSourceInvoice(res.data.data as Invoice); })
      .catch(() => { if (!cancelled) setSourceInvoice(null); })
      .finally(() => { if (!cancelled) setSourceInvoiceLoading(false); });
    return () => { cancelled = true; };
  }, [createState.invoiceId]);

  const openCreate = (prefillInvoiceId?: string) => {
    setEditingCreditNote(null);
    setCreateState({ ...emptyCreateState(), invoiceId: prefillInvoiceId || '' });
    setCreateError(null);
    setCreateOpen(true);
  };

  const openEdit = (cn: CreditNote) => {
    setEditingCreditNote(cn);
    setCreateState({
      invoiceId: typeof cn.invoice === 'object' ? cn.invoice._id : cn.invoice,
      warehouseId: cn.warehouse && typeof cn.warehouse === 'object' ? cn.warehouse._id : (cn.warehouse as string) || '',
      reason: cn.reason,
      fiscalModificationCode: cn.fiscalModificationCode,
      notes: cn.notes || '',
      lines: cn.lineItems.map(l => newLine({
        lineType: l.lineType,
        description: l.description,
        taxRate: String(l.taxRate),
        productId: l.product && typeof l.product === 'object' ? l.product._id : (l.product as string) || '',
        quantity: l.quantity !== undefined ? String(l.quantity) : '1',
        unitPrice: l.unitPrice !== undefined ? String(l.unitPrice) : '',
        lineTotal: l.lineType === 'allowance' ? String(l.lineTotal) : '',
      })),
    });
    setCreateError(null);
    setCreateOpen(true);
  };

  // "Issue Credit Note" on an eligible invoice (InvoicesContent's row menu) navigates
  // here with { invoiceId } so the create dialog opens pre-filled — same cross-page
  // hand-off shape QuotesContent → InvoicesContent already established (Phase 5.4).
  useEffect(() => {
    const prefillInvoiceId = (location.state as { invoiceId?: string } | null)?.invoiceId;
    if (prefillInvoiceId && !createOpen) {
      openCreate(prefillInvoiceId);
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const updateLine = (key: string, patch: Partial<LineItemForm>) => {
    setCreateState(s => ({ ...s, lines: s.lines.map(l => l.key === key ? { ...l, ...patch } : l) }));
  };

  const returnableLines = useMemo(() => {
    if (!sourceInvoice) return [];
    const seen = new Set<string>();
    return sourceInvoice.lineItems.filter(l => {
      if (!l.product || typeof l.product !== 'object') return false;
      if (seen.has(l.product._id)) return false;
      seen.add(l.product._id);
      return true;
    });
  }, [sourceInvoice]);

  const applyReturnableLine = (key: string, productId: string) => {
    const match = returnableLines.find(l => typeof l.product === 'object' && l.product._id === productId);
    updateLine(key, {
      productId,
      description: match ? match.description : '',
      unitPrice: match ? String(match.unitPrice) : '',
      taxRate: match ? String(match.taxRate) : '18',
    });
  };

  const addLine = (lineType: 'return' | 'allowance') => setCreateState(s => ({ ...s, lines: [...s.lines, newLine({ lineType })] }));
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

  const hasReturnLine = createState.lines.some(l => l.lineType === 'return');

  const handleSave = async () => {
    setCreateError(null);
    if (!createState.invoiceId) { setCreateError(t('accounting.creditNotes.form.invoiceRequired')); return; }
    if (hasReturnLine && !createState.warehouseId) { setCreateError(t('accounting.creditNotes.form.warehouseRequired')); return; }

    const lineItems: CreditNoteLineItemInput[] = [];
    for (const l of createState.lines) {
      if (!l.description.trim()) { setCreateError(t('accounting.creditNotes.form.lineDescriptionRequired')); return; }
      const taxRate = Number(l.taxRate) || 0;
      if (l.lineType === 'return') {
        if (!l.productId) { setCreateError(t('accounting.creditNotes.form.lineProductRequired')); return; }
        const quantity = Number(l.quantity);
        if (!quantity || quantity <= 0) { setCreateError(t('accounting.creditNotes.form.lineQuantityRequired')); return; }
        const unitPrice = Number(l.unitPrice);
        if (l.unitPrice === '' || unitPrice < 0) { setCreateError(t('accounting.creditNotes.form.lineUnitPriceRequired')); return; }
        lineItems.push({ lineType: 'return', description: l.description.trim(), taxRate, product: l.productId, quantity, unitPrice });
      } else {
        const lineTotal = Number(l.lineTotal);
        if (l.lineTotal === '' || lineTotal < 0) { setCreateError(t('accounting.creditNotes.form.lineTotalRequired')); return; }
        lineItems.push({ lineType: 'allowance', description: l.description.trim(), taxRate, lineTotal });
      }
    }

    setSaving(true);
    try {
      if (editingCreditNote) {
        await creditNotesService.updateCreditNote(editingCreditNote._id, {
          warehouse: createState.warehouseId || undefined,
          reason: createState.reason,
          fiscalModificationCode: createState.fiscalModificationCode,
          notes: createState.notes || undefined,
          lineItems,
        });
      } else {
        await creditNotesService.createCreditNote({
          invoice: createState.invoiceId,
          warehouse: createState.warehouseId || undefined,
          reason: createState.reason,
          fiscalModificationCode: createState.fiscalModificationCode,
          notes: createState.notes || undefined,
          lineItems,
        });
      }
      setCreateOpen(false);
      load();
    } catch (e: any) {
      setCreateError(e.response?.data?.message || t('accounting.creditNotes.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (cn: CreditNote) => {
    try {
      const res = await creditNotesService.getCreditNote(cn._id);
      setViewCreditNote(res.data.data as CreditNote);
    } catch {
      setViewCreditNote(cn);
    }
  };

  const handleIssue = async () => {
    if (!issueTarget) return;
    setIssuing(true);
    setIssueError(null);
    try {
      const res = await creditNotesService.issueCreditNote(issueTarget._id);
      setIssueTarget(null);
      await load();
      if (res.data.data) setViewCreditNote(res.data.data.creditNote);
    } catch (e: any) {
      setIssueError(e.response?.data?.message || t('accounting.creditNotes.messages.issueFailed'));
    } finally {
      setIssuing(false);
    }
  };

  const openApply = (cn: CreditNote) => {
    setApplyTarget(cn);
    const defaultInvoiceId = typeof cn.invoice === 'object' ? cn.invoice._id : cn.invoice;
    setApplyForm({ invoiceId: defaultInvoiceId, amount: String(cn.remainingCredit), note: '' });
    setApplyError(null);
  };

  const handleApply = async () => {
    if (!applyTarget) return;
    const amount = Number(applyForm.amount);
    if (!amount || amount <= 0) { setApplyError(t('accounting.creditNotes.form.amountRequired')); return; }
    setApplying(true);
    setApplyError(null);
    try {
      await creditNotesService.applyCreditNote(applyTarget._id, { invoice: applyForm.invoiceId || undefined, amount, note: applyForm.note || undefined });
      setApplyTarget(null);
      load();
    } catch (e: any) {
      setApplyError(e.response?.data?.message || t('accounting.creditNotes.messages.applyFailed'));
    } finally {
      setApplying(false);
    }
  };

  const openRefund = (cn: CreditNote) => {
    setRefundTarget(cn);
    setRefundForm({ amount: String(cn.remainingCredit), method: 'cash', reference: '', note: '' });
    setRefundError(null);
  };

  const handleRefund = async () => {
    if (!refundTarget) return;
    const amount = Number(refundForm.amount);
    if (!amount || amount <= 0) { setRefundError(t('accounting.creditNotes.form.amountRequired')); return; }
    setRefunding(true);
    setRefundError(null);
    try {
      await creditNotesService.refundCreditNote(refundTarget._id, {
        amount, method: refundForm.method, reference: refundForm.reference || undefined, note: refundForm.note || undefined,
      });
      setRefundTarget(null);
      load();
    } catch (e: any) {
      setRefundError(e.response?.data?.message || t('accounting.creditNotes.messages.refundFailed'));
    } finally {
      setRefunding(false);
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await creditNotesService.voidCreditNote(voidTarget._id, { reason: voidReason || undefined });
      setVoidTarget(null);
      load();
    } catch (e: any) {
      setVoidError(e.response?.data?.message || t('accounting.creditNotes.messages.voidFailed'));
    } finally {
      setVoiding(false);
    }
  };

  const electronicInvoiceOf = (cn: CreditNote | null): ElectronicInvoice | null =>
    cn?.electronicInvoiceId && typeof cn.electronicInvoiceId === 'object' ? cn.electronicInvoiceId : null;

  if (loading && creditNotes.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>{t('accounting.creditNotes.loading')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('accounting.creditNotes.table.status')}</InputLabel>
            <Select value={statusFilter} label={t('accounting.creditNotes.table.status')} onChange={(e) => setStatusFilter(e.target.value as CreditNoteStatus | 'all')}>
              <MenuItem value="all">{t('common.all', 'All')}</MenuItem>
              <MenuItem value="draft">{t('accounting.creditNotes.status.draft')}</MenuItem>
              <MenuItem value="issued">{t('accounting.creditNotes.status.issued')}</MenuItem>
              <MenuItem value="partial">{t('accounting.creditNotes.status.partial')}</MenuItem>
              <MenuItem value="closed">{t('accounting.creditNotes.status.closed')}</MenuItem>
              <MenuItem value="void">{t('accounting.creditNotes.status.void')}</MenuItem>
            </Select>
          </FormControl>
          {canManage && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => openCreate()} sx={{ ml: 'auto' }}>
              {t('accounting.creditNotes.actions.create')}
            </Button>
          )}
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.creditNotes.table.number')}</TableCell>
                <TableCell>{t('accounting.creditNotes.table.customer')}</TableCell>
                <TableCell>{t('accounting.creditNotes.table.invoice')}</TableCell>
                <TableCell>{t('accounting.creditNotes.table.issueDate')}</TableCell>
                <TableCell align="right">{t('accounting.creditNotes.table.total')}</TableCell>
                <TableCell align="right">{t('accounting.creditNotes.table.remainingCredit')}</TableCell>
                <TableCell>{t('accounting.creditNotes.table.status')}</TableCell>
                <TableCell align="right">{t('accounting.creditNotes.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {creditNotes.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center">{t('accounting.creditNotes.empty')}</TableCell></TableRow>
              ) : creditNotes.map(cn => (
                <TableRow key={cn._id} hover>
                  <TableCell>
                    <Typography component="span" fontWeight={600} sx={{ cursor: 'pointer' }} onClick={() => openView(cn)}>
                      {cn.creditNoteNumber}
                    </Typography>
                  </TableCell>
                  <TableCell>{customerLabel(cn)}</TableCell>
                  <TableCell>{typeof cn.invoice === 'object' ? cn.invoice.invoiceNumber : '—'}</TableCell>
                  <TableCell>{new Date(cn.issueDate).toLocaleDateString()}</TableCell>
                  <TableCell align="right">{formatMoney(cn.total)}</TableCell>
                  <TableCell align="right">{formatMoney(cn.remainingCredit)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={t(`accounting.creditNotes.status.${cn.status}`)} color={STATUS_COLOR[cn.status]} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('accounting.creditNotes.actions.view')}>
                      <IconButton size="small" onClick={() => openView(cn)}><VisibilityIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {canManage && (
                      <IconButton size="small" onClick={(e) => setActionMenu({ anchorEl: e.currentTarget, creditNote: cn })}>
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
      <Menu anchorEl={actionMenu.anchorEl} open={Boolean(actionMenu.anchorEl)} onClose={() => setActionMenu({ anchorEl: null, creditNote: null })}>
        {actionMenu.creditNote?.status === 'draft' && [
          <MenuItem key="edit" onClick={() => { const cn = actionMenu.creditNote!; setActionMenu({ anchorEl: null, creditNote: null }); openEdit(cn); }}>
            <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.creditNotes.actions.edit')}</ListItemText>
          </MenuItem>,
          <MenuItem key="issue" onClick={() => { const cn = actionMenu.creditNote!; setActionMenu({ anchorEl: null, creditNote: null }); setIssueError(null); setIssueTarget(cn); }}>
            <ListItemIcon><SendIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.creditNotes.actions.issue')}</ListItemText>
          </MenuItem>,
        ]}
        {(actionMenu.creditNote?.status === 'issued' || actionMenu.creditNote?.status === 'partial') && [
          <MenuItem key="apply" onClick={() => { const cn = actionMenu.creditNote!; setActionMenu({ anchorEl: null, creditNote: null }); openApply(cn); }}>
            <ListItemIcon><PaymentIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.creditNotes.actions.apply')}</ListItemText>
          </MenuItem>,
          <MenuItem key="refund" onClick={() => { const cn = actionMenu.creditNote!; setActionMenu({ anchorEl: null, creditNote: null }); openRefund(cn); }}>
            <ListItemIcon><AccountBalanceWalletIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.creditNotes.actions.refund')}</ListItemText>
          </MenuItem>,
        ]}
        {canVoid && actionMenu.creditNote && actionMenu.creditNote.status !== 'void' && actionMenu.creditNote.amountApplied === 0 && (
          <MenuItem onClick={() => { const cn = actionMenu.creditNote!; setActionMenu({ anchorEl: null, creditNote: null }); setVoidError(null); setVoidReason(''); setVoidTarget(cn); }} sx={{ color: 'error.main' }}>
            <ListItemIcon><BlockIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>{t('accounting.creditNotes.actions.void')}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Create / Edit draft dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingCreditNote ? t('accounting.creditNotes.dialog.editTitle', { number: editingCreditNote.creditNoteNumber }) : t('accounting.creditNotes.dialog.createTitle')}</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <FormControl fullWidth required disabled={!!editingCreditNote}>
              <InputLabel>{t('accounting.creditNotes.form.invoice')}</InputLabel>
              <Select value={createState.invoiceId} label={t('accounting.creditNotes.form.invoice')} onChange={(e) => setCreateState(s => ({ ...s, invoiceId: e.target.value }))}>
                {eligibleInvoices.map(inv => <MenuItem key={inv._id} value={inv._id}>{invoiceLabel(inv)}</MenuItem>)}
              </Select>
            </FormControl>

            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
              <FormControl fullWidth required>
                <InputLabel>{t('accounting.creditNotes.form.reason')}</InputLabel>
                <Select value={createState.reason} label={t('accounting.creditNotes.form.reason')} onChange={(e) => setCreateState(s => ({ ...s, reason: e.target.value as CreditNoteReason }))}>
                  {REASONS.map(r => <MenuItem key={r} value={r}>{t(`accounting.creditNotes.reason.${r}`)}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth required>
                <InputLabel>{t('accounting.creditNotes.form.fiscalModificationCode')}</InputLabel>
                <Select value={createState.fiscalModificationCode} label={t('accounting.creditNotes.form.fiscalModificationCode')} onChange={(e) => setCreateState(s => ({ ...s, fiscalModificationCode: e.target.value as CreditNoteFiscalModificationCode }))}>
                  {FISCAL_CODES.map(c => <MenuItem key={c} value={c}>{t(`accounting.creditNotes.fiscalModificationCode.${c}`)}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>

            {hasReturnLine && (
              <FormControl fullWidth required>
                <InputLabel>{t('accounting.creditNotes.form.warehouse')}</InputLabel>
                <Select value={createState.warehouseId} label={t('accounting.creditNotes.form.warehouse')} onChange={(e) => setCreateState(s => ({ ...s, warehouseId: e.target.value }))}>
                  {warehouses.map(w => <MenuItem key={w._id} value={w._id}>{w.name}</MenuItem>)}
                </Select>
              </FormControl>
            )}

            <Divider />
            <Typography variant="subtitle2">{t('accounting.creditNotes.form.lineItems')}</Typography>
            {sourceInvoiceLoading && <CircularProgress size={20} />}

            {createState.lines.map((l) => {
              const computed = lineComputed(l);
              return (
                <Paper key={l.key} variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                    <ToggleButtonGroup exclusive size="small" value={l.lineType} onChange={(_, v) => { if (v) updateLine(l.key, { lineType: v }); }}>
                      <ToggleButton value="return">{t('accounting.creditNotes.form.lineTypeReturn')}</ToggleButton>
                      <ToggleButton value="allowance">{t('accounting.creditNotes.form.lineTypeAllowance')}</ToggleButton>
                    </ToggleButtonGroup>
                    <IconButton size="small" onClick={() => removeLine(l.key)} disabled={createState.lines.length === 1}><DeleteIcon fontSize="small" /></IconButton>
                  </Box>

                  {l.lineType === 'return' ? (
                    <>
                      <FormControl fullWidth size="small" sx={{ mb: 1.5 }} disabled={!sourceInvoice}>
                        <InputLabel>{t('accounting.creditNotes.form.product')}</InputLabel>
                        <Select value={l.productId} label={t('accounting.creditNotes.form.product')} onChange={(e) => applyReturnableLine(l.key, e.target.value)}>
                          {returnableLines.map(rl => (
                            <MenuItem key={typeof rl.product === 'object' ? rl.product._id : ''} value={typeof rl.product === 'object' ? rl.product._id : ''}>
                              {rl.description}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(3, 1fr)' }}>
                        <TextField size="small" type="number" label={t('accounting.creditNotes.form.quantity')} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} inputProps={{ min: 0 }} required />
                        <TextField size="small" type="number" label={t('accounting.creditNotes.form.unitPrice')} value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} inputProps={{ min: 0 }} required />
                        <TextField size="small" type="number" label={t('accounting.creditNotes.form.taxRate')} value={l.taxRate} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} inputProps={{ min: 0, max: 100 }} />
                      </Box>
                    </>
                  ) : (
                    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr' } }}>
                      <TextField size="small" label={t('accounting.creditNotes.form.description')} value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} required fullWidth />
                      <TextField size="small" type="number" label={t('accounting.creditNotes.form.amount')} value={l.lineTotal} onChange={(e) => updateLine(l.key, { lineTotal: e.target.value })} inputProps={{ min: 0 }} required />
                      <TextField size="small" type="number" label={t('accounting.creditNotes.form.taxRate')} value={l.taxRate} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} inputProps={{ min: 0, max: 100 }} />
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
                    <Typography variant="body2" fontWeight={600}>{formatMoney(computed.total)}</Typography>
                  </Box>
                </Paper>
              );
            })}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" startIcon={<AddIcon />} onClick={() => addLine('return')} disabled={!sourceInvoice}>{t('accounting.creditNotes.form.addReturnLine')}</Button>
              <Button size="small" startIcon={<AddIcon />} onClick={() => addLine('allowance')}>{t('accounting.creditNotes.form.addAllowanceLine')}</Button>
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

      {/* View / print dialog */}
      <Dialog open={!!viewCreditNote} onClose={() => setViewCreditNote(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{viewCreditNote?.creditNoteNumber}</DialogTitle>
        <DialogContent>
          {viewCreditNote && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1" fontWeight={600}>{customerLabel(viewCreditNote)}</Typography>
                <Chip size="small" label={t(`accounting.creditNotes.status.${viewCreditNote.status}`)} color={STATUS_COLOR[viewCreditNote.status]} />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t('accounting.creditNotes.table.issueDate')}: {new Date(viewCreditNote.issueDate).toLocaleDateString()}
                {' · '}{t('accounting.creditNotes.table.invoice')}: {typeof viewCreditNote.invoice === 'object' ? viewCreditNote.invoice.invoiceNumber : '—'}
                {' · '}{t('accounting.creditNotes.form.reason')}: {t(`accounting.creditNotes.reason.${viewCreditNote.reason}`)}
              </Typography>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('accounting.creditNotes.form.description')}</TableCell>
                      <TableCell align="right">{t('accounting.creditNotes.form.taxRate')}</TableCell>
                      <TableCell align="right">{t('accounting.invoices.table.total')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {viewCreditNote.lineItems.map((l, i) => (
                      <TableRow key={l._id || i}>
                        <TableCell>
                          {l.description}
                          {l.lineType === 'return' && l.quantity !== undefined && (
                            <Typography variant="caption" display="block" color="text.secondary">
                              {l.quantity} × {formatMoney(l.unitPrice)}
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
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.subtotal')}</Typography><Typography variant="body2">{formatMoney(viewCreditNote.subtotal)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.tax')}</Typography><Typography variant="body2">{formatMoney(viewCreditNote.taxAmount)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography fontWeight={700}>{t('accounting.invoices.table.total')}</Typography><Typography fontWeight={700}>{formatMoney(viewCreditNote.total)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.creditNotes.table.amountApplied')}</Typography><Typography variant="body2">{formatMoney(viewCreditNote.amountApplied)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2" fontWeight={600}>{t('accounting.creditNotes.table.remainingCredit')}</Typography><Typography variant="body2" fontWeight={600}>{formatMoney(viewCreditNote.remainingCredit)}</Typography></Box>
              </Box>

              {viewCreditNote.applications.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('accounting.creditNotes.dialog.applicationsTitle')}</Typography>
                  {viewCreditNote.applications.map((a, i) => (
                    <Box key={a._id || i} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <Typography variant="body2">
                        {new Date(a.createdAt).toLocaleDateString()} · {a.type === 'invoice'
                          ? `${t('accounting.creditNotes.applicationType.invoice')}${a.invoice && typeof a.invoice === 'object' ? ` (${a.invoice.invoiceNumber})` : ''}`
                          : `${t('accounting.creditNotes.applicationType.refund')}${a.method ? ` — ${t(`accounting.creditNotes.refundMethod.${a.method}`)}` : ''}`}
                      </Typography>
                      <Typography variant="body2">{formatMoney(a.amount)}</Typography>
                    </Box>
                  ))}
                </Box>
              )}

              {electronicInvoiceOf(viewCreditNote) && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('accounting.creditNotes.dialog.ecfTitle')}</Typography>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2"><strong>NCF:</strong> {electronicInvoiceOf(viewCreditNote)?.eNCF}</Typography>
                      <Typography variant="body2"><strong>{t('accounting.creditNotes.dialog.ecfModifies')}:</strong> {electronicInvoiceOf(viewCreditNote)?.originalENCF}</Typography>
                      <Typography variant="body2"><strong>{t('accounting.invoices.dialog.ecfStatus')}:</strong> {electronicInvoiceOf(viewCreditNote)?.estadoECF}</Typography>
                    </Box>
                    {electronicInvoiceOf(viewCreditNote)?.urlCodigoQr && (
                      // eslint-disable-next-line jsx-a11y/img-redundant-alt
                      <img src={electronicInvoiceOf(viewCreditNote)?.urlCodigoQr} alt="QR" style={{ width: 96, height: 96 }} />
                    )}
                  </Box>
                </Paper>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewCreditNote(null)}>{t('common.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Issue confirmation */}
      <Dialog open={!!issueTarget} onClose={() => setIssueTarget(null)} maxWidth="xs">
        <DialogTitle>{t('accounting.creditNotes.dialog.issueConfirmTitle')}</DialogTitle>
        <DialogContent>
          {issueError && <Alert severity="error" sx={{ mb: 2 }}>{issueError}</Alert>}
          <Typography variant="body2">{t('accounting.creditNotes.dialog.issueConfirmBody', { number: issueTarget?.creditNoteNumber })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIssueTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleIssue} disabled={issuing}>
            {issuing ? <CircularProgress size={18} /> : t('accounting.creditNotes.actions.issue')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Apply to invoice */}
      <Dialog open={!!applyTarget} onClose={() => setApplyTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.creditNotes.dialog.applyTitle', { number: applyTarget?.creditNoteNumber })}</DialogTitle>
        <DialogContent>
          {applyError && <Alert severity="error" sx={{ mb: 2 }}>{applyError}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('accounting.creditNotes.table.remainingCredit')}: {formatMoney(applyTarget?.remainingCredit)}
          </Typography>
          <Box sx={{ display: 'grid', gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>{t('accounting.creditNotes.form.targetInvoice')}</InputLabel>
              <Select value={applyForm.invoiceId} label={t('accounting.creditNotes.form.targetInvoice')} onChange={(e) => setApplyForm(f => ({ ...f, invoiceId: e.target.value }))}>
                {eligibleInvoices.map(inv => <MenuItem key={inv._id} value={inv._id}>{invoiceLabel(inv)}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label={t('accounting.creditNotes.form.amount')} type="number" value={applyForm.amount} onChange={(e) => setApplyForm(f => ({ ...f, amount: e.target.value }))} required inputProps={{ min: 0, step: 0.01 }} />
            <TextField label={t('common.notes', 'Notes')} value={applyForm.note} onChange={(e) => setApplyForm(f => ({ ...f, note: e.target.value }))} multiline minRows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApplyTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleApply} disabled={applying}>
            {applying ? <CircularProgress size={18} /> : t('accounting.creditNotes.actions.apply')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Refund */}
      <Dialog open={!!refundTarget} onClose={() => setRefundTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.creditNotes.dialog.refundTitle', { number: refundTarget?.creditNoteNumber })}</DialogTitle>
        <DialogContent>
          {refundError && <Alert severity="error" sx={{ mb: 2 }}>{refundError}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('accounting.creditNotes.table.remainingCredit')}: {formatMoney(refundTarget?.remainingCredit)}
          </Typography>
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField label={t('accounting.creditNotes.form.amount')} type="number" value={refundForm.amount} onChange={(e) => setRefundForm(f => ({ ...f, amount: e.target.value }))} required inputProps={{ min: 0, step: 0.01 }} />
            <FormControl fullWidth>
              <InputLabel>{t('accounting.invoices.form.paymentMethod')}</InputLabel>
              <Select value={refundForm.method} label={t('accounting.invoices.form.paymentMethod')} onChange={(e) => setRefundForm(f => ({ ...f, method: e.target.value as CreditNoteRefundMethod }))}>
                {REFUND_METHODS.map(m => <MenuItem key={m} value={m}>{t(`accounting.creditNotes.refundMethod.${m}`)}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label={t('accounting.invoices.form.paymentReference')} value={refundForm.reference} onChange={(e) => setRefundForm(f => ({ ...f, reference: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRefundTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleRefund} disabled={refunding}>
            {refunding ? <CircularProgress size={18} /> : t('accounting.creditNotes.actions.refund')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Void confirmation */}
      <Dialog open={!!voidTarget} onClose={() => setVoidTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.creditNotes.dialog.voidConfirmTitle')}</DialogTitle>
        <DialogContent>
          {voidError && <Alert severity="error" sx={{ mb: 2 }}>{voidError}</Alert>}
          <Typography variant="body2" sx={{ mb: 2 }}>{t('accounting.creditNotes.dialog.voidConfirmBody', { number: voidTarget?.creditNoteNumber })}</Typography>
          <TextField label={t('accounting.creditNotes.form.voidReason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} fullWidth multiline minRows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleVoid} disabled={voiding}>
            {voiding ? <CircularProgress size={18} /> : t('accounting.creditNotes.actions.void')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CreditNotesContent;
