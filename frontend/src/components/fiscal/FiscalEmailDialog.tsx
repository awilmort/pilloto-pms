import React, { useEffect, useState } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { ElectronicInvoice } from '../../types';
import { errorFields, fiscalErrorMessage } from './fiscalUi';

interface Props {
  open: boolean;
  document: ElectronicInvoice | null;
  onClose: () => void;
  onSent: (email: string) => void;
}

/** Send the official PDF to the buyer — or to another address. */
const FiscalEmailDialog: React.FC<Props> = ({ open, document: doc, onClose, onSent }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail(doc?.buyerEmail ?? '');
      setError(null);
      setField(null);
    }
  }, [open, doc]);

  const send = async () => {
    if (!doc) return;
    setBusy(true);
    setError(null);
    setField(null);
    try {
      await fiscalService.emailDocument(doc._id, email.trim() || undefined);
      onSent(email.trim() || doc.buyerEmail || '');
      onClose();
    } catch (err) {
      setField(errorFields(err).email ?? null);
      setError(fiscalErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="xs" fullWidth aria-labelledby="fiscal-email-title">
      <DialogTitle id="fiscal-email-title">{t('fiscal.email.title', 'Send by email')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('fiscal.email.body', { encf: doc?.eNCF ?? '', defaultValue: 'We send {{encf}} as a PDF attachment, from your company.' })}
        </DialogContentText>
        <TextField
          autoFocus fullWidth type="email" label={t('fiscal.email.to', 'Send to')} value={email} onChange={(e) => setEmail(e.target.value)}
          error={Boolean(field)} helperText={field || (doc?.buyerEmail ? t('fiscal.email.buyerHint', 'The buyer’s email is filled in.') : t('fiscal.email.noBuyer', 'This document has no buyer email.'))}
          autoComplete="email"
        />
        {error && !field && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={send} disabled={busy || !email.trim()} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {t('fiscal.email.send', 'Send')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FiscalEmailDialog;
