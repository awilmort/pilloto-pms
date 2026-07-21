import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { ecfService } from '../../../services/api';

interface ReceivedInvoice {
  TrackId: string;
  RNCEmisor?: string;
  NombreEmisor?: string;
  TipoeCF?: string;
  eNCF?: string;
  FechaEmision?: string;
  MontoTotal?: number;
  Estado?: string;
}

interface ApprovalDialogState {
  open: boolean;
  trackId: string;
  aprobado: boolean;
}

const ReceivedInvoicesTab: React.FC = () => {
  const { t } = useTranslation();

  const [invoices, setInvoices] = useState<ReceivedInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [total, setTotal] = useState(0);

  // Filters
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [rncFilter, setRncFilter] = useState('');

  // Approval dialog
  const [approvalDialog, setApprovalDialog] = useState<ApprovalDialogState>({
    open: false,
    trackId: '',
    aprobado: true,
  });
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ecfService.getReceivedInvoices({
        fechaDesde: fechaDesde || undefined,
        fechaHasta: fechaHasta || undefined,
        rnc: rncFilter || undefined,
        page: page + 1,
        limit: rowsPerPage,
      });
      const data = (res.data?.data as any) ?? {};
      const rows: ReceivedInvoice[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.comprobantes)
        ? data.comprobantes
        : [];
      setInvoices(rows);
      setTotal(data?.total ?? rows.length);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t('common.errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [fechaDesde, fechaHasta, rncFilter, page, rowsPerPage, t]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const openApprovalDialog = (trackId: string, aprobado: boolean) => {
    setApprovalDialog({ open: true, trackId, aprobado });
    setMotivoRechazo('');
    setApprovalError(null);
  };

  const handleApprovalSubmit = async () => {
    if (!approvalDialog.aprobado && !motivoRechazo.trim()) {
      setApprovalError(t('admin.ecf.receivedInvoices.motivoRequired'));
      return;
    }
    setApproving(true);
    setApprovalError(null);
    try {
      await ecfService.submitCommercialApproval({
        trackId: approvalDialog.trackId,
        aprobado: approvalDialog.aprobado,
        motivoRechazo: approvalDialog.aprobado ? undefined : motivoRechazo.trim(),
      });
      setApprovalDialog({ open: false, trackId: '', aprobado: true });
      fetchInvoices();
    } catch (err: any) {
      setApprovalError(err?.response?.data?.message ?? t('common.errorGeneric'));
    } finally {
      setApproving(false);
    }
  };

  return (
    <Box>
      {/* Filters */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap">
        <TextField
          label={t('admin.ecf.receivedInvoices.filterFrom')}
          type="date"
          size="small"
          value={fechaDesde}
          onChange={(e) => { setFechaDesde(e.target.value); setPage(0); }}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label={t('admin.ecf.receivedInvoices.filterTo')}
          type="date"
          size="small"
          value={fechaHasta}
          onChange={(e) => { setFechaHasta(e.target.value); setPage(0); }}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label={t('admin.ecf.receivedInvoices.filterRnc')}
          size="small"
          value={rncFilter}
          onChange={(e) => { setRncFilter(e.target.value); setPage(0); }}
          placeholder="000-000000-0"
        />
        <Button variant="outlined" size="small" onClick={fetchInvoices}>
          {t('common.refresh')}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : invoices.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {t('admin.ecf.receivedInvoices.empty')}
        </Typography>
      ) : (
        <>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('admin.ecf.receivedInvoices.colRnc')}</TableCell>
                  <TableCell>{t('admin.ecf.receivedInvoices.colName')}</TableCell>
                  <TableCell>{t('admin.ecf.receivedInvoices.colType')}</TableCell>
                  <TableCell>{t('admin.ecf.receivedInvoices.colEncf')}</TableCell>
                  <TableCell>{t('admin.ecf.receivedInvoices.colDate')}</TableCell>
                  <TableCell align="right">{t('admin.ecf.receivedInvoices.colAmount')}</TableCell>
                  <TableCell>{t('admin.ecf.receivedInvoices.colEstado')}</TableCell>
                  <TableCell align="center">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.TrackId} hover>
                    <TableCell>{inv.RNCEmisor ?? '—'}</TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>
                        {inv.NombreEmisor ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={inv.TipoeCF ?? '—'} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {inv.eNCF ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {inv.FechaEmision ? dayjs(inv.FechaEmision).format('DD/MM/YYYY') : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {inv.MontoTotal != null
                        ? new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(inv.MontoTotal)
                        : '—'}
                    </TableCell>
                    <TableCell>{inv.Estado ?? '—'}</TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={0.5} justifyContent="center">
                        <Tooltip title={t('admin.ecf.receivedInvoices.approve')}>
                          <span>
                            <Button
                              size="small"
                              color="success"
                              startIcon={<CheckCircleOutlineIcon />}
                              onClick={() => openApprovalDialog(inv.TrackId, true)}
                            >
                              {t('admin.ecf.receivedInvoices.approve')}
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip title={t('admin.ecf.receivedInvoices.reject')}>
                          <span>
                            <Button
                              size="small"
                              color="error"
                              startIcon={<CancelOutlinedIcon />}
                              onClick={() => openApprovalDialog(inv.TrackId, false)}
                            >
                              {t('admin.ecf.receivedInvoices.reject')}
                            </Button>
                          </span>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50]}
          />
        </>
      )}

      {/* Commercial Approval Dialog */}
      <Dialog open={approvalDialog.open} onClose={() => setApprovalDialog({ ...approvalDialog, open: false })} maxWidth="xs" fullWidth>
        <DialogTitle>
          {approvalDialog.aprobado
            ? t('admin.ecf.receivedInvoices.approveTitle')
            : t('admin.ecf.receivedInvoices.rejectTitle')}
        </DialogTitle>
        <DialogContent>
          {approvalError && <Alert severity="error" sx={{ mb: 2 }}>{approvalError}</Alert>}
          {!approvalDialog.aprobado && (
            <TextField
              label={t('admin.ecf.receivedInvoices.motivoLabel')}
              multiline
              rows={3}
              fullWidth
              value={motivoRechazo}
              onChange={(e) => setMotivoRechazo(e.target.value)}
              error={!!approvalError}
              sx={{ mt: 1 }}
            />
          )}
          {approvalDialog.aprobado && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {t('admin.ecf.receivedInvoices.approveConfirm')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setApprovalDialog({ ...approvalDialog, open: false })}
            disabled={approving}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleApprovalSubmit}
            variant="contained"
            color={approvalDialog.aprobado ? 'success' : 'error'}
            disabled={approving}
            startIcon={approving ? <CircularProgress size={16} /> : undefined}
          >
            {approvalDialog.aprobado
              ? t('admin.ecf.receivedInvoices.confirmApprove')
              : t('admin.ecf.receivedInvoices.confirmReject')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ReceivedInvoicesTab;
