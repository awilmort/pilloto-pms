import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, MenuItem, Paper, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingSettings, BillingTax } from '../../../types/billing';
import { billingErrorMessage, errorFields, TAX_LABELS } from './billingUi';

/** How charges are taxed and due, who hears about Pilloto's own e-CF, and how tenants pay. */
const SettingsTab: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const { t } = useTranslation();
  const [form, setForm] = useState<BillingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    platformBillingService.getSettings().then((r) => setForm(r.data.data ?? null)).catch((err) => setError(billingErrorMessage(err, t)));
  }, [t]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      setForm((await platformBillingService.saveSettings(form)).data.data ?? form);
      setNotice(t('platformBilling.settings.saved', 'Settings saved.'));
      onSaved();
    } catch (err) {
      setFields(errorFields(err));
      setError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (!form) return error ? <Alert severity="error">{error}</Alert> : null;

  return (
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, maxWidth: 720 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      <Box sx={{ display: 'grid', gap: 2.5 }}>
        <TextField
          select label={t('platformBilling.settings.tax', 'Tax on subscription charges')} value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value as BillingTax })}
          error={Boolean(fields.tax)} helperText={fields.tax ?? t('platformBilling.settings.taxHelp', 'Prices are before tax. Services are taxable unless the law exempts them: confirm the treatment of software subscriptions with your accountant. It applies to charges created from now on.')}
        >
          {(Object.keys(TAX_LABELS) as BillingTax[]).map((k) => <MenuItem key={k} value={k}>{t(TAX_LABELS[k].key, TAX_LABELS[k].fallback)}</MenuItem>)}
        </TextField>
        <TextField
          type="number" label={t('platformBilling.settings.dueDays', 'Days to pay a charge')} value={form.dueDays} onChange={(e) => setForm({ ...form, dueDays: Number(e.target.value) })}
          inputProps={{ min: 0, max: 90 }} error={Boolean(fields.dueDays)} helperText={fields.dueDays}
        />
        <TextField
          type="email" label={t('platformBilling.settings.notifyEmail', 'Email for Pilloto’s own e-CF notices')} value={form.notifyEmail} onChange={(e) => setForm({ ...form, notifyEmail: e.target.value })}
          error={Boolean(fields.notifyEmail)} helperText={fields.notifyEmail ?? t('platformBilling.settings.notifyHelp', 'DGII rejections and low e-NCF ranges are sent here.')}
        />
        <TextField
          multiline minRows={4} label={t('platformBilling.settings.instructions', 'How to pay (included in the charge email)')} value={form.paymentInstructions} onChange={(e) => setForm({ ...form, paymentInstructions: e.target.value })}
          inputProps={{ maxLength: 2000 }} error={Boolean(fields.paymentInstructions)} helperText={fields.paymentInstructions ?? t('platformBilling.settings.instructionsHelp', 'Bank, account number, the reference to quote…')}
        />
        <Typography variant="caption" color="text.secondary">{t('platformBilling.settings.ecfNote', 'The e-CF is issued when you record a payment, never on a schedule.')}</Typography>
        <Box><Button variant="contained" onClick={save} disabled={busy}>{t('platformBilling.common.save', 'Save')}</Button></Box>
      </Box>
    </Paper>
  );
};

export default SettingsTab;
