import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { downloadBlob, fiscalErrorMessage } from './fiscalUi';

interface Props {
  open: boolean;
  title: string;
  filename: string;
  /** Fetches the PDF (the official printed representation, from BillingSoft). */
  load: () => Promise<Blob>;
  onClose: () => void;
}

/** The official printed representation of a document, shown in place, with download and print. */
const FiscalPdfDialog: React.FC<Props> = ({ open, title, filename, load, onClose }) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frame = React.useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    let objectUrl: string | null = null;
    setError(null);
    setUrl(null);
    setBlob(null);
    load()
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }));
        setBlob(b);
        setUrl(objectUrl);
      })
      .catch(async (err) => {
        if (!alive) return;
        // A failed blob request carries its JSON error as a Blob; read it for the reason.
        const data = err?.response?.data;
        if (data instanceof Blob) {
          try { err.response.data = JSON.parse(await data.text()); } catch { /* keep generic */ }
        }
        setError(fiscalErrorMessage(err, t));
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="fiscal-pdf-title">
      <DialogTitle id="fiscal-pdf-title">{title}</DialogTitle>
      <DialogContent dividers sx={{ p: 0, height: '70vh', position: 'relative' }}>
        {!url && !error && <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>}
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
        {url && <iframe ref={frame} title={title} src={url} style={{ width: '100%', height: '100%', border: 0 }} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => frame.current?.contentWindow?.print()} disabled={!url}>{t('fiscal.pdf.print', 'Print')}</Button>
        <Button onClick={() => blob && downloadBlob(blob, filename)} disabled={!blob}>{t('fiscal.pdf.download', 'Download')}</Button>
        <Button variant="contained" onClick={onClose}>{t('common.close', 'Close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default FiscalPdfDialog;
