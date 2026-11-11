import React, { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fiscalErrorMessage } from '../../fiscal/fiscalUi';
import { invoicesService } from '../../../services/api';
import type { Invoice, InvoicePaymentMethod } from '../../../types';
import { formatAccountingMoneyExact as formatMoney } from '../../../utils/currency';
import PdfPreviewDialog from './PdfPreviewDialog';

const PAYMENT_METHODS: InvoicePaymentMethod[] = ['cash', 'card', 'transfer', 'check', 'credit'];

/**
 * The invoice lifecycle actions that need a confirmation or a small form — issue (send to DGII),
 * record a payment, void — plus the PDF preview, shared by the list and the detail page. The caller
 * gets openers and a `dialogs` element to render once; `onChanged(invoice?)` fires after any change.
 */
export function useInvoiceActions(onChanged: (invoice?: Invoice, info?: { queued?: boolean }) => void) {
  const { t } = useTranslation();

  const [sendTarget, setSendTarget] = useState<Invoice | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [paymentTarget, setPaymentTarget] = useState<Invoice | null>(null);
  const [payment, setPayment] = useState({ amount: '', method: 'cash' as InvoicePaymentMethod, date: '', reference: '' });
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const [pdfTarget, setPdfTarget] = useState<Invoice | null>(null);

  const openSend = (inv: Invoice) => { setSendError(null); setSendTarget(inv); };
  const openPayment = (inv: Invoice) => {
    setPaymentTarget(inv);
    setPayment({ amount: String(inv.balanceDue || ''), method: 'cash', date: '', reference: '' });
    setPaymentError(null);
  };
  const openVoid = (inv: Invoice) => { setVoidError(null); setVoidTarget(inv); };
  const openPdf = (inv: Invoice) => setPdfTarget(inv);

  const doSend = async () => {
    if (!sendTarget) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await invoicesService.sendInvoice(sendTarget._id);
      setSendTarget(null);
      onChanged(res.data.data?.invoice, { queued: Boolean((res.data as { queued?: boolean }).queued) });
    } catch (e: any) {
      setSendError(fiscalErrorMessage(e, t));
    } finally {
      setSending(false);
    }
  };

  const doPayment = async () => {
    if (!paymentTarget) return;
    const amount = Number(payment.amount);
    if (!amount || amount <= 0) { setPaymentError(t('accounting.invoices.form.paymentAmountRequired')); return; }
    setRecording(true);
    setPaymentError(null);
    try {
      const res = await invoicesService.recordPayment(paymentTarget._id, {
        amount, method: payment.method, date: payment.date || undefined, reference: payment.reference || undefined,
      });
      setPaymentTarget(null);
      onChanged(res.data.data);
    } catch (e: any) {
      setPaymentError(e.response?.data?.message || t('accounting.invoices.messages.paymentFailed'));
    } finally {
      setRecording(false);
    }
  };

  const doVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    setVoidError(null);
    try {
      const res = await invoicesService.voidInvoice(voidTarget._id);
      setVoidTarget(null);
      onChanged(res.data.data);
    } catch (e: any) {
      setVoidError(e.response?.data?.message || t('accounting.invoices.messages.voidFailed'));
    } finally {
      setVoiding(false);
    }
  };

  const dialogs = (
    <>
      <Dialog open={!!sendTarget} onClose={() => !sending && setSendTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.invoices.dialog.sendConfirmTitle')}</DialogTitle>
        <DialogContent>
          {sendError && <Alert severity="error" sx={{ mb: 2 }}>{sendError}</Alert>}
          <Typography variant="body2" sx={{ mb: 1.5 }}>{t('accounting.invoices.dialog.sendConfirmBody', { number: sendTarget?.invoiceNumber })}</Typography>
          <Typography variant="body2" color="text.secondary">{t('accounting.invoices.dialog.sendConsequences')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSendTarget(null)} disabled={sending}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={doSend} disabled={sending}>{sending ? <CircularProgress size={18} /> : t('accounting.invoices.actions.send')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!paymentTarget} onClose={() => !recording && setPaymentTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.invoices.dialog.paymentTitle', { number: paymentTarget?.invoiceNumber })}</DialogTitle>
        <DialogContent>
          {paymentError && <Alert severity="error" sx={{ mb: 2 }}>{paymentError}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('accounting.invoices.table.balanceDue')}: <strong>{formatMoney(paymentTarget?.balanceDue)}</strong>
          </Typography>
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField label={t('accounting.invoices.form.paymentAmount')} type="number" value={payment.amount} autoFocus required inputProps={{ min: 0, step: 0.01 }}
              onChange={(e) => setPayment((f) => ({ ...f, amount: e.target.value }))} />
            <FormControl fullWidth>
              <InputLabel>{t('accounting.invoices.form.paymentMethod')}</InputLabel>
              <Select value={payment.method} label={t('accounting.invoices.form.paymentMethod')} onChange={(e) => setPayment((f) => ({ ...f, method: e.target.value as InvoicePaymentMethod }))}>
                {PAYMENT_METHODS.map((m) => <MenuItem key={m} value={m}>{t(`accounting.invoices.paymentMethod.${m}`)}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label={t('accounting.invoices.form.paymentDate')} type="date" InputLabelProps={{ shrink: true }} value={payment.date} onChange={(e) => setPayment((f) => ({ ...f, date: e.target.value }))} helperText={t('accounting.invoices.form.paymentDateHelp')} />
            <TextField label={t('accounting.invoices.form.paymentReference')} value={payment.reference} onChange={(e) => setPayment((f) => ({ ...f, reference: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentTarget(null)} disabled={recording}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={doPayment} disabled={recording}>{recording ? <CircularProgress size={18} /> : t('accounting.invoices.actions.recordPayment')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!voidTarget} onClose={() => !voiding && setVoidTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.invoices.dialog.voidConfirmTitle')}</DialogTitle>
        <DialogContent>
          {voidError && <Alert severity="error" sx={{ mb: 2 }}>{voidError}</Alert>}
          <Typography variant="body2">{t('accounting.invoices.dialog.voidConfirmBody', { number: voidTarget?.invoiceNumber })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidTarget(null)} disabled={voiding}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={doVoid} disabled={voiding}>{voiding ? <CircularProgress size={18} /> : t('accounting.invoices.actions.void')}</Button>
        </DialogActions>
      </Dialog>

      <PdfPreviewDialog
        open={!!pdfTarget}
        onClose={() => setPdfTarget(null)}
        title={t('accounting.invoices.pdf.title', { number: pdfTarget?.invoiceNumber })}
        fileName={`Factura-${pdfTarget?.invoiceNumber ?? 'invoice'}.pdf`}
        fetchPdf={() => invoicesService.getPdfBlob(pdfTarget!._id)}
      />
    </>
  );

  return { openSend, openPayment, openVoid, openPdf, dialogs };
}
