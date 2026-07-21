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
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import ReceiptIcon from '@mui/icons-material/Receipt';
import { useTranslation } from 'react-i18next';
import { ElectronicInvoice } from '../../types';
import { ecfService } from '../../services/api';
import EcfStatusBadge from './EcfStatusBadge';

interface CreditNoteModalProps {
  open: boolean;
  onClose: () => void;
  /** The original Aceptado invoice to credit against */
  originalInvoice: ElectronicInvoice;
  /** Called after successful credit note generation */
  onNoteGenerated?: (note: ElectronicInvoice) => void;
  formatCurrency: (val?: number) => string;
}

type CodigoModificacion = '1' | '2' | '3' | '4' | '5';

const CreditNoteModal: React.FC<CreditNoteModalProps> = ({
  open,
  onClose,
  originalInvoice,
  onNoteGenerated,
  formatCurrency,
}) => {
  const { t } = useTranslation();

  const [step, setStep] = useState<'form' | 'result'>('form');
  const [codigoModificacion, setCodigoModificacion] = useState<CodigoModificacion>('1');
  const [razonModificacion, setRazonModificacion] = useState('');
  const [amount, setAmount] = useState<string>(String(originalInvoice.totalFactura));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedNote, setGeneratedNote] = useState<ElectronicInvoice | null>(null);

  const CODIGO_OPTIONS: Array<{ value: CodigoModificacion; labelKey: string }> = [
    { value: '1', labelKey: 'admin.settings.ecfInvoices.creditNote.codigo_1' },
    { value: '2', labelKey: 'admin.settings.ecfInvoices.creditNote.codigo_2' },
    { value: '3', labelKey: 'admin.settings.ecfInvoices.creditNote.codigo_3' },
    { value: '4', labelKey: 'admin.settings.ecfInvoices.creditNote.codigo_4' },
    { value: '5', labelKey: 'admin.settings.ecfInvoices.creditNote.codigo_5' },
  ];

  function handleClose() {
    if (submitting) return;
    setStep('form');
    setCodigoModificacion('1');
    setRazonModificacion('');
    setAmount(String(originalInvoice.totalFactura));
    setError(null);
    setGeneratedNote(null);
    onClose();
  }

  async function handleSubmit() {
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError(t('admin.settings.ecfInvoices.creditNote.noAmountError'));
      return;
    }
    if (!razonModificacion.trim()) {
      setError(t('admin.settings.ecfInvoices.creditNote.reasonLabel') + ' ' + t('common.isRequired', 'is required'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await ecfService.createCreditNote({
        originalEcfId: originalInvoice._id,
        codigoModificacion,
        razonModificacion: razonModificacion.trim(),
        totalAmount: parsedAmount,
      });
      const note = res.data.data;
      setGeneratedNote(note ?? null);
      setStep('result');
      if (note && onNoteGenerated) onNoteGenerated(note);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
        t('admin.settings.ecfInvoices.creditNote.errors.failed'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ReceiptIcon color="error" />
        {t('admin.settings.ecfInvoices.creditNote.title')}
      </DialogTitle>

      <DialogContent dividers>
        {step === 'form' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {/* Original invoice summary */}
            <Box sx={{ bgcolor: 'grey.50', borderRadius: 1, p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                {t('admin.settings.ecfInvoices.creditNote.originalInvoice')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
                  {originalInvoice.eNCF}
                </Typography>
                <EcfStatusBadge status={originalInvoice.estadoECF} />
              </Box>
              <Box sx={{ display: 'flex', gap: 3, mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('admin.settings.ecfInvoices.creditNote.totalLabel')}:{' '}
                  <strong>{formatCurrency(originalInvoice.totalFactura)}</strong>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('admin.settings.ecfInvoices.creditNote.itbisLabel')}:{' '}
                  <strong>{formatCurrency(originalInvoice.totalImpuestos)}</strong>
                </Typography>
              </Box>
              {(originalInvoice.buyerName || originalInvoice.buyerRnc) && (
                <Typography variant="caption" color="text.secondary">
                  {t('admin.settings.ecfInvoices.creditNote.buyerLabel')}:{' '}
                  {originalInvoice.buyerName || originalInvoice.buyerRnc}
                </Typography>
              )}
            </Box>

            <Divider />

            <TextField
              select
              fullWidth
              label={t('admin.settings.ecfInvoices.creditNote.codigoLabel')}
              value={codigoModificacion}
              onChange={(e) => setCodigoModificacion(e.target.value as CodigoModificacion)}
              size="small"
            >
              {CODIGO_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.value} — {t(opt.labelKey)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              fullWidth
              label={t('admin.settings.ecfInvoices.creditNote.reasonLabel')}
              placeholder={t('admin.settings.ecfInvoices.creditNote.reasonPlaceholder')}
              value={razonModificacion}
              onChange={(e) => setRazonModificacion(e.target.value)}
              multiline
              rows={2}
              inputProps={{ maxLength: 500 }}
              size="small"
              required
            />

            <TextField
              fullWidth
              label={t('admin.settings.ecfInvoices.creditNote.amountLabel')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              inputProps={{ min: 0.01, step: 0.01 }}
              size="small"
              required
              helperText={
                parseFloat(amount) > originalInvoice.totalFactura
                  ? t('admin.settings.ecfInvoices.creditNote.exceedsOriginalWarning')
                  : undefined
              }
              FormHelperTextProps={{ sx: { color: 'warning.main' } }}
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
              {t('admin.settings.ecfInvoices.creditNote.successTitle')}
            </Alert>
            <Box sx={{ bgcolor: 'grey.50', borderRadius: 1, p: 2 }}>
              <Typography variant="body2" fontFamily="monospace" fontSize="1rem" fontWeight={700}>
                {generatedNote.eNCF}
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', gap: 2 }}>
                <Typography variant="caption">
                  {t('admin.settings.ecfInvoices.creditNote.totalLabel')}:{' '}
                  <strong>{formatCurrency(generatedNote.totalFactura)}</strong>
                </Typography>
                <Typography variant="caption">
                  {t('admin.settings.ecfInvoices.creditNote.itbisLabel')}:{' '}
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
              {t('admin.settings.ecfInvoices.creditNote.cancel')}
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={handleSubmit}
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {submitting
                ? t('admin.settings.ecfInvoices.creditNote.emitting')
                : t('admin.settings.ecfInvoices.creditNote.emitir')}
            </Button>
          </>
        ) : (
          <Button variant="contained" onClick={handleClose}>
            {t('admin.settings.ecfInvoices.creditNote.close')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default CreditNoteModal;
