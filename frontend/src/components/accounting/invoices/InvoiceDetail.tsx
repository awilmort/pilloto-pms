import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, LinearProgress, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Skeleton, Stack, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import {
  ArrowBack, AssignmentReturnOutlined, BlockOutlined, ContentCopy, EditOutlined, FileCopyOutlined, MoreVert, OpenInNew, PaymentOutlined,
  PictureAsPdfOutlined, PostAddOutlined, SendOutlined,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import i18n from '../../../i18n';
import { creditNotesService, debitNotesService, invoicesService } from '../../../services/api';
import type { CreditNote, DebitNote, Invoice, InvoiceFormMeta } from '../../../types';
import { usePermission } from '../../../lib/permissions';
import { formatAccountingMoneyExact as formatMoney } from '../../../utils/currency';
import InvoiceLetterhead from './InvoiceLetterhead';
import { useInvoiceActions } from './useInvoiceActions';
import { customerLabel, customerOf, electronicInvoiceOf, isOverdueInvoice, STATUS_COLOR } from './invoiceUi';
import { daysBetweenIso, toIsoDate, todayIso } from './invoiceMath';
import EcfStatusBadge from '../../admin/EcfStatusBadge';

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(i18n.language) : '—');
const fmtDateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString(i18n.language) : '—');
const COLS = '28px minmax(180px, 1fr) 64px 104px 64px 70px 112px';

/**
 * `/accounting/invoices/:id` — the invoice as a document (what gets printed) beside what the user needs
 * to act on it: how much is paid and due, the payments, the e-CF, related credit/debit notes and the
 * customer. Every lifecycle action is a button here instead of a row menu.
 */
const InvoiceDetail: React.FC<{ invoiceId: string }> = ({ invoiceId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const canManage = usePermission('accounting.invoices.manage');
  const canVoid = usePermission('accounting.invoices.void');
  const isXs = useMediaQuery(useTheme().breakpoints.down('sm'));

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [meta, setMeta] = useState<InvoiceFormMeta | null>(null);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [debitNotes, setDebitNotes] = useState<DebitNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  // An issue attempted from the editor that failed: shown until dismissed, so the cause is not lost.
  const [sendError, setSendError] = useState<string | null>((location.state as { sendError?: string } | null)?.sendError ?? null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [invRes, metaRes] = await Promise.all([invoicesService.getInvoice(invoiceId), invoicesService.getFormMeta().catch(() => null)]);
      const inv = invRes.data.data as Invoice;
      setInvoice(inv);
      setMeta(metaRes?.data.data ?? null);
      if (['sent', 'partial', 'paid'].includes(inv.status)) {
        const [cn, dn] = await Promise.all([
          creditNotesService.getCreditNotes({ invoice: invoiceId, limit: 20 }).catch(() => null),
          debitNotesService.getDebitNotes({ invoice: invoiceId, limit: 20 }).catch(() => null),
        ]);
        setCreditNotes(cn && Array.isArray(cn.data.data) ? cn.data.data : []);
        setDebitNotes(dn && Array.isArray(dn.data.data) ? dn.data.data : []);
      }
    } catch (e: any) {
      setError(e.response?.data?.status === 404 || e.response?.status === 404 ? t('accounting.invoices.page.notFound') : (e.response?.data?.message || t('accounting.invoices.messages.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [invoiceId, t]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  // Clear the carried error from history so a refresh does not bring it back
  useEffect(() => { if ((location.state as { sendError?: string } | null)?.sendError) navigate(location.pathname, { replace: true, state: {} }); }, [location.state, location.pathname, navigate]);

  const actions = useInvoiceActions((_inv, info) => {
    setSendError(null);
    if (info?.queued) toast.success(t('fiscal.documents.queuedToast', 'Invoice sent. Its e-CF is saved and goes out automatically.'));
    load();
  });

  if (loading && !invoice) {
    return <Box sx={{ maxWidth: 1240, mx: 'auto' }}><Skeleton variant="rounded" height={56} sx={{ mb: 2 }} /><Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '1fr 340px' } }}><Skeleton variant="rounded" height={620} /><Skeleton variant="rounded" height={420} /></Box></Box>;
  }
  if (error || !invoice) {
    return <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => navigate('/accounting/invoices')}>{t('accounting.invoices.page.back')}</Button>}>{error}</Alert>;
  }

  const inv = invoice;
  const ecf = electronicInvoiceOf(inv);
  const customer = customerOf(inv);
  const isDraft = inv.status === 'draft';
  const isOpen = inv.status === 'sent' || inv.status === 'partial';
  const fiscal = ['sent', 'partial', 'paid'].includes(inv.status);
  const stamp = isDraft ? t('accounting.invoices.status.draft') : inv.status === 'void' ? t('accounting.invoices.status.void') : null;

  const daysToDue = inv.dueDate ? daysBetweenIso(todayIso(), toIsoDate(new Date(inv.dueDate))) : null;
  const paidPct = inv.total > 0 ? Math.min(100, Math.round((inv.amountPaid / inv.total) * 100)) : 0;
  const ecfTitle = ecf ? t(`accounting.invoices.page.ecfType.${ecf.tipo}`, ecf.tipo) : null;

  const closeMenu = () => setMenuAnchor(null);
  const afterMenu = (fn: () => void) => () => { closeMenu(); fn(); };

  return (
    <Box sx={{ maxWidth: 1240, mx: 'auto', pb: 6 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBack />} onClick={() => navigate('/accounting/invoices')}>{t('accounting.invoices.page.back')}</Button>
        <Typography variant="h5" fontWeight={800} sx={{ mr: 0.5 }}>{inv.invoiceNumber}</Typography>
        <Chip size="small" label={t(`accounting.invoices.status.${inv.status}`)} color={STATUS_COLOR[inv.status]} />
        {isOverdueInvoice(inv) && <Chip size="small" label={t('accounting.invoices.status.overdue')} color="error" variant="outlined" />}
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="outlined" startIcon={<PictureAsPdfOutlined />} onClick={() => actions.openPdf(inv)}>{t('accounting.invoices.page.pdf')}</Button>
        {canManage && isDraft && <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => navigate(`/accounting/invoices/${inv._id}/edit`)}>{t('accounting.invoices.actions.edit')}</Button>}
        {canManage && isDraft && <Button variant="contained" startIcon={<SendOutlined />} onClick={() => actions.openSend(inv)}>{t('accounting.invoices.actions.send')}</Button>}
        {canManage && isOpen && <Button variant="contained" startIcon={<PaymentOutlined />} onClick={() => actions.openPayment(inv)}>{t('accounting.invoices.actions.recordPayment')}</Button>}
        <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)} aria-label={t('accounting.invoices.table.actions')}><MoreVert /></IconButton>
        <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu}>
          {canManage && (
            <MenuItem onClick={afterMenu(() => navigate(`/accounting/invoices/new?duplicate=${inv._id}`))}>
              <ListItemIcon><FileCopyOutlined fontSize="small" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.duplicate')}</ListItemText>
            </MenuItem>
          )}
          {fiscal && (
            <MenuItem onClick={afterMenu(() => navigate('/accounting/credit-notes', { state: { invoiceId: inv._id } }))}>
              <ListItemIcon><AssignmentReturnOutlined fontSize="small" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.issueCreditNote')}</ListItemText>
            </MenuItem>
          )}
          {fiscal && (
            <MenuItem onClick={afterMenu(() => navigate('/accounting/debit-notes', { state: { debitNoteInvoiceId: inv._id } }))}>
              <ListItemIcon><PostAddOutlined fontSize="small" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.issueDebitNote')}</ListItemText>
            </MenuItem>
          )}
          {canVoid && inv.status !== 'void' && inv.amountPaid === 0 && (
            <MenuItem onClick={afterMenu(() => actions.openVoid(inv))} sx={{ color: 'error.main' }}>
              <ListItemIcon><BlockOutlined fontSize="small" color="error" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.void')}</ListItemText>
            </MenuItem>
          )}
        </Menu>
      </Stack>

      {sendError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSendError(null)}><strong>{t('accounting.invoices.page.issueFailed')}</strong> {sendError}</Alert>}

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' }, alignItems: 'start' }}>
        {/* The document */}
        <Paper variant="outlined" sx={{ position: 'relative', overflow: 'hidden', p: { xs: 2, md: 5 }, borderTop: 4, borderTopColor: 'primary.main', boxShadow: '0 4px 24px rgba(18,26,51,0.06)' }}>
          {stamp && (
            <Typography aria-hidden sx={{ position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%, -50%) rotate(-30deg)', fontSize: { xs: 64, md: 110 }, fontWeight: 900, letterSpacing: 6, color: 'error.main', opacity: 0.07, pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap' }}>
              {stamp.toUpperCase()}
            </Typography>
          )}
          <InvoiceLetterhead issuer={meta?.issuer ?? null}>
            <Typography variant={ecf ? 'subtitle1' : 'h4'} fontWeight={800} color="primary.main" sx={{ letterSpacing: ecf ? 0 : '-0.02em', lineHeight: 1.15 }}>
              {ecfTitle ?? t('accounting.invoices.page.documentTitle')}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}><strong>No.</strong> {inv.invoiceNumber}</Typography>
            {ecf && <Typography variant="body2">e-NCF: {ecf.eNCF}</Typography>}
            {stamp && <Typography variant="caption" color="error.main" fontWeight={700}>{stamp.toUpperCase()} — {t('accounting.invoices.page.noFiscalValue')}</Typography>}
          </InvoiceLetterhead>

          <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { xs: '1fr', md: '1.15fr 1fr' }, mt: 4 }}>
            <Box>
              <Typography variant="overline" color="text.secondary" fontWeight={700}>{t('accounting.invoices.page.billTo')}</Typography>
              <Typography variant="body1" fontWeight={700}>{customerLabel(inv)}</Typography>
              <Box sx={{ color: 'text.secondary' }}>
                {customer?.rnc && <Typography variant="body2">RNC / Cédula: {customer.rnc}</Typography>}
                {customer?.address && <Typography variant="body2">{customer.address}</Typography>}
                {(customer?.email || inv.individualCustomer?.email) && <Typography variant="body2">{customer?.email || inv.individualCustomer?.email}</Typography>}
                {(customer?.phone || inv.individualCustomer?.phone) && <Typography variant="body2">{customer?.phone || inv.individualCustomer?.phone}</Typography>}
              </Box>
            </Box>
            <Box sx={{ display: 'grid', gap: 0.75, alignContent: 'start' }}>
              <MetaRow label={t('accounting.invoices.page.issueDate')} value={fmtDate(inv.issueDate)} />
              {inv.dueDate && <MetaRow label={t('accounting.invoices.page.dueDate')} value={fmtDate(inv.dueDate)} />}
              {inv.reference && <MetaRow label={t('accounting.invoices.page.reference')} value={inv.reference} />}
            </Box>
          </Box>

          {isXs ? (
            <Box sx={{ mt: 3 }}>
              {inv.lineItems.map((l, i) => {
                const product = l.product && typeof l.product === 'object' ? l.product : null;
                return (
                  <Box key={l._id || i} sx={{ py: 1.5, borderTop: 1, borderColor: 'divider' }}>
                    <Stack direction="row" justifyContent="space-between" spacing={2}>
                      <Typography variant="body2" fontWeight={600}>{l.description}</Typography>
                      <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatMoney(l.lineTotal)}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {l.quantity} × {formatMoney(l.unitPrice)}{l.discountPercent > 0 ? ` · −${l.discountPercent}%` : ''} · {l.taxRate > 0 ? `ITBIS ${l.taxRate}%` : t('accounting.invoices.page.exempt')}{product ? ` · ${product.sku}` : ''}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          ) : (
          <Box sx={{ mt: 4, overflowX: 'auto' }}>
            <Box sx={{ minWidth: 640 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: COLS, gap: 1, px: 1, py: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                {['#', 'item', 'qty', 'price', 'discount', 'tax', 'amount'].map((k, i) => (
                  <Typography key={k} variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: i < 2 ? 'left' : 'right' }}>
                    {k === '#' ? '#' : t(`accounting.invoices.page.cols.${k}`)}
                  </Typography>
                ))}
              </Box>
              {inv.lineItems.map((l, i) => {
                const product = l.product && typeof l.product === 'object' ? l.product : null;
                return (
                  <Box key={l._id || i} sx={{ display: 'grid', gridTemplateColumns: COLS, gap: 1, px: 1, py: 1.25, borderBottom: 1, borderColor: 'divider', alignItems: 'start' }}>
                    <Typography variant="body2" color="text.secondary">{i + 1}</Typography>
                    <Box>
                      <Typography variant="body2">{l.description}</Typography>
                      {product && <Typography variant="caption" color="text.secondary">{product.sku}</Typography>}
                    </Box>
                    <Typography variant="body2" sx={{ textAlign: 'right' }}>{l.quantity}</Typography>
                    <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(l.unitPrice)}</Typography>
                    <Typography variant="body2" sx={{ textAlign: 'right' }}>{l.discountPercent > 0 ? `${l.discountPercent}%` : '—'}</Typography>
                    <Typography variant="body2" sx={{ textAlign: 'right' }}>{l.taxRate > 0 ? `${l.taxRate}%` : t('accounting.invoices.page.exempt')}</Typography>
                    <Typography variant="body2" fontWeight={600} sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(l.lineTotal)}</Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>
          )}

          <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { xs: '1fr', md: '1fr 300px' }, mt: 4, alignItems: 'start' }}>
            <Box>
              {inv.notes && (<>
                <Typography variant="overline" color="text.secondary" fontWeight={700}>{t('accounting.invoices.page.notes')}</Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{inv.notes}</Typography>
              </>)}
            </Box>
            <DocTotals invoice={inv} />
          </Box>
        </Paper>

        {/* Rail */}
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="overline" color="text.secondary" fontWeight={700}>{t('accounting.invoices.page.rail.collection')}</Typography>
            <Typography variant="h5" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', mt: 0.5, color: inv.status === 'paid' ? 'success.dark' : 'text.primary' }}>
              {formatMoney(inv.balanceDue)}
            </Typography>
            <Typography variant="body2" color="text.secondary">{t('accounting.invoices.page.rail.balanceOf', { total: formatMoney(inv.total) })}</Typography>
            {!isDraft && inv.status !== 'void' && (
              <>
                <LinearProgress variant="determinate" value={paidPct} color={inv.status === 'paid' ? 'success' : 'primary'} sx={{ my: 1.5, height: 8, borderRadius: 4 }} aria-label={t('accounting.invoices.table.amountPaid')} />
                <Typography variant="caption" color="text.secondary">{t('accounting.invoices.page.rail.paidPct', { pct: paidPct, amount: formatMoney(inv.amountPaid) })}</Typography>
              </>
            )}
            {isOpen && daysToDue !== null && (
              <Typography variant="body2" fontWeight={600} sx={{ mt: 1.25 }} color={daysToDue < 0 ? 'error.main' : 'text.primary'}>
                {daysToDue < 0 ? t('accounting.invoices.page.rail.overdueBy', { count: -daysToDue }) : daysToDue === 0 ? t('accounting.invoices.page.rail.dueToday') : t('accounting.invoices.page.rail.dueIn', { count: daysToDue })}
              </Typography>
            )}
            {isDraft && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t('accounting.invoices.page.rail.draftNote')}</Typography>}
            {canManage && isOpen && <Button fullWidth variant="contained" startIcon={<PaymentOutlined />} sx={{ mt: 2 }} onClick={() => actions.openPayment(inv)}>{t('accounting.invoices.actions.recordPayment')}</Button>}
          </Paper>

          {inv.payments.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="overline" color="text.secondary" fontWeight={700}>{t('accounting.invoices.dialog.paymentsTitle')}</Typography>
              <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, mt: 0.5 }}>
                {inv.payments.map((p, i) => (
                  <Stack component="li" key={p._id || i} direction="row" justifyContent="space-between" spacing={2} sx={{ py: 1, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600}>{t(`accounting.invoices.paymentMethod.${p.method}`)}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{fmtDate(p.date)}{p.reference ? ` · ${p.reference}` : ''}</Typography>
                    </Box>
                    <Typography variant="body2" fontWeight={700} color="success.dark" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.amount)}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          )}

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="overline" color="text.secondary" fontWeight={700}>{t('accounting.invoices.dialog.ecfTitle')}</Typography>
            {ecf ? (
              <Stack spacing={1} sx={{ mt: 0.5 }}>
                <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" fontWeight={700}>{ecfTitle}</Typography>
                  <EcfStatusBadge status={ecf.estadoECF} />
                </Stack>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{ecf.eNCF ?? t('fiscal.documents.noEncf', 'Number pending')}</Typography>
                  {ecf.eNCF && (
                    <Tooltip title={t('accounting.invoices.page.rail.copy')}>
                      <IconButton size="small" aria-label={t('accounting.invoices.page.rail.copy')} onClick={() => { navigator.clipboard?.writeText(ecf.eNCF as string); toast.success(t('accounting.invoices.page.rail.copied')); }}><ContentCopy sx={{ fontSize: 15 }} /></IconButton>
                    </Tooltip>
                  )}
                </Stack>
                {ecf.codigoSeguridad && <MetaRow label={t('accounting.invoices.page.rail.securityCode')} value={<span style={{ fontFamily: 'monospace' }}>{ecf.codigoSeguridad}</span>} />}
                {ecf.fechaFirmaDigital && <MetaRow label={t('accounting.invoices.page.rail.signedAt')} value={fmtDateTime(ecf.fechaFirmaDigital)} />}
                {ecf.mensaje && ecf.estadoECF !== 'Aceptado' && <Typography variant="caption" color="text.secondary">{ecf.mensaje}</Typography>}
                <Button size="small" endIcon={<OpenInNew />} onClick={() => navigate(`/accounting/fiscal?tab=documents&doc=${ecf._id}`)} sx={{ alignSelf: 'flex-start' }}>{t('fiscal.documents.openInFiscal', 'Open in e-invoices')}</Button>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{inv.status === 'void' ? t('accounting.invoices.page.rail.ecfNone') : t('accounting.invoices.page.rail.ecfPending')}</Typography>
            )}
          </Paper>

          {(creditNotes.length > 0 || debitNotes.length > 0) && (
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="overline" color="text.secondary" fontWeight={700}>{t('accounting.invoices.page.rail.related')}</Typography>
              <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, mt: 0.5 }}>
                {creditNotes.map((n) => (
                  <Stack component="li" key={n._id} direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ py: 0.75 }}>
                    <Box><Typography variant="body2" fontWeight={600}>{n.creditNoteNumber}</Typography><Typography variant="caption" color="text.secondary">{t('accounting.invoices.page.rail.creditNote')} · {t(`accounting.creditNotes.status.${n.status}`, n.status)}</Typography></Box>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>- {formatMoney(n.total)}</Typography>
                  </Stack>
                ))}
                {debitNotes.map((n) => (
                  <Stack component="li" key={n._id} direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ py: 0.75 }}>
                    <Box><Typography variant="body2" fontWeight={600}>{n.debitNoteNumber}</Typography><Typography variant="caption" color="text.secondary">{t('accounting.invoices.page.rail.debitNote')} · {t(`accounting.debitNotes.status.${n.status}`, n.status)}</Typography></Box>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>+ {formatMoney(n.total)}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          )}

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="overline" color="text.secondary" fontWeight={700}>{t('accounting.invoices.page.rail.customer')}</Typography>
            <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5 }}>{customerLabel(inv)}</Typography>
            {inv.isIndividual && <Typography variant="caption" color="text.secondary">{t('accounting.invoices.page.customerModeConsumer')}</Typography>}
            {customer && (
              <Button size="small" sx={{ mt: 1, ml: -1 }} onClick={() => navigate('/accounting/invoices', { state: { customerId: customer._id } })}>{t('accounting.invoices.page.rail.customerInvoices')}</Button>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              {t('accounting.invoices.page.rail.created', { date: fmtDateTime(inv.createdAt) })}
            </Typography>
          </Paper>
        </Stack>
      </Box>

      {actions.dialogs}
    </Box>
  );
};

const MetaRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="baseline">
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="body2" fontWeight={600} component="div" sx={{ textAlign: 'right' }}>{value}</Typography>
  </Stack>
);

const DocTotals: React.FC<{ invoice: Invoice }> = ({ invoice: inv }) => {
  const { t } = useTranslation();
  const gross = inv.lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const discount = Math.round((gross - inv.subtotal) * 100) / 100;
  const byRate = new Map<number, number>();
  inv.lineItems.forEach((l) => { if (l.taxRate > 0) byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? 0) + l.taxAmount); });
  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={strong ? 700 : 400} sx={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    </Box>
  );
  return (
    <Box>
      <Row label={t('accounting.invoices.page.totals.gross')} value={formatMoney(gross)} />
      {discount > 0.005 && <Row label={t('accounting.invoices.page.totals.discount')} value={`- ${formatMoney(discount)}`} />}
      {byRate.size === 0 ? <Row label="ITBIS" value={formatMoney(0)} /> : [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, tax]) => <Row key={rate} label={t('accounting.invoices.page.totals.itbis', { rate })} value={formatMoney(tax)} />)}
      <Box sx={{ mt: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography fontWeight={800} color="primary.main">{t('accounting.invoices.page.totals.total')}</Typography>
        <Typography variant="h6" fontWeight={800} color="primary.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(inv.total)}</Typography>
      </Box>
      {inv.status !== 'draft' && (
        <Box sx={{ mt: 1 }}>
          <Row label={t('accounting.invoices.table.amountPaid')} value={formatMoney(inv.amountPaid)} />
          <Row label={t('accounting.invoices.table.balanceDue')} value={formatMoney(inv.balanceDue)} strong />
        </Box>
      )}
    </Box>
  );
};

export default InvoiceDetail;
