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
  TextField,
  CircularProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Snackbar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import NumberField from '../../components/common/NumberField';
import { useTranslation } from 'react-i18next';
import { settingsService, AppSettings, roomTypeService } from '../../services/api';
import { RoomType } from '../../types';
import { AmenitiesContent } from './AmenitiesManagement';
import { EventTypesContent } from './EventTypesManagement';
import { RolesContent } from './RolesManagement';
import { MediaContent } from './MediaManagement';

export type { AppSettings };

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
  { key: 'schedule',         labelKey: 'admin.nav.schedule' },
  { key: 'booking-calendar', labelKey: 'admin.nav.bookingCalendar' },
  { key: 'accommodations',   labelKey: 'admin.nav.accommodations' },
  { key: 'rooms',         labelKey: 'admin.nav.rooms' },
  { key: 'wristbands',    labelKey: 'admin.nav.wristbands' },
  { key: 'pricing',       labelKey: 'admin.nav.pricing' },
  { key: 'reservations',  labelKey: 'admin.nav.reservations' },
  { key: 'users',         labelKey: 'admin.nav.users' },
  { key: 'companies',     labelKey: 'admin.nav.companies' },
  { key: 'guests',        labelKey: 'admin.nav.guests' },
  { key: 'credit-accounts', labelKey: 'admin.nav.creditAccounts' },
  { key: 'cashier-closures', labelKey: 'admin.nav.cashierClosures' },
];

// ─── Settings Page ────────────────────────────────────────────────────────────

const defaultSettings: AppSettings = {
  sections: {},
  nightAuditEnabled: true,
  nightAuditTime: '',
  checkoutTime: '11:00',
};

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = React.useState(0);
  const [settings, setSettings] = React.useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [nightAuditTime, setNightAuditTime] = React.useState('');
  const [nightAuditTimeSaving, setNightAuditTimeSaving] = React.useState(false);
  const [checkoutTime, setCheckoutTime] = React.useState('11:00');
  const [checkoutTimeSaving, setCheckoutTimeSaving] = React.useState(false);
  const [snackbar, setSnackbar] = React.useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const showSnackbar = (message: string, severity: 'success' | 'error' = 'success') =>
    setSnackbar({ open: true, message, severity });

  // ── Email Settings state ──────────────────────────────────
  const [emailFromDisplayName, setEmailFromDisplayName] = React.useState('');
  const [emailReplyTo, setEmailReplyTo] = React.useState('');
  const [emailFooterHtml, setEmailFooterHtml] = React.useState('');
  const [emailFooterText, setEmailFooterText] = React.useState('');
  const [emailSaving, setEmailSaving] = React.useState(false);

  // ── Room Types state ──────────────────────────────────────
  const [roomTypes, setRoomTypes] = React.useState<RoomType[]>([]);
  const [roomTypesLoading, setRoomTypesLoading] = React.useState(false);
  const [roomTypeDialog, setRoomTypeDialog] = React.useState(false);
  const [roomTypeForm, setRoomTypeForm] = React.useState<Partial<RoomType>>({ name: '', capacity: 2, isActive: true });
  const [roomTypeError, setRoomTypeError] = React.useState<string | null>(null);

  React.useEffect(() => {
    settingsService.getSettings()
      .then(res => setSettings(res.data.data ?? defaultSettings))
      .catch(() => setError(t('admin.settings.errors.loadFailed', 'Failed to load settings')))
      .finally(() => setLoading(false));
  }, [t]);

  const fetchRoomTypes = React.useCallback(async () => {
    setRoomTypesLoading(true);
    try {
      const res = await roomTypeService.getRoomTypes();
      setRoomTypes(res.data.data || []);
    } catch {
      setRoomTypeError(t('admin.pricing.messages.loadFailed'));
    } finally {
      setRoomTypesLoading(false);
    }
  }, [t]);

  React.useEffect(() => { fetchRoomTypes(); }, [fetchRoomTypes]);

  React.useEffect(() => {
    setNightAuditTime(settings.nightAuditTime ?? '');
  }, [settings.nightAuditTime]);

  React.useEffect(() => {
    setCheckoutTime(settings.checkoutTime ?? '11:00');
  }, [settings.checkoutTime]);

  React.useEffect(() => {
    setEmailFromDisplayName(settings.emailSettings?.fromDisplayName ?? '');
    setEmailReplyTo(settings.emailSettings?.replyTo ?? '');
    setEmailFooterHtml(settings.emailSettings?.footerHtml ?? '');
    setEmailFooterText(settings.emailSettings?.footerText ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.emailSettings?.fromDisplayName,
    settings.emailSettings?.replyTo,
    settings.emailSettings?.footerHtml,
    settings.emailSettings?.footerText,
  ]);

  const openNewRoomType = () => {
    setRoomTypeForm({ name: '', capacity: 2, isActive: true });
    setRoomTypeError(null);
    setRoomTypeDialog(true);
  };

  const openEditRoomType = (rt: RoomType) => {
    setRoomTypeForm({ ...rt });
    setRoomTypeError(null);
    setRoomTypeDialog(true);
  };

  const saveRoomType = async () => {
    if (!roomTypeForm.name?.trim()) { setRoomTypeError(t('admin.pricing.roomTypes.errors.nameRequired')); return; }
    if (!roomTypeForm.capacity || roomTypeForm.capacity < 1) { setRoomTypeError(t('admin.pricing.roomTypes.errors.capacityRequired')); return; }
    setRoomTypeError(null);
    try {
      if (roomTypeForm._id) {
        await roomTypeService.updateRoomType(roomTypeForm._id, roomTypeForm as any);
      } else {
        await roomTypeService.createRoomType(roomTypeForm as any);
      }
      setRoomTypeDialog(false);
      await fetchRoomTypes();
    } catch (e: any) {
      setRoomTypeError(e.response?.data?.message || t('admin.pricing.messages.saveFailed'));
    }
  };

  const deleteRoomType = async (id: string) => {
    if (!window.confirm(t('admin.pricing.dialog.deletePrompt'))) return;
    try {
      await roomTypeService.deleteRoomType(id);
      await fetchRoomTypes();
    } catch {
      setRoomTypeError(t('admin.pricing.messages.saveFailed'));
    }
  };

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

  const handleSectionChange = (key: string) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const updated = { ...(settings.sections ?? {}), [key]: e.target.checked };
      setSettings(s => ({ ...s, sections: updated }));
      save({ sections: updated });
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
              <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)} aria-label="settings tabs" variant="scrollable" scrollButtons="auto">
                <Tab label={t('admin.settings.tabs.sections')} id="settings-tab-0" />
                <Tab label={t('admin.settings.tabs.roomTypes', 'Room Types')} id="settings-tab-1" />
                <Tab label={t('admin.settings.tabs.amenities', 'Amenities')} id="settings-tab-2" />
                <Tab label={t('admin.settings.tabs.eventTypes', 'Event Types')} id="settings-tab-3" />
                <Tab label={t('admin.settings.tabs.roles', 'Roles')} id="settings-tab-4" />
                <Tab label={t('admin.settings.tabs.media', 'Media')} id="settings-tab-5" />
                <Tab label={t('admin.settings.tabs.nightAudit', 'Night Audit')} id="settings-tab-6" />
                <Tab label={t('admin.settings.tabs.email', 'Email')} id="settings-tab-7" />
                <Tab label={t('admin.settings.tabs.checkout', 'Check-Out')} id="settings-tab-8" />
              </Tabs>
            </Box>

            {/* Sections tab */}
            <TabPanel value={activeTab} index={0}>
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

            {/* Room Types tab */}
            <TabPanel value={activeTab} index={1}>
              <Box sx={{ px: 3, pb: 3 }}>
                {roomTypeError && (
                  <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRoomTypeError(null)}>{roomTypeError}</Alert>
                )}
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                  <Button variant="contained" startIcon={<AddIcon />} onClick={openNewRoomType}>
                    {t('admin.pricing.roomTypes.actions.new')}
                  </Button>
                </Box>
                {roomTypesLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                ) : (
                  <TableContainer component={Paper} variant="outlined">
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('admin.pricing.roomTypes.table.name')}</TableCell>
                          <TableCell>{t('admin.pricing.roomTypes.table.capacity')}</TableCell>
                          <TableCell>{t('admin.pricing.roomTypes.table.active')}</TableCell>
                          <TableCell>{t('admin.pricing.roomTypes.table.actions')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {roomTypes.map(rt => (
                          <TableRow key={rt._id}>
                            <TableCell>{rt.name}</TableCell>
                            <TableCell>{rt.capacity}</TableCell>
                            <TableCell>
                              <Chip size="small" label={rt.isActive ? t('common.yes') : t('common.no')} color={rt.isActive ? 'success' : 'default'} />
                            </TableCell>
                            <TableCell>
                              <IconButton size="small" onClick={() => openEditRoomType(rt)}><EditIcon fontSize="small" /></IconButton>
                              <IconButton size="small" color="error" onClick={() => deleteRoomType(rt._id)}><DeleteIcon fontSize="small" /></IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                        {roomTypes.length === 0 && (
                          <TableRow><TableCell colSpan={4} align="center">{t('admin.pricing.roomTypes.empty')}</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}

                {/* Room Type Dialog */}
                <Dialog open={roomTypeDialog} onClose={() => setRoomTypeDialog(false)} maxWidth="xs" fullWidth>
                  <DialogTitle>
                    {roomTypeForm._id ? t('admin.pricing.roomTypes.dialog.editTitle') : t('admin.pricing.roomTypes.dialog.newTitle')}
                  </DialogTitle>
                  <DialogContent>
                    <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
                      {roomTypeError && <Alert severity="error">{roomTypeError}</Alert>}
                      <TextField
                        label={t('admin.pricing.roomTypes.form.name')}
                        value={roomTypeForm.name || ''}
                        onChange={e => setRoomTypeForm(p => ({ ...p, name: e.target.value }))}
                        required fullWidth
                      />
                      <NumberField
                        label={t('admin.pricing.roomTypes.form.capacity')}
                        value={roomTypeForm.capacity ?? 2}
                        onChange={val => setRoomTypeForm(p => ({ ...p, capacity: val ?? 1 }))}
                        min={1}
                      />
                      <FormControlLabel
                        control={<Switch checked={roomTypeForm.isActive ?? true} onChange={e => setRoomTypeForm(p => ({ ...p, isActive: e.target.checked }))} />}
                        label={t('admin.pricing.form.active')}
                      />
                    </Box>
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={() => setRoomTypeDialog(false)}>{t('admin.pricing.actions.cancel')}</Button>
                    <Button variant="contained" onClick={saveRoomType}>{t('admin.pricing.actions.save')}</Button>
                  </DialogActions>
                </Dialog>
              </Box>
            </TabPanel>

            {/* Amenities tab */}
            <TabPanel value={activeTab} index={2}>
              <Box sx={{ px: 3, pb: 3 }}>
                <AmenitiesContent />
              </Box>
            </TabPanel>

            {/* Event Types tab */}
            <TabPanel value={activeTab} index={3}>
              <Box sx={{ px: 3, pb: 3 }}>
                <EventTypesContent />
              </Box>
            </TabPanel>

            {/* Roles tab */}
            <TabPanel value={activeTab} index={4}>
              <Box sx={{ px: 3, pb: 3 }}>
                <RolesContent />
              </Box>
            </TabPanel>

            {/* Media tab */}
            <TabPanel value={activeTab} index={5}>
              <Box sx={{ px: 3, pb: 3 }}>
                <MediaContent />
              </Box>
            </TabPanel>

            {/* Night Audit tab */}
            <TabPanel value={activeTab} index={6}>
              <Box sx={{ px: 3, pb: 3 }}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                  {t('admin.settings.nightAudit.heading', 'Night Audit Worker')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('admin.settings.nightAudit.description', 'The night audit runs automatically to post nightly charges based on active charge rules. You can enable or disable it and optionally override the run schedule.')}
                </Typography>
                <Divider sx={{ mb: 3 }} />

                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.nightAuditEnabled !== false}
                      onChange={e => {
                        const patch = { nightAuditEnabled: e.target.checked };
                        setSettings(s => ({ ...s, ...patch }));
                        save(patch);
                      }}
                    />
                  }
                  label={t('admin.settings.nightAudit.enabled', 'Enable night audit')}
                  sx={{ mb: 3, display: 'flex' }}
                />

                <TextField
                  label={t('admin.settings.nightAudit.schedule', 'Run time')}
                  type="time"
                  value={nightAuditTime || '03:00'}
                  onChange={e => setNightAuditTime(e.target.value)}
                  inputProps={{ step: 3600 }}
                  InputLabelProps={{ shrink: true }}
                  helperText={t('admin.settings.nightAudit.scheduleHint', 'The audit runs automatically once at this hour each day.')}
                  disabled={settings.nightAuditEnabled === false}
                  sx={{ maxWidth: 200, display: 'block', mb: 2 }}
                />
                <Button
                  variant="contained"
                  disabled={nightAuditTimeSaving || settings.nightAuditEnabled === false}
                  onClick={async () => {
                    setNightAuditTimeSaving(true);
                    try {
                      const patch = { nightAuditTime };
                      setSettings(s => ({ ...s, ...patch }));
                      await save(patch);
                      showSnackbar(t('admin.settings.messages.saved', 'Settings saved'));
                    } catch {
                      showSnackbar(t('admin.settings.errors.saveFailed', 'Failed to save settings'), 'error');
                    } finally {
                      setNightAuditTimeSaving(false);
                    }
                  }}
                >
                  {nightAuditTimeSaving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
                </Button>
              </Box>
            </TabPanel>

            {/* Email tab */}
            <TabPanel value={activeTab} index={7}>
              <Box sx={{ px: 3, pb: 3, maxWidth: 600 }}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                  {t('admin.settings.email.heading', 'Email Settings')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('admin.settings.email.description', 'Customise the display name, reply-to address, and footer appended to every outgoing email.')}
                </Typography>
                <Divider sx={{ mb: 3 }} />

                <Box sx={{ display: 'grid', gap: 2.5 }}>
                  <TextField
                    label={t('admin.settings.email.fromDisplayName', 'Sender display name')}
                    value={emailFromDisplayName}
                    onChange={e => setEmailFromDisplayName(e.target.value.slice(0, 100))}
                    inputProps={{ maxLength: 100 }}
                    helperText={t('admin.settings.email.fromDisplayNameHint', 'Shown as the sender name, e.g. "Banana Ranch via Pilloto"')}
                    fullWidth
                  />
                  <TextField
                    label={t('admin.settings.email.replyTo', 'Reply-to address')}
                    value={emailReplyTo}
                    onChange={e => setEmailReplyTo(e.target.value)}
                    type="email"
                    inputProps={{ maxLength: 254 }}
                    helperText={t('admin.settings.email.replyToHint', 'Replies from guests will go here instead of the sending address.')}
                    fullWidth
                  />
                  <TextField
                    label={t('admin.settings.email.footerHtml', 'Footer HTML')}
                    value={emailFooterHtml}
                    onChange={e => setEmailFooterHtml(e.target.value)}
                    multiline
                    rows={4}
                    inputProps={{ maxLength: 5000 }}
                    helperText={t('admin.settings.email.footerHtmlHint', 'HTML appended to every email footer. Only basic tags are allowed (p, br, strong, em, a, ul, ol, li).')}
                    fullWidth
                  />
                  <TextField
                    label={t('admin.settings.email.footerText', 'Footer plain text')}
                    value={emailFooterText}
                    onChange={e => setEmailFooterText(e.target.value)}
                    multiline
                    rows={3}
                    inputProps={{ maxLength: 2000 }}
                    helperText={t('admin.settings.email.footerTextHint', 'Plain-text version of the footer for email clients that do not render HTML.')}
                    fullWidth
                  />
                  <Box>
                    <Button
                      variant="contained"
                      disabled={emailSaving}
                      onClick={async () => {
                        setEmailSaving(true);
                        try {
                          const patch = {
                            emailSettings: {
                              fromDisplayName: emailFromDisplayName,
                              replyTo: emailReplyTo,
                              footerHtml: emailFooterHtml,
                              footerText: emailFooterText,
                            },
                          };
                          await save(patch);
                          showSnackbar(t('admin.settings.messages.saved', 'Settings saved'));
                        } catch {
                          showSnackbar(t('admin.settings.errors.saveFailed', 'Failed to save settings'), 'error');
                        } finally {
                          setEmailSaving(false);
                        }
                      }}
                    >
                      {emailSaving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
                    </Button>
                  </Box>
                </Box>
              </Box>
            </TabPanel>

            {/* Check-Out tab */}
            <TabPanel value={activeTab} index={8}>
              <Box sx={{ px: 3, pb: 3, maxWidth: 400 }}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                  {t('admin.settings.checkout.heading', 'Check-Out Settings')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('admin.settings.checkout.description', 'Set the standard time guests must check out. This is used as the baseline for late checkout detection in auto-charge policies.')}
                </Typography>
                <Divider sx={{ mb: 3 }} />
                <TextField
                  label={t('admin.settings.checkout.checkoutTime', 'Check-out time')}
                  type="time"
                  value={checkoutTime || '11:00'}
                  onChange={e => setCheckoutTime(e.target.value)}
                  inputProps={{ step: 900 }}
                  InputLabelProps={{ shrink: true }}
                  helperText={t('admin.settings.checkout.checkoutTimeHint', 'Guests are expected to check out by this time. Auto-charge policies use this as the reference point.')}
                  sx={{ maxWidth: 200, display: 'block', mb: 2 }}
                />
                <Button
                  variant="contained"
                  disabled={checkoutTimeSaving}
                  onClick={async () => {
                    setCheckoutTimeSaving(true);
                    try {
                      const patch = { checkoutTime };
                      setSettings(s => ({ ...s, ...patch }));
                      await save(patch);
                      showSnackbar(t('admin.settings.messages.saved', 'Settings saved'));
                    } catch {
                      showSnackbar(t('admin.settings.errors.saveFailed', 'Failed to save settings'), 'error');
                    } finally {
                      setCheckoutTimeSaving(false);
                    }
                  }}
                >
                  {checkoutTimeSaving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
                </Button>
              </Box>
            </TabPanel>
          </Paper>
        )}
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </AdminLayout>
  );
};

export default Settings;
