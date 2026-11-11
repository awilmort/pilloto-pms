import React, { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingProduct, BillingTenant } from '../../../types/billing';
import { billingErrorMessage, errorFields, formatDop, periodLabel, upcomingPeriods } from './billingUi';

interface Props {
  tenant: BillingTenant | null;
  onClose: () => void;
  onSaved: (tenant: BillingTenant) => void;
}

const MIN_REASON = 10;

/** What `price` comes to once the discount is taken off (never below zero). */
export function discountedPrice(price: number, type: 'percent' | 'amount', value: number): number {
  const off = type === 'percent' ? (price * value) / 100 : value;
  return Math.max(0, Math.round((price - off) * 100) / 100);
}

/**
 * Grants a tenant a discount on one product's subscription: a percentage or a fixed amount per
 * month, from a month on, optionally until a last month. The reason is internal.
 */
const DiscountDialog: React.FC<Props> = ({ tenant, onClose, onSaved }) => {
  const { t, i18n } = useTranslation();
  const months = upcomingPeriods(24);
  const [product, setProduct] = useState<BillingProduct | ''>('');
  const [type, setType] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [from, setFrom] = useState(months[0]);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (tenant) {
      setProduct(tenant.products[0]?.product ?? '');
      setType('percent');
      setValue('');
      setFrom(months[0]);
      setUntil('');
      setReason('');
      setError(null);
      setFields({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  if (!tenant) return null;
  const current = tenant.products.find((p) => p.product === product);
  const amount = Number(value);
  const valid = value !== '' && amount > 0 && (type === 'amount' || amount <= 100);

  const submit = async () => {
    if (!product) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await platformBillingService.addDiscount(tenant.id, { product, type, value: amount, effectiveFrom: from, ...(until ? { effectiveUntil: until } : {}), reason: reason.trim() });
      onSaved(res.data.data!);
    } catch (err) {
      setFields(errorFields(err));
      setError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const month = (m: string) => <span style={{ textTransform: 'capitalize' }}>{periodLabel(m, i18n.language)}</span>;

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{t('platformBilling.discount.title', 'Grant a discount')} — {tenant.name}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('platformBilling.discount.help', 'Takes a percentage or a fixed amount off the subscription every month, from the month you choose. It is taken off the price the tenant has at that time, so it follows a price change. Charges already made do not change. The tenant is not emailed; it sees the discount on its charge.')}
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField select fullWidth sx={{ mb: 2 }} label={t('platformBilling.discount.product', 'Product')} value={product} onChange={(e) => setProduct(e.target.value as BillingProduct)} error={Boolean(fields.product)} helperText={fields.product}>
          {tenant.products.map((p) => <MenuItem key={p.product} value={p.product}>{t(`platformBilling.products.${p.product}`, p.product)} — {p.plan}</MenuItem>)}
        </TextField>
        <ToggleButtonGroup
          exclusive fullWidth size="small" color="primary" sx={{ mb: 2 }} value={type} aria-label={t('platformBilling.discount.type', 'Type')}
          onChange={(_, next) => { if (next) { setType(next); setValue(''); } }}
        >
          <ToggleButton value="percent">{t('platformBilling.discount.percent', 'Percentage')}</ToggleButton>
          <ToggleButton value="amount">{t('platformBilling.discount.amount', 'Fixed amount')}</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          fullWidth sx={{ mb: 2 }} type="number" required value={value} onChange={(e) => setValue(e.target.value)}
          label={type === 'percent' ? t('platformBilling.discount.valuePercent', 'Discount (%)') : t('platformBilling.discount.valueAmount', 'Discount per month (RD$, before ITBIS)')}
          inputProps={{ min: 0, max: type === 'percent' ? 100 : undefined, step: type === 'percent' ? '0.01' : '1', 'aria-label': 'value' }} error={Boolean(fields.value)} helperText={fields.value}
        />
        {valid && current?.contractPrice != null && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('platformBilling.discount.preview', 'Per month: {{from}} → {{to}} (before ITBIS)', { from: formatDop(current.contractPrice), to: formatDop(discountedPrice(current.contractPrice, type, amount)) })}
          </Typography>
        )}
        <TextField select fullWidth sx={{ mb: 2 }} label={t('platformBilling.discount.from', 'First month with the discount')} value={from} onChange={(e) => { setFrom(e.target.value); if (until && until < e.target.value) setUntil(''); }} error={Boolean(fields.effectiveFrom)} helperText={fields.effectiveFrom}>
          {months.map((m) => <MenuItem key={m} value={m}>{month(m)}</MenuItem>)}
        </TextField>
        <TextField select fullWidth sx={{ mb: 2 }} label={t('platformBilling.discount.until', 'Last month with the discount')} value={until} onChange={(e) => setUntil(e.target.value)} error={Boolean(fields.effectiveUntil)} helperText={fields.effectiveUntil}>
          <MenuItem value="">{t('platformBilling.discount.untilNone', 'No end date')}</MenuItem>
          {months.filter((m) => m >= from).map((m) => <MenuItem key={m} value={m}>{month(m)}</MenuItem>)}
        </TextField>
        <TextField
          fullWidth multiline minRows={2} required label={t('platformBilling.discount.reason', 'Reason (internal)')} value={reason} onChange={(e) => setReason(e.target.value)}
          inputProps={{ maxLength: 500 }} error={Boolean(fields.reason)} helperText={fields.reason ?? t('platformBilling.discount.reasonHelp', 'At least {{n}} characters. Only your team sees this.', { n: MIN_REASON })}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('platformBilling.common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !product || !valid || reason.trim().length < MIN_REASON}>
          {t('platformBilling.discount.submit', 'Grant discount')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DiscountDialog;
