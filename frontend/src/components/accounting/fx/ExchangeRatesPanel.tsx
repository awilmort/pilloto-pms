import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ExchangeRateRow, fxService } from '../../../services/fxApi';

const todayDr = () => new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);

/** The exchange rates the company records (usually the Banco Central's), newest first. */
const ExchangeRatesPanel: React.FC = () => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ExchangeRateRow[]>([]);
  const [form, setForm] = useState({ currency: 'USD', date: todayDr(), rate: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => fxService.list().then((r) => setRows(r.data.data)).catch((e) => setError(e.response?.data?.message || 'Error')), []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await fxService.set(form.currency, form.date, Number(form.rate));
      setForm((f) => ({ ...f, rate: '' }));
      await load();
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.fx.saveFailed', 'Could not save the rate'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'grid', gap: 2, maxWidth: 640 }}>
      <Typography variant="body2" color="text.secondary">
        {t('accounting.fx.intro', 'Record the day\'s rate (pesos per unit). New USD/EUR documents start from the latest rate on or before their date; you can change it on each one.')}
      </Typography>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { sm: '1fr 1fr 1fr auto' }, alignItems: 'center' }}>
        <FormControl size="small">
          <InputLabel>{t('accounting.fx.currency', 'Currency')}</InputLabel>
          <Select label={t('accounting.fx.currency', 'Currency')} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
            <MenuItem value="USD">USD</MenuItem>
            <MenuItem value="EUR">EUR</MenuItem>
          </Select>
        </FormControl>
        <TextField size="small" type="date" label={t('accounting.fx.date', 'Date')} InputLabelProps={{ shrink: true }} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        <TextField size="small" type="number" label={t('accounting.fx.rateShort', 'RD$ per unit')} value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} inputProps={{ min: 0, step: 0.0001 }} />
        <Button variant="contained" disabled={busy || !(Number(form.rate) > 0)} onClick={save}>{t('common.save', 'Save')}</Button>
      </Box>
      <Table size="small">
        <TableHead><TableRow>
          <TableCell>{t('accounting.fx.date', 'Date')}</TableCell>
          <TableCell>{t('accounting.fx.currency', 'Currency')}</TableCell>
          <TableCell align="right">{t('accounting.fx.rateShort', 'RD$ per unit')}</TableCell>
        </TableRow></TableHead>
        <TableBody>
          {rows.length === 0
            ? <TableRow><TableCell colSpan={3}>{t('accounting.fx.none', 'No rates recorded yet.')}</TableCell></TableRow>
            : rows.map((r) => <TableRow key={r._id}><TableCell>{r.date}</TableCell><TableCell>{r.currency}</TableCell><TableCell align="right">{r.rate.toFixed(4)}</TableCell></TableRow>)}
        </TableBody>
      </Table>
    </Box>
  );
};

export default ExchangeRatesPanel;
