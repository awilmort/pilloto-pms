import React, { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl,
  FormControlLabel, IconButton, InputLabel, MenuItem, Paper, Select, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { billsService } from '../../../services/api';
import type { Account, BillPaymentMethod, Supplier } from '../../../types';
import { formatAccountingMoney as formatMoney } from '../../../utils/currency';
import BankAccountSelect from '../banks/BankAccountSelect';
import BillFiscalFields, { BillFiscalState, emptyFiscal, fiscalError, fiscalPayload } from './BillFiscalFields';
import CurrencyFields, { currencyPayload, DocCurrency } from '../fx/CurrencyFields';

interface ExpenseLine { key: number; description: string; accountId: string; amount: string; taxRate: string; isGoods: boolean }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
let seq = 0;
const newLine = (): ExpenseLine => ({ key: ++seq, description: '', accountId: '', amount: '', taxRate: '18', isGoods: false });
const today = () => new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);

interface Props {
  open: boolean;
  suppliers: Supplier[];
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Records a purchase that is already paid — a receipt, a utility bill — in one step: the bill is
 * created, received (posted to the books) and paid in full.
 */
const QuickExpenseDialog: React.FC<Props> = ({ open, suppliers, accounts, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [supplierId, setSupplierId] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [lines, setLines] = useState<ExpenseLine[]>([newLine()]);
  const [fiscal, setFiscal] = useState<BillFiscalState>(emptyFiscal('02'));
  const [method, setMethod] = useState<BillPaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [fx, setFx] = useState<{ currency: DocCurrency; exchangeRate: string }>({ currency: 'DOP', exchangeRate: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const supplier = suppliers.find((s) => s._id === supplierId);
  const totals = useMemo(() => {
    let subtotal = 0, itbis = 0;
    for (const l of lines) {
      const base = r2(Number(l.amount) || 0);
      subtotal += base;
      itbis += r2(base * (Number(l.taxRate) || 0) / 100);
    }
    const total = r2(subtotal + itbis);
    const withheld = r2((Number(fiscal.itbisWithheld) || 0) + (Number(fiscal.isrWithheld) || 0));
    return { subtotal: r2(subtotal), itbis: r2(itbis), total, paid: r2(total - withheld) };
  }, [lines, fiscal]);

  const update = (key: number, patch: Partial<ExpenseLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    setError(null);
    if (!supplierId) return setError(t('accounting.bills.form.supplierRequired', 'Choose a supplier'));
    if (lines.some((l) => !l.description.trim() || !l.accountId || !(Number(l.amount) >= 0) || l.amount === '')) {
      return setError(t('accounting.bills.expense.linesRequired', 'Each line needs a description, an account and an amount.'));
    }
    const fe = fiscalError(fiscal, t);
    if (fe) return setError(fe);
    setSaving(true);
    try {
      await billsService.createQuickExpense({
        supplier: supplierId,
        issueDate,
        lineItems: lines.map((l) => ({ description: l.description.trim(), account: l.accountId, lineTotal: Number(l.amount), taxRate: Number(l.taxRate) || 0, isGoods: l.isGoods })),
        payment: { method, date: issueDate, reference: reference.trim() || undefined, bankAccount: method !== 'cash' && bankAccount ? bankAccount : undefined },
        ...fiscalPayload(fiscal),
        ...currencyPayload(fx),
      });
      onSaved();
      setLines([newLine()]);
      setFiscal(emptyFiscal('02'));
      setSupplierId('');
      setReference('');
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.bills.messages.saveFailed', 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('accounting.bills.expense.title', 'Record an expense')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('accounting.bills.expense.intro', 'For a purchase already paid (a receipt, a utility bill). It is recorded, posted to your books and marked paid in one step.')}
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '2fr 1fr' } }}>
            <FormControl fullWidth required>
              <InputLabel>{t('accounting.bills.form.supplier', 'Supplier')}</InputLabel>
              <Select value={supplierId} label={t('accounting.bills.form.supplier', 'Supplier')} onChange={(e) => {
                const s = suppliers.find((x) => x._id === e.target.value);
                setSupplierId(e.target.value);
                if (s?.defaultExpenseType) setFiscal((f) => ({ ...f, expenseType: s.defaultExpenseType! }));
              }}>
                {suppliers.map((s) => <MenuItem key={s._id} value={s._id}>{s.name}{s.taxId ? ` (${s.taxId})` : ''}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField type="date" label={t('accounting.bills.table.issueDate', 'Date')} InputLabelProps={{ shrink: true }} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Box>
          <CurrencyFields currency={fx.currency} exchangeRate={fx.exchangeRate} date={issueDate} onChange={setFx} />

          {lines.map((l) => (
            <Paper key={l.key} variant="outlined" sx={{ p: 1.5 }}>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 2fr 1fr 0.7fr auto' }, alignItems: 'center' }}>
                <TextField size="small" label={t('accounting.invoices.form.description', 'Description')} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                <FormControl size="small">
                  <InputLabel>{t('accounting.bills.form.account', 'Account')}</InputLabel>
                  <Select value={l.accountId} label={t('accounting.bills.form.account', 'Account')} onChange={(e) => update(l.key, { accountId: e.target.value })}>
                    {accounts.map((a) => <MenuItem key={a._id} value={a._id}>{a.code} — {a.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField size="small" type="number" label={t('accounting.bills.expense.amount', 'Amount before tax')} value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} inputProps={{ min: 0 }} />
                <TextField size="small" type="number" label="ITBIS %" value={l.taxRate} onChange={(e) => update(l.key, { taxRate: e.target.value })} inputProps={{ min: 0, max: 100 }} />
                <IconButton size="small" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><DeleteIcon fontSize="small" /></IconButton>
              </Box>
              <FormControlLabel sx={{ mt: 0.5 }} control={<Checkbox size="small" checked={l.isGoods} onChange={(e) => update(l.key, { isGoods: e.target.checked })} />} label={<Typography variant="body2">{t('accounting.bills.fiscal.isGoods', 'Goods (not a service)')}</Typography>} />
            </Paper>
          ))}
          <Box><Button size="small" startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, newLine()])}>{t('accounting.bills.expense.addLine', 'Add line')}</Button></Box>

          <Divider />
          <BillFiscalFields value={fiscal} onChange={setFiscal} supplierTaxId={supplier?.taxId} subtotal={totals.subtotal} itbis={totals.itbis} />
          <Divider />

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
            <FormControl>
              <InputLabel>{t('accounting.bills.payment.method', 'Paid with')}</InputLabel>
              <Select value={method} label={t('accounting.bills.payment.method', 'Paid with')} onChange={(e) => setMethod(e.target.value as BillPaymentMethod)}>
                {(['cash', 'card', 'transfer', 'check', 'other'] as BillPaymentMethod[]).map((m) => <MenuItem key={m} value={m}>{t(`accounting.bills.paymentMethod.${m}`, m)}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label={t('accounting.bills.payment.reference', 'Reference')} value={reference} onChange={(e) => setReference(e.target.value)} />
            <BankAccountSelect method={method} value={bankAccount} onChange={setBankAccount} />
          </Box>

          <Paper variant="outlined" sx={{ p: 2, ml: 'auto', minWidth: 280 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.subtotal', 'Subtotal')}</Typography><Typography variant="body2">{formatMoney(totals.subtotal)}</Typography></Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">ITBIS</Typography><Typography variant="body2">{formatMoney(totals.itbis)}</Typography></Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.invoices.table.total', 'Total')}</Typography><Typography variant="body2">{formatMoney(totals.total)}</Typography></Box>
            <Divider sx={{ my: 0.5 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography fontWeight={700}>{t('accounting.bills.expense.paid', 'Paid to the supplier')}</Typography><Typography fontWeight={700}>{formatMoney(totals.paid)}</Typography></Box>
          </Paper>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? <CircularProgress size={18} /> : t('accounting.bills.expense.save', 'Record expense')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default QuickExpenseDialog;
