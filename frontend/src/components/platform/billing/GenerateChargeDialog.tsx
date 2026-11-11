import React, { useEffect, useState } from 'react';
import { Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Switch, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingCharge, BillingTenant } from '../../../types/billing';
import { billingErrorMessage, currentPeriod, errorFields } from './billingUi';

interface Props {
  open: boolean;
  /** Tenant to charge, when opened from a tenant's page. */
  tenantId?: string;
  onClose: () => void;
  onGenerated: (charge: BillingCharge, created: boolean) => void;
}

const previousPeriod = (): string => {
  const [y, m] = currentPeriod().split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** Charges one tenant for one finished month: for catching up a month the automatic run did not cover. */
const GenerateChargeDialog: React.FC<Props> = ({ open, tenantId, onClose, onGenerated }) => {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<BillingTenant[]>([]);
  const [tenant, setTenant] = useState<BillingTenant | null>(null);
  const [period, setPeriod] = useState(previousPeriod());
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFields({});
    setPeriod(previousPeriod());
    platformBillingService.tenants().then((r) => {
      const list = r.data.data ?? [];
      setTenants(list);
      setTenant(list.find((x) => x.id === tenantId) ?? null);
    }).catch((err) => setError(billingErrorMessage(err, t)));
  }, [open, tenantId, t]);

  const submit = async () => {
    if (!tenant) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await platformBillingService.generateCharge({ tenantId: tenant.id, period, notify });
      onGenerated(res.data.data!.charge, res.data.data!.created);
    } catch (err) {
      setFields(errorFields(err));
      setError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{t('platformBilling.generate.title', 'Generate a charge')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('platformBilling.generate.help', 'Charges are created automatically on the 1st for the month that ended. Use this to catch up a month, for one tenant. If one already exists it is shown instead.')}
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Autocomplete
          options={tenants} value={tenant} onChange={(_, v) => setTenant(v)} getOptionLabel={(o) => `${o.name} (${o.slug})`}
          isOptionEqualToValue={(a, b) => a.id === b.id} disabled={Boolean(tenantId)}
          renderInput={(params) => <TextField {...params} label={t('platformBilling.generate.tenant', 'Tenant')} required />}
        />
        <TextField
          sx={{ mt: 2 }} fullWidth type="month" label={t('platformBilling.generate.period', 'Month')} value={period} onChange={(e) => setPeriod(e.target.value)}
          InputLabelProps={{ shrink: true }} inputProps={{ max: previousPeriod() }} error={Boolean(fields.period)} helperText={fields.period}
        />
        <FormControlLabel sx={{ mt: 1 }} control={<Switch checked={notify} onChange={(e) => setNotify(e.target.checked)} />} label={t('platformBilling.generate.notify', 'Email the charge to the tenant')} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('platformBilling.common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !tenant || !/^\d{4}-\d{2}$/.test(period)}>{t('platformBilling.generate.submit', 'Generate')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default GenerateChargeDialog;
