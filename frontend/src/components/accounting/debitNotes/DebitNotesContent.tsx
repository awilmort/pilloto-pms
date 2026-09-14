import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, TextField, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Alert, Tooltip, FormControl, InputLabel, Select, MenuItem, Divider, Menu, ListItemIcon, ListItemText,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EditIcon from '@mui/icons-material/Edit';
import SendIcon from '@mui/icons-material/Send';
import PaymentIcon from '@mui/icons-material/Payment';
import BlockIcon from '@mui/icons-material/Block';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePermission } from '../../../lib/permissions';
import { debitNotesService, invoicesService, DebitNoteLineItemInput } from '../../../services/api';
import { DebitNote, DebitNoteStatus, DebitNoteReason, DebitNoteFiscalModificationCode, DebitNotePaymentMethod, Invoice, ElectronicInvoice } from '../../../types';
import { formatMoney } from '../../../utils/currency';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// A debit note can only reference an invoice that has actually issued an e-CF
// (backend guard in debitNotes.controller.ts) — same set CreditNotesContent uses.
const ELIGIBLE_INVOICE_STATUSES = ['sent', 'partial', 'paid'];

interface LineItemForm {
  key: string;
  description: string;
  lineTotal: string;
  taxRate: string;
}

let lineKeySeq = 0;
const newLine = (overrides?: Partial<LineItemForm>): LineItemForm => ({
  key: `l${++lineKeySeq}`,
  description: '',
  lineTotal: '',
  taxRate: '18',
  ...overrides,
});

const emptyCreateState = () => ({
  invoiceId: '',
  reason: 'additional-charge' as DebitNoteReason,
  fiscalModificationCode: '3' as DebitNoteFiscalModificationCode,
  dueDate: '',
  notes: '',
  lines: [newLine()],
});

const STATUS_COLOR: Record<DebitNoteStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  issued: 'info',
  partial: 'warning',
  paid: 'success',
  void: 'error',
};

const REASONS: DebitNoteReason[] = ['interest-on-overdue', 'price-correction', 'quantity-correction', 'additional-charge', 'other'];
const FISCAL_CODES: DebitNoteFiscalModificationCode[] = ['1', '2', '3', '4'];

const customerLabel = (dn: DebitNote): string => {
  if (dn.isIndividual) return dn.individualCustomer?.name || '—';
  const c = dn.customer;
  return c && typeof c === 'object' ? c.name : '—';
};

const invoiceLabel = (inv: Invoice): string => {
  const name = inv.isIndividual ? (inv.individualCustomer?.name || '—') : (inv.customer && typeof inv.customer === 'object' ? inv.customer.name : '—');
  return `${inv.invoiceNumber} — ${name} (${formatMoney(inv.total)})`;
};

const lineComputed = (l: LineItemForm) => {
  const tax = Number(l.taxRate) || 0;
  const lineTotal = round2(Number(l.lineTotal) || 0);
  const taxAmount = round2(lineTotal * (tax / 100));
  return { lineTotal, taxAmount, total: round2(lineTotal + taxAmount) };
};

/**
 * `/accounting/debit-notes` — AR debit note list + lifecycle (create draft against
 * a sent invoice, issue through the e-CF pipeline as an E33, record payments, void),
 * per PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 8.4. Mirrors
 * `InvoicesContent.tsx`'s conventions (own payments ledger, no apply/refund) rather
 * than `CreditNotesContent.tsx`'s — a debit note is new AR to collect, not a pool of
 * credit to allocate. Flat line items only (no return/allowance discriminator — a
 * debit note never touches inventory).
 */
const DebitNotesContent: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const canManage = usePermission('accounting.debitNotes.manage');
  const canVoid = usePermission('accounting.debitNotes.void');

  const [debitNotes, setDebitNotes] = useState<DebitNote[]>([]);
  const [eligibleInvoices, setEligibleInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<DebitNoteStatus | 'all'>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [createState, setCreateState] = useState(emptyCreateState());
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingDebitNote, setEditingDebitNote] = useState<DebitNote | null>(null);

  const [viewDebitNote, setViewDebitNote] = useState<DebitNote | null>(null);

  const [issueTarget, setIssueTarget] = useState<DebitNote | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [paymentTarget, setPaymentTarget] = useState<DebitNote | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash' as DebitNotePaymentMethod, date: '', reference: '' });
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);

  const [voidTarget, setVoidTarget] = useState<DebitNote | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const [actionMenu, setActionMenu] = useState<{ anchorEl: HTMLElement | null; debitNote: DebitNote | null }>({ anchorEl: null, debitNote: null });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [dnRes, invRes] = await Promise.all([
        debitNotesService.getDebitNotes({ status: statusFilter === 'all' ? undefined : statusFilter, limit: 200 }),
        invoicesService.getInvoices({ limit: 200 }),
      ]);
      setDebitNotes(Array.isArray(dnRes.data.data) ? dnRes.data.data : []);
      const allInvoices = Array.isArray(invRes.data.data) ? invRes.data.data : [];
      setEligibleInvoices(allInvoices.filter(i => ELIGIBLE_INVOICE_STATUSES.includes(i.status)));
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.debitNotes.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => { load(); }, [load]);

  const openCreate = (prefillInvoiceId?: string) => {
    setEditingDebitNote(null);
    setCreateState({ ...emptyCreateState(), invoiceId: prefillInvoiceId || '' });
    setCreateError(null);
    setCreateOpen(true);
  };

  const openEdit = (dn: DebitNote) => {
    setEditingDebitNote(dn);
    setCreateState({
      invoiceId: typeof dn.invoice === 'object' ? dn.invoice._id : dn.invoice,
      reason: dn.reason,
      fiscalModificationCode: dn.fiscalModificationCode,
      dueDate: dn.dueDate ? dn.dueDate.slice(0, 10) : '',
      notes: dn.notes || '',
      lines: dn.lineItems.map(l => newLine({ description: l.description, lineTotal: String(l.lineTotal), taxRate: String(l.taxRate) })),
    });
    setCreateError(null);
    setCreateOpen(true);
  };

  // "Issue Debit Note" on an eligible invoice (InvoicesContent's row menu) navigates
  // here with { invoiceId } so the create dialog opens pre-filled — same hand-off
  // shape CreditNotesContent already established (Phase 8.2).
  useEffect(() => {
    const prefillInvoiceId = (location.state as { debitNoteInvoiceId?: string } | null)?.debitNoteInvoiceId;
    if (prefillInvoiceId && !createOpen) {
      openCreate(prefillInvoiceId);
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const updateLine = (key: string, patch: Partial<LineItemForm>) => {
    setCreateState(s => ({ ...s, lines: s.lines.map(l => l.key === key ? { ...l, ...patch } : l) }));
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
    if (!createState.invoiceId) { setCreateError(t('accounting.debitNotes.form.invoiceRequired')); return; }

    const lineItems: DebitNoteLineItemInput[] = [];
    for (const l of createState.lines) {
      if (!l.description.trim()) { setCreateError(t('accounting.debitNotes.form.lineDescriptionRequired')); return; }
      const lineTotal = Number(l.lineTotal);
      if (l.lineTotal === '' || lineTotal < 0) { setCreateError(t('accounting.debitNotes.form.lineTotalRequired')); return; }
      lineItems.push({ description: l.description.trim(), lineTotal, taxRate: Number(l.taxRate) || 0 });
    }

    setSaving(true);
    try {
      if (editingDebitNote) {
        await debitNotesService.updateDebitNote(editingDebitNote._id, {
          reason: createState.reason,
          fiscalModificationCode: createState.fiscalModificationCode,
          dueDate: createState.dueDate || undefined,
          notes: createState.notes || undefined,
          lineItems,
        });
      } else {
        await debitNotesService.createDebitNote({
          invoice: createState.invoiceId,
          reason: createState.reason,
          fiscalModificationCode: createState.fiscalModificationCode,
          dueDate: createState.dueDate || undefined,
          notes: createState.notes || undefined,
          lineItems,
        });
      }
      setCreateOpen(false);
      load();
    } catch (e: any) {
      setCreateError(e.response?.data?.message || t('accounting.debitNotes.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (dn: DebitNote) => {
    try {
      const res = await debitNotesService.getDebitNote(dn._id);
      setViewDebitNote(res.data.data as DebitNote);
    } catch {
      setViewDebitNote(dn);
    }
  };

  const handleIssue = async () => {
    if (!issueTarget) return;
    setIssuing(true);
    setIssueError(null);
    try {
      const res = await debitNotesService.issueDebitNote(issueTarget._id);
      setIssueTarget(null);
      await load();
      if (res.data.data) setViewDebitNote(res.data.data.debitNote);
    } catch (e: any) {
      setIssueError(e.response?.data?.message || t('accounting.debitNotes.messages.issueFailed'));
    } finally {
      setIssuing(false);
    }
  };

  const openPayment = (dn: DebitNote) => {
    setPaymentTarget(dn);
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
      await debitNotesService.recordPayment(paymentTarget._id, {
        amount, method: paymentForm.method, date: paymentForm.date || undefined, reference: paymentForm.reference || undefined,
      });
      setPaymentTarget(null);
      load();
    } catch (e: any) {
      setPaymentError(e.response?.data?.message || t('accounting.debitNotes.messages.paymentFailed'));
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await debitNotesService.voidDebitNote(voidTarget._id, { reason: voidReason || undefined });
      setVoidTarget(null);
      load();
    } catch (e: any) {
      setVoidError(e.response?.data?.message || t('accounting.debitNotes.messages.voidFailed'));
    } finally {
      setVoiding(false);
    }
  };

  const electronicInvoiceOf = (dn: DebitNote | null): ElectronicInvoice | null =>
    dn?.electronicInvoiceId && typeof dn.electronicInvoiceId === 'object' ? dn.electronicInvoiceId : null;

  if (loading && debitNotes.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>{t('accounting.debitNotes.loading')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('accounting.debitNotes.table.status')}</InputLabel>
            <Select value={statusFilter} label={t('accounting.debitNotes.table.status')} onChange={(e) => setStatusFilter(e.target.value as DebitNoteStatus | 'all')}>
              <MenuItem value="all">{t('common.all', 'All')}</MenuItem>
              <MenuItem value="draft">{t('accounting.debitNotes.status.draft')}</MenuItem>
              <MenuItem value="issued">{t('accounting.debitNotes.status.issued')}</MenuItem>
              <MenuItem value="partial">{t('accounting.debitNotes.status.partial')}</MenuItem>
              <MenuItem value="paid">{t('accounting.debitNotes.status.paid')}</MenuItem>
              <MenuItem value="void">{t('accounting.debitNotes.status.void')}</MenuItem>
            </Select>
          </FormControl>
          {canManage && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => openCreate()} sx={{ ml: 'auto' }}>
              {t('accounting.debitNotes.actions.create')}
            </Button>
          )}
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.debitNotes.table.number')}</TableCell>
                <TableCell>{t('accounting.debitNotes.table.customer')}</TableCell>
                <TableCell>{t('accounting.debitNotes.table.invoice')}</TableCell>
                <TableCell>{t('accounting.debitNotes.table.issueDate')}</TableCell>
                <TableCell align="right">{t('accounting.debitNotes.table.total')}</TableCell>
                <TableCell align="right">{t('accounting.debitNotes.table.balanceDue')}</TableCell>
                <TableCell>{t('accounting.debitNotes.table.status')}</TableCell>
                <TableCell align="right">{t('accounting.debitNotes.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {debitNotes.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center">{t('accounting.debitNotes.empty')}</TableCell></TableRow>
              ) : debitNotes.map(dn => (
                <TableRow key={dn._id} hover>
                  <TableCell>
                    <Typography component="span" fontWeight={600} sx={{ cursor: 'pointer' }} onClick={() => openView(dn)}>
                      {dn.debitNoteNumber}
                    </Typography>
                  </TableCell>
                  <TableCell>{customerLabel(dn)}</TableCell>
                  <TableCell>{typeof dn.invoice === 'object' ? dn.invoice.invoiceNumber : '—'}</TableCell>
                  <TableCell>{new Date(dn.issueDate).toLocaleDateString()}</TableCell>
                  <TableCell align="right">{formatMoney(dn.total)}</TableCell>
                  <TableCell align="right">{formatMoney(dn.balanceDue)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={t(`accounting.debitNotes.status.${dn.status}`)} color={STATUS_COLOR[dn.status]} />
                    {dn.isOverdue && <Chip size="small" label={t('accounting.invoices.status.overdue')} color="error" variant="outlined" sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('accounting.debitNotes.actions.view')}>
                      <IconButton size="small" onClick={() => openView(dn)}><VisibilityIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {canManage && (
                      <IconButton size="small" onClick={(e) => setActionMenu({ anchorEl: e.currentTarget, debitNote: dn })}>
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
      <Menu anchorEl={actionMenu.anchorEl} open={Boolean(actionMenu.anchorEl)} onClose={() => setActionMenu({ anchorEl: null, debitNote: null })}>
        {actionMenu.debitNote?.status === 'draft' && [
          <MenuItem key="edit" onClick={() => { const dn = actionMenu.debitNote!; setActionMenu({ anchorEl: null, debitNote: null }); openEdit(dn); }}>
            <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.debitNotes.actions.edit')}</ListItemText>
          </MenuItem>,
          <MenuItem key="issue" onClick={() => { const dn = actionMenu.debitNote!; setActionMenu({ anchorEl: null, debitNote: null }); setIssueError(null); setIssueTarget(dn); }}>
            <ListItemIcon><SendIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.debitNotes.actions.issue')}</ListItemText>
          </MenuItem>,
        ]}
        {(actionMenu.debitNote?.status === 'issued' || actionMenu.debitNote?.status === 'partial') && (
          <MenuItem onClick={() => { const dn = actionMenu.debitNote!; setActionMenu({ anchorEl: null, debitNote: null }); openPayment(dn); }}>
            <ListItemIcon><PaymentIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.debitNotes.actions.recordPayment')}</ListItemText>
          </MenuItem>
        )}
        {canVoid && actionMenu.debitNote && actionMenu.debitNote.status !== 'void' && actionMenu.debitNote.amountPaid === 0 && (
          <MenuItem onClick={() => { const dn = actionMenu.debitNote!; setActionMenu({ anchorEl: null, debitNote: null }); setVoidError(null); setVoidReason(''); setVoidTarget(dn); }} sx={{ color: 'error.main' }}>
            <ListItemIcon><BlockIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>{t('accounting.debitNotes.actions.void')}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Create / Edit draft dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingDebitNote ? t('accounting.debitNotes.dialog.editTitle', { number: editingDebitNote.debitNoteNumber }) : t('accounting.debitNotes.dialog.createTitle')}</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <FormControl fullWidth required disabled={!!editingDebitNote}>
              <InputLabel>{t('accounting.debitNotes.form.invoice')}</InputLabel>
              <Select value={createState.invoiceId} label={t('accounting.debitNotes.form.invoice')} onChange={(e) => setCreateState(s => ({ ...s, invoiceId: e.target.value }))}>
                {eligibleInvoices.map(inv => <MenuItem key={inv._id} value={inv._id}>{invoiceLabel(inv)}</MenuItem>)}
              </Select>
            </FormControl>

            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr 1fr' } }}>
              <FormControl fullWidth required>
                <InputLabel>{t('accounting.debitNotes.form.reason')}</InputLabel>
                <Select value={createState.reason} label={t('accounting.debitNotes.form.reason')} onChange={(e) => setCreateState(s => ({ ...s, reason: e.target.value as DebitNoteReason }))}>
                  {REASONS.map(r => <MenuItem key={r} value={r}>{t(`accounting.debitNotes.reason.${r}`)}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth required>
                <InputLabel>{t('accounting.debitNotes.form.fiscalModificationCode')}</InputLabel>
                <Select value={createState.fiscalModificationCode} label={t('accounting.debitNotes.form.fiscalModificationCode')} onChange={(e) => setCreateState(s => ({ ...s, fiscalModificationCode: e.target.value as DebitNoteFiscalModificationCode }))}>
                  {FISCAL_CODES.map(c => <MenuItem key={c} value={c}>{t(`accounting.creditNotes.fiscalModificationCode.${c}`)}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField label={t('accounting.invoices.form.dueDate')} type="date" InputLabelProps={{ shrink: true }} value={createState.dueDate} onChange={(e) => setCreateState(s => ({ ...s, dueDate: e.target.value }))} />
            </Box>

            <Divider />
            <Typography variant="subtitle2">{t('accounting.debitNotes.form.lineItems')}</Typography>

            {createState.lines.map((l) => {
              const computed = lineComputed(l);
              return (
                <Paper key={l.key} variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr' } }}>
                    <TextField size="small" label={t('accounting.debitNotes.form.description')} value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} required fullWidth />
                    <TextField size="small" type="number" label={t('accounting.debitNotes.form.amount')} value={l.lineTotal} onChange={(e) => updateLine(l.key, { lineTotal: e.target.value })} inputProps={{ min: 0 }} required />
                    <TextField size="small" type="number" label={t('accounting.debitNotes.form.taxRate')} value={l.taxRate} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} inputProps={{ min: 0, max: 100 }} />
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1.5 }}>
                    <Typography variant="body2" fontWeight={600}>{formatMoney(computed.total)}</Typography>
                    <IconButton size="small" onClick={() => removeLine(l.key)} disabled={createState.lines.length === 1}><DeleteIcon fontSize="small" /></IconButton>
                  </Box>
                </Paper>
              );
            })}
            <Button size="small" startIcon={<AddIcon />} onClick={addLine} sx={{ justifySelf: 'start' }}>{t('accounting.debitNotes.form.addLine')}</Button>

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
      <Dialog open={!!viewDebitNote} onClose={() => setViewDebitNote(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{viewDebitNote?.debitNoteNumber}</DialogTitle>
        <DialogContent>
          {viewDebitNote && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1" fontWeight={600}>{customerLabel(viewDebitNote)}</Typography>
                <Chip size="small" label={t(`accounting.debitNotes.status.${viewDebitNote.status}`)} color={STATUS_COLOR[viewDebitNote.status]} />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t('accounting.debitNotes.table.issueDate')}: {new Date(viewDebitNote.issueDate).toLocaleDateString()}
                {' · '}{t('accounting.debitNotes.table.invoice')}: {typeof viewDebitNote.invoice === 'object' ? viewDebitNote.invoice.invoiceNumber : '—'}
                {' · '}{t('accounting.debitNotes.form.reason')}: {t(`accounting.debitNotes.reason.${viewDebitNote.reason}`)}
              </Typography>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('accounting.debitNotes.form.description')}</TableCell>
                      <TableCell align="right">{t('accounting.debitNotes.form.taxRate')}</TableCell>
                      <TableCell align="right">{t('accounting.invoices.table.total')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {viewDebitNote.lineItems.map((l, i) => (
                      <TableRow key={l._id || i}>
                        <TableCell>{l.description}</TableCell>
                        <TableCell align="right">{l.taxRate}%</TableCell>
                        <TableCell align="right">{formatMoney(l.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ display: 'grid', gap: 0.5, ml: 'auto', minWidth: 220 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.subtotal')}</Typography><Typography variant="body2">{formatMoney(viewDebitNote.subtotal)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.tax')}</Typography><Typography variant="body2">{formatMoney(viewDebitNote.taxAmount)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography fontWeight={700}>{t('accounting.invoices.table.total')}</Typography><Typography fontWeight={700}>{formatMoney(viewDebitNote.total)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.amountPaid')}</Typography><Typography variant="body2">{formatMoney(viewDebitNote.amountPaid)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2" fontWeight={600}>{t('accounting.invoices.table.balanceDue')}</Typography><Typography variant="body2" fontWeight={600}>{formatMoney(viewDebitNote.balanceDue)}</Typography></Box>
              </Box>

              {viewDebitNote.payments.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('accounting.invoices.dialog.paymentsTitle')}</Typography>
                  {viewDebitNote.payments.map((p, i) => (
                    <Box key={p._id || i} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <Typography variant="body2">{new Date(p.date).toLocaleDateString()} · {t(`accounting.invoices.paymentMethod.${p.method}`)}{p.reference ? ` (${p.reference})` : ''}</Typography>
                      <Typography variant="body2">{formatMoney(p.amount)}</Typography>
                    </Box>
                  ))}
                </Box>
              )}

              {electronicInvoiceOf(viewDebitNote) && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('accounting.debitNotes.dialog.ecfTitle')}</Typography>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2"><strong>NCF:</strong> {electronicInvoiceOf(viewDebitNote)?.eNCF}</Typography>
                      <Typography variant="body2"><strong>{t('accounting.creditNotes.dialog.ecfModifies')}:</strong> {electronicInvoiceOf(viewDebitNote)?.originalENCF}</Typography>
                      <Typography variant="body2"><strong>{t('accounting.invoices.dialog.ecfStatus')}:</strong> {electronicInvoiceOf(viewDebitNote)?.estadoECF}</Typography>
                    </Box>
                    {electronicInvoiceOf(viewDebitNote)?.urlCodigoQr && (
                      // eslint-disable-next-line jsx-a11y/img-redundant-alt
                      <img src={electronicInvoiceOf(viewDebitNote)?.urlCodigoQr} alt="QR" style={{ width: 96, height: 96 }} />
                    )}
                  </Box>
                </Paper>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDebitNote(null)}>{t('common.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Issue confirmation */}
      <Dialog open={!!issueTarget} onClose={() => setIssueTarget(null)} maxWidth="xs">
        <DialogTitle>{t('accounting.debitNotes.dialog.issueConfirmTitle')}</DialogTitle>
        <DialogContent>
          {issueError && <Alert severity="error" sx={{ mb: 2 }}>{issueError}</Alert>}
          <Typography variant="body2">{t('accounting.debitNotes.dialog.issueConfirmBody', { number: issueTarget?.debitNoteNumber })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIssueTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleIssue} disabled={issuing}>
            {issuing ? <CircularProgress size={18} /> : t('accounting.debitNotes.actions.issue')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record payment */}
      <Dialog open={!!paymentTarget} onClose={() => setPaymentTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.debitNotes.dialog.paymentTitle', { number: paymentTarget?.debitNoteNumber })}</DialogTitle>
        <DialogContent>
          {paymentError && <Alert severity="error" sx={{ mb: 2 }}>{paymentError}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('accounting.debitNotes.table.balanceDue')}: {formatMoney(paymentTarget?.balanceDue)}
          </Typography>
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField label={t('accounting.invoices.form.paymentAmount')} type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm(f => ({ ...f, amount: e.target.value }))} required inputProps={{ min: 0, step: 0.01 }} />
            <FormControl fullWidth>
              <InputLabel>{t('accounting.invoices.form.paymentMethod')}</InputLabel>
              <Select value={paymentForm.method} label={t('accounting.invoices.form.paymentMethod')} onChange={(e) => setPaymentForm(f => ({ ...f, method: e.target.value as DebitNotePaymentMethod }))}>
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
            {recordingPayment ? <CircularProgress size={18} /> : t('accounting.debitNotes.actions.recordPayment')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Void confirmation */}
      <Dialog open={!!voidTarget} onClose={() => setVoidTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.debitNotes.dialog.voidConfirmTitle')}</DialogTitle>
        <DialogContent>
          {voidError && <Alert severity="error" sx={{ mb: 2 }}>{voidError}</Alert>}
          <Typography variant="body2" sx={{ mb: 2 }}>{t('accounting.debitNotes.dialog.voidConfirmBody', { number: voidTarget?.debitNoteNumber })}</Typography>
          <TextField label={t('accounting.creditNotes.form.voidReason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} fullWidth multiline minRows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleVoid} disabled={voiding}>
            {voiding ? <CircularProgress size={18} /> : t('accounting.debitNotes.actions.void')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DebitNotesContent;
