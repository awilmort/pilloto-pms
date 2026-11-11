import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { accountingCustomersService } from '../../../services/api';
import type { Customer } from '../../../types';

interface Props {
  open: boolean;
  initialName?: string;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}

const digits = (s: string) => s.replace(/\D/g, '');

/** Create a customer without leaving the invoice: only what an invoice needs, the rest can be filled in later under Customers. */
const QuickCustomerDialog: React.FC<Props> = ({ open, initialName = '', onClose, onCreated }) => {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: '', rnc: '', email: '', phone: '', address: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setForm({ name: initialName, rnc: '', email: '', phone: '', address: '' }); setError(null); }
  }, [open, initialName]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const rnc = digits(form.rnc);
  const rncInvalid = rnc.length > 0 && rnc.length !== 9 && rnc.length !== 11;

  const save = async () => {
    if (!form.name.trim()) { setError(t('accounting.invoices.page.quickCustomer.nameRequired')); return; }
    if (rncInvalid) { setError(t('accounting.invoices.page.quickCustomer.rncInvalid')); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await accountingCustomersService.createCustomer({
        name: form.name.trim(),
        rnc: rnc || undefined,
        razonSocial: rnc ? form.name.trim() : undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        isActive: true,
      });
      onCreated(res.data.data as Customer);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.invoices.page.quickCustomer.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle>{t('accounting.invoices.page.quickCustomer.title')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
          <TextField label={t('accounting.invoices.page.quickCustomer.name')} value={form.name} onChange={set('name')} required autoFocus />
          <TextField label="RNC / Cédula" value={form.rnc} onChange={set('rnc')} error={rncInvalid} helperText={rncInvalid ? t('accounting.invoices.page.quickCustomer.rncInvalid') : t('accounting.invoices.page.quickCustomer.rncHelp')} inputProps={{ inputMode: 'numeric' }} />
          <TextField label={t('common.email', 'Email')} type="email" value={form.email} onChange={set('email')} />
          <TextField label={t('common.phone', 'Phone')} value={form.phone} onChange={set('phone')} />
          <TextField label={t('accounting.invoices.page.quickCustomer.address')} value={form.address} onChange={set('address')} multiline minRows={2} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? <CircularProgress size={18} /> : t('common.save', 'Save')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default QuickCustomerDialog;
