/**
 * Channel Manager home (CHANNEX_ARCHITECTURE.md §8.6; plan Phase 5.3): status in words, items
 * that need attention, channels, bookings from the channels, sync activity, options, the property details
 * it uses (read-only, edited in the property profile) and Disable with its consequences explained.
 * White-label: nothing here names the provider or shows its ids — that view is the platform
 * console's. Channel cards and the connect wizard: ChannelsPanel (8.1–8.2).
 */
import React, { useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, FormControlLabel, Paper, Switch, Typography,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { channelManagerService, ChannelManagerStatus, ChannelManagerSettings } from '../../../services/api';
import PropertyProfileSummary from '../PropertyProfileSummary';
import ChannelGlossary from './ChannelGlossary';
import SyncActivity from './SyncActivity';
import BookingInbox from './BookingInbox';
import ChannelsPanel from './ChannelsPanel';

interface Props {
  status: ChannelManagerStatus;
  canManage: boolean;
  onChanged: () => void;
  /** Open the connect-a-channel wizard right away */
  openConnectWizard?: boolean;
}

const ChannelManagerHome: React.FC<Props> = ({ status, canManage, onChanged, openConnectWizard }) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ChannelManagerSettings>(status.settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const property = status.property;
  const state = property?.status ?? 'disabled';

  const toggle = async (field: 'autoAssignRooms' | 'sendGuestConfirmationEmail' | 'ratesIncludeTaxes', value: boolean) => {
    try {
      setSettings((await channelManagerService.saveSettings({ [field]: value })).data.data!);
    } catch (e: any) {
      setMessage({ severity: 'error', text: e?.response?.data?.message ?? t('admin.channelManager.home.saveFailed') });
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await channelManagerService.disable();
      setConfirmDisable(false);
      onChanged();
    } catch (e: any) {
      setConfirmDisable(false);
      setMessage({ severity: 'error', text: e?.response?.data?.message ?? t('admin.channelManager.home.disableFailed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>{t('admin.channelManager.home.title')}</Typography>
        <ChannelGlossary />
      </Box>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Chip color={state === 'active' ? 'success' : state === 'error' ? 'error' : 'default'} label={t(`admin.channelManager.home.state.${state}`)} />
          <Typography variant="body1">{t(`admin.channelManager.home.stateText.${state}`, { name: settings.name })}</Typography>
        </Box>
        {property?.hasProblem && <Alert severity="error" sx={{ mt: 2 }}>{t('admin.channelManager.home.problem')}</Alert>}
        {status.issues.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('admin.channelManager.home.issues', { count: status.issues.length })}
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {status.issues.map((i) => (
                <li key={`${i.kind}-${i.parentName ?? ''}-${i.name}`}>
                  {i.parentName ? `${i.parentName} · ` : ''}{i.name} — {t(`admin.channelManager.home.issueStatus.${i.status === 'remap_required' ? 'remap_required' : 'failed'}`)}
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </Paper>

      <ChannelsPanel canManage={canManage} active={state === 'active'} openWizard={openConnectWizard} />

      <BookingInbox active={state === 'active'} />

      <SyncActivity canManage={canManage} active={state === 'active'} />

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>{t('admin.channelManager.home.optionsTitle')}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {([['autoAssignRooms', 'autoAssign'], ['sendGuestConfirmationEmail', 'guestEmail'], ['ratesIncludeTaxes', 'taxes']] as const).map(([field, key]) => (
            <Box key={field} sx={{ mb: 1 }}>
              <FormControlLabel control={<Switch checked={settings[field]} disabled={!canManage} onChange={(e) => toggle(field, e.target.checked)} />}
                label={t(`admin.channelManager.home.options.${key}.label`)} />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 6, mt: -0.5 }}>{t(`admin.channelManager.home.options.${key}.hint`)}</Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      <Accordion variant="outlined" disableGutters sx={{ mb: 2 }}>
        <AccordionSummary expandIcon={<ExpandMore />}><Typography fontWeight={700}>{t('admin.channelManager.home.propertyTitle')}</Typography></AccordionSummary>
        <AccordionDetails>
          <PropertyProfileSummary fields={['name', 'currency', 'timezone', 'email', 'phone', 'address', 'city', 'country', 'zipCode']}
            intro={t('admin.channelManager.home.propertyChangeNote')} />
        </AccordionDetails>
      </Accordion>

      {message && <Alert severity={message.severity} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {canManage && (
        <Box sx={{ mt: 3 }}>
          <Button color="error" variant="outlined" onClick={() => setConfirmDisable(true)} disabled={busy}>{t('admin.channelManager.home.disable')}</Button>
        </Box>
      )}
      <Dialog open={confirmDisable} onClose={() => setConfirmDisable(false)}>
        <DialogTitle>{t('admin.channelManager.home.disableTitle')}</DialogTitle>
        <DialogContent><DialogContentText>{t('admin.channelManager.home.disableText')}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDisable(false)}>{t('common.cancel')}</Button>
          <Button color="error" onClick={disable} disabled={busy}>{t('admin.channelManager.home.disableConfirm')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ChannelManagerHome;
