import React, { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
  InputLabel, MenuItem, Select, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { bankService } from '../../../services/bankApi';
import { formatAccountingMoney as formatMoney } from '../../../utils/currency';
import { DateFormat, guessMapping, mapRows, Mapping, parseCsv } from './statementCsv';

interface Props { open: boolean; bankId: string; onClose: () => void; onImported: (message: string) => void }

/** Imports a bank statement (CSV): pick the file, say which column is which, check the preview, import. */
const BankImportDialog: React.FC<Props> = ({ open, bankId, onClose, onImported }) => {
  const { t } = useTranslation();
  const [cells, setCells] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    const rows = parseCsv(await file.text());
    if (rows.length === 0) return setError(t('accounting.banks.import.empty', 'The file has no rows.'));
    setCells(rows);
    setMapping(guessMapping(rows[0]));
  };

  const mapped = useMemo(() => (cells && mapping ? mapRows(cells, mapping) : null), [cells, mapping]);
  const columns = cells ? Array.from({ length: Math.max(...cells.slice(0, 20).map((r) => r.length)) }, (_, i) => i) : [];
  const label = (i: number) => (mapping?.hasHeader && cells?.[0]?.[i] ? cells[0][i] : `${t('accounting.banks.import.column', 'Column')} ${i + 1}`);
  const set = (patch: Partial<Mapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));

  const columnSelect = (key: 'date' | 'description' | 'reference' | 'amount' | 'debit' | 'credit', text: string, optional = false) => (
    <FormControl size="small" fullWidth>
      <InputLabel>{text}</InputLabel>
      <Select label={text} value={mapping?.[key] ?? ''} onChange={(e) => set({ [key]: e.target.value === '' ? null : Number(e.target.value) } as Partial<Mapping>)}>
        {optional && <MenuItem value="">{t('common.none', 'None')}</MenuItem>}
        {columns.map((i) => <MenuItem key={i} value={i}>{label(i)}</MenuItem>)}
      </Select>
    </FormControl>
  );

  const doImport = async () => {
    if (!mapped || mapped.rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await bankService.importLines(bankId, mapped.rows);
      const d = r.data.data;
      onImported(t('accounting.banks.import.done', '{{added}} movements imported, {{duplicates}} already there.', { added: d.added, duplicates: d.duplicates }));
      setCells(null);
      setMapping(null);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.banks.import.failed', 'The import failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('accounting.banks.import.title', 'Import bank statement')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('accounting.banks.import.intro', 'Download the statement from your bank\'s website as CSV (Excel can save it as CSV). Movements already imported are skipped.')}
        </Typography>
        <Button variant="outlined" component="label">
          {t('accounting.banks.import.choose', 'Choose CSV file')}
          <input hidden type="file" accept=".csv,text/csv,.txt" onChange={(e) => onFile(e.target.files?.[0])} />
        </Button>

        {mapping && cells && (
          <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
            <FormControlLabel control={<Checkbox checked={mapping.hasHeader} onChange={(e) => set({ hasHeader: e.target.checked })} />} label={t('accounting.banks.import.hasHeader', 'The first row is the column names')} />
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { sm: '1fr 1fr 1fr' } }}>
              {columnSelect('date', t('accounting.banks.import.date', 'Date'))}
              {columnSelect('description', t('accounting.banks.import.description', 'Description'))}
              {columnSelect('reference', t('accounting.banks.import.reference', 'Reference'), true)}
            </Box>
            <ToggleButtonGroup exclusive size="small" value={mapping.amountMode} onChange={(_, v) => v && set({ amountMode: v })}>
              <ToggleButton value="signed">{t('accounting.banks.import.signed', 'One amount column (− for withdrawals)')}</ToggleButton>
              <ToggleButton value="split">{t('accounting.banks.import.split', 'Debit and credit columns')}</ToggleButton>
            </ToggleButtonGroup>
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { sm: '1fr 1fr 1fr 1fr' } }}>
              {mapping.amountMode === 'signed'
                ? columnSelect('amount', t('accounting.banks.import.amount', 'Amount'))
                : <>{columnSelect('debit', t('accounting.banks.import.debit', 'Debit (money out)'))}{columnSelect('credit', t('accounting.banks.import.credit', 'Credit (money in)'))}</>}
              <FormControl size="small">
                <InputLabel>{t('accounting.banks.import.dateFormat', 'Date format')}</InputLabel>
                <Select label={t('accounting.banks.import.dateFormat', 'Date format')} value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
                  {['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small">
                <InputLabel>{t('accounting.banks.import.decimal', 'Decimals')}</InputLabel>
                <Select label={t('accounting.banks.import.decimal', 'Decimals')} value={mapping.decimal} onChange={(e) => set({ decimal: e.target.value as '.' | ',' })}>
                  <MenuItem value=".">1,234.56</MenuItem>
                  <MenuItem value=",">1.234,56</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {mapped && (
              <>
                <Typography variant="subtitle2">
                  {t('accounting.banks.import.preview', '{{count}} movements read', { count: mapped.rows.length })}
                  {mapped.skipped > 0 ? ` · ${t('accounting.banks.import.skipped', '{{count}} lines could not be read', { count: mapped.skipped })}` : ''}
                </Typography>
                <Table size="small">
                  <TableHead><TableRow>
                    <TableCell>{t('accounting.banks.import.date', 'Date')}</TableCell>
                    <TableCell>{t('accounting.banks.import.description', 'Description')}</TableCell>
                    <TableCell align="right">{t('accounting.banks.import.amount', 'Amount')}</TableCell>
                  </TableRow></TableHead>
                  <TableBody>
                    {mapped.rows.slice(0, 6).map((r, i) => (
                      <TableRow key={i}><TableCell>{r.date}</TableCell><TableCell>{r.description}</TableCell><TableCell align="right" sx={{ color: r.amount < 0 ? 'error.main' : 'success.main' }}>{formatMoney(r.amount)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="contained" disabled={busy || !mapped || mapped.rows.length === 0} onClick={doImport}>
          {busy ? <CircularProgress size={18} /> : t('accounting.banks.import.import', 'Import {{count}} movements', { count: mapped?.rows.length ?? 0 })}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BankImportDialog;
