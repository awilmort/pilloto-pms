import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, InputAdornment, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { ElectronicInvoice } from '../../types';
import EcfStatusBadge from '../admin/EcfStatusBadge';
import FiscalDocumentDrawer from './FiscalDocumentDrawer';
import { downloadBlob, ESTADO_META, estadoKey, fiscalErrorMessage, formatDateTime, formatDop } from './fiscalUi';
import i18n from '../../i18n';

interface Props {
  canIssue: boolean;
  /** A document to open as soon as the list loads (deep link from another screen). */
  openId?: string;
  /** Called after anything changed, so the page can refresh its alerts. */
  onChanged?: () => void;
  /** Start filtered to a state (`attention` = everything that needs a person). */
  initialEstado?: string;
  /** Narrow the list to one source (e.g. an Accounting invoice). */
  fixedQuery?: { folioId?: string; paymentId?: string; invoiceId?: string };
}

const TIPOS = ['E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47'];
const AUTO_REFRESH_MS = 20_000;

/**
 * Every e-CF the company issued, from either app. Server-paged and searchable; while any document
 * on screen is still moving toward DGII's verdict the list quietly refreshes, so staff see the
 * answer arrive without pressing anything.
 */
const FiscalDocumentsTab: React.FC<Props> = ({ canIssue, openId, onChanged, fixedQuery, initialEstado }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ElectronicInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [estado, setEstado] = useState(initialEstado ?? '');
  const [tipo, setTipo] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<ElectronicInvoice | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => { setDebouncedQ(q.trim()); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const query = useMemo(() => ({
    page: page + 1,
    limit: rowsPerPage,
    ...(debouncedQ ? { q: debouncedQ } : {}),
    ...(estado ? { estadoECF: estado === 'attention' ? ['Rechazado', 'Error', 'Sin Resolver', 'Aceptado Condicional'].join(',') : estado } : {}),
    ...(tipo ? { tipo } : {}),
    ...(from ? { fechaInicio: `${from}T00:00:00-04:00` } : {}),
    ...(to ? { fechaFin: `${to}T23:59:59-04:00` } : {}),
    ...fixedQuery,
  }), [page, rowsPerPage, debouncedQ, estado, tipo, from, to, fixedQuery]);

  const load = useCallback(async (quiet = false) => {
    const mine = ++requestId.current;
    if (!quiet) setLoading(true);
    try {
      const res = await fiscalService.getDocuments(query);
      if (mine !== requestId.current) return; // a newer request superseded this one
      setRows(res.data.data ?? []);
      setTotal(res.data.meta?.total ?? 0);
      setError(null);
    } catch (err) {
      if (mine === requestId.current) setError(fiscalErrorMessage(err, t));
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, [query, t]);

  useEffect(() => { void load(); }, [load]);

  // A deep link (?doc=…) opens that document once, whatever page of the list it is on.
  useEffect(() => {
    if (!openId) return;
    fiscalService.getDocument(openId).then((res) => setSelected(res.data.data as ElectronicInvoice)).catch(() => undefined);
  }, [openId]);

  const anyBusy = rows.some((r) => ESTADO_META[r.estadoECF]?.busy);
  useEffect(() => {
    if (!anyBusy) return undefined;
    const id = setInterval(() => { if (!document.hidden) void load(true); }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [anyBusy, load]);

  const changed = (doc?: ElectronicInvoice) => {
    if (doc) setRows((rs) => rs.map((r) => (r._id === doc._id ? doc : r)));
    void load(true);
    onChanged?.();
  };

  const exportCsv = () => {
    const header = ['e-NCF', 'Tipo', 'Fecha', 'Comprador', 'RNC', 'Total', 'ITBIS', 'Estado'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [r.eNCF ?? '', r.tipo, formatDateTime(r.issuedAt, i18n.language), r.buyerName ?? '', r.buyerRnc ?? '', r.totalFactura, r.totalImpuestos, r.estadoECF].map(esc).join(','));
    downloadBlob(new Blob(['﻿' + [header.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' }), `e-cf-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const filtered = Boolean(debouncedQ || estado || tipo || from || to);

  return (
    <Box>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} flexWrap="wrap" useFlexGap>
          <TextField
            size="small" value={q} onChange={(e) => setQ(e.target.value)} sx={{ minWidth: { md: 260 } }}
            placeholder={t('fiscal.documents.search', 'Search e-NCF, buyer, RNC or reference')}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            inputProps={{ 'aria-label': t('fiscal.documents.search', 'Search e-NCF, buyer, RNC or reference') }}
          />
          <TextField select size="small" label={t('fiscal.documents.status', 'Status')} value={estado} onChange={(e) => { setEstado(e.target.value); setPage(0); }} sx={{ minWidth: 190 }}>
            <MenuItem value="">{t('common.all', 'All')}</MenuItem>
            <MenuItem value="attention">{t('fiscal.documents.needsAttention', 'Needs attention')}</MenuItem>
            {Object.keys(ESTADO_META).map((s) => <MenuItem key={s} value={s}>{t(estadoKey(s), s)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label={t('fiscal.documents.type', 'Type')} value={tipo} onChange={(e) => { setTipo(e.target.value); setPage(0); }} sx={{ minWidth: 190 }}>
            <MenuItem value="">{t('common.all', 'All')}</MenuItem>
            {TIPOS.map((x) => <MenuItem key={x} value={x}>{t(`fiscal.tipo.${x}`, x)}</MenuItem>)}
          </TextField>
          <TextField size="small" type="date" label={t('fiscal.documents.from', 'From')} value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label={t('fiscal.documents.to', 'To')} value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} InputLabelProps={{ shrink: true }} />
          {filtered && <Button size="small" onClick={() => { setQ(''); setEstado(''); setTipo(''); setFrom(''); setTo(''); setPage(0); }}>{t('fiscal.documents.clear', 'Clear filters')}</Button>}
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t('fiscal.documents.exportHint', 'Download what is on this page as CSV')}>
            <span><IconButton onClick={exportCsv} disabled={rows.length === 0} aria-label={t('fiscal.documents.export', 'Export CSV')}><FileDownloadOutlinedIcon /></IconButton></span>
          </Tooltip>
          <Tooltip title={t('fiscal.documents.reload', 'Reload')}>
            <IconButton onClick={() => load()} aria-label={t('fiscal.documents.reload', 'Reload')}><RefreshIcon /></IconButton>
          </Tooltip>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => load()}>{t('fiscal.retry', 'Retry')}</Button>}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" aria-label={t('fiscal.documents.tableLabel', 'Electronic invoices')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('fiscal.documents.encf', 'e-NCF')}</TableCell>
                <TableCell>{t('fiscal.documents.type', 'Type')}</TableCell>
                <TableCell>{t('fiscal.documents.date', 'Date')}</TableCell>
                <TableCell>{t('fiscal.documents.buyer', 'Buyer')}</TableCell>
                <TableCell align="right">{t('fiscal.documents.total', 'Total')}</TableCell>
                <TableCell>{t('fiscal.documents.status', 'Status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5 }}><CircularProgress size={24} /></TableCell></TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 5 }}>
                    <Typography color="text.secondary">
                      {filtered ? t('fiscal.documents.noMatches', 'No documents match these filters.') : t('fiscal.documents.empty', 'No electronic invoices yet.')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow
                  key={r._id} hover tabIndex={0} sx={{ cursor: 'pointer' }} onClick={() => setSelected(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r); } }}
                  aria-label={`${r.eNCF ?? t('fiscal.documents.noEncf', 'Number pending')} ${r.buyerName ?? ''}`}
                >
                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace">{r.eNCF ?? <em>{t('fiscal.documents.noEncf', 'Number pending')}</em>}</Typography>
                    {r.numeroFacturaInterna && <Typography variant="caption" color="text.secondary">{r.numeroFacturaInterna}</Typography>}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={r.tipo} />
                    {r.environment && r.environment !== 'ecf' && <Chip size="small" color="warning" label={t('fiscal.documents.test', 'TEST')} sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.issuedAt, i18n.language)}</TableCell>
                  <TableCell sx={{ maxWidth: 220 }}><Typography variant="body2" noWrap>{r.buyerName || r.buyerRnc || '—'}</Typography></TableCell>
                  <TableCell align="right">{formatDop(r.totalFactura, i18n.language)}</TableCell>
                  <TableCell><EcfStatusBadge status={r.estadoECF} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div" count={total} page={page} rowsPerPage={rowsPerPage} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(_, p) => setPage(p)} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          labelRowsPerPage={t('common.rowsPerPage', 'Rows per page')}
        />
      </Paper>

      <FiscalDocumentDrawer document={selected} canIssue={canIssue} onClose={() => setSelected(null)} onChanged={changed} />
    </Box>
  );
};

export default FiscalDocumentsTab;
