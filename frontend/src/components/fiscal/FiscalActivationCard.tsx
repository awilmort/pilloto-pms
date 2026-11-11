import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, FormControl, FormControlLabel, FormHelperText, Paper, Stack, TextField, Typography,
} from '@mui/material';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { FiscalActivation, FiscalPlanId, FiscalPlans, FiscalStatus } from '../../types';
import FiscalPlanPicker from './FiscalPlanPicker';
import { errorFields, fiscalErrorMessage, isTaxId } from './fiscalUi';
import { invalidateFiscalStatus } from './useFiscalStatus';

interface Props {
  status: FiscalStatus;
  onActivated: (status: FiscalStatus) => void;
}

type Form = { rnc: string; razonSocial: string; address: string; adminName: string; adminEmail: string; confirmed: boolean };

/**
 * Turning on electronic invoicing. The company confirms who it is (as DGII knows it), who
 * BillingSoft should invite to upload the digital certificate and run DGII's certification, the
 * plan, and that any earlier postulation with another provider is concluded — DGII requires that
 * before a new one can start, and nothing else can check it.
 */
const FiscalActivationCard: React.FC<Props> = ({ status, onActivated }) => {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<FiscalPlans | null>(null);
  const [plan, setPlan] = useState<FiscalPlanId>('essential');
  const [form, setForm] = useState<Form>({
    rnc: status.defaults.rnc,
    razonSocial: status.defaults.razonSocial,
    address: status.defaults.address,
    adminName: '',
    adminEmail: status.defaults.adminEmail,
    confirmed: false,
  });
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fiscalService
      .getPlans()
      .then((res) => {
        if (!alive) return;
        const data = res.data.data as FiscalPlans;
        setPlans(data);
        const first = data.plans.find((p) => p.selectable);
        if (first) setPlan((data.includedPlan && data.plans.find((p) => p.id === data.includedPlan)?.selectable ? data.includedPlan : first.id) as FiscalPlanId);
      })
      .catch((err) => alive && setError(fiscalErrorMessage(err, t)));
    return () => { alive = false; };
  }, [t]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerFields({});
  };

  const problems = useMemo(() => {
    const p: Record<string, string> = {};
    if (!isTaxId(form.rnc)) p.rnc = t('fiscal.activation.errors.rnc', 'Enter a valid RNC (9 digits) or cédula (11).');
    if (!form.razonSocial.trim()) p.razonSocial = t('fiscal.activation.errors.required', 'Required');
    else if (form.razonSocial.trim().length > 150) p.razonSocial = t('fiscal.activation.errors.max150', 'At most 150 characters.');
    if (!form.address.trim()) p.address = t('fiscal.activation.errors.required', 'Required');
    else if (form.address.trim().length > 100) p.address = t('fiscal.activation.errors.max100', 'At most 100 characters.');
    if (!form.adminName.trim()) p['admin.name'] = t('fiscal.activation.errors.required', 'Required');
    if (!/^\S+@\S+\.\S+$/.test(form.adminEmail)) p['admin.email'] = t('fiscal.activation.errors.email', 'Enter a valid email.');
    if (!form.confirmed) p.confirmPreviousPostulationConcluded = t('fiscal.activation.errors.confirm', 'You need to confirm this to continue.');
    return p;
  }, [form, t]);

  const shown = (key: string) => (touched ? problems[key] ?? serverFields[key] : serverFields[key]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (Object.keys(problems).length > 0) return;
    const body: FiscalActivation = {
      plan,
      rnc: form.rnc.replace(/\D/g, ''),
      razonSocial: form.razonSocial.trim(),
      address: form.address.trim(),
      admin: { name: form.adminName.trim(), email: form.adminEmail.trim() },
      confirmPreviousPostulationConcluded: form.confirmed,
    };
    setBusy(true);
    try {
      const res = await fiscalService.activate(body);
      const next = res.data.data as FiscalStatus;
      invalidateFiscalStatus(next);
      onActivated(next);
    } catch (err) {
      setServerFields(errorFields(err));
      setError(fiscalErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper component="form" onSubmit={submit} noValidate elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: { xs: 2, md: 3 } }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
        <ReceiptLongOutlinedIcon color="primary" />
        <Typography variant="h6" fontWeight={700}>{t('fiscal.activation.title', 'Activate electronic invoicing')}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 760 }}>
        {t('fiscal.activation.intro', 'Issue e-CF directly from Pilloto. We create your company’s account in BillingSoft, our DGII-authorized invoicing partner. Its administrator then uploads your digital certificate and completes DGII’s certification — until DGII certifies you, Pilloto will not issue fiscal invoices.')}
      </Typography>

      {!status.configured && <Alert severity="warning" sx={{ mb: 2 }}>{t('fiscal.unavailable', 'Electronic invoicing is not available on this server yet. Contact support.')}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('fiscal.activation.company', 'Your company, as DGII knows it')}</Typography>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 2fr' }, mb: 3 }}>
        <TextField
          label={t('fiscal.activation.rnc', 'RNC')} value={form.rnc} onChange={(e) => set('rnc', e.target.value)} size="small" required
          error={Boolean(shown('rnc'))} helperText={shown('rnc') || t('fiscal.activation.rncHelp', '9 digits (11 for a cédula)')} inputProps={{ inputMode: 'numeric' }}
        />
        <TextField
          label={t('fiscal.activation.razonSocial', 'Legal name')} value={form.razonSocial} onChange={(e) => set('razonSocial', e.target.value)} size="small" required
          error={Boolean(shown('razonSocial'))} helperText={shown('razonSocial')}
        />
        <TextField
          sx={{ gridColumn: { md: '1 / -1' } }}
          label={t('fiscal.activation.address', 'Address')} value={form.address} onChange={(e) => set('address', e.target.value)} size="small" required
          error={Boolean(shown('address'))} helperText={shown('address') || t('fiscal.activation.addressHelp', 'Printed on every e-CF. At most 100 characters.')}
        />
      </Box>

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>{t('fiscal.activation.administrator', 'Who sets up the certificate')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('fiscal.activation.administratorHelp', 'BillingSoft emails this person a link to create their password. They upload the digital certificate and complete DGII’s certification there.')}
      </Typography>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, mb: 3 }}>
        <TextField
          label={t('fiscal.activation.adminName', 'Name')} value={form.adminName} onChange={(e) => set('adminName', e.target.value)} size="small" required
          error={Boolean(shown('admin.name'))} helperText={shown('admin.name')} autoComplete="name"
        />
        <TextField
          label={t('fiscal.activation.adminEmail', 'Email')} type="email" value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} size="small" required
          error={Boolean(shown('admin.email'))} helperText={shown('admin.email')} autoComplete="email"
        />
      </Box>

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('fiscal.activation.plan', 'Plan')}</Typography>
      {plans ? (
        <FiscalPlanPicker plans={plans.plans} value={plan} onChange={setPlan} currentPlan={null} />
      ) : (
        <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
      )}
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1, mb: 3 }}>
        {t('fiscal.activation.planNote', 'You can change plan any time. Upgrades apply immediately; downgrades take effect on the 1st of next month.')}
      </Typography>

      <FormControl error={Boolean(shown('confirmPreviousPostulationConcluded'))} sx={{ mb: 2 }}>
        <FormControlLabel
          control={<Checkbox checked={form.confirmed} onChange={(e) => set('confirmed', e.target.checked)} />}
          label={t('fiscal.activation.confirm', 'I confirm that any earlier postulation with another e-CF provider is concluded (or that I never started one). DGII requires this before a new postulation can start.')}
        />
        {shown('confirmPreviousPostulationConcluded') && <FormHelperText>{shown('confirmPreviousPostulationConcluded')}</FormHelperText>}
      </FormControl>

      <Box>
        <Button type="submit" variant="contained" disabled={busy || !status.configured || !plans} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {t('fiscal.activation.submit', 'Activate electronic invoicing')}
        </Button>
      </Box>
    </Paper>
  );
};

export default FiscalActivationCard;
