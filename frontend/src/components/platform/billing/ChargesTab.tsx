import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, FormControlLabel, MenuItem, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material';
import { AddOutlined, PlayArrowOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingCharge } from '../../../types/billing';
import ChargeDrawer, { ChargeStatusChip } from './ChargeDrawer';
import GenerateChargeDialog from './GenerateChargeDialog';
import RecordPaymentDialog from './RecordPaymentDialog';
import { billingErrorMessage, formatDate, formatDop, periodLabel } from './billingUi';

interface Props {
  issuerReady: boolean;
  /** Called after anything that changes the numbers on the overview. */
  onChanged: () => void;
  /** Open a charge by id (from another tab). */
  initialChargeId?: string | null;
}

const PAGE_SIZE = 25;

/** Every charge: who owes what for which month, with the payment dialog a click away. */
const ChargesTab: React.FC<Props> = ({ issuerReady, onChanged, initialChargeId }) => {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<BillingCharge[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [period, setPeriod] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialChargeId ?? null);
  const [paying, setPaying] = useState<BillingCharge | null>(null);
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await platformBillingService.charges({ status: status || undefined, overdue: overdue || undefined, period: /^\d{4}-\d{2}$/.test(period) ? period : undefined, page: page + 1, limit: PAGE_SIZE });
      setRows(res.data.data);
      setTotal(res.data.meta.total);
      setError(null);
    } catch (err) {
      setError(billingErrorMessage(err, t));
    }
  }, [status, overdue, period, page, t]);

  useEffect(() => { load(); }, [load]);

  const changed = () => { setRefreshKey((k) => k + 1); load(); onChanged(); };

  const runNow = async () => {
    setRunning(true);
    try {
      const r = (await platformBillingService.runBilling()).data.data!;
      setNotice(t('platformBilling.charges.runDone', '{{period}}: {{created}} charged, {{existing}} already had one, {{skipped}} with nothing to charge, {{failed}} failed.', {
        period: periodLabel(r.period, i18n.language), created: r.created, existing: r.existing, skipped: r.skipped, failed: r.failed,
      }));
      changed();
    } catch (err) {
      setError(billingErrorMessage(err, t));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }} alignItems={{ md: 'center' }} justifyContent="space-between">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <TextField select size="small" sx={{ minWidth: 160 }} label={t('platformBilling.charges.statusFilter', 'Status')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <MenuItem value="">{t('platformBilling.common.all', 'All')}</MenuItem>
            {['open', 'partial', 'paid', 'void'].map((s) => <MenuItem key={s} value={s}>{t(`platformBilling.charges.status.${s}`, s)}</MenuItem>)}
          </TextField>
          <TextField size="small" type="month" label={t('platformBilling.charges.month', 'Month')} value={period} onChange={(e) => { setPeriod(e.target.value); setPage(0); }} InputLabelProps={{ shrink: true }} />
          <FormControlLabel control={<Switch checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(0); }} />} label={t('platformBilling.charges.onlyOverdue', 'Overdue only')} />
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={running ? <CircularProgress size={16} /> : <PlayArrowOutlined />} onClick={runNow} disabled={running}>
            {t('platformBilling.charges.run', 'Run monthly billing')}
          </Button>
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setGenerating(true)}>{t('platformBilling.generate.title', 'Generate a charge')}</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" aria-label={t('platformBilling.tabs.charges', 'Charges')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('platformBilling.charges.number', 'Charge')}</TableCell>
                <TableCell>{t('platformBilling.charges.tenant', 'Tenant')}</TableCell>
                <TableCell>{t('platformBilling.charges.month', 'Month')}</TableCell>
                <TableCell align="right">{t('platformBilling.charges.total', 'Total')}</TableCell>
                <TableCell align="right">{t('platformBilling.charges.balance', 'Balance')}</TableCell>
                <TableCell>{t('platformBilling.charges.dueDate', 'Due')}</TableCell>
                <TableCell>{t('platformBilling.charges.statusFilter', 'Status')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {!rows && <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={22} /></TableCell></TableRow>}
              {rows?.length === 0 && <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('platformBilling.charges.empty', 'No charges match.')}</Typography></TableCell></TableRow>}
              {rows?.map((c) => (
                <TableRow key={c.id} hover sx={{ cursor: 'pointer' }} onClick={() => setOpenId(c.id)}>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{c.number}</TableCell>
                  <TableCell>{c.tenant?.name ?? '—'}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{periodLabel(c.period, i18n.language)}</TableCell>
                  <TableCell align="right">{formatDop(c.total)}</TableCell>
                  <TableCell align="right">{c.balance > 0 && c.status !== 'void' ? <strong>{formatDop(c.balance)}</strong> : '—'}</TableCell>
                  <TableCell>{formatDate(`${c.dueDate}T12:00:00Z`)}</TableCell>
                  <TableCell><ChargeStatusChip charge={c} /></TableCell>
                  <TableCell align="right">
                    {(c.status === 'open' || c.status === 'partial') && (
                      <Button size="small" onClick={(e) => { e.stopPropagation(); setPaying(c); }}>{t('platformBilling.charges.pay', 'Record payment')}</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={total} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]} />
      </Paper>

      <ChargeDrawer chargeId={openId} onClose={() => setOpenId(null)} onRecordPayment={setPaying} refreshKey={refreshKey} onChanged={() => { load(); onChanged(); }} />
      <RecordPaymentDialog
        charge={paying} issuerReady={issuerReady} onClose={() => setPaying(null)}
        onRecorded={(payment) => {
          setPaying(null);
          setNotice(payment.ecf
            ? t('platformBilling.record.doneWithEcf', 'Payment recorded. e-CF {{ncf}} issued.', { ncf: payment.ecf.eNCF ?? '' })
            : t('platformBilling.record.doneNoEcf', 'Payment recorded. The e-CF was not issued: {{reason}}', { reason: payment.ecfError ?? '' }));
          changed();
        }}
      />
      <GenerateChargeDialog
        open={generating} onClose={() => setGenerating(false)}
        onGenerated={(charge, created) => {
          setGenerating(false);
          setNotice(created ? t('platformBilling.generate.created', 'Charge {{number}} created.', { number: charge.number }) : t('platformBilling.generate.existed', 'That month was already charged ({{number}}).', { number: charge.number }));
          setOpenId(charge.id);
          changed();
        }}
      />
    </Box>
  );
};

export default ChargesTab;
