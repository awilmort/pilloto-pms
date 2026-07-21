import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import RefreshIcon from '@mui/icons-material/Refresh';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { EcfSequenceInfo, EcfTipo } from '../../../../types';
import { ecfService } from '../../../../services/api';
import EcfStatusBadge from '../../EcfStatusBadge';

const TIPO_LABELS: Record<string, string> = {
  E31: 'Factura de Crédito Fiscal',
  E32: 'Factura de Consumo',
  E33: 'Nota de Débito',
  E34: 'Nota de Crédito',
  E41: 'Comprobante de Compras',
  E43: 'Gastos Menores',
  E44: 'Regímenes Especiales',
  E45: 'Gubernamental',
  E46: 'Exportaciones',
  E47: 'Pagos al Exterior',
};

const TIPO_COLORS: Record<string, 'primary' | 'info' | 'warning' | 'error' | 'default'> = {
  E31: 'primary',
  E32: 'info',
  E33: 'warning',
  E34: 'error',
};

const EXPIRY_WARNING_DAYS = 30;

const SequenceManagement: React.FC = () => {
  const { t } = useTranslation();
  const [sequences, setSequences] = useState<EcfSequenceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Annulment dialog state
  const [annulDialog, setAnnulDialog] = useState(false);
  const [annulTipo, setAnnulTipo] = useState('');
  const [annulInput, setAnnulInput] = useState('');
  const [annulling, setAnnulling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ecfService.getSequences();
      if (res.data.success && res.data.data) {
        setSequences(res.data.data);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('common.errorOccurred'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const openAnnulDialog = (tipo: string) => {
    setAnnulTipo(tipo);
    setAnnulInput('');
    setAnnulDialog(true);
  };

  const handleAnnul = async () => {
    const secuencias = annulInput
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (secuencias.length === 0) return;

    setAnnulling(true);
    setError(null);
    try {
      await ecfService.annulSequences({ tipo: annulTipo, secuencias });
      setSuccess(t('admin.reports.sequences.annulSuccess', { count: secuencias.length }));
      setAnnulDialog(false);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || t('common.errorOccurred'));
    } finally {
      setAnnulling(false);
    }
  };

  const getExpiryStatus = (expiry?: string): 'ok' | 'warning' | 'expired' => {
    if (!expiry) return 'ok';
    const daysLeft = dayjs(expiry).diff(dayjs(), 'day');
    if (daysLeft < 0) return 'expired';
    if (daysLeft < EXPIRY_WARNING_DAYS) return 'warning';
    return 'ok';
  };

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <VpnKeyIcon color="primary" />
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {t('admin.reports.sequences.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('admin.reports.sequences.subtitle')}
            </Typography>
          </Box>
        </Stack>
        <Tooltip title={t('common.refresh')}>
          <span>
            <IconButton onClick={load} disabled={loading} size="small">
              {loading ? <CircularProgress size={16} /> : <RefreshIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      {loading && sequences.length === 0 && (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      )}

      {!loading && sequences.length === 0 && (
        <Alert severity="info">{t('admin.reports.sequences.noData')}</Alert>
      )}

      <Grid container spacing={2}>
        {sequences.map((seq) => {
          const expiryStatus = getExpiryStatus(seq.latestExpiry);
          const daysLeft = seq.latestExpiry
            ? dayjs(seq.latestExpiry).diff(dayjs(), 'day')
            : null;

          return (
            <Grid item xs={12} sm={6} md={4} key={seq.tipo}>
              <Card
                variant="outlined"
                sx={{
                  borderColor:
                    expiryStatus === 'expired'
                      ? 'error.main'
                      : expiryStatus === 'warning'
                      ? 'warning.main'
                      : undefined,
                }}
              >
                <CardContent>
                  {/* Type header */}
                  <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Chip
                        label={seq.tipo}
                        color={TIPO_COLORS[seq.tipo as EcfTipo] ?? 'default'}
                        size="small"
                      />
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {TIPO_LABELS[seq.tipo] ?? seq.tipo}
                      </Typography>
                    </Stack>
                    {expiryStatus === 'ok' && <CheckCircleOutlineIcon color="success" fontSize="small" />}
                    {expiryStatus === 'warning' && <WarningAmberIcon color="warning" fontSize="small" />}
                    {expiryStatus === 'expired' && <WarningAmberIcon color="error" fontSize="small" />}
                  </Stack>

                  {/* Latest e-NCF */}
                  <Box mb={1.5}>
                    <Typography variant="caption" color="text.secondary">
                      {t('admin.reports.sequences.latestENCF')}
                    </Typography>
                    <Typography variant="body2" fontFamily="monospace">
                      {seq.latestENCF || '—'}
                    </Typography>
                  </Box>

                  {/* Expiry */}
                  {seq.latestExpiry && (
                    <Box mb={1.5}>
                      <Typography variant="caption" color="text.secondary">
                        {t('admin.reports.sequences.expiry')}
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography
                          variant="body2"
                          color={
                            expiryStatus === 'expired'
                              ? 'error.main'
                              : expiryStatus === 'warning'
                              ? 'warning.main'
                              : undefined
                          }
                          fontWeight={expiryStatus !== 'ok' ? 700 : undefined}
                        >
                          {dayjs(seq.latestExpiry).format('DD/MM/YYYY')}
                        </Typography>
                        {daysLeft !== null && (
                          <Chip
                            label={
                              daysLeft < 0
                                ? t('admin.reports.sequences.expired')
                                : t('admin.reports.sequences.daysLeft', { days: daysLeft })
                            }
                            color={
                              expiryStatus === 'expired'
                                ? 'error'
                                : expiryStatus === 'warning'
                                ? 'warning'
                                : 'success'
                            }
                            size="small"
                          />
                        )}
                      </Stack>
                    </Box>
                  )}

                  {/* Counts */}
                  <Grid container spacing={1} mb={1.5}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">
                        {t('admin.reports.sequences.totalIssued')}
                      </Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {seq.totalIssued.toLocaleString()}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">
                        {t('admin.reports.sequences.issuedThisMonth')}
                      </Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {seq.issuedThisMonth.toLocaleString()}
                      </Typography>
                    </Grid>
                  </Grid>

                  {/* Last status */}
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('admin.reports.sequences.lastStatus')}
                      </Typography>
                      <EcfStatusBadge status={seq.lastEstadoECF} />
                    </Box>
                    <Tooltip title={t('admin.reports.sequences.annulButton')}>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => openAnnulDialog(seq.tipo)}
                      >
                        <BlockIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Annulment dialog */}
      <Dialog
        open={annulDialog}
        onClose={() => setAnnulDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t('admin.reports.sequences.annulTitle')} — {annulTipo}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {t('admin.reports.sequences.annulDescription')}
          </DialogContentText>
          <TextField
            fullWidth
            multiline
            rows={4}
            label={t('admin.reports.sequences.annulInputLabel')}
            placeholder="B3100000001&#10;B3100000002&#10;B3100000003"
            value={annulInput}
            onChange={(e) => setAnnulInput(e.target.value)}
            inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
          />
          <Typography variant="caption" color="text.secondary" mt={0.5} display="block">
            {t('admin.reports.sequences.annulInputHint')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnulDialog(false)} disabled={annulling}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleAnnul}
            color="error"
            variant="contained"
            disabled={annulling || annulInput.trim().length === 0}
            startIcon={annulling ? <CircularProgress size={14} color="inherit" /> : <BlockIcon />}
          >
            {t('admin.reports.sequences.annulConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SequenceManagement;
