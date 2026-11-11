import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TablePagination, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { ReceivedDocument, ReceivedDocumentDetail } from '../../types';
import FiscalPdfDialog from './FiscalPdfDialog';
import { chipTone, downloadBlob, fiscalErrorMessage, formatDate, formatDateTime, formatDop, formatTaxId } from './fiscalUi';
import i18n from '../../i18n';

type Filter = 'undecided' | 'approved' | 'rejected' | '';

interface Props {
  /** May the user approve or reject (commercial approval)? */
  canDecide: boolean;
  /** Reports how many documents await a decision, for the tab's badge. */
  onPendingCount?: (count: number) => void;
}

const DECISION_TONE = { approved: 'success', rejected: 'error' } as const;

/**
 * Documents other companies issued to this one, and the company's commercial approval of each:
 * approve or reject, once, signed with its certificate and sent to DGII and to the issuer.
 * BillingSoft receives them (it holds the company's reception URL); this is the inbox.
 */
const FiscalReceivedTab: React.FC<Props> = ({ canDecide, onPendingCount }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('undecided');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ReceivedDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceivedDocumentDetail | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => { setDebouncedQ(q.trim()); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fiscalService.getReceived({ page: page + 1, ...(filter ? { filter } : {}), ...(debouncedQ ? { q: debouncedQ } : {}) });
      setRows(res.data.data ?? []);
      setTotal(res.data.meta?.total ?? 0);
      setPageSize(res.data.meta?.limit ?? 25);
      setError(null);
      if (filter === 'undecided' && !debouncedQ) onPendingCount?.(res.data.meta?.total ?? 0);
    } catch (err) {
      setError(fiscalErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  }, [page, filter, debouncedQ, onPendingCount, t]);

  useEffect(() => { void load(); }, [load]);

  const open = async (id: string) => {
    setOpeningId(id);
    try {
      setDetail((await fiscalService.getReceivedOne(id)).data.data as ReceivedDocumentDetail);
    } catch (err) {
      setError(fiscalErrorMessage(err, t));
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <Box>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v: Filter | null) => { if (v !== null) { setFilter(v); setPage(0); } }} aria-label={t('fiscal.received.filter', 'Filter received documents')}>
            <ToggleButton value="undecided">{t('fiscal.received.undecided', 'Awaiting decision')}</ToggleButton>
            <ToggleButton value="approved">{t('fiscal.received.approved', 'Approved')}</ToggleButton>
            <ToggleButton value="rejected">{t('fiscal.received.rejected', 'Rejected')}</ToggleButton>
            <ToggleButton value="">{t('common.all', 'All')}</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            size="small" value={q} onChange={(e) => setQ(e.target.value)} sx={{ minWidth: { md: 280 } }}
            placeholder={t('fiscal.received.search', 'Search issuer, RNC or e-NCF')}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            inputProps={{ 'aria-label': t('fiscal.received.search', 'Search issuer, RNC or e-NCF') }}
          />
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" aria-label={t('fiscal.received.tableLabel', 'Received documents')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('fiscal.received.issuer', 'Issuer')}</TableCell>
                <TableCell>{t('fiscal.documents.encf', 'e-NCF')}</TableCell>
                <TableCell>{t('fiscal.documents.date', 'Date')}</TableCell>
                <TableCell align="right">{t('fiscal.documents.total', 'Total')}</TableCell>
                <TableCell>{t('fiscal.received.decision', 'Decision')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && rows.length === 0 && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5 }}><CircularProgress size={24} /></TableCell></TableRow>}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5 }}>
                  <Typography color="text.secondary">
                    {filter === 'undecided' && !debouncedQ ? t('fiscal.received.nothingPending', 'Nothing is waiting for your decision.') : t('fiscal.received.empty', 'No received documents match.')}
                  </Typography>
                </TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow
                  key={r.id} hover tabIndex={0} sx={{ cursor: 'pointer' }} onClick={() => open(r.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void open(r.id); } }}
                >
                  <TableCell><Typography variant="body2" noWrap maxWidth={260}>{r.issuerName}</Typography><Typography variant="caption" color="text.secondary">{formatTaxId(r.issuerRnc)}</Typography></TableCell>
                  <TableCell><Typography variant="body2" fontFamily="monospace">{r.encf}</Typography></TableCell>
                  <TableCell>{formatDate(r.issuedOn, i18n.language)}</TableCell>
                  <TableCell align="right">{formatDop(r.total, i18n.language)}</TableCell>
                  <TableCell>
                    {openingId === r.id ? <CircularProgress size={16} /> : r.decision
                      ? <Chip size="small" color={DECISION_TONE[r.decision]} label={t(`fiscal.received.${r.decision}`, r.decision)} />
                      : <Chip size="small" {...chipTone('warning')} label={t('fiscal.received.pending', 'Pending')} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[pageSize]} onPageChange={(_, p) => setPage(p)} labelRowsPerPage={t('common.rowsPerPage', 'Rows per page')} />
      </Paper>

      {detail && <ReceivedDetailDialog doc={detail} canDecide={canDecide} onClose={() => setDetail(null)} onChanged={(d) => { setDetail(d); void load(); }} />}
    </Box>
  );
};

const ReceivedDetailDialog: React.FC<{ doc: ReceivedDocumentDetail; canDecide: boolean; onClose: () => void; onChanged: (d: ReceivedDocumentDetail) => void }> = ({ doc, canDecide, onClose, onChanged }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [pdf, setPdf] = useState(false);

  const act = async (name: string, work: () => Promise<ReceivedDocumentDetail | void>) => {
    setBusy(name);
    setError(null);
    try {
      const next = await work();
      if (next) onChanged(next);
    } catch (err: any) {
      const data = err?.response?.data;
      if (data instanceof Blob) { try { err.response.data = JSON.parse(await data.text()); } catch { /* generic */ } }
      setError(fiscalErrorMessage(err, t));
    } finally {
      setBusy(null);
    }
  };

  const decide = (decision: 'approved' | 'rejected') =>
    act(decision, async () => (await fiscalService.decideReceived(doc.id, decision, decision === 'rejected' ? reason.trim() : undefined)).data.data as ReceivedDocumentDetail).then(() => setRejecting(false));
  const file = (kind: 'xml' | 'acknowledgment') => act(kind, async () => { downloadBlob((await fiscalService.getReceivedFileBlob(doc.id, kind)).data, `${doc.encf}${kind === 'xml' ? '' : '-ARECF'}.xml`); });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="received-title">
      <DialogTitle id="received-title">{t('fiscal.received.detailTitle', 'Received document')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="h6" fontFamily="monospace">{doc.encf}</Typography>
            <Typography variant="body2" color="text.secondary">{doc.issuerName} · {formatTaxId(doc.issuerRnc)}</Typography>
          </Box>
          <Stack direction="row" spacing={3}>
            <Box><Typography variant="caption" color="text.secondary">{t('fiscal.documents.total', 'Total')}</Typography><Typography variant="body1" fontWeight={700}>{formatDop(doc.total, i18n.language)}</Typography></Box>
            {doc.itbisTotal && <Box><Typography variant="caption" color="text.secondary">ITBIS</Typography><Typography variant="body1">{formatDop(doc.itbisTotal, i18n.language)}</Typography></Box>}
            <Box><Typography variant="caption" color="text.secondary">{t('fiscal.received.receivedAt', 'Received')}</Typography><Typography variant="body1">{formatDateTime(doc.receivedAt, i18n.language)}</Typography></Box>
          </Stack>
          {doc.referencedNcf && <Typography variant="body2">{t('fiscal.documents.modifies', 'Modifies')}: <code>{doc.referencedNcf}</code></Typography>}

          {doc.approval ? (
            <Alert severity={doc.approval.decision === 'approved' ? 'success' : 'warning'}>
              {t(`fiscal.received.${doc.approval.decision}By`, { name: doc.approval.decidedBy, defaultValue: doc.approval.decision === 'approved' ? 'Approved by {{name}}' : 'Rejected by {{name}}' })}
              {doc.approval.reason && <Typography variant="body2">“{doc.approval.reason}”</Typography>}
              <Typography variant="caption" component="div">{formatDateTime(doc.approval.decidedAt, i18n.language)}</Typography>
            </Alert>
          ) : (
            <Alert severity="info">{t('fiscal.received.decideHint', 'Approving or rejecting is signed with your certificate and sent to DGII and to the issuer. It can be done once.')}</Alert>
          )}

          {doc.deliveries.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>{t('fiscal.received.deliveries', 'Where your decision went')}</Typography>
              {doc.deliveries.map((d) => (
                <Stack key={d.target} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
                  <Typography variant="body2" sx={{ minWidth: 70 }}>{t(`fiscal.received.target.${d.target}`, d.target)}</Typography>
                  <Chip size="small" color={d.status === 'delivered' ? 'success' : d.status === 'pending' ? 'info' : 'error'} label={t(`fiscal.received.delivery.${d.status}`, d.status)} />
                  {d.status === 'failed' && canDecide && (
                    <Button size="small" disabled={busy !== null} onClick={() => act(`retry-${d.target}`, async () => (await fiscalService.retryReceivedDelivery(doc.id, d.target)).data.data as ReceivedDocumentDetail)}>
                      {t('fiscal.received.retry', 'Try again')}
                    </Button>
                  )}
                  {d.messages[0] && <Typography variant="caption" color="text.secondary" noWrap>{d.messages[0]}</Typography>}
                </Stack>
              ))}
            </Box>
          )}
          {error && <Alert severity="error">{error}</Alert>}

          {rejecting && (
            <TextField autoFocus fullWidth size="small" required label={t('fiscal.received.reason', 'Reason for rejecting')} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 250))} helperText={t('fiscal.received.reasonHelp', 'Up to 250 characters. DGII and the issuer receive it.')} multiline minRows={2} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        <Button size="small" onClick={() => setPdf(true)}>PDF</Button>
        <Button size="small" onClick={() => file('xml')} disabled={busy !== null}>XML</Button>
        <Button size="small" onClick={() => file('acknowledgment')} disabled={busy !== null}>{t('fiscal.received.acknowledgment', 'Acknowledgment')}</Button>
        <Box sx={{ flex: 1 }} />
        {canDecide && !doc.approval && !rejecting && (
          <>
            <Button color="error" disabled={busy !== null} onClick={() => setRejecting(true)}>{t('fiscal.received.reject', 'Reject')}</Button>
            <Button variant="contained" color="success" disabled={busy !== null} onClick={() => decide('approved')} startIcon={busy === 'approved' ? <CircularProgress size={16} color="inherit" /> : undefined}>{t('fiscal.received.approve', 'Approve')}</Button>
          </>
        )}
        {rejecting && (
          <>
            <Button onClick={() => setRejecting(false)} disabled={busy !== null}>{t('common.cancel', 'Cancel')}</Button>
            <Button variant="contained" color="error" disabled={busy !== null || !reason.trim()} onClick={() => decide('rejected')} startIcon={busy === 'rejected' ? <CircularProgress size={16} color="inherit" /> : undefined}>{t('fiscal.received.confirmReject', 'Confirm rejection')}</Button>
          </>
        )}
        {!rejecting && <Button onClick={onClose}>{t('common.close', 'Close')}</Button>}
      </DialogActions>
      <FiscalPdfDialog open={pdf} title={`${doc.issuerName} ${doc.encf}`} filename={`${doc.encf}.pdf`} load={async () => (await fiscalService.getReceivedFileBlob(doc.id, 'pdf')).data} onClose={() => setPdf(false)} />
    </Dialog>
  );
};

export default FiscalReceivedTab;
