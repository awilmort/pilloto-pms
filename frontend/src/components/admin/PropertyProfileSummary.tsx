/**
 * Read-only view of the property-profile fields a module uses, with a link to edit them in
 * Settings → Property profile. Booking engine, electronic invoicing and the channel-manager
 * wizard show it instead of keeping their own copy of the data.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { Edit } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { propertyProfileService, PropertyProfile } from '../../services/api';

export type ProfileSummaryField = Exclude<keyof PropertyProfile, 'currencyLocked' | 'currencyLockReason' | 'currencyLocksOnSave'>;

interface Props {
  fields: ProfileSummaryField[];
  /** Why this screen shows them (e.g. "shown to guests on the booking page") */
  intro?: string;
  /** Called with the loaded profile (e.g. to check required fields) */
  onLoaded?: (profile: PropertyProfile) => void;
}

const PropertyProfileSummary: React.FC<Props> = ({ fields, intro, onLoaded }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PropertyProfile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    propertyProfileService.get()
      .then((res) => { setProfile(res.data.data!); onLoaded?.(res.data.data!); })
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return <Alert severity="error">{t('admin.settings.profile.loadFailed')}</Alert>;
  if (!profile) return <CircularProgress size={20} />;

  const value = (k: ProfileSummaryField) => {
    if (k === 'currency') return profile.currency ? t(`admin.settings.profile.currencies.${profile.currency}`) : '';
    return profile[k] || '';
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, maxWidth: 720 }}>
      {intro && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{intro}</Typography>}
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr' }, columnGap: 2, rowGap: 0.75, m: 0 }}>
        {fields.map((k) => (
          <React.Fragment key={k}>
            <Typography component="dt" variant="body2" color="text.secondary">{t(`admin.settings.profile.fields.${k}`)}</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0, color: value(k) ? 'text.primary' : 'warning.main' }}>
              {value(k) || t('admin.settings.profile.notSet')}
            </Typography>
          </React.Fragment>
        ))}
      </Box>
      <Button size="small" startIcon={<Edit fontSize="small" />} sx={{ mt: 1.5 }} onClick={() => navigate('/admin/settings/profile')}>
        {t('admin.settings.profile.edit')}
      </Button>
    </Paper>
  );
};

export default PropertyProfileSummary;
