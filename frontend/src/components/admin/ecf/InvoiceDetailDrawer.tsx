import React, { useCallback, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  Grid,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import EmailIcon from '@mui/icons-material/Email';
import DownloadIcon from '@mui/icons-material/Download';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { ElectronicInvoice } from '../../../types';
import EcfStatusBadge from '../EcfStatusBadge';
import { ecfService } from '../../../services/api';
import CreditNoteModal from '../CreditNoteModal';
import DebitNoteModal from '../DebitNoteModal';
import InvoicePdfPreviewDialog from './InvoicePdfPreviewDialog';

interface InvoiceDetailDrawerProps {
  invoice: ElectronicInvoice | null;
  open: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  formatCurrency: (val?: number) => string;
}

const TIPO_LABELS: Record<string, string> = {
  E31: 'Factura de Crédito Fiscal',
  E32: 'Factura de Consumo',
  E33: 'Nota de Débito',
  E34: 'Nota de Crédito',
  E41: 'Comprobante de Compras',
  E43: 'Gastos Menores',
  E44: 'Regímenes Especiales',
  E45: 'Gubernamental',
  E46: 'Exportaciones',
  E47: 'Pagos al Exterior',
};

const TIPO_COLORS: Record<string, 'primary' | 'secondary' | 'default' | 'warning' | 'error' | 'info' | 'success'> = {
  E31: 'primary',
  E32: 'info',
  E33: 'warning',
  E34: 'error',
};

const LabeledValue: React.FC<{ label: string; value?: React.ReactNode; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <Box>
    <Typography variant="caption" color="text.secondary" display="block">
      {label}
    </Typography>
    <Typography
      variant="body2"
      fontFamily={mono ? 'monospace' : undefined}
      sx={{ wordBreak: 'break-all' }}
    >
      {value ?? '—'}
    </Typography>
  </Box>
);

const InvoiceDetailDrawer: React.FC<InvoiceDetailDrawerProps> = ({
  invoice,
  open,
  onClose,
  onRefresh,
  formatCurrency,
}) => {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailOverride, setEmailOverride] = useState('');
  const [showEmailField, setShowEmailField] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creditNoteOpen, setCreditNoteOpen] = useState(false);
  const [debitNoteOpen, setDebitNoteOpen] = useState(false);
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (!invoice) return;
    setRefreshing(true);
    setError(null);
    try {
      await ecfService.refreshStatus(invoice._id);
      onRefresh?.();
    } catch (err: any) {
      setError(err?.response?.data?.message || t('admin.settings.ecfInvoices.errors.refreshFailed'));
    } finally {
      setRefreshing(false);
    }
  }, [invoice, onRefresh, t]);

  const handleViewPdf = useCallback(() => {
    if (!invoice) return;
    setError(null);
    setPdfPreviewOpen(true);
  }, [invoice]);

  const handleDownloadXml = useCallback(() => {
    if (!invoice) return;
    setError(null);
    ecfService.getInvoiceXmlBlob(invoice._id)
      .then((response) => {
        const blobUrl = URL.createObjectURL(response.data);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${invoice.eNCF || invoice._id}.xml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      })
      .catch((err: any) => {
        setError(err?.response?.data?.message || t('admin.ecfInvoices.detail.xmlFailed'));
      });
  }, [invoice, t]);

  const handleSendEmail = useCallback(async () => {
    if (!invoice) return;
    setEmailSending(true);
    setError(null);
    setSuccess(null);
    try {
      await ecfService.sendInvoiceEmail(invoice._id, emailOverride || undefined);
      setSuccess(t('admin.ecfInvoices.detail.emailSent'));
      setShowEmailField(false);
      setEmailOverride('');
    } catch (err: any) {
      setError(err?.response?.data?.message || t('admin.ecfInvoices.detail.emailFailed'));
    } finally {
      setEmailSending(false);
    }
  }, [invoice, emailOverride, t]);

  const handleClose = () => {
    setError(null);
    setSuccess(null);
    setShowEmailField(false);
    setEmailOverride('');
    setPdfPreviewOpen(false);
    onClose();
  };

  if (!invoice) return null;

  const canCreditNote =
    invoice.estadoECF === 'Aceptado' || invoice.estadoECF === 'Aceptado Condicional';
  const canDebitNote = canCreditNote;

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={handleClose}
        PaperProps={{ sx: { width: { xs: '100%', sm: 480 }, p: 0 } }}
      >
        {/* Header */}
        <Box
          sx={{
            px: 3,
            py: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Box>
            <Typography variant="h6" fontWeight={600}>
              {invoice.eNCF}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
              <Chip
                label={invoice.tipo}
                color={TIPO_COLORS[invoice.tipo] ?? 'default'}
                size="small"
              />
              <EcfStatusBadge status={invoice.estadoECF} />
            </Stack>
          </Box>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Body */}
        <Box sx={{ overflowY: 'auto', flex: 1, px: 3, py: 2 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }}>
              {success}
            </Alert>
          )}

          {/* Invoice type description */}
          <Typography variant="body2" color="text.secondary" mb={2}>
            {TIPO_LABELS[invoice.tipo] ?? invoice.tipo}
          </Typography>

          {/* Financial summary */}
          <Box
            sx={{
              bgcolor: 'grey.50',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: 2,
              mb: 3,
            }}
          >
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('admin.ecfInvoices.detail.total')}
                </Typography>
                <Typography variant="h6" fontWeight={700} color="primary.main">
                  {formatCurrency(invoice.totalFactura)}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('admin.ecfInvoices.detail.itbis')}
                </Typography>
                <Typography variant="h6" fontWeight={700}>
                  {formatCurrency(invoice.totalImpuestos)}
                </Typography>
              </Grid>
            </Grid>
          </Box>

          {/* Details */}
          <Stack spacing={2} divider={<Divider />}>
            <Box>
              <Typography variant="subtitle2" fontWeight={600} mb={1.5}>
                {t('admin.ecfInvoices.detail.sectionIdentity')}
              </Typography>
              <Grid container spacing={1.5}>
                <Grid item xs={12}>
                  <LabeledValue label="e-NCF" value={invoice.eNCF} mono />
                </Grid>
                <Grid item xs={12}>
                  <LabeledValue label="Track ID" value={invoice.trackId} mono />
                </Grid>
                <Grid item xs={6}>
                  <LabeledValue
                    label={t('admin.ecfInvoices.detail.transaccionId')}
                    value={invoice.transaccionId}
                  />
                </Grid>
                <Grid item xs={6}>
                  <LabeledValue
                    label={t('admin.ecfInvoices.detail.currency')}
                    value={invoice.currency}
                  />
                </Grid>
                <Grid item xs={6}>
                  <LabeledValue
                    label={t('admin.ecfInvoices.detail.issuedAt')}
                    value={dayjs(invoice.issuedAt).format('DD/MM/YYYY HH:mm')}
                  />
                </Grid>
                <Grid item xs={6}>
                  <LabeledValue
                    label={t('admin.ecfInvoices.detail.source')}
                    value={t(`admin.ecfInvoices.detail.sources.${invoice.generationSource}`, invoice.generationSource)}
                  />
                </Grid>
                {invoice.numeroFacturaInterna && (
                  <Grid item xs={12}>
                    <LabeledValue
                      label={t('admin.ecfInvoices.detail.internalRef')}
                      value={invoice.numeroFacturaInterna}
                      mono
                    />
                  </Grid>
                )}
              </Grid>
            </Box>

            {/* Buyer */}
            {(invoice.buyerName || invoice.buyerRnc || invoice.buyerEmail) && (
              <Box>
                <Typography variant="subtitle2" fontWeight={600} mb={1.5}>
                  {t('admin.ecfInvoices.detail.sectionBuyer')}
                </Typography>
                <Grid container spacing={1.5}>
                  {invoice.buyerName && (
                    <Grid item xs={12}>
                      <LabeledValue label={t('common.firstName') + ' / ' + t('admin.ecfInvoices.detail.razonSocial')} value={invoice.buyerName} />
                    </Grid>
                  )}
                  {invoice.buyerRnc && (
                    <Grid item xs={12}>
                      <LabeledValue label="RNC / Cédula" value={invoice.buyerRnc} mono />
                    </Grid>
                  )}
                  {invoice.buyerEmail && (
                    <Grid item xs={12}>
                      <LabeledValue label={t('common.email')} value={invoice.buyerEmail} />
                    </Grid>
                  )}
                </Grid>
              </Box>
            )}

            {/* Reference (for notes) */}
            {invoice.originalENCF && (
              <Box>
                <Typography variant="subtitle2" fontWeight={600} mb={1.5}>
                  {t('admin.ecfInvoices.detail.sectionReference')}
                </Typography>
                <Grid container spacing={1.5}>
                  <Grid item xs={12}>
                    <LabeledValue
                      label={t('admin.ecfInvoices.detail.originalENCF')}
                      value={invoice.originalENCF}
                      mono
                    />
                  </Grid>
                  {invoice.codigoModificacion && (
                    <Grid item xs={12}>
                      <LabeledValue
                        label={t('admin.ecfInvoices.detail.codigoModificacion')}
                        value={t(
                          `admin.settings.ecfInvoices.creditNote.codigo_${invoice.codigoModificacion}`,
                          invoice.codigoModificacion,
                        )}
                      />
                    </Grid>
                  )}
                </Grid>
              </Box>
            )}

            {/* Security / QR */}
            {(invoice.urlCodigoQr || invoice.codigoSeguridad) && (
              <Box>
                <Typography variant="subtitle2" fontWeight={600} mb={1.5}>
                  <QrCode2Icon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                  {t('admin.ecfInvoices.detail.sectionSecurity')}
                </Typography>
                <Grid container spacing={1.5}>
                  {invoice.codigoSeguridad && (
                    <Grid item xs={12}>
                      <LabeledValue
                        label={t('admin.ecfInvoices.detail.codigoSeguridad')}
                        value={invoice.codigoSeguridad}
                        mono
                      />
                    </Grid>
                  )}
                  {invoice.urlCodigoQr && (
                    <Grid item xs={12}>
                      <LabeledValue
                        label={t('admin.ecfInvoices.detail.urlQr')}
                        value={
                          <a href={invoice.urlCodigoQr} target="_blank" rel="noreferrer">
                            {t('admin.ecfInvoices.detail.openQr')}
                          </a>
                        }
                      />
                    </Grid>
                  )}
                </Grid>
              </Box>
            )}

            {/* Citrus status */}
            <Box>
              <Typography variant="subtitle2" fontWeight={600} mb={1.5}>
                {t('admin.ecfInvoices.detail.sectionStatus')}
              </Typography>
              <Grid container spacing={1.5}>
                <Grid item xs={6}>
                  <LabeledValue label={t('admin.ecfInvoices.detail.citrusEstatus')} value={invoice.estatus} />
                </Grid>
                <Grid item xs={6}>
                  <LabeledValue
                    label={t('admin.ecfInvoices.detail.retryCount')}
                    value={invoice.retryCount}
                  />
                </Grid>
                {invoice.mensaje && (
                  <Grid item xs={12}>
                    <LabeledValue label={t('admin.ecfInvoices.detail.mensaje')} value={invoice.mensaje} />
                  </Grid>
                )}
                {invoice.fechaFirmaDigital && (
                  <Grid item xs={12}>
                    <LabeledValue
                      label={t('admin.ecfInvoices.detail.fechaFirma')}
                      value={dayjs(invoice.fechaFirmaDigital).format('DD/MM/YYYY HH:mm')}
                    />
                  </Grid>
                )}
                {invoice.fechaVencimientoSecuencia && (
                  <Grid item xs={12}>
                    <LabeledValue
                      label={t('admin.ecfInvoices.detail.fechaVencimiento')}
                      value={dayjs(invoice.fechaVencimientoSecuencia).format('DD/MM/YYYY')}
                    />
                  </Grid>
                )}
              </Grid>
            </Box>
          </Stack>

          {/* Email override */}
          {showEmailField && (
            <Box mt={2}>
              <TextField
                size="small"
                fullWidth
                label={t('admin.ecfInvoices.detail.emailOverride')}
                value={emailOverride}
                onChange={(e) => setEmailOverride(e.target.value)}
                placeholder={invoice.buyerEmail || t('common.email')}
                type="email"
              />
            </Box>
          )}
        </Box>

        {/* Footer actions */}
        <Box
          sx={{
            px: 3,
            py: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'grey.50',
          }}
        >
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Tooltip title={t('admin.settings.ecfInvoices.actions.viewPdf')}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PictureAsPdfIcon />}
                  onClick={handleViewPdf}
                >
                  PDF
                </Button>
              </Tooltip>
              <Tooltip title={t('admin.settings.ecfInvoices.actions.downloadXml')}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadXml}
                >
                  XML
                </Button>
              </Tooltip>
              <Button
                size="small"
                variant="outlined"
                startIcon={emailSending ? <CircularProgress size={14} /> : <EmailIcon />}
                onClick={showEmailField ? handleSendEmail : () => setShowEmailField(true)}
                disabled={emailSending}
              >
                {showEmailField
                  ? t('admin.ecfInvoices.detail.sendEmailConfirm')
                  : t('admin.settings.ecfInvoices.actions.sendEmail')}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={refreshing ? <CircularProgress size={14} /> : <RefreshIcon />}
                onClick={handleRefresh}
                disabled={refreshing}
              >
                {t('admin.settings.ecfInvoices.actions.refreshStatus')}
              </Button>
            </Stack>

            {(canCreditNote || canDebitNote) && (
              <Stack direction="row" spacing={1}>
                {canCreditNote && (
                  <Button
                    size="small"
                    variant="contained"
                    color="error"
                    startIcon={<RemoveCircleOutlineIcon />}
                    onClick={() => setCreditNoteOpen(true)}
                  >
                    {t('admin.settings.ecfInvoices.actions.creditNoteButton')}
                  </Button>
                )}
                {canDebitNote && (
                  <Button
                    size="small"
                    variant="contained"
                    color="warning"
                    startIcon={<AddCircleOutlineIcon />}
                    onClick={() => setDebitNoteOpen(true)}
                  >
                    {t('admin.settings.ecfInvoices.actions.debitNoteButton')}
                  </Button>
                )}
              </Stack>
            )}
          </Stack>
        </Box>
      </Drawer>

      {creditNoteOpen && invoice && (
        <CreditNoteModal
          open={creditNoteOpen}
          originalInvoice={invoice}
          onClose={() => setCreditNoteOpen(false)}
          onNoteGenerated={() => {
            setCreditNoteOpen(false);
            onRefresh?.();
          }}
          formatCurrency={formatCurrency}
        />
      )}

      {debitNoteOpen && invoice && (
        <DebitNoteModal
          open={debitNoteOpen}
          originalInvoice={invoice}
          onClose={() => setDebitNoteOpen(false)}
          onNoteGenerated={() => {
            setDebitNoteOpen(false);
            onRefresh?.();
          }}
          formatCurrency={formatCurrency}
        />
      )}

      <InvoicePdfPreviewDialog
        invoice={invoice}
        open={pdfPreviewOpen}
        onClose={() => setPdfPreviewOpen(false)}
      />
    </>
  );
};

export default InvoiceDetailDrawer;
