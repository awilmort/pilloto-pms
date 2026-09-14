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
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '../../../lib/permissions';
import { quotesService, accountingCustomersService, productsService, InvoiceLineItemInput } from '../../../services/api';
import { Quote, QuoteStatus, Customer, Product } from '../../../types';
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
  expiryDate: '',
  notes: '',
  lines: [newLine()],
});

const STATUS_COLOR: Record<QuoteStatus, 'default' | 'info' | 'warning' | 'success' | 'error' | 'primary'> = {
  draft: 'default',
  sent: 'info',
  accepted: 'success',
  rejected: 'error',
  expired: 'warning',
  converted: 'primary',
};

const customerLabel = (q: Quote): string => {
  if (q.isIndividual) return q.individualCustomer?.name || '—';
  const c = q.customer;
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
 * `/accounting/quotes` — quote/estimate list + lifecycle (create draft, edit,
 * send, accept/reject, convert to a real draft Invoice), per
 * PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5.4. Mirrors InvoicesContent's
 * list/editor conventions — a quote never touches stock/GL/e-CF, so there's no
 * payment or void UI here, only the status lifecycle and the convert action.
 */
const QuotesContent: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canManage = usePermission('accounting.quotes.manage');

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [createState, setCreateState] = useState(emptyCreateState());
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [viewQuote, setViewQuote] = useState<Quote | null>(null);

  const [sendTarget, setSendTarget] = useState<Quote | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [statusActionTarget, setStatusActionTarget] = useState<{ quote: Quote; action: 'accept' | 'reject' } | null>(null);
  const [statusActionBusy, setStatusActionBusy] = useState(false);
  const [statusActionError, setStatusActionError] = useState<string | null>(null);

  const [convertTarget, setConvertTarget] = useState<Quote | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const [actionMenu, setActionMenu] = useState<{ anchorEl: HTMLElement | null; quote: Quote | null }>({ anchorEl: null, quote: null });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [quoteRes, custRes, prodRes] = await Promise.all([
        quotesService.getQuotes({ status: statusFilter === 'all' ? undefined : statusFilter, limit: 200 }),
        accountingCustomersService.getCustomers({ active: true, limit: 200 }),
        productsService.getProducts({ active: true, sellable: true }),
      ]);
      setQuotes(Array.isArray(quoteRes.data.data) ? quoteRes.data.data : []);
      setCustomers(Array.isArray(custRes.data.data) ? custRes.data.data : []);
      setProducts(Array.isArray(prodRes.data.data) ? prodRes.data.data : []);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.quotes.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingQuote(null);
    setCreateState(emptyCreateState());
    setCreateError(null);
    setCreateOpen(true);
  };

  const openEdit = (q: Quote) => {
    setEditingQuote(q);
    setCreateState({
      customerMode: q.isIndividual ? 'individual' : 'company',
      companyId: !q.isIndividual && q.customer && typeof q.customer === 'object' ? q.customer._id : (typeof q.customer === 'string' ? q.customer : ''),
      individualName: q.individualCustomer?.name || '',
      individualEmail: q.individualCustomer?.email || '',
      individualPhone: q.individualCustomer?.phone || '',
      expiryDate: q.expiryDate ? q.expiryDate.slice(0, 10) : '',
      notes: q.notes || '',
      lines: q.lineItems.map(l => newLine({
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
      setCreateError(t('accounting.quotes.form.customerRequired')); return;
    }
    if (createState.customerMode === 'individual' && !createState.individualName.trim()) {
      setCreateError(t('accounting.quotes.form.individualNameRequired')); return;
    }
    const lineItems: InvoiceLineItemInput[] = [];
    for (const l of createState.lines) {
      if (!l.description.trim()) { setCreateError(t('accounting.quotes.form.lineDescriptionRequired')); return; }
      const quantity = Number(l.quantity);
      if (!quantity || quantity <= 0) { setCreateError(t('accounting.quotes.form.lineQuantityRequired')); return; }
      const unitPrice = Number(l.unitPrice);
      if (l.unitPrice === '' || unitPrice < 0) { setCreateError(t('accounting.quotes.form.lineUnitPriceRequired')); return; }
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
        expiryDate: createState.expiryDate || undefined,
        notes: createState.notes || undefined,
        lineItems,
      };
      if (editingQuote) {
        await quotesService.updateQuote(editingQuote._id, payload);
      } else {
        await quotesService.createQuote(payload);
      }
      setCreateOpen(false);
      load();
    } catch (e: any) {
      setCreateError(e.response?.data?.message || t('accounting.quotes.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (q: Quote) => {
    try {
      const res = await quotesService.getQuote(q._id);
      setViewQuote(res.data.data as Quote);
    } catch {
      setViewQuote(q);
    }
  };

  const handleSend = async () => {
    if (!sendTarget) return;
    setSending(true);
    setSendError(null);
    try {
      await quotesService.sendQuote(sendTarget._id);
      setSendTarget(null);
      load();
    } catch (e: any) {
      setSendError(e.response?.data?.message || t('accounting.quotes.messages.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  const handleStatusAction = async () => {
    if (!statusActionTarget) return;
    setStatusActionBusy(true);
    setStatusActionError(null);
    try {
      if (statusActionTarget.action === 'accept') {
        await quotesService.acceptQuote(statusActionTarget.quote._id);
      } else {
        await quotesService.rejectQuote(statusActionTarget.quote._id);
      }
      setStatusActionTarget(null);
      load();
    } catch (e: any) {
      setStatusActionError(e.response?.data?.message || t(`accounting.quotes.messages.${statusActionTarget.action}Failed`));
    } finally {
      setStatusActionBusy(false);
    }
  };

  const handleConvert = async () => {
    if (!convertTarget) return;
    setConverting(true);
    setConvertError(null);
    try {
      const res = await quotesService.convertQuote(convertTarget._id);
      setConvertTarget(null);
      const invoiceId = res.data.data?.invoice?._id;
      if (invoiceId) {
        navigate('/accounting/invoices', { state: { openInvoiceId: invoiceId } });
      } else {
        load();
      }
    } catch (e: any) {
      setConvertError(e.response?.data?.message || t('accounting.quotes.messages.convertFailed'));
    } finally {
      setConverting(false);
    }
  };

  const canConvert = (q: Quote) => q.status !== 'converted' && q.status !== 'rejected' && q.status !== 'expired';

  if (loading && quotes.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>{t('accounting.quotes.loading')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('accounting.quotes.table.status')}</InputLabel>
            <Select value={statusFilter} label={t('accounting.quotes.table.status')} onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | 'all')}>
              <MenuItem value="all">{t('common.all', 'All')}</MenuItem>
              <MenuItem value="draft">{t('accounting.quotes.status.draft')}</MenuItem>
              <MenuItem value="sent">{t('accounting.quotes.status.sent')}</MenuItem>
              <MenuItem value="accepted">{t('accounting.quotes.status.accepted')}</MenuItem>
              <MenuItem value="rejected">{t('accounting.quotes.status.rejected')}</MenuItem>
              <MenuItem value="expired">{t('accounting.quotes.status.expired')}</MenuItem>
              <MenuItem value="converted">{t('accounting.quotes.status.converted')}</MenuItem>
            </Select>
          </FormControl>
          {canManage && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ ml: 'auto' }}>
              {t('accounting.quotes.actions.create')}
            </Button>
          )}
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.quotes.table.number')}</TableCell>
                <TableCell>{t('accounting.quotes.table.customer')}</TableCell>
                <TableCell>{t('accounting.quotes.table.issueDate')}</TableCell>
                <TableCell align="right">{t('accounting.quotes.table.total')}</TableCell>
                <TableCell>{t('accounting.quotes.table.status')}</TableCell>
                <TableCell align="right">{t('accounting.quotes.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {quotes.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center">{t('accounting.quotes.empty')}</TableCell></TableRow>
              ) : quotes.map(q => (
                <TableRow key={q._id} hover>
                  <TableCell>
                    <Typography component="span" fontWeight={600} sx={{ cursor: 'pointer' }} onClick={() => openView(q)}>
                      {q.quoteNumber}
                    </Typography>
                  </TableCell>
                  <TableCell>{customerLabel(q)}</TableCell>
                  <TableCell>{new Date(q.issueDate).toLocaleDateString()}</TableCell>
                  <TableCell align="right">{formatMoney(q.total)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={t(`accounting.quotes.status.${q.status}`)} color={STATUS_COLOR[q.status]} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('accounting.quotes.actions.view')}>
                      <IconButton size="small" onClick={() => openView(q)}><VisibilityIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {canManage && (
                      <IconButton size="small" onClick={(e) => setActionMenu({ anchorEl: e.currentTarget, quote: q })}>
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
      <Menu anchorEl={actionMenu.anchorEl} open={Boolean(actionMenu.anchorEl)} onClose={() => setActionMenu({ anchorEl: null, quote: null })}>
        {actionMenu.quote?.status === 'draft' && (
          <MenuItem onClick={() => { const q = actionMenu.quote!; setActionMenu({ anchorEl: null, quote: null }); openEdit(q); }}>
            <ListItemIcon><VisibilityIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.quotes.actions.edit')}</ListItemText>
          </MenuItem>
        )}
        {actionMenu.quote?.status === 'draft' && (
          <MenuItem onClick={() => { const q = actionMenu.quote!; setActionMenu({ anchorEl: null, quote: null }); setSendError(null); setSendTarget(q); }}>
            <ListItemIcon><SendIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.quotes.actions.send')}</ListItemText>
          </MenuItem>
        )}
        {(actionMenu.quote?.status === 'draft' || actionMenu.quote?.status === 'sent') && (
          <MenuItem onClick={() => { const q = actionMenu.quote!; setActionMenu({ anchorEl: null, quote: null }); setStatusActionError(null); setStatusActionTarget({ quote: q, action: 'accept' }); }}>
            <ListItemIcon><CheckCircleIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.quotes.actions.accept')}</ListItemText>
          </MenuItem>
        )}
        {(actionMenu.quote?.status === 'draft' || actionMenu.quote?.status === 'sent') && (
          <MenuItem onClick={() => { const q = actionMenu.quote!; setActionMenu({ anchorEl: null, quote: null }); setStatusActionError(null); setStatusActionTarget({ quote: q, action: 'reject' }); }} sx={{ color: 'error.main' }}>
            <ListItemIcon><CancelIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>{t('accounting.quotes.actions.reject')}</ListItemText>
          </MenuItem>
        )}
        {actionMenu.quote && canConvert(actionMenu.quote) && (
          <MenuItem onClick={() => { const q = actionMenu.quote!; setActionMenu({ anchorEl: null, quote: null }); setConvertError(null); setConvertTarget(q); }}>
            <ListItemIcon><SwapHorizIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('accounting.quotes.actions.convertToInvoice')}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Create / Edit draft dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingQuote ? t('accounting.quotes.dialog.editTitle', { number: editingQuote.quoteNumber }) : t('accounting.quotes.dialog.createTitle')}</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <ToggleButtonGroup exclusive size="small" value={createState.customerMode} onChange={(_, v) => { if (v) setCreateState(s => ({ ...s, customerMode: v })); }}>
              <ToggleButton value="company">{t('accounting.quotes.form.customerModeCompany')}</ToggleButton>
              <ToggleButton value="individual">{t('accounting.quotes.form.customerModeIndividual')}</ToggleButton>
            </ToggleButtonGroup>

            {createState.customerMode === 'company' ? (
              <FormControl fullWidth required>
                <InputLabel>{t('accounting.quotes.form.customer')}</InputLabel>
                <Select value={createState.companyId} label={t('accounting.quotes.form.customer')} onChange={(e) => setCreateState(s => ({ ...s, companyId: e.target.value }))}>
                  {customers.map(c => <MenuItem key={c._id} value={c._id}>{c.name}{c.rnc ? ` (RNC ${c.rnc})` : ''}</MenuItem>)}
                </Select>
              </FormControl>
            ) : (
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
                <TextField label={t('accounting.quotes.form.individualName')} value={createState.individualName} onChange={(e) => setCreateState(s => ({ ...s, individualName: e.target.value }))} required sx={{ gridColumn: { sm: '1 / -1' } }} />
                <TextField label={t('common.email', 'Email')} value={createState.individualEmail} onChange={(e) => setCreateState(s => ({ ...s, individualEmail: e.target.value }))} />
                <TextField label={t('common.phone', 'Phone')} value={createState.individualPhone} onChange={(e) => setCreateState(s => ({ ...s, individualPhone: e.target.value }))} />
              </Box>
            )}

            <TextField label={t('accounting.quotes.form.expiryDate')} type="date" InputLabelProps={{ shrink: true }} value={createState.expiryDate} onChange={(e) => setCreateState(s => ({ ...s, expiryDate: e.target.value }))} sx={{ maxWidth: 220 }} />

            <Divider />
            <Typography variant="subtitle2">{t('accounting.quotes.form.lineItems')}</Typography>

            {createState.lines.map((l) => {
              const computed = lineComputed(l);
              return (
                <Paper key={l.key} variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('accounting.quotes.form.product')}</InputLabel>
                      <Select value={l.productId} label={t('accounting.quotes.form.product')} onChange={(e) => applyProductToLine(l.key, e.target.value)}>
                        <MenuItem value=""><em>{t('accounting.quotes.form.productNone')}</em></MenuItem>
                        {products.map(p => <MenuItem key={p._id} value={p._id}>{p.name} ({p.onHandQty} {p.unitOfMeasure} {t('accounting.quotes.form.available')})</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField size="small" label={t('accounting.quotes.form.description')} value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} required fullWidth />
                  </Box>
                  <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(5, 1fr)', mt: 1.5 }}>
                    <TextField size="small" type="number" label={t('accounting.quotes.form.quantity')} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} inputProps={{ min: 0 }} required />
                    <TextField size="small" type="number" label={t('accounting.quotes.form.unitPrice')} value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} inputProps={{ min: 0 }} required />
                    <TextField size="small" type="number" label={t('accounting.quotes.form.discountPercent')} value={l.discountPercent} onChange={(e) => updateLine(l.key, { discountPercent: e.target.value })} inputProps={{ min: 0, max: 100 }} />
                    <TextField size="small" type="number" label={t('accounting.quotes.form.taxRate')} value={l.taxRate} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} inputProps={{ min: 0, max: 100 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="body2" fontWeight={600}>{formatMoney(computed.total)}</Typography>
                      <IconButton size="small" onClick={() => removeLine(l.key)} disabled={createState.lines.length === 1}><DeleteIcon fontSize="small" /></IconButton>
                    </Box>
                  </Box>
                </Paper>
              );
            })}
            <Button size="small" startIcon={<AddIcon />} onClick={addLine} sx={{ justifySelf: 'start' }}>{t('accounting.quotes.form.addLine')}</Button>

            <TextField label={t('common.notes', 'Notes')} value={createState.notes} onChange={(e) => setCreateState(s => ({ ...s, notes: e.target.value }))} multiline minRows={2} />

            <Paper variant="outlined" sx={{ p: 2, ml: 'auto', minWidth: 260 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.quotes.table.subtotal')}</Typography><Typography variant="body2">{formatMoney(totals.subtotal)}</Typography></Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.quotes.table.tax')}</Typography><Typography variant="body2">{formatMoney(totals.taxAmount)}</Typography></Box>
              <Divider sx={{ my: 0.5 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography fontWeight={700}>{t('accounting.quotes.table.total')}</Typography><Typography fontWeight={700}>{formatMoney(totals.total)}</Typography></Box>
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
      <Dialog open={!!viewQuote} onClose={() => setViewQuote(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{viewQuote?.quoteNumber}</DialogTitle>
        <DialogContent>
          {viewQuote && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1" fontWeight={600}>{customerLabel(viewQuote)}</Typography>
                <Chip size="small" label={t(`accounting.quotes.status.${viewQuote.status}`)} color={STATUS_COLOR[viewQuote.status]} />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t('accounting.quotes.table.issueDate')}: {new Date(viewQuote.issueDate).toLocaleDateString()}
                {viewQuote.expiryDate ? ` · ${t('accounting.quotes.form.expiryDate')}: ${new Date(viewQuote.expiryDate).toLocaleDateString()}` : ''}
              </Typography>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('accounting.quotes.form.description')}</TableCell>
                      <TableCell align="right">{t('accounting.quotes.form.quantity')}</TableCell>
                      <TableCell align="right">{t('accounting.quotes.form.unitPrice')}</TableCell>
                      <TableCell align="right">{t('accounting.quotes.form.taxRate')}</TableCell>
                      <TableCell align="right">{t('accounting.quotes.table.total')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {viewQuote.lineItems.map((l, i) => (
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
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.quotes.table.subtotal')}</Typography><Typography variant="body2">{formatMoney(viewQuote.subtotal)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.quotes.table.tax')}</Typography><Typography variant="body2">{formatMoney(viewQuote.taxAmount)}</Typography></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography fontWeight={700}>{t('accounting.quotes.table.total')}</Typography><Typography fontWeight={700}>{formatMoney(viewQuote.total)}</Typography></Box>
              </Box>

              {viewQuote.convertedInvoiceId && (
                <Alert severity="info">
                  {t('accounting.quotes.dialog.convertedNotice', {
                    number: typeof viewQuote.convertedInvoiceId === 'object' ? viewQuote.convertedInvoiceId.invoiceNumber : '',
                  })}
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewQuote(null)}>{t('common.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Send confirmation */}
      <Dialog open={!!sendTarget} onClose={() => setSendTarget(null)} maxWidth="xs">
        <DialogTitle>{t('accounting.quotes.dialog.sendConfirmTitle')}</DialogTitle>
        <DialogContent>
          {sendError && <Alert severity="error" sx={{ mb: 2 }}>{sendError}</Alert>}
          <Typography variant="body2">{t('accounting.quotes.dialog.sendConfirmBody', { number: sendTarget?.quoteNumber })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSendTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleSend} disabled={sending}>
            {sending ? <CircularProgress size={18} /> : t('accounting.quotes.actions.send')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Accept / Reject confirmation */}
      <Dialog open={!!statusActionTarget} onClose={() => setStatusActionTarget(null)} maxWidth="xs">
        <DialogTitle>
          {statusActionTarget?.action === 'accept' ? t('accounting.quotes.dialog.acceptConfirmTitle') : t('accounting.quotes.dialog.rejectConfirmTitle')}
        </DialogTitle>
        <DialogContent>
          {statusActionError && <Alert severity="error" sx={{ mb: 2 }}>{statusActionError}</Alert>}
          <Typography variant="body2">
            {statusActionTarget?.action === 'accept'
              ? t('accounting.quotes.dialog.acceptConfirmBody', { number: statusActionTarget?.quote.quoteNumber })
              : t('accounting.quotes.dialog.rejectConfirmBody', { number: statusActionTarget?.quote.quoteNumber })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusActionTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button
            variant="contained"
            color={statusActionTarget?.action === 'reject' ? 'error' : 'primary'}
            onClick={handleStatusAction}
            disabled={statusActionBusy}
          >
            {statusActionBusy ? <CircularProgress size={18} /> : t(`accounting.quotes.actions.${statusActionTarget?.action}`)}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Convert to Invoice confirmation */}
      <Dialog open={!!convertTarget} onClose={() => setConvertTarget(null)} maxWidth="xs">
        <DialogTitle>{t('accounting.quotes.dialog.convertConfirmTitle')}</DialogTitle>
        <DialogContent>
          {convertError && <Alert severity="error" sx={{ mb: 2 }}>{convertError}</Alert>}
          <Typography variant="body2">{t('accounting.quotes.dialog.convertConfirmBody', { number: convertTarget?.quoteNumber })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConvertTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleConvert} disabled={converting}>
            {converting ? <CircularProgress size={18} /> : t('accounting.quotes.actions.convertToInvoice')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default QuotesContent;
