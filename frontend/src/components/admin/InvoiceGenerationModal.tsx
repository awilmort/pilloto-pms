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
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import ReceiptIcon from '@mui/icons-material/Receipt';
import { useTranslation } from 'react-i18next';
import { ElectronicInvoice } from '../../types';
import { ecfService } from '../../services/api';
import EcfStatusBadge from './EcfStatusBadge';

interface InvoiceGenerationModalProps {
  open: boolean;
  onClose: () => void;
  folioId: string;
  paymentId?: string;
  /** Total amount shown to staff for confirmation */
  totalAmount: number;
  /** Pre-fill buyer info from guest record */
  prefillBuyerName?: string;
  prefillBuyerEmail?: string;
  prefillBuyerRnc?: string;
  prefillBuyerRazonSocial?: string;
  /** Called after a successful invoice generation */
  onInvoiceGenerated?: (invoice: ElectronicInvoice) => void;
  formatCurrency: (val?: number) => string;
}

type InvoiceType = 'E32' | 'E31' | 'none';

const InvoiceGenerationModal: React.FC<InvoiceGenerationModalProps> = ({
  open,
  onClose,
  folioId,
  paymentId,
  totalAmount,
  prefillBuyerName,
  prefillBuyerEmail,
  prefillBuyerRnc,
  prefillBuyerRazonSocial,
  onInvoiceGenerated,
  formatCurrency,
}) => {
  const { t } = useTranslation();

  // Step: 'select' — choose type; 'form' — fill buyer info; 'result' — show outcome
  const [step, setStep] = useState<'select' | 'form' | 'result'>('select');
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('E32');

  const [buyerName, setBuyerName] = useState(prefillBuyerName ?? '');
  const [buyerEmail, setBuyerEmail] = useState(prefillBuyerEmail ?? '');
  const [buyerRnc, setBuyerRnc] = useState(prefillBuyerRnc ?? '');
  const [buyerRazonSocial, setBuyerRazonSocial] = useState(prefillBuyerRazonSocial ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedInvoice, setGeneratedInvoice] = useState<ElectronicInvoice | null>(null);

  const RNC_REGEX = /^\d{9}$|^\d{11}$/;

  function handleClose() {
    if (submitting) return;
    setStep('select');
    setInvoiceType('E32');
    setBuyerName(prefillBuyerName ?? '');
    setBuyerEmail(prefillBuyerEmail ?? '');
    setBuyerRnc(prefillBuyerRnc ?? '');
    setBuyerRazonSocial(prefillBuyerRazonSocial ?? '');
    setError(null);
    setGeneratedInvoice(null);
    onClose();
  }

  function handleTypeConfirm() {
    if (invoiceType === 'none') {
      handleClose();
      return;
    }
    setError(null);
    setStep('form');
  }

  async function handleSubmit() {
    setError(null);

    if (invoiceType === 'E31') {
      if (!buyerRnc.trim() || !RNC_REGEX.test(buyerRnc.trim())) {
        setError(t('admin.settings.ecfInvoices.generate.errors.invalidRnc'));
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await ecfService.generateInvoice({
        folioId,
        paymentId,
        tipoECF: invoiceType as 'E31' | 'E32',
        buyerRnc: invoiceType === 'E31' ? buyerRnc.trim() : buyerRnc.trim() || undefined,
        buyerName: buyerName.trim() || undefined,
        buyerEmail: buyerEmail.trim().toLowerCase() || undefined,
        buyerRazonSocial: buyerRazonSocial.trim() || undefined,
      });
      const invoice = res.data.data!;
      setGeneratedInvoice(invoice);
      setStep('result');
      if (onInvoiceGenerated) onInvoiceGenerated(invoice);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.detail ||
        t('admin.settings.ecfInvoices.generate.errors.generationFailed');
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSubmitting(false);
    }
  }

  function handleRefreshStatus() {
    if (!generatedInvoice?._id) return;
    ecfService.refreshStatus(generatedInvoice._id).then((res) => {
      if (res.data.data) setGeneratedInvoice(res.data.data);
    }).catch(() => {});
  }

  // ── Step: Select type ──────────────────────────────────────────────────────

  if (step === 'select') {
    return (
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ReceiptIcon color="primary" />
          {t('admin.settings.ecfInvoices.generate.title')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('admin.settings.ecfInvoices.generate.subtitle', { amount: formatCurrency(totalAmount) })}
          </Typography>
          <RadioGroup
            value={invoiceType}
            onChange={(e) => setInvoiceType(e.target.value as InvoiceType)}
          >
            <FormControlLabel
              value="E32"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body1" fontWeight={500}>
                    {t('admin.settings.ecfInvoices.generate.typeE32Label')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('admin.settings.ecfInvoices.generate.typeE32Help')}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="E31"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body1" fontWeight={500}>
                    {t('admin.settings.ecfInvoices.generate.typeE31Label')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('admin.settings.ecfInvoices.generate.typeE31Help')}
                  </Typography>
                </Box>
              }
            />
            <Divider sx={{ my: 1 }} />
            <FormControlLabel
              value="none"
              control={<Radio />}
              label={
                <Typography variant="body2" color="text.secondary">
                  {t('admin.settings.ecfInvoices.generate.typeNone')}
                </Typography>
              }
            />
          </RadioGroup>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={submitting}>
            {t('admin.settings.ecfInvoices.generate.cancel')}
          </Button>
          <Button variant="contained" onClick={handleTypeConfirm}>
            {invoiceType === 'none'
              ? t('admin.settings.ecfInvoices.generate.skipInvoice')
              : t('admin.settings.ecfInvoices.generate.continue')}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // ── Step: Buyer info form ──────────────────────────────────────────────────

  if (step === 'form') {
    return (
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          {invoiceType === 'E31'
            ? t('admin.settings.ecfInvoices.generate.formTitleE31')
            : t('admin.settings.ecfInvoices.generate.formTitleE32')}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            {invoiceType === 'E31' && (
              <>
                <TextField
                  label={t('admin.settings.ecfInvoices.generate.buyerRnc')}
                  value={buyerRnc}
                  onChange={(e) => setBuyerRnc(e.target.value)}
                  required
                  helperText={t('admin.settings.ecfInvoices.generate.rncHelp')}
                  inputProps={{ maxLength: 11 }}
                />
                <TextField
                  label={t('admin.settings.ecfInvoices.generate.buyerRazonSocial')}
                  value={buyerRazonSocial}
                  onChange={(e) => setBuyerRazonSocial(e.target.value)}
                  inputProps={{ maxLength: 150 }}
                />
              </>
            )}
            <TextField
              label={t('admin.settings.ecfInvoices.generate.buyerName')}
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              inputProps={{ maxLength: 150 }}
            />
            <TextField
              label={t('admin.settings.ecfInvoices.generate.buyerEmail')}
              value={buyerEmail}
              onChange={(e) => setBuyerEmail(e.target.value)}
              type="email"
              inputProps={{ maxLength: 150 }}
            />
          </Box>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setStep('select'); setError(null); }} disabled={submitting}>
            {t('admin.settings.ecfInvoices.generate.back')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting || (invoiceType === 'E31' && !buyerRnc.trim())}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {submitting
              ? t('admin.settings.ecfInvoices.generate.generating')
              : t('admin.settings.ecfInvoices.generate.emit')}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // ── Step: Result ───────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('admin.settings.ecfInvoices.generate.resultTitle')}</DialogTitle>
      <DialogContent>
        {generatedInvoice ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h6" fontFamily="monospace">
                {generatedInvoice.eNCF}
              </Typography>
              <EcfStatusBadge status={generatedInvoice.estadoECF} />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {t('admin.settings.ecfInvoices.generate.totalLabel')}: {formatCurrency(generatedInvoice.totalFactura)}
              {' · '}
              {t('admin.settings.ecfInvoices.generate.itbisLabel')}: {formatCurrency(generatedInvoice.totalImpuestos)}
            </Typography>
            {generatedInvoice.mensaje && (
              <Alert severity="info">{generatedInvoice.mensaje}</Alert>
            )}
            {generatedInvoice.estadoECF === 'En Proceso' && (
              <Alert severity="info">
                {t('admin.settings.ecfInvoices.generate.pendingInfo')}
              </Alert>
            )}
          </Box>
        ) : (
          <Alert severity="warning">{t('admin.settings.ecfInvoices.generate.noData')}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        {generatedInvoice?.estadoECF === 'En Proceso' && (
          <Button variant="outlined" size="small" onClick={handleRefreshStatus}>
            {t('admin.settings.ecfInvoices.actions.refreshStatus')}
          </Button>
        )}
        <Button variant="contained" onClick={handleClose}>
          {t('admin.settings.ecfInvoices.generate.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default InvoiceGenerationModal;
