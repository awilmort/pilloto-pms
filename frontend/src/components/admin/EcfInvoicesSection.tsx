import React, { useCallback, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import EmailIcon from '@mui/icons-material/Email';
import DownloadIcon from '@mui/icons-material/Download';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { useTranslation } from 'react-i18next';
import { ElectronicInvoice } from '../../types';
import EcfStatusBadge from './EcfStatusBadge';
import { ecfService } from '../../services/api';
import CreditNoteModal from './CreditNoteModal';
import DebitNoteModal from './DebitNoteModal';
import InvoicePdfPreviewDialog from './ecf/InvoicePdfPreviewDialog';
import InvoiceDetailDrawer from './ecf/InvoiceDetailDrawer';

interface EcfInvoicesSectionProps {
  invoices: ElectronicInvoice[];
  onRefresh: () => void;
  formatCurrency: (val?: number) => string;
}

const TIPO_COLORS: Record<string, 'primary' | 'secondary' | 'default' | 'warning' | 'error' | 'info' | 'success'> = {
  E31: 'primary',
  E32: 'info',
  E33: 'warning',
  E34: 'error',
};

const EcfInvoicesSection: React.FC<EcfInvoicesSectionProps> = ({
  invoices,
  onRefresh,
  formatCurrency,
}) => {
  const { t } = useTranslation();
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [creditNoteInvoice, setCreditNoteInvoice] = useState<ElectronicInvoice | null>(null);
  const [debitNoteInvoice, setDebitNoteInvoice] = useState<ElectronicInvoice | null>(null);
  const [pdfPreviewInvoice, setPdfPreviewInvoice] = useState<ElectronicInvoice | null>(null);
  const [detailInvoice, setDetailInvoice] = useState<ElectronicInvoice | null>(null);

  const handleRefreshStatus = useCallback(async (invoice: ElectronicInvoice) => {
    setActionError(null);
    setActionSuccess(null);
    setRefreshingId(invoice._id);
    try {
      await ecfService.refreshStatus(invoice._id);
      onRefresh();
    } catch (err: any) {
      setActionError(
        err?.response?.data?.message || t('admin.settings.ecfInvoices.errors.refreshFailed'),
      );
    } finally {
      setRefreshingId(null);
    }
  }, [onRefresh, t]);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }, []);

  const handleViewPdf = useCallback(async (invoice: ElectronicInvoice) => {
    setActionError(null);
    setActionSuccess(null);
    setPdfPreviewInvoice(invoice);
  }, []);

  const handleDownloadXml = useCallback(async (invoice: ElectronicInvoice) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const response = await ecfService.getInvoiceXmlBlob(invoice._id);
      const filename = `${invoice.eNCF || invoice._id}.xml`;
      downloadBlob(response.data, filename);
    } catch (err: any) {
      setActionError(err?.response?.data?.message || t('admin.ecfInvoices.detail.xmlFailed'));
    }
  }, [downloadBlob, t]);

  const handleSendEmail = useCallback(async (invoice: ElectronicInvoice) => {
    setActionError(null);
    setActionSuccess(null);
    setSendingId(invoice._id);
    try {
      await ecfService.sendInvoiceEmail(invoice._id);
      setActionSuccess(t('admin.ecfInvoices.detail.emailSent'));
    } catch (err: any) {
      setActionError(err?.response?.data?.message || t('admin.ecfInvoices.detail.emailFailed'));
    } finally {
      setSendingId(null);
    }
  }, [t]);

  if (invoices.length === 0) {
    return (
      <Box sx={{ mt: 2, textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          {t('admin.settings.ecfInvoices.noInvoices')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 1 }}>
      {actionError && (
        <Alert severity="error" onClose={() => setActionError(null)} sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      )}
      {actionSuccess && (
        <Alert severity="success" onClose={() => setActionSuccess(null)} sx={{ mb: 2 }}>
          {actionSuccess}
        </Alert>
      )}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.settings.ecfInvoices.table.eNCF')}</TableCell>
              <TableCell>{t('admin.settings.ecfInvoices.table.type')}</TableCell>
              <TableCell>{t('admin.settings.ecfInvoices.table.date')}</TableCell>
              <TableCell>{t('admin.settings.ecfInvoices.table.buyer')}</TableCell>
              <TableCell align="right">{t('admin.settings.ecfInvoices.table.total')}</TableCell>
              <TableCell align="right">{t('admin.settings.ecfInvoices.table.itbis')}</TableCell>
              <TableCell>{t('admin.settings.ecfInvoices.table.status')}</TableCell>
              <TableCell align="right">{t('admin.settings.ecfInvoices.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invoices.map((inv) => (
              <TableRow key={inv._id}>
                <TableCell>
                  <Typography
                    variant="body2"
                    fontFamily="monospace"
                    fontSize="0.8rem"
                    sx={{ cursor: 'pointer', color: 'primary.main', '&:hover': { textDecoration: 'underline' } }}
                    onClick={() => setDetailInvoice(inv)}
                  >
                    {inv.eNCF}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={inv.tipo}
                    color={TIPO_COLORS[inv.tipo] ?? 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontSize="0.8rem">
                    {new Date(inv.issuedAt).toLocaleString()}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontSize="0.8rem">
                    {inv.buyerName || inv.buyerRnc || '—'}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2">{formatCurrency(inv.totalFactura)}</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2">{formatCurrency(inv.totalImpuestos)}</Typography>
                </TableCell>
                <TableCell>
                  <EcfStatusBadge status={inv.estadoECF} />
                </TableCell>
                <TableCell align="right">
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                    {(inv.estadoECF === 'En Proceso' || inv.estadoECF === 'Pendiente') && (
                      <Tooltip title={t('admin.settings.ecfInvoices.actions.refreshStatus')}>
                        <IconButton
                          size="small"
                          onClick={() => handleRefreshStatus(inv)}
                          disabled={refreshingId === inv._id}
                        >
                          {refreshingId === inv._id ? (
                            <CircularProgress size={14} />
                          ) : (
                            <RefreshIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={t('admin.settings.ecfInvoices.actions.viewPdf')}>
                      <IconButton
                        size="small"
                        onClick={() => handleViewPdf(inv)}
                      >
                        <PictureAsPdfIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('admin.settings.ecfInvoices.actions.sendEmail')}>
                      <IconButton
                        size="small"
                        onClick={() => handleSendEmail(inv)}
                        disabled={sendingId === inv._id}
                      >
                        {sendingId === inv._id ? (
                          <CircularProgress size={14} />
                        ) : (
                          <EmailIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('admin.settings.ecfInvoices.actions.downloadXml')}>
                      <IconButton
                        size="small"
                        onClick={() => handleDownloadXml(inv)}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {(inv.estadoECF === 'Aceptado' || inv.estadoECF === 'Aceptado Condicional') &&
                      (inv.tipo === 'E31' || inv.tipo === 'E32') && (
                      <>
                        <Tooltip title={t('admin.settings.ecfInvoices.actions.creditNoteButton')}>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setCreditNoteInvoice(inv)}
                          >
                            <RemoveCircleOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('admin.settings.ecfInvoices.actions.debitNoteButton')}>
                          <IconButton
                            size="small"
                            color="warning"
                            onClick={() => setDebitNoteInvoice(inv)}
                          >
                            <AddCircleOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {creditNoteInvoice && (
        <CreditNoteModal
          open
          onClose={() => setCreditNoteInvoice(null)}
          originalInvoice={creditNoteInvoice}
          formatCurrency={formatCurrency}
          onNoteGenerated={() => { setCreditNoteInvoice(null); onRefresh(); }}
        />
      )}
      {debitNoteInvoice && (
        <DebitNoteModal
          open
          onClose={() => setDebitNoteInvoice(null)}
          originalInvoice={debitNoteInvoice}
          formatCurrency={formatCurrency}
          onNoteGenerated={() => { setDebitNoteInvoice(null); onRefresh(); }}
        />
      )}
      <InvoicePdfPreviewDialog
        invoice={pdfPreviewInvoice}
        open={Boolean(pdfPreviewInvoice)}
        onClose={() => setPdfPreviewInvoice(null)}
      />
      <InvoiceDetailDrawer
        invoice={detailInvoice}
        open={Boolean(detailInvoice)}
        onClose={() => setDetailInvoice(null)}
        onRefresh={onRefresh}
        formatCurrency={formatCurrency}
      />
    </Box>
  );
};

export default EcfInvoicesSection;
