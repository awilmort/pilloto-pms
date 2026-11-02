/**
 * Channels on the Channel Manager home (CHANNEX_ARCHITECTURE.md §8.6; plan Phases 8.1–8.2):
 * one card per connected channel with its state in words, latest news and open alerts; cards
 * for connections left half-way ("Continuar"); "Conectar un canal" (the per-OTA wizard) and the
 * full connection screen. When Pilloto connects channels for the property (platform-only),
 * the connect actions are replaced by a note.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardActions, CardContent, Chip, Grid, Paper, Typography } from '@mui/material';
import { Add } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { channelManagerService, ChannelList } from '../../../services/api';
import { guideFor } from '../../../utils/channelGuides';
import ChannelStateChip from './ChannelStateChip';
import ConnectChannelsDialog from './ConnectChannelsDialog';
import ConnectChannelWizard from './ConnectChannelWizard';

interface Props {
  canManage: boolean;
  /** The property is active on the channel manager */
  active: boolean;
  /** Open the connect-a-channel wizard on arrival */
  openWizard?: boolean;
}

const POLL_MS = 30_000;
const STEPS = 5;

const ChannelsPanel: React.FC<Props> = ({ canManage, active, openWizard = false }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'es-DO';
  const [list, setList] = useState<ChannelList | null>(null);
  const [failed, setFailed] = useState(false);
  const [wizard, setWizard] = useState<{ otaCode: string | null } | null>(openWizard ? { otaCode: null } : null);
  const [screenOpen, setScreenOpen] = useState(false);
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.channelManager.channels.${key}`, opts);

  const load = useCallback(async () => {
    try {
      setList((await channelManagerService.channels()).data.data ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const platformOnly = list?.connection === 'platform_only';
  const canConnect = canManage && active && !platformOnly && (list?.offered.length ?? 0) > 0;
  const time = (d?: string) => (d ? new Date(d).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const closeAndReload = () => { setWizard(null); setScreenOpen(false); load(); };

  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>{k('title')}</Typography>
        {canConnect && <Button size="small" onClick={() => setScreenOpen(true)}>{k('openScreen')}</Button>}
        {canConnect && <Button size="small" variant="contained" startIcon={<Add />} onClick={() => setWizard({ otaCode: null })}>{k('connect')}</Button>}
      </Box>

      {platformOnly && <Alert severity="info" sx={{ mb: 1.5 }}>{k('platformOnly')}</Alert>}
      {failed && <Alert severity="error" sx={{ mb: 1.5 }}>{k('loadFailed')}</Alert>}
      {list?.stale && <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{k('stale')}</Typography>}

      {list && list.channels.length === 0 && list.onboardings.length === 0 && (
        <Typography variant="body2" color="text.secondary">{active ? k('empty') : k('inactive')}</Typography>
      )}

      <Grid container spacing={2}>
        {list?.channels.map((c) => (
          <Grid item xs={12} md={6} key={c.id}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
                    {c.otaName}{c.title !== c.otaName ? <Typography component="span" variant="body2" color="text.secondary"> · {c.title}</Typography> : null}
                  </Typography>
                  <ChannelStateChip state={c.state} />
                </Box>
                <Typography variant="body2">{k(`stateText.${c.state}`, { name: c.otaName })}</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                  {c.alerts.critical > 0 && <Chip size="small" color="error" label={k('alertsCritical', { count: c.alerts.critical })} />}
                  {c.alerts.warning > 0 && <Chip size="small" color="warning" label={k('alertsWarning', { count: c.alerts.warning })} />}
                </Box>
                {c.lastEventAt && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>{k('lastEvent', { time: time(c.lastEventAt) })}</Typography>}
                {!c.lastEventAt && c.connectedAt && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>{k('connectedAt', { time: time(c.connectedAt) })}</Typography>}
              </CardContent>
              {c.onboarding && canManage && (
                <CardActions>
                  <Button size="small" onClick={() => setWizard({ otaCode: c.onboarding!.otaCode })}>
                    {k('continue')} · {k('stepOf', { step: c.onboarding.step, total: STEPS })}
                  </Button>
                </CardActions>
              )}
            </Card>
          </Grid>
        ))}
        {list?.onboardings.map((o) => (
          <Grid item xs={12} md={6} key={`onboarding-${o.otaCode}`}>
            <Card variant="outlined" sx={{ height: '100%', borderStyle: 'dashed' }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>{guideFor(o.otaCode).name}</Typography>
                  <Chip size="small" label={k('inProgress')} />
                </Box>
                <Typography variant="body2">{k('inProgressText', { name: guideFor(o.otaCode).name, step: o.step, total: STEPS })}</Typography>
              </CardContent>
              {canManage && (
                <CardActions>
                  <Button size="small" onClick={() => setWizard({ otaCode: o.otaCode })}>{k('continue')}</Button>
                </CardActions>
              )}
            </Card>
          </Grid>
        ))}
      </Grid>

      {wizard && list && (
        <ConnectChannelWizard open otaCode={wizard.otaCode} offered={list.offered} platformOnly={platformOnly} canManage={canManage}
          connectedCodes={list.channels.filter((c) => c.active && c.otaCode).map((c) => c.otaCode!)} onClose={closeAndReload} />
      )}
      <ConnectChannelsDialog open={screenOpen} onClose={closeAndReload} />
    </Paper>
  );
};

export default ChannelsPanel;
