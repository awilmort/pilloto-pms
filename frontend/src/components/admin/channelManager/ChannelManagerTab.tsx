/** Settings → Channel Manager: the setup wizard until activated, the home screen afterwards. */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, LinearProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { channelManagerService, ChannelManagerStatus } from '../../../services/api';
import { usePermission } from '../../../lib/permissions';
import SetupWizard from './SetupWizard';
import ChannelManagerHome from './ChannelManagerHome';

const ChannelManagerTab: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('admin.ota.view');
  const canManage = usePermission('admin.ota.manage');
  const [status, setStatus] = useState<ChannelManagerStatus | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'noPlan' | 'error'>('loading');
  /** Open the connect-a-channel wizard once the home shows (end of the setup wizard) */
  const [connectNext, setConnectNext] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus((await channelManagerService.status()).data.data ?? null);
      setState('ready');
    } catch (e: any) {
      setState(e?.response?.status === 403 ? 'noPlan' : 'error');
    }
  }, []);
  useEffect(() => { if (canView) load(); }, [canView, load]);

  if (!canView) return <Alert severity="info">{t('admin.channelManager.noPermission')}</Alert>;
  if (state === 'loading') return <LinearProgress />;
  if (state === 'noPlan') return (
    <Box sx={{ maxWidth: 560 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>{t('admin.channelManager.home.title')}</Typography>
      <Alert severity="info">{t('admin.channelManager.noPlan')}</Alert>
    </Box>
  );
  if (state === 'error' || !status) return <Alert severity="error">{t('admin.channelManager.loadFailed')}</Alert>;

  return status.enabled
    ? <ChannelManagerHome key="home" status={status} canManage={canManage} onChanged={load} openConnectWizard={connectNext} />
    : <SetupWizard key="wizard" status={status} canManage={canManage} onChanged={load} onConnectChannel={() => { setConnectNext(true); load(); }} />;
};

export default ChannelManagerTab;
