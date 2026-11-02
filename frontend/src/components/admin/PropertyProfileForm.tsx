/**
 * Settings → Property profile: the property's own details. The booking engine, guest emails,
 * electronic invoicing and the channel manager all read them from here.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, CircularProgress, Divider, FormControl, FormHelperText, InputLabel, MenuItem, Select, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { propertyProfileService, PropertyProfile, PROFILE_CURRENCIES } from '../../services/api';
import { setPropertyCurrency } from '../../utils/currency';

type Editable = Omit<PropertyProfile, 'currencyLocked' | 'currencyLockReason' | 'currencyLocksOnSave'>;
type TextKey = Exclude<keyof Editable, 'currency' | 'timezone'>;

interface Props {
  showSnackbar: (message: string, severity?: 'success' | 'error') => void;
}

const PropertyProfileForm: React.FC<Props> = ({ showSnackbar }) => {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<PropertyProfile | null>(null);
  const [form, setForm] = useState<Editable | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    propertyProfileService.get()
      .then((res) => { setProfile(res.data.data!); setForm(res.data.data!); })
      .catch(() => setErrors([t('admin.settings.profile.loadFailed')]));
  }, [t]);

  const timezones = useMemo(() => {
    try { return (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { return ['America/Santo_Domingo', 'America/New_York', 'UTC']; }
  }, []);

  if (!form || !profile) return errors.length ? <Alert severity="error">{errors[0]}</Alert> : <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  const set = (k: keyof Editable, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const field = (k: TextKey, extra: Record<string, unknown> = {}) => (
    <TextField size="small" label={t(`admin.settings.profile.fields.${k}`)} value={form[k]} onChange={(e) => set(k, e.target.value)} fullWidth {...extra} />
  );

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const { currency, ...rest } = form;
      // Only send the currency when one is chosen and it changes (it may be locked)
      const res = await propertyProfileService.update(currency && currency !== profile.currency ? form : rest);
      setProfile(res.data.data!);
      setForm(res.data.data!);
      setPropertyCurrency(res.data.data!.currency);
      showSnackbar(t('admin.settings.profile.saved'));
    } catch (e: any) {
      setErrors(e?.response?.data?.errors ?? [e?.response?.data?.message ?? t('admin.settings.profile.saveFailed')]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>{t('admin.settings.profile.heading')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('admin.settings.profile.description')}</Typography>
      <Divider sx={{ mb: 3 }} />

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>{t('admin.settings.profile.identityTitle')}</Typography>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, mb: 3 }}>
        <Box sx={{ gridColumn: { sm: '1 / -1' } }}>{field('name', { required: true, helperText: t('admin.settings.profile.hints.name') })}</Box>
        {field('legalName', { helperText: t('admin.settings.profile.hints.legalName') })}
        {field('rnc', { helperText: t('admin.settings.profile.hints.rnc'), inputProps: { maxLength: 13 } })}
      </Box>

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>{t('admin.settings.profile.contactTitle')}</Typography>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, mb: 3 }}>
        {field('email', { type: 'email' })}
        {field('phone')}
        <Box sx={{ gridColumn: { sm: '1 / -1' } }}>{field('address')}</Box>
        {field('city')}
        {field('state')}
        {field('country', { inputProps: { maxLength: 2 }, helperText: t('admin.settings.profile.hints.country'), onChange: (e: React.ChangeEvent<HTMLInputElement>) => set('country', e.target.value.toUpperCase()) })}
        {field('zipCode')}
      </Box>

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>{t('admin.settings.profile.regionalTitle')}</Typography>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' }, mb: 2 }}>
        <FormControl size="small" disabled={profile.currencyLocked}>
          <InputLabel shrink>{t('admin.settings.profile.fields.currency')}</InputLabel>
          <Select label={t('admin.settings.profile.fields.currency')} value={form.currency} displayEmpty={!form.currency} notched
            renderValue={(v) => (v ? t(`admin.settings.profile.currencies.${v}`) : <em>{t('admin.settings.profile.chooseCurrency')}</em>)}
            onChange={(e) => set('currency', String(e.target.value))}>
            {PROFILE_CURRENCIES.map((c) => <MenuItem key={c} value={c}>{t(`admin.settings.profile.currencies.${c}`)}</MenuItem>)}
          </Select>
          <FormHelperText>
            {profile.currencyLocked ? t(`admin.settings.profile.currencyLocked.${profile.currencyLockReason}`)
              : !profile.currency ? t('admin.settings.profile.hints.currencyNotSet') : t('admin.settings.profile.hints.currency')}
          </FormHelperText>
        </FormControl>
        <Autocomplete freeSolo size="small" options={timezones} value={form.timezone}
          onInputChange={(_, v) => set('timezone', v)}
          renderInput={(p) => <TextField {...p} label={t('admin.settings.profile.fields.timezone')} helperText={t('admin.settings.profile.hints.timezone')} />} />
      </Box>
      {!profile.currencyLocked && form.currency && form.currency !== profile.currency && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {profile.currencyLocksOnSave ? t(`admin.settings.profile.currencyChoice.${profile.currencyLocksOnSave}`) : t('admin.settings.profile.currencyWarning')}
        </Alert>
      )}

      {errors.length > 0 && <Alert severity="error" sx={{ mb: 2 }}>{errors.map((e) => <div key={e}>{e}</div>)}</Alert>}
      <Button variant="contained" onClick={save} disabled={saving || !form.name.trim()} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>
        {t('common.save', 'Save')}
      </Button>
    </Box>
  );
};

export default PropertyProfileForm;
