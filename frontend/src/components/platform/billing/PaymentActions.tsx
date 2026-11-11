import React, { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, TextField } from '@mui/material';
import { Code, MailOutline, MoreVert, PictureAsPdfOutlined, ReplayOutlined, SyncOutlined, UndoOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingPayment } from '../../../types/billing';
import { billingErrorMessage, canRetryEcf, downloadBlob, openBlob } from './billingUi';

interface Props {
  payment: BillingPayment;
  /** Called with a message the page shows, and after anything that changed the payment. */
  onChanged: (message?: string) => void;
  onError: (message: string) => void;
}

/** Everything a person can do with a payment and its e-CF, in one menu. */
const PaymentActions: React.FC<Props> = ({ payment, onChanged, onError }) => {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState('');
  const [reverseError, setReverseError] = useState<string | null>(null);

  const hasDocument = Boolean(payment.ecf?.hasDocument);
  const close = () => setAnchor(null);

  const run = async (work: () => Promise<void>) => {
    close();
    setBusy(true);
    try {
      await work();
    } catch (err) {
      onError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const reverse = async () => {
    setBusy(true);
    setReverseError(null);
    try {
      await platformBillingService.reversePayment(payment.id, reason.trim());
      setReversing(false);
      setReason('');
      onChanged(t('platformBilling.payments.reversed', 'Payment reversed.'));
    } catch (err) {
      setReverseError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IconButton size="small" aria-label={t('platformBilling.payments.actions', 'Payment actions')} onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget); }} disabled={busy}>
        <MoreVert fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close} onClick={(e) => e.stopPropagation()}>
        {canRetryEcf(payment) && (
          <MenuItem onClick={() => run(async () => { await platformBillingService.retryEcf(payment.id); onChanged(t('platformBilling.payments.ecfSent', 'e-CF sent.')); })}>
            <ListItemIcon><ReplayOutlined fontSize="small" /></ListItemIcon>
            <ListItemText>{payment.ecf ? t('platformBilling.payments.retryEcf', 'Send or issue the e-CF again') : t('platformBilling.payments.issueEcf', 'Issue e-CF')}</ListItemText>
          </MenuItem>
        )}
        {payment.ecf && (
          <MenuItem onClick={() => run(async () => { await platformBillingService.refreshEcf(payment.id); onChanged(); })}>
            <ListItemIcon><SyncOutlined fontSize="small" /></ListItemIcon>
            <ListItemText>{t('platformBilling.payments.refreshEcf', 'Check DGII status')}</ListItemText>
          </MenuItem>
        )}
        {hasDocument && (
          <MenuItem onClick={() => run(async () => openBlob((await platformBillingService.ecfPdf(payment.id)).data))}>
            <ListItemIcon><PictureAsPdfOutlined fontSize="small" /></ListItemIcon>
            <ListItemText>{t('platformBilling.payments.viewPdf', 'View PDF')}</ListItemText>
          </MenuItem>
        )}
        {hasDocument && (
          <MenuItem onClick={() => run(async () => downloadBlob((await platformBillingService.ecfXml(payment.id)).data, `${payment.ecf!.eNCF ?? payment.id}.xml`))}>
            <ListItemIcon><Code fontSize="small" /></ListItemIcon>
            <ListItemText>{t('platformBilling.payments.downloadXml', 'Download XML')}</ListItemText>
          </MenuItem>
        )}
        {hasDocument && (
          <MenuItem onClick={() => run(async () => { await platformBillingService.emailEcf(payment.id); onChanged(t('platformBilling.payments.emailed', 'e-CF emailed to the tenant.')); })}>
            <ListItemIcon><MailOutline fontSize="small" /></ListItemIcon>
            <ListItemText>{t('platformBilling.payments.emailEcf', 'Email e-CF to the tenant')}</ListItemText>
          </MenuItem>
        )}
        {payment.status === 'recorded' && (
          <MenuItem onClick={() => { close(); setReversing(true); }}>
            <ListItemIcon><UndoOutlined fontSize="small" color="error" /></ListItemIcon>
            <ListItemText sx={{ color: 'error.main' }}>{t('platformBilling.payments.reverse', 'Reverse payment')}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <Dialog open={reversing} onClose={() => !busy && setReversing(false)} fullWidth maxWidth="sm" onClick={(e) => e.stopPropagation()}>
        <DialogTitle>{t('platformBilling.payments.reverseTitle', 'Reverse this payment?')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {payment.ecf?.estado === 'Aceptado' || payment.ecf?.estado === 'Aceptado Condicional'
              ? t('platformBilling.payments.reverseWithNote', 'The charge becomes payable again, and a credit note (E34) cancels the e-CF that was issued for it.')
              : t('platformBilling.payments.reverseSimple', 'The charge becomes payable again.')}
          </DialogContentText>
          {reverseError && <Alert severity="error" sx={{ mb: 2 }}>{reverseError}</Alert>}
          <TextField
            autoFocus fullWidth multiline minRows={2} required label={t('platformBilling.payments.reverseReason', 'Reason')}
            value={reason} onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 500 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReversing(false)} disabled={busy}>{t('platformBilling.common.cancel', 'Cancel')}</Button>
          <Button color="error" variant="contained" onClick={reverse} disabled={busy || reason.trim().length < 5}>
            {t('platformBilling.payments.reverse', 'Reverse payment')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default PaymentActions;
