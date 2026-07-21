import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTranslation } from 'react-i18next';
import { ecfService } from '../../../services/api';
import { ElectronicInvoice } from '../../../types';

interface InvoicePdfPreviewDialogProps {
  invoice: ElectronicInvoice | null;
  open: boolean;
  onClose: () => void;
}

const InvoicePdfPreviewDialog: React.FC<InvoicePdfPreviewDialogProps> = ({ invoice, open, onClose }) => {
  const { t } = useTranslation();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHtml, setIsHtml] = useState(false);

  useEffect(() => {
    let active = true;

    if (!open || !invoice) {
      setPdfUrl(null);
      setLoading(false);
      setError(null);
      return () => undefined;
    }

    setLoading(true);
    setError(null);
    setPdfUrl(null);
    setIsHtml(false);

    ecfService.getInvoicePdfBlob(invoice._id)
      .then((response) => {
        if (!active) return;
        const blob = response.data;
        setIsHtml(blob.type.includes('html'));
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
        setLoading(false);
      })
      .catch(async (err: any) => {
        if (!active) return;
        let message = t('admin.ecfInvoices.detail.pdfFailed');
        const data = err?.response?.data;
        if (data instanceof Blob) {
          try {
            const text = await data.text();
            const parsed = JSON.parse(text);
            if (parsed?.message) message = parsed.message;
          } catch {
            // ignore parse errors — fall back to generic message
          }
        } else if (typeof data?.message === 'string') {
          message = data.message;
        }
        if (!active) return;
        setError(message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, invoice, t]);

  useEffect(() => () => {
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
    }
  }, [pdfUrl]);

  const filename = useMemo(() => {
    const base = invoice?.eNCF || invoice?._id || 'invoice';
    return isHtml ? `${base}.html` : `${base}.pdf`;
  }, [invoice, isHtml]);

  const handleDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleOpenInNewTab = () => {
    if (!pdfUrl) return;
    window.open(pdfUrl, '_blank', 'noopener,noreferrer');
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xl" fullWidth PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle sx={{ pr: 6 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {t('admin.ecfInvoices.detail.previewTitle', { defaultValue: 'Invoice PDF Preview' })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {invoice?.eNCF || invoice?._id}
            </Typography>
          </Box>
          <IconButton
            onClick={handleClose}
            size="small"
            aria-label={t('admin.ecfInvoices.detail.close', { defaultValue: 'Close' })}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, bgcolor: 'grey.100' }}>
        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="body2" color="text.secondary">
              Loading...
            </Typography>
          </Box>
        )}
        {!loading && !error && pdfUrl && (
          <Box sx={{ height: '100%', minHeight: '70vh' }}>
            <iframe
              title={invoice?.eNCF || 'invoice-pdf'}
              src={pdfUrl}
              style={{ border: 0, width: '100%', height: '100%' }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Button onClick={handleClose} variant="text">
          {t('admin.ecfInvoices.detail.close', { defaultValue: 'Close' })}
        </Button>
        <Stack direction="row" spacing={1}>
          <Button
            onClick={handleOpenInNewTab}
            startIcon={<OpenInNewIcon />}
            disabled={!pdfUrl}
          >
            {t('admin.ecfInvoices.actions.openInNewTab', { defaultValue: 'Open in new tab' })}
          </Button>
          <Button
            onClick={handleDownload}
            variant="contained"
            startIcon={<DownloadIcon />}
            disabled={!pdfUrl}
          >
            {t('admin.ecfInvoices.actions.downloadPdf', { defaultValue: 'Download PDF' })}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
};

export default InvoicePdfPreviewDialog;