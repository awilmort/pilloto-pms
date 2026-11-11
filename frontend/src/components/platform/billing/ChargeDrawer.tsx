import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, Drawer, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { Close, MailOutline, PaymentsOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingCharge, BillingPayment } from '../../../types/billing';
import EcfCell from './EcfCell';
import PaymentActions from './PaymentActions';
import { billingErrorMessage, CHARGE_TONE, formatDate, formatDop, periodLabel } from './billingUi';
import { chipTone } from '../../fiscal/fiscalUi';

interface Props {
  chargeId: string | null;
  onClose: () => void;
  onRecordPayment: (charge: BillingCharge) => void;
  /** Bump to reload (a payment was recorded elsewhere). */
  refreshKey?: number;
  onChanged: () => void;
}

export const ChargeStatusChip: React.FC<{ charge: Pick<BillingCharge, 'status' | 'overdue'> }> = ({ charge }) => {
  const { t } = useTranslation();
  const tone = charge.overdue ? 'error' : CHARGE_TONE[charge.status];
  const label = charge.overdue ? t('platformBilling.charges.overdue', 'Overdue') : t(`platformBilling.charges.status.${charge.status}`, charge.status);
  return <Chip size="small" {...chipTone(tone)} variant={tone === 'default' ? 'outlined' : 'filled'} label={label} />;
};

/** One charge: what it is made of, who paid what, and what can be done with it. */
const ChargeDrawer: React.FC<Props> = ({ chargeId, onClose, onRecordPayment, refreshKey, onChanged }) => {
  const { t, i18n } = useTranslation();
  const [charge, setCharge] = useState<BillingCharge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!chargeId) return;
    try {
      setCharge((await platformBillingService.charge(chargeId)).data.data ?? null);
      setError(null);
    } catch (err) {
      setError(billingErrorMessage(err, t));
    }
  }, [chargeId, t]);

  useEffect(() => {
    setCharge(null);
    setNotice(null);
    setError(null);
    load();
  }, [load, refreshKey]);

  const changed = (message?: string) => {
    if (message) setNotice(message);
    load();
    onChanged();
  };

  const notify = async () => {
    if (!charge) return;
    setBusy(true);
    try {
      await platformBillingService.notifyCharge(charge.id);
      setNotice(t('platformBilling.charges.notified', 'Charge emailed to the tenant.'));
    } catch (err) {
      setError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const voidIt = async () => {
    if (!charge) return;
    setBusy(true);
    try {
      await platformBillingService.voidCharge(charge.id, reason.trim());
      setVoiding(false);
      setReason('');
      changed(t('platformBilling.charges.voided', 'Charge voided.'));
    } catch (err) {
      setError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const payable = charge && (charge.status === 'open' || charge.status === 'partial');
  const payments: BillingPayment[] = charge?.payments ?? [];

  return (
    <Drawer anchor="right" open={Boolean(chargeId)} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 560 }, p: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">{t('platformBilling.charges.charge', 'Charge')}</Typography>
          <Typography variant="h6" fontWeight={700}>{charge?.number ?? '…'}</Typography>
          {charge && <Typography variant="body2" color="text.secondary">{charge.tenant?.name} · {periodLabel(charge.period, i18n.language)}</Typography>}
        </Box>
        <IconButton onClick={onClose} aria-label={t('platformBilling.common.close', 'Close')}><Close /></IconButton>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {!charge && !error && <CircularProgress size={24} />}

      {charge && (
        <>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <ChargeStatusChip charge={charge} />
            <Typography variant="body2" color="text.secondary">{t('platformBilling.charges.due', 'Due {{date}}', { date: formatDate(`${charge.dueDate}T12:00:00Z`) })}</Typography>
          </Stack>
          {charge.status === 'void' && <Alert severity="info" sx={{ mb: 2 }}>{t('platformBilling.charges.voidedWhy', 'Voided: {{reason}}', { reason: charge.voidReason })}</Alert>}

          <Table size="small" aria-label={t('platformBilling.charges.lines', 'Charge lines')}>
            <TableBody>
              {charge.lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell sx={{ pl: 0 }}>{l.description}</TableCell>
                  <TableCell align="right" sx={{ pr: 0, whiteSpace: 'nowrap' }}>{formatDop(l.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow><TableCell sx={{ pl: 0 }} align="right">{t('platformBilling.charges.subtotal', 'Subtotal')}</TableCell><TableCell align="right" sx={{ pr: 0 }}>{formatDop(charge.subtotal)}</TableCell></TableRow>
              <TableRow><TableCell sx={{ pl: 0 }} align="right">{t(`platformBilling.tax.${charge.tax}`, charge.tax)}</TableCell><TableCell align="right" sx={{ pr: 0 }}>{formatDop(charge.itbis)}</TableCell></TableRow>
              <TableRow><TableCell sx={{ pl: 0 }} align="right"><strong>{t('platformBilling.charges.total', 'Total')}</strong></TableCell><TableCell align="right" sx={{ pr: 0 }}><strong>{formatDop(charge.total)}</strong></TableCell></TableRow>
              <TableRow><TableCell sx={{ pl: 0 }} align="right">{t('platformBilling.charges.paid', 'Paid')}</TableCell><TableCell align="right" sx={{ pr: 0 }}>{formatDop(charge.paidAmount)}</TableCell></TableRow>
              <TableRow><TableCell sx={{ pl: 0 }} align="right"><strong>{t('platformBilling.charges.balance', 'Balance')}</strong></TableCell><TableCell align="right" sx={{ pr: 0 }}><strong>{formatDop(charge.balance)}</strong></TableCell></TableRow>
            </TableBody>
          </Table>

          <Stack direction="row" spacing={1} sx={{ my: 2 }} flexWrap="wrap" useFlexGap>
            {payable && <Button variant="contained" startIcon={<PaymentsOutlined />} onClick={() => onRecordPayment(charge)}>{t('platformBilling.record.title', 'Record payment')}</Button>}
            {charge.status !== 'void' && <Button variant="outlined" startIcon={<MailOutline />} onClick={notify} disabled={busy}>{t('platformBilling.charges.email', 'Email to tenant')}</Button>}
            {charge.status !== 'void' && charge.paidAmount === 0 && <Button color="error" onClick={() => setVoiding(true)}>{t('platformBilling.charges.void', 'Void charge')}</Button>}
          </Stack>

          <Divider sx={{ mb: 2 }} />
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{t('platformBilling.charges.payments', 'Payments')}</Typography>
          {payments.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t('platformBilling.charges.noPayments', 'No payments recorded.')}</Typography>
          ) : (
            <Table size="small" aria-label={t('platformBilling.charges.payments', 'Payments')}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ pl: 0 }}>{t('platformBilling.payments.date', 'Date')}</TableCell>
                  <TableCell align="right">{t('platformBilling.payments.amount', 'Amount')}</TableCell>
                  <TableCell>{t('platformBilling.payments.ecf', 'e-CF')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id} sx={p.status === 'reversed' ? { opacity: 0.6 } : undefined}>
                    <TableCell sx={{ pl: 0 }}>
                      {formatDate(p.paidAt)}
                      <Typography variant="caption" display="block" color="text.secondary">{t(`platformBilling.methods.${p.method}`, p.method)}{p.reference ? ` · ${p.reference}` : ''}</Typography>
                    </TableCell>
                    <TableCell align="right">{formatDop(p.amount)}</TableCell>
                    <TableCell>
                      <EcfCell payment={p} />
                      {p.ecfError && p.status === 'recorded' && <Typography variant="caption" color="error" display="block">{p.ecfError}</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ pr: 0 }}><PaymentActions payment={p} onChanged={changed} onError={setError} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <Dialog open={voiding} onClose={() => !busy && setVoiding(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('platformBilling.charges.voidTitle', 'Void this charge?')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>{t('platformBilling.charges.voidHelp', 'The tenant no longer owes it. A new charge can be generated for the same month.')}</DialogContentText>
          <TextField autoFocus fullWidth multiline minRows={2} required label={t('platformBilling.payments.reverseReason', 'Reason')} value={reason} onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 500 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoiding(false)} disabled={busy}>{t('platformBilling.common.cancel', 'Cancel')}</Button>
          <Button color="error" variant="contained" onClick={voidIt} disabled={busy || reason.trim().length < 5}>{t('platformBilling.charges.void', 'Void charge')}</Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
};

export default ChargeDrawer;
