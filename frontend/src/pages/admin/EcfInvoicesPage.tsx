import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Collapse,
  Grid,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import ReceiptIcon from '@mui/icons-material/Receipt';
import FilterListIcon from '@mui/icons-material/FilterList';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import AddIcon from '@mui/icons-material/Add';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../components/admin/AdminLayout';
import InvoiceFiltersPanel, {
  DEFAULT_FILTERS,
  InvoiceFilters,
} from '../../components/admin/ecf/InvoiceFiltersPanel';
import InvoicesTable from '../../components/admin/ecf/InvoicesTable';
import InvoiceDetailDrawer from '../../components/admin/ecf/InvoiceDetailDrawer';
import ContingencyBanner from '../../components/admin/ecf/ContingencyBanner';
import ReceivedInvoicesTab from '../../components/admin/ecf/ReceivedInvoicesTab';
import OtherInvoiceModal from '../../components/admin/ecf/OtherInvoiceModal';
import { ElectronicInvoice } from '../../types';
import { ecfService } from '../../services/api';

type SortField = 'issuedAt' | 'totalFactura' | 'totalImpuestos' | 'tipo' | 'estadoECF';
type SortOrder = 'asc' | 'desc';

const FORMAT_CURRENCY = (val?: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'DOP' }).format(val ?? 0);

const EcfInvoicesPage: React.FC = () => {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState(0);
  const [otherInvoiceModalOpen, setOtherInvoiceModalOpen] = useState(false);

  const [invoices, setInvoices] = useState<ElectronicInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Alerts
  const [alerts, setAlerts] = useState<Array<{ type: string; severity: 'info' | 'warning' | 'error'; message: string; count?: number }>>([]);

  const filtersDefault = DEFAULT_FILTERS;
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [filters, setFilters] = useState<InvoiceFilters>(filtersDefault);

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [sortField, setSortField] = useState<SortField>('issuedAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const [selectedInvoice, setSelectedInvoice] = useState<ElectronicInvoice | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await ecfService.getAlerts();
      setAlerts(res.data?.data ?? []);
    } catch {
      // Non-critical — don't show an error for this
    }
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {
        page: page + 1,
        limit: rowsPerPage,
        sortBy: sortField,
        sortOrder,
      };

      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
      if (filters.tipo) params.tipo = filters.tipo;
      if (filters.estadoECF) params.estadoECF = filters.estadoECF;
      if (filters.buyerSearch) params.buyerSearch = filters.buyerSearch;
      if (filters.encfSearch) params.encfSearch = filters.encfSearch;
      if (filters.amountMin) params.amountMin = parseFloat(filters.amountMin);
      if (filters.amountMax) params.amountMax = parseFloat(filters.amountMax);

      const res = await ecfService.getInvoices(params);
      const data = res.data;
      if (data.success && data.data) {
        const payload = data.data as any;
        setInvoices(Array.isArray(payload) ? payload : payload.invoices ?? payload.data ?? []);
        setTotal(
          typeof payload.total === 'number'
            ? payload.total
            : Array.isArray(payload)
            ? payload.length
            : 0,
        );
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('common.errorOccurred'));
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, sortField, sortOrder, filters, t]);

  useEffect(() => {
    fetchInvoices();
    fetchAlerts();
  }, [fetchInvoices, fetchAlerts]);

  const handleSortChange = (field: SortField) => {
    if (field === sortField) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
    setPage(0);
  };

  const handleFiltersChange = (f: InvoiceFilters) => {
    setFilters(f);
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
        await fetchInvoices();
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('common.errorOccurred'));
    } finally {
      setBulkRefreshing(false);
    }
  };

  const handleExportCsv = () => {
    const headers = ['eNCF', 'Tipo', 'Fecha', 'Comprador', 'Total', 'ITBIS', 'Estado'];
    const rows = invoices.map((inv) => [
      inv.eNCF,
      inv.tipo,
      new Date(inv.issuedAt).toLocaleDateString(),
      inv.buyerName || inv.buyerRnc || '',
      inv.totalFactura,
      inv.totalImpuestos,
      inv.estadoECF,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ecf-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRowClick = (inv: ElectronicInvoice) => {
    setSelectedInvoice(inv);
    setDrawerOpen(true);
  };

  const handleRefreshSingle = async (inv: ElectronicInvoice) => {
    try {
      await ecfService.refreshStatus(inv._id);
      fetchInvoices();
    } catch {
      // ignore; user can retry
    }
  };

  // Summary totals across current loaded set
  const summary = useMemo(
    () =>
      invoices.reduce(
        (acc, inv) => ({
          count: acc.count + 1,
          totalFactura: acc.totalFactura + (inv.totalFactura || 0),
          totalImpuestos: acc.totalImpuestos + (inv.totalImpuestos || 0),
        }),
        { count: 0, totalFactura: 0, totalImpuestos: 0 },
      ),
    [invoices],
  );

  return (
    <AdminLayout>
      <Box>
        {/* Contingency banner */}
        <ContingencyBanner />

        {/* Page header */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <ReceiptIcon color="primary" />
            <Box>
              <Typography variant="h5" fontWeight={700}>
                {t('admin.ecfInvoices.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('admin.ecfInvoices.subtitle')}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Tooltip title={t('admin.ecf.alerts.tooltip')}>
              <IconButton onClick={() => {}}>
                <Badge badgeContent={alerts.filter(a => a.severity === 'error').length} color="error">
                  <NotificationsNoneIcon color={alerts.length > 0 ? 'warning' : 'inherit'} />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title={t('admin.ecfInvoices.toggleFilters')}>
              <IconButton onClick={() => setFiltersOpen((v) => !v)}>
                <FilterListIcon color={filtersOpen ? 'primary' : 'inherit'} />
              </IconButton>
            </Tooltip>
            <Button
              size="small"
              variant="outlined"
              startIcon={<CloudDownloadIcon />}
              onClick={handleExportCsv}
              disabled={invoices.length === 0}
            >
              CSV
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setOtherInvoiceModalOpen(true)}
            >
              {t('admin.ecf.otherInvoice.newButton')}
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={
                bulkRefreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />
              }
              onClick={handleBulkRefresh}
              disabled={bulkRefreshing}
            >
              {t('admin.ecfInvoices.bulkRefresh')}
            </Button>
          </Stack>
        </Stack>

        {/* System alerts */}
        {alerts.filter(a => a.severity !== 'info').map((alert) => (
          <Alert key={alert.type} severity={alert.severity} sx={{ mb: 1 }}>
            {alert.message}
          </Alert>
        ))}

        {/* Error / success feedback */}
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

        {/* Summary cards — only on Issued tab */}
        {activeTab === 0 && (
          <Grid container spacing={2} mb={2}>
            <Grid item xs={12} sm={4}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary">
                    {t('admin.ecfInvoices.summary.count')}
                  </Typography>
                  <Typography variant="h5" fontWeight={700}>
                    {total.toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary">
                    {t('admin.ecfInvoices.summary.totalFactura')}
                  </Typography>
                  <Typography variant="h5" fontWeight={700} color="primary.main">
                    {FORMAT_CURRENCY(summary.totalFactura)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary">
                    {t('admin.ecfInvoices.summary.totalImpuestos')}
                  </Typography>
                  <Typography variant="h5" fontWeight={700}>
                    {FORMAT_CURRENCY(summary.totalImpuestos)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 0 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
            <Tab label={t('admin.ecfInvoices.tabIssued')} />
            <Tab label={t('admin.ecfInvoices.tabReceived')} />
          </Tabs>
        </Box>

        {/* Tab: Issued invoices */}
        {activeTab === 0 && (
          <>
            {/* Filters */}
            <Collapse in={filtersOpen}>
              <Paper variant="outlined" sx={{ p: 2, mb: 0, borderTop: 0, borderRadius: '0 0 4px 4px' }}>
                <InvoiceFiltersPanel
                  filters={filters}
                  onChange={(f) => { setFilters(f); setPage(0); }}
                  onReset={() => { setFilters(filtersDefault); setPage(0); }}
                />
              </Paper>
            </Collapse>

            <Paper variant="outlined" sx={{ mt: 0, borderTop: filtersOpen ? 0 : undefined }}>
              <InvoicesTable
                invoices={invoices}
                total={total}
                page={page}
                rowsPerPage={rowsPerPage}
                sortField={sortField}
                sortOrder={sortOrder}
                loading={loading}
                onPageChange={setPage}
                onRowsPerPageChange={(r) => { setRowsPerPage(r); setPage(0); }}
                onSortChange={handleSortChange}
                onRowClick={handleRowClick}
                onRefreshSingle={handleRefreshSingle}
                formatCurrency={FORMAT_CURRENCY}
              />
            </Paper>
          </>
        )}

        {/* Tab: Received invoices */}
        {activeTab === 1 && (
          <Box sx={{ mt: 2 }}>
            <ReceivedInvoicesTab />
          </Box>
        )}
      </Box>

      <InvoiceDetailDrawer
        open={drawerOpen}
        invoice={selectedInvoice}
        onClose={() => setDrawerOpen(false)}
        onRefresh={fetchInvoices}
        formatCurrency={FORMAT_CURRENCY}
      />

      <OtherInvoiceModal
        open={otherInvoiceModalOpen}
        onClose={() => setOtherInvoiceModalOpen(false)}
        onSuccess={() => {
          setOtherInvoiceModalOpen(false);
          fetchInvoices();
          fetchAlerts();
        }}
      />
    </AdminLayout>
  );
};

export default EcfInvoicesPage;
