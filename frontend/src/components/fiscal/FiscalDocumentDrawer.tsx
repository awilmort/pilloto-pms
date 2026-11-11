import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Divider, Drawer, IconButton, Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import CodeIcon from '@mui/icons-material/Code';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { ElectronicInvoice } from '../../types';
import EcfStatusBadge from '../admin/EcfStatusBadge';
import FiscalEmailDialog from './FiscalEmailDialog';
import FiscalNoteDialog from './FiscalNoteDialog';
import FiscalPdfDialog from './FiscalPdfDialog';
import {
  downloadBlob, estadoMeta, fiscalErrorMessage, formatDateTime, formatDop, formatTaxId, hasOfficialFiles, isTestDocument, isValidDocument,
} from './fiscalUi';
import i18n from '../../i18n';

interface Props {
  document: ElectronicInvoice | null;
  canIssue: boolean;
  onClose: () => void;
  /** The document changed (refreshed, retried); the list should reload. */
  onChanged: (doc?: ElectronicInvoice) => void;
}

const Row: React.FC<{ label: React.ReactNode; children: React.ReactNode }> = ({ label, children }) => (
  <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.75 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="body2" sx={{ textAlign: 'right', wordBreak: 'break-word' }} component="div">{children}</Typography>
  </Stack>
);

/**
 * One e-CF in full: what it is, where it stands with DGII, and everything that can be done with it
 * — the official PDF and XML, email it, ask for its state, send it again, or modify it with a note.
 */
const FiscalDocumentDrawer: React.FC<Props> = ({ document: initial, canIssue, onClose, onChanged }) => {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<ElectronicInvoice | null>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [note, setNote] = useState<'credit' | 'debit' | null>(null);

  useEffect(() => {
    setDoc(initial);
    setError(null);
  }, [initial]);

  if (!doc) return null;
  const meta = estadoMeta(doc.estadoECF);
  const official = hasOfficialFiles(doc);
  const test = isTestDocument(doc);
  const valid = isValidDocument(doc.estadoECF);
  const fromAccounting = doc.generationSource === 'accounting_invoice';
  const canNote = canIssue && valid && (doc.tipo === 'E31' || doc.tipo === 'E32') && doc.generationSource !== 'accounting_invoice';
  const unsent = doc.estadoECF === 'Pendiente' || doc.estadoECF === 'Error';

  const run = async (name: string, work: () => Promise<ElectronicInvoice | void>) => {
    setBusy(name);
    setError(null);
    try {
      const next = await work();
      if (next) {
        setDoc(next);
        onChanged(next);
      }
    } catch (err: any) {
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try { err.response.data = JSON.parse(await data.text()); } catch { /* generic */ }
      }
      setError(fiscalErrorMessage(err, t));
    } finally {
      setBusy(null);
    }
  };

  const refresh = () => run('refresh', async () => (await fiscalService.refreshDocument(doc._id)).data.data);
  const retry = () => run('retry', async () => {
    const res = await fiscalService.retryDocument(doc._id);
    setToast(res.data.queued ? t('fiscal.documents.stillQueued', 'BillingSoft is still unreachable. We will keep trying.') : t('fiscal.documents.sent', 'Sent.'));
    return res.data.data;
  });
  const xml = () => run('xml', async () => {
    downloadBlob((await fiscalService.getDocumentXmlBlob(doc._id)).data, `${doc.eNCF ?? doc._id}.xml`);
  });

  return (
    <Drawer anchor="right" open onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 460 }, p: 0 } }} aria-label={t('fiscal.documents.detail', 'Document detail')}>
      <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2, height: '100%', overflowY: 'auto' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="overline" color="text.secondary">{t(`fiscal.tipo.${doc.tipo}`, doc.tipo)}</Typography>
            <Typography variant="h6" fontFamily="monospace" fontWeight={700}>{doc.eNCF ?? t('fiscal.documents.noEncf', 'Number pending')}</Typography>
            <Box sx={{ mt: 0.5 }}><EcfStatusBadge status={doc.estadoECF} /></Box>
          </Box>
          <IconButton onClick={onClose} aria-label={t('common.close', 'Close')}><CloseIcon /></IconButton>
        </Stack>

        {test && <Alert severity="warning">{t('fiscal.documents.testWarning', 'Issued in a DGII test environment: this document has no fiscal value.')}</Alert>}
        {doc.estadoECF === 'Pendiente' && <Alert severity="info">{t('fiscal.documents.pendingNote', 'Saved. BillingSoft has not confirmed it yet; it is sent again automatically, and cannot be issued twice.')}</Alert>}
        {doc.estadoECF === 'Firmado' && <Alert severity="info">{t('fiscal.documents.signedNote', 'Signed. DGII has not received it yet; BillingSoft sends it again by itself.')}</Alert>}
        {doc.estadoECF === 'Sin Resolver' && <Alert severity="warning">{t('fiscal.documents.unresolvedNote', 'DGII has not answered in time. Check again, or contact support if it stays like this.')}</Alert>}
        {(doc.estadoECF === 'Rechazado' || doc.estadoECF === 'Error' || doc.estadoECF === 'Aceptado Condicional') && (doc.dgiiMessages?.length || doc.mensaje) && (
          <Alert severity={doc.estadoECF === 'Aceptado Condicional' ? 'warning' : 'error'}>
            <strong>{t(doc.estadoECF === 'Aceptado Condicional' ? 'fiscal.documents.observations' : 'fiscal.documents.reason', doc.estadoECF === 'Aceptado Condicional' ? 'DGII’s observations' : 'Why')}</strong>
            {(doc.dgiiMessages?.length ? doc.dgiiMessages.map((m) => (m.code ? `${m.code}: ` : '') + m.message) : [doc.mensaje as string]).map((m, i) => (
              <Typography key={i} variant="body2">{m}</Typography>
            ))}
          </Alert>
        )}
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        <Box>
          <Row label={t('fiscal.documents.issuedAt', 'Issued')}>{formatDateTime(doc.issuedAt, i18n.language)}</Row>
          <Row label={t('fiscal.documents.buyer', 'Buyer')}>
            {doc.buyerName || t('fiscal.documents.noBuyer', 'No buyer named')}
            {doc.buyerRnc && <Typography variant="caption" color="text.secondary" component="div">{formatTaxId(doc.buyerRnc)}</Typography>}
          </Row>
          {doc.originalENCF && <Row label={t('fiscal.documents.modifies', 'Modifies')}><Typography component="span" fontFamily="monospace" variant="body2">{doc.originalENCF}</Typography></Row>}
          {doc.numeroFacturaInterna && <Row label={t('fiscal.documents.reference', 'Reference')}>{doc.numeroFacturaInterna}</Row>}
          {doc.codigoSeguridad && <Row label={t('fiscal.documents.securityCode', 'Security code')}><Typography component="span" fontFamily="monospace" variant="body2">{doc.codigoSeguridad}</Typography></Row>}
          {doc.trackId && <Row label="TrackId"><Typography component="span" fontFamily="monospace" variant="caption">{doc.trackId}</Typography></Row>}
          <Divider sx={{ my: 1 }} />
          <Row label="ITBIS">{formatDop(doc.totalImpuestos, i18n.language)}</Row>
          <Row label={<strong>{t('fiscal.documents.total', 'Total')}</strong>}><strong>{formatDop(doc.totalFactura, i18n.language)}</strong></Row>
        </Box>

        {doc.lineItems && doc.lineItems.length > 0 && (
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>{t('fiscal.documents.lines', 'Items')}</Typography>
            <Table size="small" aria-label={t('fiscal.documents.lines', 'Items')}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('fiscal.documents.description', 'Description')}</TableCell>
                  <TableCell align="right">{t('fiscal.documents.net', 'Net')}</TableCell>
                  <TableCell align="right">ITBIS</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {doc.lineItems.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>{l.qty !== 1 ? `${l.qty} × ` : ''}{l.description}</TableCell>
                    <TableCell align="right">{formatDop(l.netPrice, i18n.language)}</TableCell>
                    <TableCell align="right">{l.itbisRate ? `${l.itbisRate}%` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        <Stack spacing={1} sx={{ mt: 'auto' }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" size="small" startIcon={<PictureAsPdfOutlinedIcon />} onClick={() => setPdfOpen(true)} disabled={!official}>
              {t('fiscal.documents.viewPdf', 'View PDF')}
            </Button>
            <Button variant="outlined" size="small" startIcon={busy === 'xml' ? <CircularProgress size={14} /> : <CodeIcon />} onClick={xml} disabled={!official || busy !== null}>XML</Button>
            {canIssue && (
              <Button variant="outlined" size="small" startIcon={<EmailOutlinedIcon />} onClick={() => setEmailOpen(true)} disabled={!official || test}>
                {t('fiscal.documents.email', 'Email')}
              </Button>
            )}
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {official && meta.busy && (
              <Button size="small" startIcon={busy === 'refresh' ? <CircularProgress size={14} /> : <RefreshIcon />} onClick={refresh} disabled={busy !== null}>
                {t('fiscal.documents.refresh', 'Check status')}
              </Button>
            )}
            {unsent && canIssue && !official && (
              <Button size="small" color="warning" startIcon={busy === 'retry' ? <CircularProgress size={14} /> : <ReplayIcon />} onClick={retry} disabled={busy !== null}>
                {t('fiscal.documents.retry', 'Send again')}
              </Button>
            )}
            {canNote && <Button size="small" color="error" onClick={() => setNote('credit')}>{t('fiscal.documents.creditNote', 'Credit note')}</Button>}
            {canNote && <Button size="small" onClick={() => setNote('debit')}>{t('fiscal.documents.debitNote', 'Debit note')}</Button>}
          </Stack>
          {fromAccounting && valid && (
            <Typography variant="caption" color="text.secondary">
              {t('fiscal.documents.notesFromAccounting', 'This invoice belongs to Accounting: issue its credit and debit notes from Accounting so the books stay in step.')}
            </Typography>
          )}
        </Stack>
      </Box>

      <FiscalPdfDialog
        open={pdfOpen} title={`${t(`fiscal.tipo.${doc.tipo}`, doc.tipo)} ${doc.eNCF ?? ''}`.trim()} filename={`${doc.eNCF ?? doc._id}.pdf`}
        load={async () => (await fiscalService.getDocumentPdfBlob(doc._id)).data} onClose={() => setPdfOpen(false)}
      />
      <FiscalEmailDialog open={emailOpen} document={doc} onClose={() => setEmailOpen(false)} onSent={(to) => setToast(t('fiscal.email.sent', { to, defaultValue: 'Sent to {{to}}.' }))} />
      {note && <FiscalNoteDialog open kind={note} original={doc} onClose={() => setNote(null)} onIssued={() => onChanged()} />}
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast ?? ''} />
    </Drawer>
  );
};

export default FiscalDocumentDrawer;
