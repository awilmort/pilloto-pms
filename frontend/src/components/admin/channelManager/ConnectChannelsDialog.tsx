/**
 * "Connect channels" (plan Phase 8.1): the channel connection screen full height, for every
 * offered OTA (or one, with `otaCode`). "Done" closes it and the channel list is re-read.
 */
import React, { useCallback } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { channelManagerService } from '../../../services/api';
import ChannelConnectFrame, { ChannelConnectFrameLabels } from './ChannelConnectFrame';

/** Tenant-language labels of the connection frame */
export function useFrameLabels(): ChannelConnectFrameLabels {
  const { t } = useTranslation();
  const k = (key: string) => t(`admin.channelManager.channels.frame.${key}`);
  return {
    title: k('title'), loading: k('loading'), failed: k('failed'), retry: k('retry'),
    newWindow: k('newWindow'), newWindowHint: k('newWindowHint'), newWindowBlocked: k('newWindowBlocked'), openedNewWindow: k('openedNewWindow'),
  };
}

/** A fresh session for the tenant's own property (memoized: the frame re-mints when it changes) */
export function useTenantSession(otaCode?: string) {
  const { i18n } = useTranslation();
  const language = i18n.language?.startsWith('en') ? 'en' : 'es';
  return useCallback(async () => (await channelManagerService.iframeSession({ otaCode, language })).data.data!.url, [otaCode, language]);
}

interface Props {
  open: boolean;
  onClose: () => void;
  otaCode?: string;
  allowNewWindow?: boolean;
}

const ConnectChannelsDialog: React.FC<Props> = ({ open, onClose, otaCode, allowNewWindow }) => {
  const { t } = useTranslation();
  const labels = useFrameLabels();
  const createSession = useTenantSession(otaCode);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xl" PaperProps={{ sx: { height: '95vh' } }}>
      <DialogTitle>{t('admin.channelManager.channels.dialogTitle')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary">{t('admin.channelManager.channels.dialogIntro')}</Typography>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {open && <ChannelConnectFrame createSession={createSession} labels={labels} allowNewWindow={allowNewWindow} height="calc(95vh - 220px)" />}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>{t('admin.channelManager.channels.done')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConnectChannelsDialog;
