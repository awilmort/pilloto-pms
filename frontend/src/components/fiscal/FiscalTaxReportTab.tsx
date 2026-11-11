import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { EcfMonthlyTaxRow } from '../../types';
import { downloadBlob, fiscalErrorMessage, formatDop, periodLabel, formatInt } from './fiscalUi';
import i18n from '../../i18n';

/**
 * Accepted e-CF by month and type: the figures behind the monthly ITBIS return. Only documents DGII
 * accepted count; a rejected document was never fiscally issued.
 */
const FiscalTaxReportTab: React.FC = () => {
  const { t } = useTranslation();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<EcfMonthlyTaxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fiscalService
      .getMonthlyTaxReport({ year, limit: 12 })
      .then((res) => alive && (setRows(res.data.data as EcfMonthlyTaxRow[]), setError(null)))
      .catch((err) => alive && setError(fiscalErrorMessage(err, t)));
    return () => { alive = false; };
  }, [year, t]);

  const totals = useMemo(() => (rows ?? []).reduce((a, r) => ({ n: a.n + r.totalInvoices, total: a.total + r.totalFactura, tax: a.tax + r.totalImpuestos }), { n: 0, total: 0, tax: 0 }), [rows]);

  const exportCsv = () => {
    if (!rows) return;
    const lines = [['Mes', 'Tipo', 'Documentos', 'Total', 'ITBIS'].join(',')];
    [...rows].reverse().forEach((r) => r.byTipo.forEach((b) => lines.push([`${r.year}-${String(r.month).padStart(2, '0')}`, b.tipo, b.count, b.totalFactura.toFixed(2), b.totalImpuestos.toFixed(2)].join(','))));
    downloadBlob(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }), `e-cf-itbis-${year}.csv`);
  };

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
        <TextField select size="small" label={t('fiscal.report.year', 'Year')} value={year} onChange={(e) => setYear(Number(e.target.value))} sx={{ width: 120 }}>
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
        </TextField>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={exportCsv} disabled={!rows?.length}>{t('fiscal.documents.export', 'Export CSV')}</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" aria-label={t('fiscal.report.tableLabel', 'Monthly totals')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('fiscal.statements.period', 'Month')}</TableCell>
                <TableCell>{t('fiscal.report.byType', 'By type')}</TableCell>
                <TableCell align="right">{t('fiscal.statements.used', 'Documents')}</TableCell>
                <TableCell align="right">{t('fiscal.documents.total', 'Total')}</TableCell>
                <TableCell align="right">ITBIS</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!rows && !error && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5 }}><CircularProgress size={24} /></TableCell></TableRow>}
              {rows?.length === 0 && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5 }}><Typography color="text.secondary">{t('fiscal.report.empty', 'No accepted documents this year.')}</Typography></TableCell></TableRow>}
              {rows?.map((r) => (
                <TableRow key={`${r.year}-${r.month}`} hover>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{periodLabel(`${r.year}-${String(r.month).padStart(2, '0')}`, i18n.language)}</TableCell>
                  <TableCell>{r.byTipo.map((b) => `${b.tipo}: ${b.count}`).join(' · ')}</TableCell>
                  <TableCell align="right">{formatInt(r.totalInvoices)}</TableCell>
                  <TableCell align="right">{formatDop(r.totalFactura, i18n.language)}</TableCell>
                  <TableCell align="right">{formatDop(r.totalImpuestos, i18n.language)}</TableCell>
                </TableRow>
              ))}
              {rows && rows.length > 0 && (
                <TableRow>
                  <TableCell colSpan={2}><strong>{t('fiscal.report.year', 'Year')} {year}</strong></TableCell>
                  <TableCell align="right"><strong>{formatInt(totals.n)}</strong></TableCell>
                  <TableCell align="right"><strong>{formatDop(totals.total, i18n.language)}</strong></TableCell>
                  <TableCell align="right"><strong>{formatDop(totals.tax, i18n.language)}</strong></TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};

export default FiscalTaxReportTab;
