import React, { useEffect, useRef, useState } from 'react';
import { AxiosResponse } from 'axios';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogTitle, IconButton, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Close, Download, OpenInNew, Print } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  fileName: string;
  /** Fetches the server-generated PDF each time the dialog opens, so it always reflects the current document. */
  fetchPdf: () => Promise<AxiosResponse<Blob>>;
}

/**
 * Preview of a server-generated PDF in the browser's own viewer, with download, open-in-tab and print.
 * The PDF is fetched as a blob (so the auth header is sent) and shown through an object URL.
 */
const PdfPreviewDialog: React.FC<Props> = ({ open, onClose, title, fileName, fetchPdf }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  // The caller passes an inline arrow; only an actual open/close should refetch.
  const fetchRef = useRef(fetchPdf);
  fetchRef.current = fetchPdf;

  useEffect(() => {
    if (!open) { setUrl(null); return undefined; }
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    fetchRef.current()
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
        setUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setError(t('accounting.invoices.pdf.loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [open, t]);

  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const print = () => {
    try {
      frame.current?.contentWindow?.focus();
      frame.current?.contentWindow?.print();
    } catch {
      if (url) window.open(url, '_blank'); // viewer refused: the new tab has its own print button
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth fullScreen={fullScreen} PaperProps={{ sx: { height: fullScreen ? '100%' : '92vh' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography component="span" variant="h6" noWrap>{title}</Typography>
        <IconButton size="small" onClick={onClose} aria-label={t('common.close', 'Close')}><Close fontSize="small" /></IconButton>
      </DialogTitle>
      <Box sx={{ flex: 1, minHeight: 0, mx: 3, mb: 1, position: 'relative', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
        {loading && <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>}
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
        {url && !loading && <iframe ref={frame} src={url} title={title} style={{ width: '100%', height: '100%', border: 'none' }} />}
      </Box>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose}>{t('common.close', 'Close')}</Button>
        <Button startIcon={<OpenInNew />} disabled={!url} onClick={() => url && window.open(url, '_blank')}>{t('accounting.invoices.pdf.openNewTab')}</Button>
        <Button startIcon={<Print />} disabled={!url} onClick={print}>{t('accounting.invoices.pdf.print')}</Button>
        <Button variant="contained" startIcon={<Download />} disabled={!url} onClick={download}>{t('accounting.invoices.pdf.download')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default PdfPreviewDialog;
