import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { ElectronicInvoice } from '../../types';
import EcfStatusBadge from '../admin/EcfStatusBadge';
import { errorFields, fiscalErrorMessage, formatDop } from './fiscalUi';
import i18n from '../../i18n';

type Code = '1' | '2' | '3';

interface Props {
  open: boolean;
  kind: 'credit' | 'debit';
  /** The accepted invoice the note modifies. */
  original: ElectronicInvoice;
  onClose: () => void;
  onIssued?: (note: ElectronicInvoice, queued: boolean) => void;
}

const REASON_MAX = 90;

/**
 * A credit (34) or debit (33) note on an accepted invoice. A credit note is the only way to void or
 * correct an e-CF already sent; it cannot credit more than the invoice, and a void credits all of it.
 * A debit note charges more on the same invoice (interest, a late fee). DGII's own codes are used:
 * 1 voids, 2 corrects text, 3 corrects amounts.
 */
const FiscalNoteDialog: React.FC<Props> = ({ open, kind, original, onClose, onIssued }) => {
  const { t } = useTranslation();
  const credit = kind === 'credit';
  const [code, setCode] = useState<Code>(credit ? '3' : '3');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ note: ElectronicInvoice; queued: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode('3');
    setReason('');
    setAmount('');
    setError(null);
    setFields({});
    setResult(null);
  }, [open, original._id]);

  const voiding = credit && code === '1';
  const value = voiding ? original.totalFactura : parseFloat(amount);
  const tooMuch = credit && Number.isFinite(value) && value > original.totalFactura + 0.001;
  const amountOk = Number.isFinite(value) && value > 0 && !tooMuch;
  const canSubmit = amountOk && reason.trim().length > 0 && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = credit
        ? await fiscalService.issueCreditNote({ originalId: original._id, codigoModificacion: code, razonModificacion: reason.trim(), totalAmount: value })
        : await fiscalService.issueDebitNote({ originalId: original._id, razonModificacion: reason.trim(), totalAmount: value });
      setResult({ note: res.data.data, queued: Boolean(res.data.queued) });
      onIssued?.(res.data.data, Boolean(res.data.queued));
    } catch (err) {
      setFields(errorFields(err));
      setError(fiscalErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="sm" fullWidth aria-labelledby="fiscal-note-title">
      <DialogTitle id="fiscal-note-title">
        {credit ? t('fiscal.note.creditTitle', 'Issue a credit note') : t('fiscal.note.debitTitle', 'Issue a debit note')}
      </DialogTitle>
      <DialogContent dividers>
        {!result ? (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">{t('fiscal.note.original', 'Invoice being modified')}</Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <Typography variant="body2" fontFamily="monospace" fontWeight={700}>{original.eNCF}</Typography>
                <EcfStatusBadge status={original.estadoECF} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {original.buyerName || original.buyerRnc || t('fiscal.documents.noBuyer', 'No buyer named')} · {formatDop(original.totalFactura, i18n.language)}
              </Typography>
            </Box>

            {credit && (
              <TextField select fullWidth size="small" label={t('fiscal.note.code', 'Why')} value={code} onChange={(e) => setCode(e.target.value as Code)}>
                <MenuItem value="1">{t('fiscal.note.code1', 'Void the invoice')}</MenuItem>
                <MenuItem value="2">{t('fiscal.note.code2', 'Correct text (name, description)')}</MenuItem>
                <MenuItem value="3">{t('fiscal.note.code3', 'Correct amounts (discount, return, error)')}</MenuItem>
              </TextField>
            )}

            <TextField
              fullWidth size="small" required label={t('fiscal.note.reason', 'Reason')} value={reason} onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
              error={Boolean(fields.reason)} helperText={fields.reason || t('fiscal.note.reasonHelp', { max: REASON_MAX, defaultValue: 'Printed on the note. Up to {{max}} characters.' })}
            />

            <TextField
              fullWidth size="small" required type="number" label={credit ? t('fiscal.note.creditAmount', 'Amount to credit (with ITBIS)') : t('fiscal.note.debitAmount', 'Amount to charge (with ITBIS)')}
              value={voiding ? String(original.totalFactura) : amount} onChange={(e) => setAmount(e.target.value)} disabled={voiding}
              inputProps={{ min: 0.01, step: 0.01 }}
              error={tooMuch} helperText={tooMuch ? t('fiscal.note.exceeds', 'A credit note cannot credit more than the invoice.') : voiding ? t('fiscal.note.voidAll', 'Voiding credits the whole invoice.') : undefined}
            />

            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Alert severity={result.queued ? 'info' : 'success'}>
              {result.queued
                ? t('fiscal.note.queued', 'Saved. BillingSoft could not be reached, so it will be sent automatically in a moment.')
                : t('fiscal.note.issued', 'The note was issued and sent to DGII.')}
            </Alert>
            <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 2 }}>
              <Typography variant="body1" fontFamily="monospace" fontWeight={700}>{result.note.eNCF ?? t('fiscal.documents.noEncf', 'Number pending')}</Typography>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1 }}>
                <Typography variant="body2">{formatDop(result.note.totalFactura, i18n.language)}</Typography>
                <EcfStatusBadge status={result.note.estadoECF} />
              </Stack>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {!result ? (
          <>
            <Button onClick={onClose} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
            <Button
              variant="contained" color={credit ? 'error' : 'primary'} onClick={submit} disabled={!canSubmit}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {credit ? t('fiscal.note.issueCredit', 'Issue credit note') : t('fiscal.note.issueDebit', 'Issue debit note')}
            </Button>
          </>
        ) : (
          <Button variant="contained" onClick={onClose}>{t('common.close', 'Close')}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default FiscalNoteDialog;
