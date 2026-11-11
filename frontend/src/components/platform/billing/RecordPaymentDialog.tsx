import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import { BILLING_PAYMENT_METHODS, BillingCharge, BillingPayment, METHODS_NEEDING_REFERENCE, BillingPaymentMethod } from '../../../types/billing';
import { billingErrorMessage, errorFields, formatDop, periodLabel } from './billingUi';

interface Props {
  charge: BillingCharge | null;
  /** Whether Pilloto can issue its own e-CF right now (otherwise the payment is recorded and the e-CF waits). */
  issuerReady: boolean;
  onClose: () => void;
  /** The recorded payment (carrying its e-CF, or why there is none yet). */
  onRecorded: (payment: BillingPayment, charge: BillingCharge) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Records money received against a charge. Saving it issues the tenant's credit-fiscal e-CF, so the
 * dialog says so before and shows the outcome after; the payment is kept either way.
 */
const RecordPaymentDialog: React.FC<Props> = ({ charge, issuerReady, onClose, onRecorded }) => {
  const { t, i18n } = useTranslation();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<BillingPaymentMethod>('transfer');
  const [paidOn, setPaidOn] = useState(today());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (charge) {
      setAmount(charge.balance.toFixed(2));
      setMethod('transfer');
      setPaidOn(today());
      setReference('');
      setNotes('');
      setError(null);
      setFields({});
    }
  }, [charge]);

  if (!charge) return null;

  const needsReference = METHODS_NEEDING_REFERENCE.includes(method);
  const parsed = Number(amount);
  const settles = Number.isFinite(parsed) && Math.round(parsed * 100) === Math.round(charge.balance * 100);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await platformBillingService.recordPayment(charge.id, {
        amount: parsed,
        method,
        // Noon Dominican time keeps the date the person chose in every timezone.
        paidAt: `${paidOn}T16:00:00.000Z`,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onRecorded(res.data.data!.payment, res.data.data!.charge);
    } catch (err) {
      setFields(errorFields(err));
      setError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>
        {t('platformBilling.record.title', 'Record payment')} — {charge.number}
        <Typography variant="body2" color="text.secondary">
          {charge.tenant?.name} · {periodLabel(charge.period, i18n.language)}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Alert severity={issuerReady ? 'info' : 'warning'} sx={{ mb: 2 }}>
          {issuerReady
            ? t('platformBilling.record.willIssue', 'Saving issues a credit-fiscal e-CF (E31) to the tenant for the amount received, and emails it.')
            : t('platformBilling.record.cannotIssue', 'Pilloto cannot issue e-CF yet. The payment will be recorded and the e-CF can be issued later from the payment.')}
        </Alert>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField
            label={t('platformBilling.record.amount', 'Amount received (ITBIS included)')} type="number" required autoFocus
            value={amount} onChange={(e) => setAmount(e.target.value)} inputProps={{ min: 0.01, step: '0.01', 'aria-label': 'amount' }}
            error={Boolean(fields.amount)} helperText={fields.amount ?? t('platformBilling.record.balance', 'Balance: {{amount}}', { amount: formatDop(charge.balance) })}
          />
          <TextField
            label={t('platformBilling.record.date', 'Date received')} type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ max: today() }} error={Boolean(fields.paidAt)} helperText={fields.paidAt}
          />
          <TextField select label={t('platformBilling.record.method', 'Method')} value={method} onChange={(e) => setMethod(e.target.value as BillingPaymentMethod)} error={Boolean(fields.method)} helperText={fields.method}>
            {BILLING_PAYMENT_METHODS.map((m) => <MenuItem key={m} value={m}>{t(`platformBilling.methods.${m}`, m)}</MenuItem>)}
          </TextField>
          <TextField
            label={t('platformBilling.record.reference', 'Reference')} required={needsReference} value={reference} onChange={(e) => setReference(e.target.value)}
            inputProps={{ maxLength: 100 }} error={Boolean(fields.reference)} helperText={fields.reference ?? t('platformBilling.record.referenceHelp', 'Transfer number, check number…')}
          />
        </Box>
        <TextField sx={{ mt: 2 }} fullWidth multiline minRows={2} label={t('platformBilling.record.notes', 'Notes (optional)')} value={notes} onChange={(e) => setNotes(e.target.value)} inputProps={{ maxLength: 500 }} />
        {!settles && Number.isFinite(parsed) && parsed > 0 && parsed < charge.balance && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('platformBilling.record.partialNote', 'A partial payment leaves {{amount}} still owed; its e-CF covers only what is received.', { amount: formatDop(charge.balance - parsed) })}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('platformBilling.common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !(parsed > 0) || (needsReference && !reference.trim())}>
          {busy ? t('platformBilling.common.saving', 'Saving…') : t('platformBilling.record.save', 'Record payment and issue e-CF')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RecordPaymentDialog;
