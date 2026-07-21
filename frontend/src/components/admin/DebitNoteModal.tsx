import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  TextField,
  Typography,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { useTranslation } from 'react-i18next';
import { ElectronicInvoice } from '../../types';
import { ecfService } from '../../services/api';
import EcfStatusBadge from './EcfStatusBadge';

interface DebitNoteModalProps {
  open: boolean;
  onClose: () => void;
  /** The original Aceptado invoice to debit against */
  originalInvoice: ElectronicInvoice;
  /** Called after successful debit note generation */
  onNoteGenerated?: (note: ElectronicInvoice) => void;
  formatCurrency: (val?: number) => string;
}

const DebitNoteModal: React.FC<DebitNoteModalProps> = ({
  open,
  onClose,
  originalInvoice,
  onNoteGenerated,
  formatCurrency,
}) => {
  const { t } = useTranslation();

  const [step, setStep] = useState<'form' | 'result'>('form');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedNote, setGeneratedNote] = useState<ElectronicInvoice | null>(null);

  function handleClose() {
    if (submitting) return;
    setStep('form');
    setReason('');
    setAmount('');
    setError(null);
    setGeneratedNote(null);
    onClose();
  }

  async function handleSubmit() {
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError(t('admin.settings.ecfInvoices.debitNote.noAmountError'));
      return;
    }
    if (!reason.trim()) {
      setError(t('admin.settings.ecfInvoices.debitNote.reasonLabel') + ' ' + t('common.isRequired', 'is required'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await ecfService.createDebitNote({
        originalEcfId: originalInvoice._id,
        reason: reason.trim(),
        totalAmount: parsedAmount,
      });
      const note = res.data.data;
      setGeneratedNote(note ?? null);
      setStep('result');
      if (note && onNoteGenerated) onNoteGenerated(note);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
        t('admin.settings.ecfInvoices.debitNote.errors.failed'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AddCircleOutlineIcon color="warning" />
        {t('admin.settings.ecfInvoices.debitNote.title')}
      </DialogTitle>

      <DialogContent dividers>
        {step === 'form' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {/* Original invoice summary */}
            <Box sx={{ bgcolor: 'grey.50', borderRadius: 1, p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                {t('admin.settings.ecfInvoices.debitNote.originalInvoice')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
                  {originalInvoice.eNCF}
                </Typography>
                <EcfStatusBadge status={originalInvoice.estadoECF} />
              </Box>
              <Box sx={{ display: 'flex', gap: 3, mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('admin.settings.ecfInvoices.debitNote.totalLabel')}:{' '}
                  <strong>{formatCurrency(originalInvoice.totalFactura)}</strong>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('admin.settings.ecfInvoices.debitNote.itbisLabel')}:{' '}
                  <strong>{formatCurrency(originalInvoice.totalImpuestos)}</strong>
                </Typography>
              </Box>
              {(originalInvoice.buyerName || originalInvoice.buyerRnc) && (
                <Typography variant="caption" color="text.secondary">
                  {t('admin.settings.ecfInvoices.debitNote.buyerLabel')}:{' '}
                  {originalInvoice.buyerName || originalInvoice.buyerRnc}
                </Typography>
              )}
            </Box>

            <Divider />

            <TextField
              fullWidth
              label={t('admin.settings.ecfInvoices.debitNote.reasonLabel')}
              placeholder={t('admin.settings.ecfInvoices.debitNote.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              multiline
              rows={2}
              inputProps={{ maxLength: 500 }}
              size="small"
              required
            />

            <TextField
              fullWidth
              label={t('admin.settings.ecfInvoices.debitNote.amountLabel')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              inputProps={{ min: 0.01, step: 0.01 }}
              size="small"
              required
            />

            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
          </Box>
        )}

        {step === 'result' && generatedNote && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Alert severity="success">
              {t('admin.settings.ecfInvoices.debitNote.successTitle')}
            </Alert>
            <Box sx={{ bgcolor: 'grey.50', borderRadius: 1, p: 2 }}>
              <Typography variant="body2" fontFamily="monospace" fontSize="1rem" fontWeight={700}>
                {generatedNote.eNCF}
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', gap: 2 }}>
                <Typography variant="caption">
                  {t('admin.settings.ecfInvoices.debitNote.totalLabel')}:{' '}
                  <strong>{formatCurrency(generatedNote.totalFactura)}</strong>
                </Typography>
                <Typography variant="caption">
                  {t('admin.settings.ecfInvoices.debitNote.itbisLabel')}:{' '}
                  <strong>{formatCurrency(generatedNote.totalImpuestos)}</strong>
                </Typography>
              </Box>
              <Box sx={{ mt: 1 }}>
                <EcfStatusBadge status={generatedNote.estadoECF} />
              </Box>
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        {step === 'form' ? (
          <>
            <Button onClick={handleClose} disabled={submitting}>
              {t('admin.settings.ecfInvoices.debitNote.cancel')}
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={handleSubmit}
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {submitting
                ? t('admin.settings.ecfInvoices.debitNote.emitting')
                : t('admin.settings.ecfInvoices.debitNote.emitir')}
            </Button>
          </>
        ) : (
          <Button variant="contained" onClick={handleClose}>
            {t('admin.settings.ecfInvoices.debitNote.close')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default DebitNoteModal;
