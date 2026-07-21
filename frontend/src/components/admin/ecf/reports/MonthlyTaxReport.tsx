import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { EcfMonthlyTaxRow, EcfTipo } from '../../../../types';
import { ecfService } from '../../../../services/api';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const TIPO_COLORS: Record<string, 'primary' | 'info' | 'warning' | 'error' | 'default'> = {
  E31: 'primary',
  E32: 'info',
  E33: 'warning',
  E34: 'error',
};

const FORMAT = (val?: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'DOP' }).format(val ?? 0);

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i);

const MonthlyTaxReport: React.FC = () => {
  const { t } = useTranslation();
  const [year, setYear] = useState<string>(String(currentYear));
  const [rows, setRows] = useState<EcfMonthlyTaxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ecfService.getMonthlyTaxReport({ year: parseInt(year, 10), limit: 12 });
      if (res.data.success && res.data.data) {
        setRows(res.data.data);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('common.errorOccurred'));
    } finally {
      setLoading(false);
    }
  }, [year, t]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExportCsv = () => {
    const headers = ['Año', 'Mes', 'Tipo', 'Facturas', 'Total Facturado', 'Total ITBIS'];
    const csvRows: (string | number)[][] = [];
    rows.forEach((row) => {
      // grand total row
      csvRows.push([
        row.year,
        MONTH_NAMES[row.month - 1],
        'TOTAL',
        row.totalInvoices,
        row.totalFactura,
        row.totalImpuestos,
      ]);
      // by tipo
      row.byTipo.forEach((bt) => {
        csvRows.push([
          row.year,
          MONTH_NAMES[row.month - 1],
          bt.tipo,
          bt.count,
          bt.totalFactura,
          bt.totalImpuestos,
        ]);
      });
    });

    const csv = [headers, ...csvRows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax-report-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Grand totals
  const grandTotal = rows.reduce(
    (acc, r) => ({
      invoices: acc.invoices + r.totalInvoices,
      factura: acc.factura + r.totalFactura,
      impuestos: acc.impuestos + r.totalImpuestos,
    }),
    { invoices: 0, factura: 0, impuestos: 0 },
  );

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <BarChartIcon color="primary" />
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {t('admin.reports.monthlyTax.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('admin.reports.monthlyTax.subtitle')}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            select
            label={t('admin.reports.monthlyTax.year')}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            sx={{ width: 110 }}
          >
            {YEAR_OPTIONS.map((y) => (
              <MenuItem key={y} value={String(y)}>
                {y}
              </MenuItem>
            ))}
          </TextField>
          <Tooltip title={t('common.refresh')}>
            <span>
              <IconButton onClick={load} disabled={loading} size="small">
                {loading ? <CircularProgress size={16} /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CloudDownloadIcon />}
            onClick={handleExportCsv}
            disabled={rows.length === 0}
          >
            CSV
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Grand total summary */}
      {!loading && rows.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            mb: 2,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 2,
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('admin.reports.monthlyTax.totalInvoices')}
            </Typography>
            <Typography variant="h5" fontWeight={700}>
              {grandTotal.invoices.toLocaleString()}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('admin.reports.monthlyTax.totalFactura')}
            </Typography>
            <Typography variant="h5" fontWeight={700} color="primary.main">
              {FORMAT(grandTotal.factura)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('admin.reports.monthlyTax.totalImpuestos')}
            </Typography>
            <Typography variant="h5" fontWeight={700}>
              {FORMAT(grandTotal.impuestos)}
            </Typography>
          </Box>
        </Paper>
      )}

      {/* Table */}
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell width={40} />
                <TableCell>{t('admin.reports.monthlyTax.month')}</TableCell>
                <TableCell align="right">{t('admin.reports.monthlyTax.invoicesCount')}</TableCell>
                <TableCell align="right">{t('admin.reports.monthlyTax.facturado')}</TableCell>
                <TableCell align="right">ITBIS</TableCell>
                <TableCell align="right">{t('admin.reports.monthlyTax.effectiveTax')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <CircularProgress size={24} sx={{ my: 3 }} />
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary" py={3}>
                      {t('admin.reports.monthlyTax.noData')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                rows.map((row) => {
                  const rowKey = `${row.year}-${row.month}`;
                  const expanded = expandedRows.has(rowKey);
                  const effectiveTax =
                    row.totalFactura > 0
                      ? ((row.totalImpuestos / row.totalFactura) * 100).toFixed(1)
                      : '0.0';

                  return (
                    <React.Fragment key={rowKey}>
                      <TableRow
                        hover
                        onClick={() => toggleRow(rowKey)}
                        sx={{ cursor: 'pointer' }}
                      >
                        <TableCell>
                          <IconButton size="small">
                            {expanded ? (
                              <ExpandLessIcon fontSize="small" />
                            ) : (
                              <ExpandMoreIcon fontSize="small" />
                            )}
                          </IconButton>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {MONTH_NAMES[row.month - 1]} {row.year}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2">{row.totalInvoices}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={500}>
                            {FORMAT(row.totalFactura)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2">{FORMAT(row.totalImpuestos)}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Chip label={`${effectiveTax}%`} size="small" variant="outlined" />
                        </TableCell>
                      </TableRow>

                      {/* Expanded breakdown by tipo */}
                      <TableRow>
                        <TableCell colSpan={6} sx={{ p: 0, border: 0 }}>
                          <Collapse in={expanded} unmountOnExit>
                            <Box sx={{ bgcolor: 'grey.50', px: 4, py: 1 }}>
                              <Table size="small">
                                <TableBody>
                                  {row.byTipo.map((bt) => (
                                    <TableRow key={bt.tipo}>
                                      <TableCell width={200}>
                                        <Chip
                                          label={bt.tipo}
                                          color={TIPO_COLORS[bt.tipo as EcfTipo] ?? 'default'}
                                          size="small"
                                          sx={{ mr: 1 }}
                                        />
                                      </TableCell>
                                      <TableCell align="right">
                                        <Typography variant="caption" color="text.secondary">
                                          {bt.count} {t('admin.reports.monthlyTax.invoicesUnit')}
                                        </Typography>
                                      </TableCell>
                                      <TableCell align="right">
                                        <Typography variant="caption">
                                          {FORMAT(bt.totalFactura)}
                                        </Typography>
                                      </TableCell>
                                      <TableCell align="right">
                                        <Typography variant="caption">
                                          {FORMAT(bt.totalImpuestos)}
                                        </Typography>
                                      </TableCell>
                                      <TableCell />
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};

export default MonthlyTaxReport;
