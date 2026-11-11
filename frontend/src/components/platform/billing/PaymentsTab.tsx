import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, FormControlLabel, MenuItem, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingPayment } from '../../../types/billing';
import EcfCell from './EcfCell';
import PaymentActions from './PaymentActions';
import { billingErrorMessage, formatDate, formatDop } from './billingUi';

const PAGE_SIZE = 25;

/** Every payment received, with the e-CF it issued. "Without e-CF" lists the ones that still need one. */
const PaymentsTab: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BillingPayment[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await platformBillingService.payments({ status: status || undefined, ecf: missing ? 'missing' : undefined, page: page + 1, limit: PAGE_SIZE });
      setRows(res.data.data);
      setTotal(res.data.meta.total);
      setError(null);
    } catch (err) {
      setError(billingErrorMessage(err, t));
    }
  }, [status, missing, page, t]);

  useEffect(() => { load(); }, [load]);

  const changed = (message?: string) => { if (message) setNotice(message); load(); onChanged(); };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }} alignItems={{ sm: 'center' }}>
        <TextField select size="small" sx={{ minWidth: 160 }} label={t('platformBilling.charges.statusFilter', 'Status')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <MenuItem value="">{t('platformBilling.common.all', 'All')}</MenuItem>
          <MenuItem value="recorded">{t('platformBilling.payments.recorded', 'Recorded')}</MenuItem>
          <MenuItem value="reversed">{t('platformBilling.payments.reversedChip', 'Reversed')}</MenuItem>
        </TextField>
        <FormControlLabel control={<Switch checked={missing} onChange={(e) => { setMissing(e.target.checked); setPage(0); }} />} label={t('platformBilling.payments.onlyMissing', 'Without e-CF only')} />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" aria-label={t('platformBilling.tabs.payments', 'Payments')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('platformBilling.payments.date', 'Date')}</TableCell>
                <TableCell>{t('platformBilling.charges.tenant', 'Tenant')}</TableCell>
                <TableCell>{t('platformBilling.charges.number', 'Charge')}</TableCell>
                <TableCell>{t('platformBilling.record.method', 'Method')}</TableCell>
                <TableCell align="right">{t('platformBilling.payments.amount', 'Amount')}</TableCell>
                <TableCell>{t('platformBilling.payments.ecf', 'e-CF')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {!rows && <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={22} /></TableCell></TableRow>}
              {rows?.length === 0 && <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('platformBilling.payments.empty', 'No payments match.')}</Typography></TableCell></TableRow>}
              {rows?.map((p) => (
                <TableRow key={p.id} hover sx={p.status === 'reversed' ? { opacity: 0.6 } : undefined}>
                  <TableCell>{formatDate(p.paidAt)}</TableCell>
                  <TableCell>{p.tenant?.name ?? '—'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{p.chargeNumber ?? '—'}</TableCell>
                  <TableCell>{t(`platformBilling.methods.${p.method}`, p.method)}{p.reference ? <Typography variant="caption" display="block" color="text.secondary">{p.reference}</Typography> : null}</TableCell>
                  <TableCell align="right">{formatDop(p.amount)}</TableCell>
                  <TableCell>
                    <EcfCell payment={p} />
                    {p.ecfError && p.status === 'recorded' && <Typography variant="caption" color="error" display="block" sx={{ maxWidth: 260 }}>{p.ecfError}</Typography>}
                  </TableCell>
                  <TableCell align="right"><PaymentActions payment={p} onChanged={changed} onError={setError} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={total} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]} />
      </Paper>
    </Box>
  );
};

export default PaymentsTab;
