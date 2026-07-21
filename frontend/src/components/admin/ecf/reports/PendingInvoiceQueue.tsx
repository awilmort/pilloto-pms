import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';
import { useTranslation } from 'react-i18next';
import { ElectronicInvoice } from '../../../../types';
import { ecfService } from '../../../../services/api';
import InvoicesTable from '../InvoicesTable';
import InvoiceDetailDrawer from '../InvoiceDetailDrawer';

type SortField = 'issuedAt' | 'totalFactura' | 'totalImpuestos' | 'tipo' | 'estadoECF';
type SortOrder = 'asc' | 'desc';

const FORMAT_CURRENCY = (val?: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'DOP' }).format(val ?? 0);

const PendingInvoiceQueue: React.FC = () => {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<ElectronicInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [sortField, setSortField] = useState<SortField>('issuedAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const [selectedInvoice, setSelectedInvoice] = useState<ElectronicInvoice | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ecfService.getInvoices({
        estadoECF: 'En Proceso,Emitido Contingencia,Rechazado,Error',
        page: page + 1,
        limit: rowsPerPage,
        sortBy: sortField,
        sortOrder,
      } as any);
      if (res.data.success && res.data.data) {
        const payload = res.data.data as any;
        const arr: ElectronicInvoice[] = Array.isArray(payload)
          ? payload
          : payload.invoices ?? payload.data ?? [];
        setInvoices(arr);
        setTotal(
          typeof payload.total === 'number'
            ? payload.total
            : arr.length,
        );
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('common.errorOccurred'));
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, sortField, sortOrder, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSortChange = (field: SortField) => {
    if (field === sortField) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
    setPage(0);
  };

  const handleBulkRefresh = async () => {
    setBulkRefreshing(true);
    setBulkResult(null);
    setError(null);
    try {
      const res = await ecfService.bulkRefreshPending();
      if (res.data.success && res.data.data) {
        const { total: tot, refreshed, failed } = res.data.data;
        setBulkResult(
          t('admin.ecfInvoices.bulkRefreshResult', { total: tot, refreshed, failed }),
        );
        load();
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('common.errorOccurred'));
    } finally {
      setBulkRefreshing(false);
    }
  };

  const handleRefreshSingle = async (inv: ElectronicInvoice) => {
    try {
      await ecfService.refreshStatus(inv._id);
      load();
    } catch {
      // ignore; user can retry
    }
  };

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <HourglassEmptyIcon color="warning" />
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {t('admin.reports.pendingQueue.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('admin.reports.pendingQueue.subtitle')}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Tooltip title={t('common.refresh')}>
            <span>
              <IconButton onClick={load} disabled={loading} size="small">
                {loading ? <CircularProgress size={16} /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
          <Button
            size="small"
            variant="contained"
            color="warning"
            startIcon={
              bulkRefreshing ? <CircularProgress size={14} color="inherit" /> : <SyncIcon />
            }
            onClick={handleBulkRefresh}
            disabled={bulkRefreshing || invoices.length === 0}
          >
            {t('admin.ecfInvoices.bulkRefresh')}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {bulkResult && (
        <Alert severity="success" onClose={() => setBulkResult(null)} sx={{ mb: 2 }}>
          {bulkResult}
        </Alert>
      )}

      {!loading && invoices.length === 0 && (
        <Alert severity="success">{t('admin.reports.pendingQueue.allClear')}</Alert>
      )}

      {(loading || invoices.length > 0) && (
        <Paper variant="outlined">
          <InvoicesTable
            invoices={invoices}
            total={total}
            page={page}
            rowsPerPage={rowsPerPage}
            sortField={sortField}
            sortOrder={sortOrder}
            loading={loading}
            onPageChange={setPage}
            onRowsPerPageChange={(r) => {
              setRowsPerPage(r);
              setPage(0);
            }}
            onSortChange={handleSortChange}
            onRowClick={(inv) => {
              setSelectedInvoice(inv);
              setDrawerOpen(true);
            }}
            onRefreshSingle={handleRefreshSingle}
            formatCurrency={FORMAT_CURRENCY}
          />
        </Paper>
      )}

      <InvoiceDetailDrawer
        open={drawerOpen}
        invoice={selectedInvoice}
        onClose={() => setDrawerOpen(false)}
        onRefresh={load}
        formatCurrency={FORMAT_CURRENCY}
      />
    </Box>
  );
};

export default PendingInvoiceQueue;
