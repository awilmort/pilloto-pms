import React, { useMemo, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';
import { fiscalService, FiscalOtherLine } from '../../services/api';
import type { ElectronicInvoice } from '../../types';
import EcfStatusBadge from '../admin/EcfStatusBadge';
import { errorFields, fiscalErrorMessage, formatDop } from './fiscalUi';
import { INCOME_TYPES, lineTotal, OTHER_TYPE_RULES, OtherType, Tax } from './otherTypes';
import i18n from '../../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  onIssued: (doc: ElectronicInvoice, queued: boolean) => void;
}

interface Line { name: string; kind: 'good' | 'service'; quantity: string; unitPrice: string; tax: Tax; itbisHeld: string; isrHeld: string }

const emptyLine = (rules: typeof OTHER_TYPE_RULES[OtherType]): Line => ({
  name: '', kind: rules.kinds[0], quantity: '1', unitPrice: '', tax: rules.taxes[0], itbisHeld: '', isrHeld: '',
});

/** Purchases, minor expenses, special-regime, government, export and foreign-payment documents (41–47). */
const FiscalOtherDocumentDialog: React.FC<Props> = ({ open, onClose, onIssued }) => {
  const { t } = useTranslation();
  const [type, setType] = useState<OtherType>('43');
  const rules = OTHER_TYPE_RULES[type];
  const [lines, setLines] = useState<Line[]>([emptyLine(OTHER_TYPE_RULES['43'])]);
  const [buyer, setBuyer] = useState({ name: '', id: '', idKind: 'rnc' as 'rnc' | 'foreignId', email: '' });
  const [incomeType, setIncomeType] = useState('01');
  const [credit, setCredit] = useState(false);
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ doc: ElectronicInvoice; queued: boolean } | null>(null);

  const changeType = (next: OtherType) => {
    const r = OTHER_TYPE_RULES[next];
    setType(next);
    setLines([emptyLine(r)]);
    setBuyer((b) => ({ ...b, idKind: r.ids.includes(b.idKind) ? b.idKind : r.ids[0] ?? 'rnc' }));
    setCredit(false);
    setError(null);
    setFields({});
  };

  const totals = useMemo(() => lines.reduce((a, l) => {
    const x = lineTotal(l.quantity, l.unitPrice, l.tax);
    return { net: a.net + x.net, itbis: a.itbis + x.itbis };
  }, { net: 0, itbis: 0 }), [lines]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const linesOk = lines.every((l) => l.name.trim() && Number(l.quantity) > 0 && Number(l.unitPrice) > 0);
  const buyerOk = rules.buyer === 'forbidden' || (rules.buyer === 'optional' && !buyer.name.trim() && !buyer.id.trim())
    || (Boolean(buyer.name.trim()) && (!rules.idRequired || Boolean(buyer.id.replace(/\D/g, '') || (buyer.idKind === 'foreignId' && buyer.id.trim()))));
  const canSubmit = linesOk && buyerOk && (!credit || Boolean(dueOn)) && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    const body: Parameters<typeof fiscalService.issueOther>[0] = {
      type,
      ...(rules.incomeType ? { incomeType } : {}),
      payment: credit ? { type: 'credit', dueOn } : { type: 'cash' },
      lines: lines.map((l): FiscalOtherLine => ({
        name: l.name.trim(), kind: l.kind, quantity: l.quantity, unitPrice: l.unitPrice, tax: l.tax,
        ...(rules.withholding.required || l.itbisHeld || l.isrHeld
          ? { withholding: { ...(rules.withholding.itbis ? { itbis: l.itbisHeld || '0.00' } : {}), ...(rules.withholding.isr ? { isr: l.isrHeld || '0.00' } : {}) } }
          : {}),
      })),
    };
    if (rules.buyer !== 'forbidden' && buyer.name.trim()) {
      body.buyer = {
        name: buyer.name.trim(),
        ...(buyer.id.trim() ? (buyer.idKind === 'rnc' ? { rnc: buyer.id.replace(/\D/g, '') } : { foreignId: buyer.id.trim() }) : {}),
        ...(buyer.email.trim() ? { email: buyer.email.trim() } : {}),
      };
    }
    try {
      const res = await fiscalService.issueOther(body);
      setResult({ doc: res.data.data, queued: Boolean(res.data.queued) });
      onIssued(res.data.data, Boolean(res.data.queued));
    } catch (err) {
      setFields(errorFields(err));
      setError(fiscalErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth aria-labelledby="fiscal-other-title">
      <DialogTitle id="fiscal-other-title">{t('fiscal.other.title', 'Other document types')}</DialogTitle>
      <DialogContent dividers>
        {result ? (
          <Stack spacing={2}>
            <Alert severity={result.queued ? 'info' : 'success'}>
              {result.queued ? t('fiscal.note.queued', 'Saved. BillingSoft could not be reached, so it will be sent automatically in a moment.') : t('fiscal.other.issued', 'The document was issued and sent to DGII.')}
            </Alert>
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography fontFamily="monospace" fontWeight={700}>{result.doc.eNCF ?? t('fiscal.documents.noEncf', 'Number pending')}</Typography>
              <EcfStatusBadge status={result.doc.estadoECF} />
              <Typography>{formatDop(result.doc.totalFactura, i18n.language)}</Typography>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={2.5}>
            <TextField select size="small" label={t('fiscal.documents.type', 'Type')} value={type} onChange={(e) => changeType(e.target.value as OtherType)} sx={{ maxWidth: 420 }}>
              {(Object.keys(OTHER_TYPE_RULES) as OtherType[]).map((x) => <MenuItem key={x} value={x}>{t(`fiscal.tipo.E${x}`, x)}</MenuItem>)}
            </TextField>
            <Typography variant="body2" color="text.secondary">{t(`fiscal.other.help.${type}`, '')}</Typography>

            {rules.buyer !== 'forbidden' && (
              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  {type === '41' ? t('fiscal.other.seller', 'Seller') : t('fiscal.other.counterparty', 'Counterparty')}
                  {rules.buyer === 'optional' && <Typography component="span" variant="caption" color="text.secondary"> · {t('fiscal.other.optional', 'optional')}</Typography>}
                </Typography>
                <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1.4fr' } }}>
                  <TextField size="small" label={t('fiscal.other.name', 'Name')} value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} error={Boolean(fields['buyer.name'])} helperText={fields['buyer.name']} />
                  <Stack direction="row" spacing={1}>
                    {rules.ids.length > 1 && (
                      <TextField select size="small" value={buyer.idKind} onChange={(e) => setBuyer({ ...buyer, idKind: e.target.value as 'rnc' | 'foreignId' })} sx={{ minWidth: 92 }} inputProps={{ 'aria-label': t('fiscal.other.idKind', 'Identification type') }}>
                        <MenuItem value="rnc">RNC</MenuItem>
                        <MenuItem value="foreignId">{t('fiscal.other.foreignId', 'Foreign ID')}</MenuItem>
                      </TextField>
                    )}
                    <TextField size="small" fullWidth label={buyer.idKind === 'rnc' ? 'RNC' : t('fiscal.other.foreignId', 'Foreign ID')} value={buyer.id} onChange={(e) => setBuyer({ ...buyer, id: e.target.value })} error={Boolean(fields['buyer.rnc'] || fields['buyer.foreignId'])} helperText={fields['buyer.rnc'] || fields['buyer.foreignId']} />
                  </Stack>
                  <TextField size="small" type="email" label={t('fiscal.other.email', 'Email')} value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} />
                </Box>
              </Box>
            )}

            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('fiscal.other.lines', 'Items')}</Typography>
              <Stack spacing={1.5}>
                {lines.map((l, i) => (
                  <Box key={i} sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr 1fr', md: `2.4fr${rules.kinds.length > 1 ? ' 1fr' : ''} 0.8fr 1fr 1.1fr${rules.withholding.itbis ? ' 1fr' : ''}${rules.withholding.isr ? ' 1fr' : ''} auto` }, alignItems: 'start' }}>
                    <TextField size="small" label={t('fiscal.other.description', 'Description')} value={l.name} onChange={(e) => setLine(i, { name: e.target.value.slice(0, 80) })} sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }} />
                    {rules.kinds.length > 1 && (
                      <TextField select size="small" label={t('fiscal.other.kind', 'Kind')} value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as Line['kind'] })}>
                        <MenuItem value="service">{t('fiscal.other.kindService', 'Service')}</MenuItem>
                        <MenuItem value="good">{t('fiscal.other.kindGood', 'Good')}</MenuItem>
                      </TextField>
                    )}
                    <TextField size="small" type="number" label={t('fiscal.other.qty', 'Qty')} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} inputProps={{ min: 0.01, step: 0.01 }} />
                    <TextField size="small" type="number" label={t('fiscal.other.price', 'Unit price')} value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} inputProps={{ min: 0, step: 0.01 }} />
                    <TextField select size="small" label="ITBIS" value={l.tax} onChange={(e) => setLine(i, { tax: e.target.value as Tax })} disabled={rules.taxes.length === 1}>
                      {rules.taxes.map((x) => <MenuItem key={x} value={x}>{t(`fiscal.other.tax.${x}`, x)}</MenuItem>)}
                    </TextField>
                    {rules.withholding.itbis && <TextField size="small" type="number" label={t('fiscal.other.itbisHeld', 'ITBIS withheld')} value={l.itbisHeld} onChange={(e) => setLine(i, { itbisHeld: e.target.value })} inputProps={{ min: 0, step: 0.01 }} />}
                    {rules.withholding.isr && <TextField size="small" type="number" label={t('fiscal.other.isrHeld', 'ISR withheld')} value={l.isrHeld} onChange={(e) => setLine(i, { isrHeld: e.target.value })} inputProps={{ min: 0, step: 0.01 }} />}
                    <IconButton aria-label={t('fiscal.other.removeLine', 'Remove item')} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} disabled={lines.length === 1}><DeleteOutlineIcon /></IconButton>
                  </Box>
                ))}
              </Stack>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, emptyLine(rules)])} sx={{ mt: 1 }}>{t('fiscal.other.addLine', 'Add item')}</Button>
            </Box>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
              {rules.incomeType && (
                <TextField select size="small" label={t('fiscal.other.incomeType', 'Type of income')} value={incomeType} onChange={(e) => setIncomeType(e.target.value)} sx={{ minWidth: 260 }}>
                  {INCOME_TYPES.map((x) => <MenuItem key={x} value={x}>{t(`fiscal.other.income.${x}`, x)}</MenuItem>)}
                </TextField>
              )}
              {rules.credit && (
                <>
                  <TextField select size="small" label={t('fiscal.other.payment', 'Payment')} value={credit ? 'credit' : 'cash'} onChange={(e) => setCredit(e.target.value === 'credit')} sx={{ minWidth: 160 }}>
                    <MenuItem value="cash">{t('fiscal.other.cash', 'Cash')}</MenuItem>
                    <MenuItem value="credit">{t('fiscal.other.credit', 'Credit')}</MenuItem>
                  </TextField>
                  {credit && <TextField size="small" type="date" required label={t('fiscal.other.dueOn', 'Due on')} value={dueOn} onChange={(e) => setDueOn(e.target.value)} InputLabelProps={{ shrink: true }} />}
                </>
              )}
              <Box sx={{ flex: 1 }} />
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary">{t('fiscal.documents.total', 'Total')}</Typography>
                <Typography variant="h6" fontWeight={700}>{formatDop(totals.net + totals.itbis, i18n.language)}</Typography>
              </Box>
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {result ? <Button variant="contained" onClick={close}>{t('common.close', 'Close')}</Button> : (
          <>
            <Button onClick={close} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
            <Button variant="contained" onClick={submit} disabled={!canSubmit} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>{t('fiscal.other.issue', 'Issue document')}</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default FiscalOtherDocumentDialog;
