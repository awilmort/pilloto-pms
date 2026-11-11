import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { FiscalSequence } from '../../types';
import { chipTone, errorFields, fiscalErrorMessage, formatDate, formatInt } from './fiscalUi';
import i18n from '../../i18n';

/** Types whose ranges never expire (consumer invoices and credit notes). */
const NO_EXPIRY = ['32', '34'];
const TYPES = ['31', '32', '33', '34', '41', '43', '44', '45', '46', '47'];
const LOW_SHARE = 0.1;

interface Props {
  canManage: boolean;
}

/**
 * The e-NCF ranges DGII authorized the company. Every document takes its number from one, so a
 * range running out stops invoicing: low ranges are flagged here and by email. Recording a range
 * is done once DGII grants it, from whichever app.
 */
const FiscalSequencesTab: React.FC<Props> = ({ canManage }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<FiscalSequence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'record' | 'annul' | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await fiscalService.getSequences()).data.data as FiscalSequence[]);
      setError(null);
    } catch (err) {
      setError(fiscalErrorMessage(err, t));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 640 }}>
          {t('fiscal.sequences.intro', 'The e-NCF numbers DGII authorized you to issue, by document type. Request new ranges in DGII’s Oficina Virtual and record them here.')}
        </Typography>
        {canManage && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" onClick={() => setDialog('annul')}>{t('fiscal.sequences.annul', 'Cancel unused numbers')}</Button>
            <Button variant="contained" size="small" onClick={() => setDialog('record')}>{t('fiscal.sequences.record', 'Record a range')}</Button>
          </Stack>
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" aria-label={t('fiscal.sequences.tableLabel', 'e-NCF ranges')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('fiscal.documents.type', 'Type')}</TableCell>
                <TableCell>{t('fiscal.sequences.range', 'Range')}</TableCell>
                <TableCell>{t('fiscal.sequences.next', 'Next number')}</TableCell>
                <TableCell sx={{ minWidth: 180 }}>{t('fiscal.sequences.remaining', 'Remaining')}</TableCell>
                <TableCell>{t('fiscal.sequences.expires', 'Expires')}</TableCell>
                <TableCell>{t('fiscal.documents.status', 'Status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!rows && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5 }}><CircularProgress size={24} /></TableCell></TableRow>}
              {rows?.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5 }}>
                  <Typography color="text.secondary">{t('fiscal.sequences.empty', 'No ranges recorded yet. Without one, no e-CF can be numbered.')}</Typography>
                </TableCell></TableRow>
              )}
              {rows?.map((s) => {
                const size = s.rangeEnd - s.rangeStart + 1;
                const share = size > 0 ? s.remaining / size : 0;
                const low = s.usable && share <= LOW_SHARE;
                return (
                  <TableRow key={s.id}>
                    <TableCell>{t(`fiscal.tipo.E${s.documentType}`, s.documentType)}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{formatInt(s.rangeStart)} – {formatInt(s.rangeEnd)}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{s.next > s.rangeEnd ? '—' : formatInt(s.next)}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{formatInt(s.remaining)}</Typography>
                      <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, share * 100))} color={low ? 'warning' : 'primary'} aria-label={t('fiscal.sequences.remaining', 'Remaining')} sx={{ height: 5, borderRadius: 3, mt: 0.5 }} />
                    </TableCell>
                    <TableCell>{s.expiresOn ? formatDate(s.expiresOn, i18n.language) : t('fiscal.sequences.never', 'Does not expire')}</TableCell>
                    <TableCell>
                      {s.usable ? <Chip size="small" {...chipTone(low ? 'warning' : 'success')} label={low ? t('fiscal.sequences.low', 'Running low') : t('fiscal.sequences.inUse', 'Usable')} />
                        : <Chip size="small" variant="outlined" label={s.remaining === 0 ? t('fiscal.sequences.exhausted', 'Used up') : t('fiscal.sequences.unusable', 'Not usable')} />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {dialog === 'record' && <RecordDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} />}
      {dialog === 'annul' && <AnnulDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} />}
    </Box>
  );
};

const TypeSelect: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <TextField select fullWidth size="small" label={t('fiscal.documents.type', 'Type')} value={value} onChange={(e) => onChange(e.target.value)}>
      {TYPES.map((x) => <MenuItem key={x} value={x}>{t(`fiscal.tipo.E${x}`, x)}</MenuItem>)}
    </TextField>
  );
};

const RecordDialog: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const { t } = useTranslation();
  const [type, setType] = useState('32');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const needsExpiry = !NO_EXPIRY.includes(type);
  const s = Number(start);
  const e = Number(end);
  const valid = Number.isInteger(s) && Number.isInteger(e) && s >= 1 && e >= s && (!needsExpiry || Boolean(expires));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await fiscalService.recordSequence({ documentType: type, rangeStart: s, rangeEnd: e, ...(needsExpiry ? { expiresOn: expires } : {}) });
      onDone();
    } catch (err) {
      setFields(errorFields(err));
      setError(fiscalErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="xs" fullWidth aria-labelledby="record-seq-title">
      <DialogTitle id="record-seq-title">{t('fiscal.sequences.recordTitle', 'Record an authorized range')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TypeSelect value={type} onChange={(v) => { setType(v); setExpires(''); }} />
          <Stack direction="row" spacing={1.5}>
            <TextField fullWidth size="small" type="number" label={t('fiscal.sequences.from', 'From')} value={start} onChange={(x) => setStart(x.target.value)} error={Boolean(fields.rangeStart)} helperText={fields.rangeStart} inputProps={{ min: 1 }} />
            <TextField fullWidth size="small" type="number" label={t('fiscal.sequences.to', 'To')} value={end} onChange={(x) => setEnd(x.target.value)} error={Boolean(fields.rangeEnd) || (start !== '' && end !== '' && e < s)} helperText={fields.rangeEnd} inputProps={{ min: 1 }} />
          </Stack>
          {needsExpiry ? (
            <TextField fullWidth size="small" type="date" required label={t('fiscal.sequences.expiresOn', 'Last valid day')} value={expires} onChange={(x) => setExpires(x.target.value)} InputLabelProps={{ shrink: true }} error={Boolean(fields.expiresOn)} helperText={fields.expiresOn || t('fiscal.sequences.expiresHelp', 'As DGII granted it.')} />
          ) : (
            <Typography variant="caption" color="text.secondary">{t('fiscal.sequences.noExpiry', 'Ranges for this type do not expire.')}</Typography>
          )}
          <Alert severity="info">{t('fiscal.sequences.continueNote', 'Already used part of this range with another provider? Record only the part still unused, starting from the next number, so no number is issued twice.')}</Alert>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={submit} disabled={!valid || busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>{t('fiscal.sequences.save', 'Record')}</Button>
      </DialogActions>
    </Dialog>
  );
};

const AnnulDialog: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const { t } = useTranslation();
  const [type, setType] = useState('32');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const f = Number(from);
  const l = Number(to);
  const valid = Number.isInteger(f) && Number.isInteger(l) && f >= 1 && l >= f;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fiscalService.annulSequences([{ documentType: type, from: f, to: l }]);
      setDone(res.data.data?.count ?? 0);
    } catch (err) {
      setError(fiscalErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="xs" fullWidth aria-labelledby="annul-seq-title">
      <DialogTitle id="annul-seq-title">{t('fiscal.sequences.annulTitle', 'Cancel unused numbers')}</DialogTitle>
      <DialogContent>
        {done === null ? (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Alert severity="warning">{t('fiscal.sequences.annulNote', 'Tell DGII these numbers will not be used. It cannot be undone, and a number already sent to DGII is voided with a credit note instead.')}</Alert>
            <TypeSelect value={type} onChange={setType} />
            <Stack direction="row" spacing={1.5}>
              <TextField fullWidth size="small" type="number" label={t('fiscal.sequences.from', 'From')} value={from} onChange={(x) => setFrom(x.target.value)} inputProps={{ min: 1 }} />
              <TextField fullWidth size="small" type="number" label={t('fiscal.sequences.to', 'To')} value={to} onChange={(x) => setTo(x.target.value)} inputProps={{ min: 1 }} />
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        ) : (
          <Alert severity="success" sx={{ mt: 0.5 }}>{t('fiscal.sequences.annulDone', { count: done, defaultValue: '{{count}} number(s) cancelled with DGII.' })}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        {done === null ? (
          <>
            <Button onClick={onClose} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
            <Button color="error" variant="contained" onClick={submit} disabled={!valid || busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>{t('fiscal.sequences.annulConfirm', 'Cancel these numbers')}</Button>
          </>
        ) : <Button variant="contained" onClick={onDone}>{t('common.close', 'Close')}</Button>}
      </DialogActions>
    </Dialog>
  );
};

export default FiscalSequencesTab;
