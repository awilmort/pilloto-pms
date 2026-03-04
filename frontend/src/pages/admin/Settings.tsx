import React from 'react';
import {
  Box,
  Tab,
  Tabs,
  Typography,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Paper,
  Divider,
  RadioGroup,
  Radio,
  TextField,
  CircularProgress,
  Alert,
} from '@mui/material';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import { useTranslation } from 'react-i18next';
import { settingsService, AppSettings } from '../../services/api';

export type { AppSettings };
export type PricingModel = 'perGuest' | 'perRoom';

// ─── Tab Panel ────────────────────────────────────────────────────────────────

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => (
  <div role="tabpanel" hidden={value !== index} id={`settings-tabpanel-${index}`}>
    {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
  </div>
);

// ─── Section keys (must match AdminLayout menu item keys) ───────────────────

// 'settings' is intentionally excluded — disabling it would lock the admin out
const SECTION_KEYS: { key: string; labelKey: string }[] = [
  { key: 'dashboard',     labelKey: 'admin.nav.dashboard' },
  { key: 'revenue',       labelKey: 'admin.nav.revenue' },
  { key: 'commissions',   labelKey: 'admin.nav.commissions' },
  { key: 'schedule',      labelKey: 'admin.nav.schedule' },
  { key: 'accommodations',labelKey: 'admin.nav.accommodations' },
  { key: 'rooms',         labelKey: 'admin.nav.rooms' },
  { key: 'amenities',     labelKey: 'admin.nav.amenities' },
  { key: 'event-types',   labelKey: 'admin.nav.eventTypes' },
  { key: 'wristbands',    labelKey: 'admin.nav.wristbands' },
  { key: 'pricing',       labelKey: 'admin.nav.pricing' },
  { key: 'reservations',  labelKey: 'admin.nav.reservations' },
  { key: 'users',         labelKey: 'admin.nav.users' },
  { key: 'roles',         labelKey: 'admin.nav.roles' },
  { key: 'media',         labelKey: 'admin.nav.media' },
  { key: 'companies',     labelKey: 'admin.nav.companies' },
  { key: 'guests',        labelKey: 'admin.nav.guests' },
  { key: 'credit-accounts', labelKey: 'admin.nav.creditAccounts' },
  { key: 'cashier-closures', labelKey: 'admin.nav.cashierClosures' },
];

// ─── Settings Page ────────────────────────────────────────────────────────────

const defaultSettings: AppSettings = {
  services: { daypass: true, accommodation: true, pasatarde: true, event: true },
  accommodationPricingModel: 'perGuest',
  sections: {},
  cashierShift: { openTime: '08:00', closeTime: '17:00' },
};

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = React.useState(0);
  const [settings, setSettings] = React.useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    settingsService.getSettings()
      .then(res => setSettings(res.data.data ?? defaultSettings))
      .catch(() => setError(t('admin.settings.errors.loadFailed', 'Failed to load settings')))
      .finally(() => setLoading(false));
  }, [t]);

  const save = async (patch: Partial<AppSettings>) => {
    setSaving(true);
    try {
      const res = await settingsService.updateSettings(patch);
      // Merge server response to avoid stale-closure overwrite
      if (res.data.data) setSettings(prev => ({ ...prev, ...res.data.data! }));
    } catch {
      setError(t('admin.settings.errors.saveFailed', 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const handleServiceChange = (key: keyof AppSettings['services']) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const updated = { ...settings.services, [key]: e.target.checked };
      setSettings(s => ({ ...s, services: updated }));
      save({ services: updated });
    };

  const handlePricingModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const model = e.target.value as PricingModel;
    setSettings(s => ({ ...s, accommodationPricingModel: model }));
    save({ accommodationPricingModel: model });
  };

  const handleSectionChange = (key: string) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const updated = { ...(settings.sections ?? {}), [key]: e.target.checked };
      setSettings(s => ({ ...s, sections: updated }));
      save({ sections: updated });
    };

  const handleCashierShiftChange = (field: 'openTime' | 'closeTime') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const updated = { ...(settings.cashierShift || { openTime: '08:00', closeTime: '17:00' }), [field]: e.target.value };
      setSettings(s => ({ ...s, cashierShift: updated }));
      save({ cashierShift: updated });
    };

  // A section is enabled when not explicitly set to false
  const isSectionEnabled = (key: string) => settings.sections?.[key] !== false;

  return (
    <AdminLayout>
      <Box sx={{ pb: 4 }}>
        <SectionTitle title={t('admin.settings.title')} />
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          {t('admin.settings.subtitle')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Paper
            elevation={0}
            sx={{ border: '1px solid', borderColor: 'divider', opacity: saving ? 0.7 : 1, transition: 'opacity 0.2s' }}
          >
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)} aria-label="settings tabs">
                <Tab label={t('admin.settings.tabs.services')} id="settings-tab-0" />
                <Tab label={t('admin.settings.tabs.sections')} id="settings-tab-1" />
                <Tab label={t('admin.settings.tabs.cashier', 'Cashier')} id="settings-tab-2" />
              </Tabs>
            </Box>

            {/* Services tab */}
            <TabPanel value={activeTab} index={0}>
              <Box sx={{ px: 3, pb: 3 }}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                  {t('admin.settings.services.heading')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('admin.settings.services.description')}
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <FormGroup>
                  <FormControlLabel
                    control={<Checkbox checked={settings.services.daypass} onChange={handleServiceChange('daypass')} color="primary" />}
                    label={t('admin.settings.services.daypass')}
                  />

                  {/* Accommodation + pricing model */}
                  <FormControlLabel
                    control={<Checkbox checked={settings.services.accommodation} onChange={handleServiceChange('accommodation')} color="primary" />}
                    label={t('admin.settings.services.accommodation')}
                  />
                  {settings.services.accommodation && (
                    <Box sx={{ ml: 4, mb: 1 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                        {t('admin.settings.services.pricingModelLabel')}
                      </Typography>
                      <RadioGroup row value={settings.accommodationPricingModel} onChange={handlePricingModelChange}>
                        <FormControlLabel
                          value="perGuest"
                          control={<Radio size="small" color="primary" />}
                          label={t('admin.settings.services.pricingModel.perGuest')}
                        />
                        <FormControlLabel
                          value="perRoom"
                          control={<Radio size="small" color="primary" />}
                          label={t('admin.settings.services.pricingModel.perRoom')}
                        />
                      </RadioGroup>
                    </Box>
                  )}

                  <FormControlLabel
                    control={<Checkbox checked={settings.services.pasatarde} onChange={handleServiceChange('pasatarde')} color="primary" />}
                    label={t('admin.settings.services.pasatarde')}
                  />
                  <FormControlLabel
                    control={<Checkbox checked={settings.services.event} onChange={handleServiceChange('event')} color="primary" />}
                    label={t('admin.settings.services.event')}
                  />
                </FormGroup>
              </Box>
            </TabPanel>
            {/* Sections tab */}
            <TabPanel value={activeTab} index={1}>
              <Box sx={{ px: 3, pb: 3 }}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                  {t('admin.settings.sections.heading')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('admin.settings.sections.description')}
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <FormGroup>
                  {SECTION_KEYS.map(({ key, labelKey }) => (
                    <FormControlLabel
                      key={key}
                      control={
                        <Checkbox
                          checked={isSectionEnabled(key)}
                          onChange={handleSectionChange(key)}
                          color="primary"
                        />
                      }
                      label={t(labelKey)}
                    />
                  ))}
                </FormGroup>
              </Box>
            </TabPanel>
            <TabPanel value={activeTab} index={2}>
              <Box sx={{ px: 3, pb: 3 }}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                  {t('admin.settings.cashier.heading', 'Cashier Shift')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('admin.settings.cashier.description', 'Configure cashier shift opening and closing times for closures.')}
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <TextField
                    label={t('admin.settings.cashier.openTime', 'Cashier Shift Open Time')}
                    type="time"
                    value={settings.cashierShift?.openTime || '08:00'}
                    onChange={handleCashierShiftChange('openTime')}
                    InputLabelProps={{ shrink: true }}
                    sx={{ minWidth: 240 }}
                  />
                  <TextField
                    label={t('admin.settings.cashier.closeTime', 'Cashier Shift Close Time')}
                    type="time"
                    value={settings.cashierShift?.closeTime || '17:00'}
                    onChange={handleCashierShiftChange('closeTime')}
                    InputLabelProps={{ shrink: true }}
                    sx={{ minWidth: 240 }}
                  />
                </Box>
              </Box>
            </TabPanel>
          </Paper>
        )}
      </Box>
    </AdminLayout>
  );
};

export default Settings;
