/**
 * The channel connection screen, embedded (CHANNEX_ARCHITECTURE.md §8.4; plan Phases 8.1–8.2).
 * Every mount mints a fresh single-use session URL (`createSession`). "Open in new window" mints
 * another one for a popup, for OTAs whose login refuses to load in a frame (Airbnb OAuth).
 * Labels are passed in so the platform console (English) and tenant screens can share it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { OpenInNew } from '@mui/icons-material';

export interface ChannelConnectFrameLabels {
  title: string;
  loading: string;
  failed: string;
  retry: string;
  newWindow: string;
  newWindowHint: string;
  newWindowBlocked: string;
  openedNewWindow: string;
}

interface Props {
  /** Returns a fresh session URL (single use) */
  createSession: () => Promise<string>;
  labels: ChannelConnectFrameLabels;
  allowNewWindow?: boolean;
  height?: number | string;
}

const errorText = (e: any, fallback: string) => e?.response?.data?.message ?? fallback;

const ChannelConnectFrame: React.FC<Props> = ({ createSession, labels, allowNewWindow = false, height = '70vh' }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popupNote, setPopupNote] = useState<'opened' | 'blocked' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setUrl(null);
    try {
      setUrl(await createSession());
    } catch (e) {
      setError(errorText(e, labels.failed));
    }
  }, [createSession, labels.failed]);
  useEffect(() => { load(); }, [load]);

  const openWindow = async () => {
    // Opened before the request so the browser treats it as a reaction to the click
    const win = window.open('', 'pilloto-channel-connection', 'width=1100,height=820');
    if (!win) { setPopupNote('blocked'); return; }
    try {
      win.location.href = await createSession();
      setPopupNote('opened');
    } catch (e) {
      win.close();
      setError(errorText(e, labels.failed));
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
      {allowNewWindow && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" startIcon={<OpenInNew />} onClick={openWindow}>{labels.newWindow}</Button>
          <Typography variant="caption" color="text.secondary">{labels.newWindowHint}</Typography>
        </Box>
      )}
      {popupNote === 'opened' && <Alert severity="info" onClose={() => setPopupNote(null)}>{labels.openedNewWindow}</Alert>}
      {popupNote === 'blocked' && <Alert severity="warning" onClose={() => setPopupNote(null)}>{labels.newWindowBlocked}</Alert>}
      {error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>{labels.retry}</Button>}>{error}</Alert>}
      {!error && !url && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, height }}>
          <CircularProgress size={20} /><Typography color="text.secondary">{labels.loading}</Typography>
        </Box>
      )}
      {url && (
        <Box component="iframe" src={url} title={labels.title} allow="clipboard-write"
          sx={{ width: '100%', height, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }} />
      )}
    </Box>
  );
};

export default ChannelConnectFrame;
