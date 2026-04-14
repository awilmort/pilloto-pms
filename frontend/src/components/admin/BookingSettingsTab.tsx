import React, { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, Button, Switch, FormControlLabel,
  CircularProgress, Divider, Stack,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { settingsService } from '../../services/api';

interface BookingSettings {
  enabled: boolean;
  contactPhone: string;
  contactEmail: string;
  contactAddress: string;
  widgetAllowedOrigins: string[];
  minAdvanceHours: number;
  maxAdvanceDays: number;
  termsVersion: string;
  privacyVersion: string;
}

interface BookingSettingsTabProps {
  showSnackbar: (message: string, severity?: 'success' | 'error') => void;
}

const DEFAULT_SETTINGS: BookingSettings = {
  enabled: false,
  contactPhone: '',
  contactEmail: '',
  contactAddress: '',
  widgetAllowedOrigins: [],
  minAdvanceHours: 24,
  maxAdvanceDays: 365,
  termsVersion: '1.0',
  privacyVersion: '1.0',
};

const BookingSettingsTab: React.FC<BookingSettingsTabProps> = ({ showSnackbar }) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<BookingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsService.getSettings()
      .then(res => {
        const data = res.data.data;
        if (data?.bookingSettings) {
          const bs = data.bookingSettings as any;
          setSettings(prev => ({
            ...prev,
            ...bs,
          }));
        }
      })
      .catch(() => showSnackbar(t('admin.settings.booking.errors.loadFailed', 'Failed to load booking settings'), 'error'))
      .finally(() => setLoading(false));
  }, [showSnackbar, t]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsService.updateSettings({ bookingSettings: settings });
      showSnackbar(t('admin.settings.booking.messages.saved', 'Booking settings saved successfully'));
    } catch {
      showSnackbar(t('admin.settings.errors.saveFailed', 'Failed to save settings'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ px: 3, pb: 3 }}>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        {t('admin.settings.booking.heading', 'Booking Engine')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('admin.settings.booking.description', 'Configure the public online booking page for guests. Control availability, branding, and widget embeds.')}
      </Typography>

      {/* ── Enable toggle ─────────────────────────────────────── */}
      <FormControlLabel
        control={
          <Switch
            checked={settings?.enabled || false}
            onChange={e => setSettings(prev => ({ ...prev!, enabled: e.target.checked }))}
          />
        }
        label={t('admin.settings.booking.enabled', 'Enable online booking')}
        sx={{ mb: 3 }}
      />

      <Divider sx={{ mb: 3 }} />

      {/* ── Contact Information ───────────────────────────────── */}
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {t('admin.settings.booking.contact.heading', 'Contact Information')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('admin.settings.booking.contact.description', 'Contact details shown to guests on the booking page.')}
      </Typography>
      <Stack spacing={2} sx={{ mb: 3 }}>
        <TextField
          label={t('admin.settings.booking.contact.phone', 'Phone')}
          value={settings?.contactPhone || ''}
          onChange={e => setSettings(prev => ({ ...prev!, contactPhone: e.target.value }))}
          fullWidth
          size="small"
        />
        <TextField
          label={t('admin.settings.booking.contact.email', 'Email')}
          value={settings?.contactEmail || ''}
          onChange={e => setSettings(prev => ({ ...prev!, contactEmail: e.target.value }))}
          fullWidth
          size="small"
        />
        <TextField
          label={t('admin.settings.booking.contact.address', 'Address')}
          value={settings?.contactAddress || ''}
          onChange={e => setSettings(prev => ({ ...prev!, contactAddress: e.target.value }))}
          fullWidth
          size="small"
          multiline
          rows={2}
        />
      </Stack>

      <Divider sx={{ mb: 3 }} />

      {/* ── Booking Rules ─────────────────────────────────────── */}
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {t('admin.settings.booking.rules.heading', 'Booking Rules')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('admin.settings.booking.rules.description', 'Control how far in advance guests can book.')}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <TextField
          label={t('admin.settings.booking.rules.minAdvanceHours', 'Minimum advance hours')}
          type="number"
          value={settings?.minAdvanceHours ?? 24}
          onChange={e => setSettings(prev => ({ ...prev!, minAdvanceHours: Math.max(0, parseInt(e.target.value) || 0) }))}
          size="small"
          inputProps={{ min: 0 }}
          helperText={t('admin.settings.booking.rules.minAdvanceHoursHint', 'Minimum hours before check-in a booking can be made.')}
        />
        <TextField
          label={t('admin.settings.booking.rules.maxAdvanceDays', 'Maximum advance days')}
          type="number"
          value={settings?.maxAdvanceDays ?? 365}
          onChange={e => setSettings(prev => ({ ...prev!, maxAdvanceDays: Math.max(1, parseInt(e.target.value) || 1) }))}
          size="small"
          inputProps={{ min: 1 }}
          helperText={t('admin.settings.booking.rules.maxAdvanceDaysHint', 'Maximum number of days into the future a booking can be made.')}
        />
      </Stack>

      {/* ── Save ──────────────────────────────────────────────── */}
      <Button
        variant="contained"
        onClick={handleSave}
        disabled={saving}
        sx={{ textTransform: 'none', fontWeight: 600, mb: 4 }}
      >
        {saving
          ? t('admin.settings.booking.saving', 'Saving…')
          : t('admin.settings.booking.save', 'Save Booking Settings')}
      </Button>
    </Box>
  );
};

export default BookingSettingsTab;
