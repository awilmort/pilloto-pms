import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingPlanEntry } from '../../../types/billing';
import { billingErrorMessage, errorFields, formatDate, formatDop } from './billingUi';

/** The price list. Editing a price affects only subscriptions that start afterwards. */
const PlansTab: React.FC = () => {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<BillingPlanEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<BillingPlanEntry | null>(null);
  const [price, setPrice] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlans((await platformBillingService.plans()).data.data ?? []);
      setError(null);
    } catch (err) {
      setError(billingErrorMessage(err, t));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const open = (plan: BillingPlanEntry) => { setEditing(plan); setPrice(String(plan.monthlyPrice)); setFieldError(null); };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setFieldError(null);
    try {
      await platformBillingService.setPlanPrice(editing.product, editing.plan, Number(price));
      setEditing(null);
      setNotice(t('platformBilling.plans.saved', 'Price updated. Existing subscriptions keep the price they have.'));
      load();
    } catch (err) {
      setFieldError(errorFields(err).price ?? billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>{t('platformBilling.plans.help', 'Monthly prices in Dominican pesos, before ITBIS. Changing a price here only affects subscriptions that start afterwards. To change what one tenant pays, use its Billing page.')}</Alert>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" aria-label={t('platformBilling.tabs.plans', 'Plans & prices')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('platformBilling.priceChange.product', 'Product')}</TableCell>
                <TableCell>{t('platformBilling.plans.plan', 'Plan')}</TableCell>
                <TableCell align="right">{t('platformBilling.plans.price', 'Price per month')}</TableCell>
                <TableCell>{t('platformBilling.plans.lastChange', 'Last change')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {plans?.map((p) => {
                const last = p.history[p.history.length - 1];
                return (
                  <TableRow key={`${p.product}:${p.plan}`}>
                    <TableCell>{t(`platformBilling.products.${p.product}`, p.product)}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell align="right"><strong>{formatDop(p.monthlyPrice)}</strong></TableCell>
                    <TableCell>
                      {last && last.changedByEmail !== 'system' ? <Typography variant="caption" color="text.secondary">{formatDate(last.changedAt)} · {last.changedByEmail}</Typography> : '—'}
                    </TableCell>
                    <TableCell align="right"><Button size="small" onClick={() => open(p)} aria-label={`${t('platformBilling.plans.edit', 'Edit price')} ${p.product} ${p.name}`}>{t('platformBilling.plans.edit', 'Edit price')}</Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={Boolean(editing)} onClose={() => !busy && setEditing(null)} fullWidth maxWidth="xs">
        <DialogTitle>{editing && `${t(`platformBilling.products.${editing.product}`, editing.product)} — ${editing.name}`}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth sx={{ mt: 1 }} type="number" label={t('platformBilling.plans.price', 'Price per month')} value={price} onChange={(e) => setPrice(e.target.value)}
            inputProps={{ min: 0, step: '0.01', 'aria-label': 'price' }} error={Boolean(fieldError)} helperText={fieldError ?? t('platformBilling.plans.beforeTax', 'Before ITBIS')}
          />
          {editing && editing.history.length > 1 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2">{t('platformBilling.plans.history', 'History')}</Typography>
              {[...editing.history].reverse().slice(0, 6).map((h, i) => (
                <Typography key={i} variant="caption" display="block" color="text.secondary">
                  {formatDate(h.changedAt)} · {h.previous != null ? `${formatDop(h.previous)} → ` : ''}{formatDop(h.price)} · {h.changedByEmail ?? ''}
                </Typography>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={busy}>{t('platformBilling.common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={save} disabled={busy || price === '' || Number(price) < 0}>{t('platformBilling.common.save', 'Save')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PlansTab;
