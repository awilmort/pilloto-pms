import React, { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, TextField } from '@mui/material';
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

/**
 * Sets a different monthly price for one tenant from a month on. The reason is required because the
 * tenant is emailed it, together with the old and the new price.
 */
const PriceChangeDialog: React.FC<Props> = ({ tenant, onClose, onSaved }) => {
  const { t, i18n } = useTranslation();
  const months = upcomingPeriods(12);
  const [product, setProduct] = useState<BillingProduct | ''>('');
  const [price, setPrice] = useState('');
  const [from, setFrom] = useState(months[0]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (tenant) {
      setProduct(tenant.products[0]?.product ?? '');
      setPrice('');
      setFrom(months[0]);
      setReason('');
      setError(null);
      setFields({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  if (!tenant) return null;
  const current = tenant.products.find((p) => p.product === product);

  const submit = async () => {
    if (!product) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await platformBillingService.addPriceChange(tenant.id, { product, price: Number(price), effectiveFrom: from, reason: reason.trim() });
      onSaved(res.data.data!);
    } catch (err) {
      setFields(errorFields(err));
      setError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{t('platformBilling.priceChange.title', 'Change the contracted price')} — {tenant.name}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('platformBilling.priceChange.help', 'The new price applies from the month you choose, until the tenant changes plan. The tenant is emailed the old price, the new price and your reason.')}
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField select fullWidth sx={{ mb: 2 }} label={t('platformBilling.priceChange.product', 'Product')} value={product} onChange={(e) => setProduct(e.target.value as BillingProduct)} error={Boolean(fields.product)} helperText={fields.product}>
          {tenant.products.map((p) => <MenuItem key={p.product} value={p.product}>{t(`platformBilling.products.${p.product}`, p.product)} — {p.plan}</MenuItem>)}
        </TextField>
        <TextField
          fullWidth sx={{ mb: 2 }} type="number" required label={t('platformBilling.priceChange.price', 'New monthly price (before ITBIS)')} value={price} onChange={(e) => setPrice(e.target.value)}
          inputProps={{ min: 0, step: '0.01', 'aria-label': 'price' }} error={Boolean(fields.price)}
          helperText={fields.price ?? (current?.contractPrice != null ? t('platformBilling.priceChange.currentPrice', 'Now: {{price}}', { price: formatDop(current.contractPrice) }) : undefined)}
        />
        <TextField select fullWidth sx={{ mb: 2 }} label={t('platformBilling.priceChange.from', 'First month at the new price')} value={from} onChange={(e) => setFrom(e.target.value)} error={Boolean(fields.effectiveFrom)} helperText={fields.effectiveFrom}>
          {months.map((m) => <MenuItem key={m} value={m} sx={{ textTransform: 'capitalize' }}>{periodLabel(m, i18n.language)}</MenuItem>)}
        </TextField>
        <TextField
          fullWidth multiline minRows={3} required label={t('platformBilling.priceChange.reason', 'Reason (the tenant will read this)')} value={reason} onChange={(e) => setReason(e.target.value)}
          inputProps={{ maxLength: 500 }} error={Boolean(fields.reason)} helperText={fields.reason ?? t('platformBilling.priceChange.reasonHelp', 'At least {{n}} characters.', { n: MIN_REASON })}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('platformBilling.common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !product || price === '' || Number(price) < 0 || reason.trim().length < MIN_REASON}>
          {t('platformBilling.priceChange.submit', 'Save and email the tenant')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PriceChangeDialog;
