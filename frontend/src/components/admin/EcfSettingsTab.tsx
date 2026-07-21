import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import VpnKeyOffIcon from '@mui/icons-material/VpnKeyOff';
import WifiIcon from '@mui/icons-material/Wifi';
import { useTranslation } from 'react-i18next';
import { ecfService } from '../../services/api';
import type { TenantEcfConfig, EcfAmbiente } from '../../types';

const AMBIENTES: EcfAmbiente[] = ['Simulacion', 'Pruebas', 'Certificacion', 'Produccion'];

const DEFAULT_CITRUS_URL = 'https://test.ecf.citrus.com.do';

interface FormState {
  rnc: string;
  razonSocial: string;
  nombreComercial: string;
  phone: string;
  sucursal: string;
  ambiente: EcfAmbiente;
  citrusBaseUrl: string;
  citrusToken: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  rnc: '',
  razonSocial: '',
  nombreComercial: '',
  phone: '',
  sucursal: '',
  ambiente: 'Simulacion',
  citrusBaseUrl: DEFAULT_CITRUS_URL,
  citrusToken: '',
  isActive: false,
};

const EcfSettingsTab: React.FC = () => {
  const { t } = useTranslation();

  const [config, setConfig] = useState<TenantEcfConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);

  // ── Load config ─────────────────────────────────────────────

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ecfService.getConfig();
      const data = res.data.data ?? null;
      setConfig(data);
      if (data) {
        setForm({
          rnc: data.rnc ?? '',
          razonSocial: data.razonSocial ?? '',
          nombreComercial: data.nombreComercial ?? '',
          phone: data.phone ?? '',
          sucursal: data.sucursal ?? '',
          ambiente: data.ambiente ?? 'Simulacion',
          citrusBaseUrl: data.citrusBaseUrl ?? DEFAULT_CITRUS_URL,
          citrusToken: '',
          isActive: data.isActive ?? false,
        });
      }
    } catch {
      setErrorMessage(t('admin.settings.ecf.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // ── Save ─────────────────────────────────────────────────────

  const handleSave = async () => {
    // Validate RNC
    if (form.rnc && !/^\d{9}$|^\d{11}$/.test(form.rnc)) {
      setFormError(t('admin.settings.ecf.errors.invalidRnc'));
      return;
    }
    if (!form.rnc.trim() || !form.razonSocial.trim()) {
      setFormError(t('common.requiredFields', 'RNC and Razón Social are required'));
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      const payload: Partial<TenantEcfConfig & { citrusToken?: string }> = {
        rnc: form.rnc.trim(),
        razonSocial: form.razonSocial.trim(),
        nombreComercial: form.nombreComercial.trim() || undefined,
        phone: form.phone.trim() || undefined,
        sucursal: form.sucursal.trim() || undefined,
        ambiente: form.ambiente,
        // citrusBaseUrl is managed server-side — not sent by the client
        isActive: form.isActive,
      };
      if (form.citrusToken.trim()) {
        payload.citrusToken = form.citrusToken.trim();
      }

      await ecfService.saveConfig(payload);
      setSuccessMessage(t('admin.settings.ecf.messages.saved'));
      setForm(prev => ({ ...prev, citrusToken: '' }));
      await loadConfig();
    } catch {
      setErrorMessage(t('admin.settings.ecf.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // ── Test connection ──────────────────────────────────────────

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await ecfService.testConnection();
      setTestResult('success');
      setSuccessMessage(t('admin.settings.ecf.messages.connectionSuccess'));
    } catch {
      setTestResult('error');
      setErrorMessage(t('admin.settings.ecf.messages.connectionFailed'));
    } finally {
      setTesting(false);
    }
  };

  // ── Revoke token ─────────────────────────────────────────────

  const handleRevokeToken = async () => {
    setRevoking(true);
    try {
      await ecfService.revokeToken();
      setSuccessMessage(t('admin.settings.ecf.messages.tokenRevoked'));
      setRevokeDialogOpen(false);
      await loadConfig();
    } catch {
      setErrorMessage(t('admin.settings.ecf.errors.saveFailed'));
    } finally {
      setRevoking(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    );
  }

  const hasToken = config?.hasToken ?? false;
  const canTest = hasToken && !config?.isActive === false;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t('admin.settings.ecf.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        {t('admin.settings.ecf.subtitle')}
      </Typography>

      {formError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setFormError(null)}>
          {formError}
        </Alert>
      )}

      <Box component="form" noValidate>

        {/* ── Token status ──────────────────────────────────── */}
        <Box display="flex" alignItems="center" gap={2} mb={3} p={2}
          sx={{ bgcolor: 'action.hover', borderRadius: 1 }}>
          {hasToken ? (
            <CheckCircleOutlineIcon color="success" />
          ) : (
            <ErrorOutlineIcon color="warning" />
          )}
          <Typography variant="body2">
            {hasToken
              ? t('admin.settings.ecf.tokenStatus.configured')
              : t('admin.settings.ecf.tokenStatus.notConfigured')}
          </Typography>
          {hasToken && (
            <Button
              size="small"
              color="error"
              startIcon={<VpnKeyOffIcon />}
              onClick={() => setRevokeDialogOpen(true)}
              sx={{ ml: 'auto' }}
            >
              {t('admin.settings.ecf.actions.revokeToken')}
            </Button>
          )}
        </Box>

        {/* ── API token input ───────────────────────────────── */}
        <TextField
          label={t('admin.settings.ecf.fields.citrusToken')}
          value={form.citrusToken}
          onChange={e => setForm(prev => ({ ...prev, citrusToken: e.target.value }))}
          helperText={t('admin.settings.ecf.fields.citrusTokenHelp')}
          type="password"
          fullWidth
          size="small"
          sx={{ mb: 2 }}
          placeholder={hasToken ? '••••••••••••' : ''}
          autoComplete="new-password"
        />

        <Divider sx={{ my: 2 }} />

        {/* ── RNC + Razón Social ────────────────────────────── */}
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }} gap={2} mb={2}>
          <TextField
            label={t('admin.settings.ecf.fields.rnc')}
            value={form.rnc}
            onChange={e => setForm(prev => ({ ...prev, rnc: e.target.value }))}
            helperText={t('admin.settings.ecf.fields.rncHelp')}
            size="small"
            required
            inputProps={{ maxLength: 11 }}
          />
          <TextField
            label={t('admin.settings.ecf.fields.razonSocial')}
            value={form.razonSocial}
            onChange={e => setForm(prev => ({ ...prev, razonSocial: e.target.value }))}
            size="small"
            required
          />
          <TextField
            label={t('admin.settings.ecf.fields.nombreComercial')}
            value={form.nombreComercial}
            onChange={e => setForm(prev => ({ ...prev, nombreComercial: e.target.value }))}
            size="small"
          />
          <TextField
            label={t('admin.settings.ecf.fields.phone', 'Teléfono de Contacto')}
            value={form.phone}
            onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
            size="small"
            helperText={t('admin.settings.ecf.fields.phoneHelp', 'Aparece en la representación impresa del comprobante')}
            inputProps={{ maxLength: 20 }}
          />
          <TextField
            label={t('admin.settings.ecf.fields.sucursal')}
            value={form.sucursal}
            onChange={e => setForm(prev => ({ ...prev, sucursal: e.target.value }))}
            size="small"
          />
        </Box>

        {/* ── Ambiente ──────────────────────────────────────── */}
        <FormControl size="small" fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t('admin.settings.ecf.fields.ambiente')}</InputLabel>
          <Select
            label={t('admin.settings.ecf.fields.ambiente')}
            value={form.ambiente}
            onChange={e => setForm(prev => ({ ...prev, ambiente: e.target.value as EcfAmbiente }))}
          >
            {AMBIENTES.map(a => (
              <MenuItem key={a} value={a}>
                {t(`admin.settings.ecf.ambiente.${a}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* ── Citrus Base URL (read-only) ────────────────────── */}
        <TextField
          label={t('admin.settings.ecf.fields.citrusBaseUrl')}
          value={form.citrusBaseUrl}
          size="small"
          fullWidth
          sx={{ mb: 2 }}
          InputProps={{ readOnly: true }}
          helperText={t('admin.settings.ecf.fields.citrusBaseUrlHelp', 'Managed by Pilloto — contact support to change')}
        />

        {/* ── isActive toggle ───────────────────────────────── */}
        <FormControlLabel
          control={
            <Switch
              checked={form.isActive}
              onChange={e => setForm(prev => ({ ...prev, isActive: e.target.checked }))}
              color="primary"
            />
          }
          label={t('admin.settings.ecf.fields.isActive')}
          sx={{ mb: 3 }}
        />

        {/* ── Actions ───────────────────────────────────────── */}
        <Box display="flex" gap={2} flexWrap="wrap">
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : undefined}
          >
            {t('admin.settings.ecf.actions.save')}
          </Button>

          <Tooltip
            title={!hasToken ? t('admin.settings.ecf.tokenStatus.notConfigured') : ''}
          >
            <span>
              <Button
                variant="outlined"
                onClick={handleTestConnection}
                disabled={testing || !hasToken}
                startIcon={testing ? <CircularProgress size={16} /> : <WifiIcon />}
                color={testResult === 'success' ? 'success' : testResult === 'error' ? 'error' : 'primary'}
              >
                {t('admin.settings.ecf.actions.testConnection')}
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* ── Revoke token dialog ────────────────────────────────── */}
      <Dialog open={revokeDialogOpen} onClose={() => setRevokeDialogOpen(false)}>
        <DialogTitle>{t('admin.settings.ecf.actions.revokeToken')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('admin.settings.ecf.messages.revokeConfirm')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeDialogOpen(false)} disabled={revoking}>
            {t('common.cancel', 'Cancelar')}
          </Button>
          <Button
            onClick={handleRevokeToken}
            color="error"
            disabled={revoking}
            startIcon={revoking ? <CircularProgress size={16} /> : undefined}
          >
            {t('admin.settings.ecf.actions.revokeToken')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Success snackbar ──────────────────────────────────── */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={4000}
        onClose={() => setSuccessMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      </Snackbar>

      {/* ── Error snackbar ────────────────────────────────────── */}
      <Snackbar
        open={!!errorMessage}
        autoHideDuration={5000}
        onClose={() => setErrorMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default EcfSettingsTab;
