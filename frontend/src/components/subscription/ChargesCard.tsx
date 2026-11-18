import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Divider, IconButton, InputAdornment, LinearProgress, Paper, Stack, Table,
  TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { ExpandLess, ExpandMore, PictureAsPdfOutlined, SearchOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { downloadBlob, formatDop, periodLabel } from '../fiscal/fiscalUi';
import { subscriptionService } from '../../services/subscriptionApi';
import type { ChargeStatusFilter, SubscriptionCharge, SubscriptionChargesPage } from '../../types/subscription';

const PAGE_SIZE = 12;
const SEARCH_DELAY_MS = 300;
const CHARGE_COLOR: Record<string, 'success' | 'info' | 'warning' | 'default'> = { paid: 'success', open: 'info', partial: 'warning', void: 'default' };

interface Props {
  /** Where HandyPay sends the tenant back to after paying. */
  returnUrl: string;
  /** Bank-transfer instructions from the platform settings, when there are any. */
  paymentInstructions?: string | null;
  /** Bumped by the page whenever something outside this card may have changed a charge (a payment came back, a plan changed). */
  refreshKey: number;
  /** Reports an error on the page's banner. */
  onError: (message: string) => void;
  /** Turns a failed request into the text to show. */
  errorText: (err: unknown) => string;
}

/**
 * The tenant's monthly charges. A charge is added every month, so the list is paged on the server
 * and can be filtered by status and searched by number or month; the outstanding balance is shown
 * above the table so an unpaid charge on another page is never out of sight.
 */
const ChargesCard: React.FC<Props> = ({ returnUrl, paymentInstructions, refreshKey, onError, errorText }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('es') ? 'es' : 'en';

  const [status, setStatus] = useState<ChargeStatusFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SubscriptionChargesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, SubscriptionCharge | 'loading'>>({});
  const [paying, setPaying] = useState(false);
  const latest = useRef(0);
  const appliedSearch = useRef('');

  // Typing waits a moment before it asks the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      if (next === appliedSearch.current) return;
      appliedSearch.current = next;
      setSearch(next);
      setPage(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const res = await subscriptionService.charges({ page: page + 1, limit: PAGE_SIZE, status, search: search || undefined });
      if (ticket !== latest.current) return;
      setResult(res.data);
      setFailed(false);
      // A page that no longer exists (a charge went away) falls back to the last one.
      if (page > 0 && res.data.data.length === 0 && res.data.meta.total > 0) setPage(res.data.meta.pages - 1);
    } catch (err) {
      if (ticket !== latest.current) return;
      setFailed(true);
      onError(errorText(err));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [page, status, search, onError, errorText]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // What was open may have changed (a payment landed): reopen from the server on the next click.
  useEffect(() => { setExpanded({}); }, [refreshKey, page, status, search]);

  const toggle = async (id: string) => {
    if (expanded[id]) {
      setExpanded(({ [id]: _closed, ...rest }) => rest);
      return;
    }
    setExpanded((e) => ({ ...e, [id]: 'loading' }));
    try {
      const r = await subscriptionService.charge(id);
      setExpanded((e) => (e[id] ? { ...e, [id]: r.data.data } : e));
    } catch (err) {
      setExpanded(({ [id]: _failed, ...rest }) => rest);
      onError(errorText(err));
    }
  };

  const pay = async (charge: SubscriptionCharge) => {
    setPaying(true);
    try {
      const r = await subscriptionService.pay(charge.id, returnUrl);
      window.location.assign(r.data.data.url);
    } catch (err) {
      onError(errorText(err));
      setPaying(false);
    }
  };

  const downloadEcf = async (paymentId: string, eNCF: string | null) => {
    try {
      const r = await subscriptionService.ecfPdf(paymentId);
      downloadBlob(r.data, `${eNCF ?? paymentId}.pdf`);
    } catch (err) {
      onError(errorText(err));
    }
  };

  const rows = result?.data ?? [];
  const total = result?.meta.total ?? 0;
  const summary = result?.summary;
  const filtering = status !== 'all' || search !== '';
  const firstLoad = result === null && loading;

  return (
    <Paper variant="outlined">
      <Box sx={{ p: 2.5, pb: 1.5 }}>
        <Typography variant="h6" fontWeight={700}>{t('subscription.charges.title', 'Charges')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('subscription.charges.help', 'Each month is charged at the start of the next one. Your electronic invoice (e-CF) is issued when the payment is received.')}
        </Typography>
      </Box>

      {summary && summary.outstanding > 0 && (
        <Box sx={{ px: 2.5, pb: 1.5 }}>
          <Alert severity={summary.overdueCount > 0 ? 'error' : 'info'} variant="outlined">
            {summary.overdueCount > 0
              ? t('subscription.charges.summaryOverdue', 'You owe {{amount}}, of which {{overdue}} is overdue ({{count}} charges).', { amount: formatDop(summary.outstanding), overdue: formatDop(summary.overdueBalance), count: summary.overdueCount })
              : t('subscription.charges.summaryOutstanding', 'You owe {{amount}}.', { amount: formatDop(summary.outstanding) })}
          </Alert>
        </Box>
      )}

      {/* With no charges at all there is nothing to filter. */}
      {(filtering || total > 0) && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ px: 2.5, pb: 1.5 }}>
          <ToggleButtonGroup
            exclusive size="small" value={status} aria-label={t('subscription.charges.statusFilter', 'Filter by status')}
            onChange={(_, v: ChargeStatusFilter | null) => { if (v) { setStatus(v); setPage(0); } }}
          >
            <ToggleButton value="all">{t('subscription.charges.filter.all', 'All')}</ToggleButton>
            <ToggleButton value="pending">{t('subscription.charges.filter.pending', 'Pending')}</ToggleButton>
            <ToggleButton value="paid">{t('subscription.charges.filter.paid', 'Paid')}</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            size="small" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} sx={{ minWidth: { sm: 260 } }}
            placeholder={t('subscription.charges.searchPlaceholder', 'Search by number or month (2026-03)')}
            inputProps={{ 'aria-label': t('subscription.charges.search', 'Search charges'), maxLength: 40 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlined fontSize="small" /></InputAdornment> }}
          />
        </Stack>
      )}

      {firstLoad && <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>}
      {failed && !result && (
        <Box sx={{ px: 2.5, pb: 2.5 }}>
          <Button variant="outlined" onClick={load}>{t('subscription.charges.retry', 'Try again')}</Button>
        </Box>
      )}

      {result && total === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, pb: 2.5 }}>
          {filtering ? t('subscription.charges.noMatch', 'No charges match.') : t('subscription.charges.none', 'No charges yet.')}
        </Typography>
      )}

      {result && total > 0 && (
        <>
          {loading && <LinearProgress sx={{ height: 2 }} />}
          <TableContainer sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
            <Table size="small" aria-label={t('subscription.charges.title', 'Charges')}>
              <TableHead>
                <TableRow>
                  <TableCell />
                  <TableCell>{t('subscription.charges.month', 'Month')}</TableCell>
                  <TableCell>{t('subscription.charges.number', 'Number')}</TableCell>
                  <TableCell align="right">{t('subscription.charges.total', 'Total')}</TableCell>
                  <TableCell align="right">{t('subscription.charges.balance', 'Balance')}</TableCell>
                  <TableCell>{t('subscription.charges.due', 'Due')}</TableCell>
                  <TableCell>{t('subscription.charges.status', 'Status')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((c) => {
                  const detail = expanded[c.id];
                  return (
                    <React.Fragment key={c.id}>
                      <TableRow hover>
                        <TableCell padding="checkbox">
                          <IconButton size="small" aria-label={t('subscription.charges.details', 'Show details')} aria-expanded={!!detail} onClick={() => toggle(c.id)}>
                            {detail ? <ExpandLess /> : <ExpandMore />}
                          </IconButton>
                        </TableCell>
                        <TableCell sx={{ textTransform: 'capitalize' }}>{periodLabel(c.period, lang)}</TableCell>
                        <TableCell>{c.number}</TableCell>
                        <TableCell align="right">{formatDop(c.total)}</TableCell>
                        <TableCell align="right">{formatDop(c.balance)}</TableCell>
                        <TableCell>{c.dueDate.split('-').reverse().join('/')}</TableCell>
                        <TableCell>
                          <Chip size="small" color={c.overdue ? 'error' : CHARGE_COLOR[c.status]} label={c.overdue ? t('subscription.charges.overdue', 'Overdue') : t(`subscription.charges.statuses.${c.status}`, c.status)} />
                        </TableCell>
                        <TableCell align="right">
                          {(c.status === 'open' || c.status === 'partial') && c.balance > 0 && (
                            <Button size="small" variant="contained" disabled={paying} onClick={() => pay(c)}>{t('subscription.pay.cta', 'Pay online')}</Button>
                          )}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={8} sx={{ py: 0, borderBottom: detail ? undefined : 'none' }}>
                          <Collapse in={!!detail} unmountOnExit>
                            {detail === 'loading' ? <LinearProgress sx={{ my: 1 }} /> : detail && (
                              <Box sx={{ py: 1.5 }}>
                                {detail.lines.map((l, i) => (
                                  <Stack key={i} direction="row" justifyContent="space-between" sx={{ py: 0.25 }}>
                                    <Typography variant="body2">{l.description}</Typography>
                                    <Typography variant="body2">{formatDop(l.amount)}</Typography>
                                  </Stack>
                                ))}
                                <Divider sx={{ my: 1 }} />
                                <Stack direction="row" justifyContent="space-between"><Typography variant="body2">{t('subscription.charges.subtotal', 'Subtotal')}</Typography><Typography variant="body2">{formatDop(detail.subtotal)}</Typography></Stack>
                                <Stack direction="row" justifyContent="space-between"><Typography variant="body2">ITBIS</Typography><Typography variant="body2">{formatDop(detail.itbis)}</Typography></Stack>
                                {(detail.payments ?? []).map((pmt) => (
                                  <Stack key={pmt.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
                                    <Typography variant="body2" color="text.secondary">
                                      {t('subscription.charges.paid', 'Paid {{amount}} on {{date}}', { amount: formatDop(pmt.amount), date: new Date(pmt.paidAt).toLocaleDateString(lang) })}
                                      {pmt.ecf?.eNCF ? ` · e-CF ${pmt.ecf.eNCF}` : ''}
                                    </Typography>
                                    {pmt.ecf?.hasDocument && (
                                      <Button size="small" startIcon={<PictureAsPdfOutlined />} onClick={() => downloadEcf(pmt.id, pmt.ecf!.eNCF)}>e-CF</Button>
                                    )}
                                  </Stack>
                                ))}
                              </Box>
                            )}
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div" count={total} page={Math.min(page, Math.max(0, (result.meta.pages ?? 1) - 1))} rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]}
            onPageChange={(_, p) => setPage(p)}
            labelDisplayedRows={({ from, to, count }) => t('subscription.charges.range', '{{from}}–{{to}} of {{count}}', { from, to, count })}
          />
        </>
      )}

      {paymentInstructions && (
        <Box sx={{ p: 2.5, pt: 1.5 }}>
          <Typography variant="subtitle2">{t('subscription.charges.otherWays', 'You can also pay by transfer')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>{paymentInstructions}</Typography>
        </Box>
      )}
    </Paper>
  );
};

export default ChargesCard;
