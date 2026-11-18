import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Grid, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import { accountingReportsService, Dgii606Report, ItbisSummary } from '../../../services/api';
import { formatAccountingMoney as formatMoney } from '../../../utils/currency';
import { PAYMENT_FORMS } from '../../../config/dgii';

/** Last month, `YYYY-MM` (the one being declared by the 15th), in Dominican time. */
const lastMonth = (): string => {
  const d = new Date(Date.now() - 4 * 3600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
const ymd = (s: string) => (s ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : '—');

/**
 * DGII monthly figures (every plan): the Formato 606 of the month's purchases — preview, what is
 * missing, and the TXT to upload — and the ITBIS figures the IT-1 is filled from.
 */
const DgiiTab: React.FC = () => {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(lastMonth());
  const [report, setReport] = useState<Dgii606Report | null>(null);
  const [summary, setSummary] = useState<ItbisSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, s] = await Promise.all([accountingReportsService.getDgii606(period), accountingReportsService.getItbisSummary(period)]);
      setReport(r.data.data ?? null);
      setSummary(s.data.data ?? null);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.reports.dgii.loadFailed', 'Could not load the DGII figures'));
    } finally {
      setLoading(false);
    }
  }, [period, t]);

  useEffect(() => { load(); }, [load]);

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      const r = await accountingReportsService.getDgii606Txt(period);
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DGII_F_606_${report?.rnc ?? ''}_${period.replace('-', '')}.TXT`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      // The error body of a blob request is itself a blob.
      let message = t('accounting.reports.dgii.txtFailed', 'The TXT could not be generated');
      try {
        const body = JSON.parse(await (e.response?.data as Blob).text());
        if (body.code === 'DGII_NO_RNC') message = t('accounting.reports.dgii.noRnc', 'Set your company RNC in the profile first.');
        else if (body.code === 'DGII_606_ISSUES') message = t('accounting.reports.dgii.fixFirst', 'Fix the bills marked in red first: the DGII rejects the whole file otherwise.');
        else if (body.message) message = body.message;
      } catch { /* keep the generic message */ }
      setError(message);
    } finally {
      setDownloading(false);
    }
  };

  const errors = report?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = report?.issues.filter((i) => i.severity === 'warning') ?? [];
  const issueText = (p: string) => t(`accounting.reports.dgii.issues.${p}`, p);
  const issuesOf = (billId: string) => report?.issues.filter((i) => i.billId === billId) ?? [];

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField type="month" size="small" label={t('accounting.reports.dgii.period', 'Month')} InputLabelProps={{ shrink: true }} value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        <Typography variant="body2" color="text.secondary">{t('accounting.reports.dgii.due', 'The 606 and the IT-1 are due by the 15th of the following month.')}</Typography>
      </Box>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {loading && <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box>}

      {!loading && summary && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>{t('accounting.reports.dgii.itbisTitle', 'ITBIS of the month (for the IT-1)')}</Typography>
          <Grid container spacing={2}>
            {[
              [t('accounting.reports.dgii.salesItbis', 'ITBIS on sales (accepted e-CF, less credit notes)'), summary.sales.netItbis],
              [t('accounting.reports.dgii.advance', 'ITBIS paid on purchases (deductible)'), summary.purchases.itbisAdvance],
              [summary.itbisBalance >= 0 ? t('accounting.reports.dgii.balanceToPay', 'ITBIS balance to pay') : t('accounting.reports.dgii.balanceInFavour', 'Balance in your favour'), Math.abs(summary.itbisBalance)],
              [t('accounting.reports.dgii.itbisWithheld', 'ITBIS withheld from suppliers'), summary.withheld.itbis],
              [t('accounting.reports.dgii.isrWithheld', 'ISR withheld from suppliers (IR-17)'), summary.withheld.isr],
            ].map(([label, value]) => (
              <Grid item xs={12} sm={6} md={4} key={label as string}>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
                <Typography variant="h6" fontWeight={700}>{formatMoney(value as number)}</Typography>
              </Grid>
            ))}
          </Grid>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            {t('accounting.reports.dgii.itbisNote', 'A guide from your records, for your accountant to confirm: it does not include balances carried from earlier months or payments on account.')}
          </Typography>
        </Paper>
      )}

      {!loading && report && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
            <Box>
              <Typography variant="h6" fontWeight={700}>{t('accounting.reports.dgii.title606', 'Formato 606 — purchases')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('accounting.reports.dgii.count', '{{count}} purchases · {{total}} before tax · ITBIS {{itbis}}', { count: report.totals.count, total: formatMoney(report.totals.totalAmount), itbis: formatMoney(report.totals.itbisBilled) })}
              </Typography>
            </Box>
            <Button variant="contained" startIcon={downloading ? <CircularProgress size={16} /> : <DownloadIcon />} disabled={downloading || errors.length > 0} onClick={download}>
              {t('accounting.reports.dgii.downloadTxt', 'Download TXT for the DGII')}
            </Button>
          </Box>
          {errors.length > 0 && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {t('accounting.reports.dgii.errorsIntro', '{{count}} purchase(s) are missing data the 606 needs. Complete them in Bills or Suppliers:', { count: new Set(errors.map((e) => e.billId)).size })}
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {errors.map((e, i) => <li key={i}>{e.billNumber}: {issueText(e.problem)}</li>)}
              </ul>
            </Alert>
          )}
          {warnings.length > 0 && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              {warnings.map((w, i) => <div key={i}>{w.billNumber}: {issueText(w.problem)}</div>)}
            </Alert>
          )}
          {report.rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t('accounting.reports.dgii.empty', 'No purchases this month. The 606 is still sent, with no rows.')}</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('accounting.reports.dgii.cols.bill', 'Bill')}</TableCell>
                    <TableCell>{t('accounting.reports.dgii.cols.supplier', 'Supplier / RNC')}</TableCell>
                    <TableCell>NCF</TableCell>
                    <TableCell>{t('accounting.reports.dgii.cols.type', 'Type')}</TableCell>
                    <TableCell>{t('accounting.reports.dgii.cols.date', 'Date')}</TableCell>
                    <TableCell align="right">{t('accounting.reports.dgii.cols.amount', 'Amount')}</TableCell>
                    <TableCell align="right">ITBIS</TableCell>
                    <TableCell align="right">{t('accounting.reports.dgii.cols.withheld', 'Withheld')}</TableCell>
                    <TableCell>{t('accounting.reports.dgii.cols.payment', 'Payment')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.rows.map((r) => {
                    const problems = issuesOf(r.billId);
                    return (
                      <TableRow key={r.billId} sx={problems.some((p) => p.severity === 'error') ? { bgcolor: (theme) => alpha(theme.palette.error.main, 0.06) } : undefined}>
                        <TableCell>{r.billNumber}</TableCell>
                        <TableCell>{r.supplierName}<Typography variant="caption" display="block" color={r.idType ? 'text.secondary' : 'error'}>{r.rncCedula || t('accounting.reports.dgii.noTaxId', 'no RNC')}</Typography></TableCell>
                        <TableCell>{r.ncf || <Chip size="small" color="error" label={t('accounting.reports.dgii.noNcf', 'missing')} />}</TableCell>
                        <TableCell>{r.expenseType}</TableCell>
                        <TableCell>{ymd(r.issueDate)}</TableCell>
                        <TableCell align="right">{formatMoney(r.totalAmount)}</TableCell>
                        <TableCell align="right">{formatMoney(r.itbisBilled)}</TableCell>
                        <TableCell align="right">{r.itbisWithheld + r.isrWithheld > 0 ? formatMoney(r.itbisWithheld + r.isrWithheld) : '—'}</TableCell>
                        <TableCell>{PAYMENT_FORMS[r.paymentForm] ?? r.paymentForm}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}
    </Box>
  );
};

export default DgiiTab;
