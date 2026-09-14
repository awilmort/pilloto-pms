import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, TextField, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Alert, Tooltip, FormControl, InputLabel, Select, MenuItem, Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import BlockIcon from '@mui/icons-material/Block';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../../../lib/permissions';
import { journalEntriesService, accountsService, JournalEntryLineInput } from '../../../services/api';
import { JournalEntry, JournalEntrySource, Account } from '../../../types';
import { formatMoney } from '../../../utils/currency';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type LineType = 'debit' | 'credit';
interface LineForm {
  key: string;
  accountId: string;
  type: LineType;
  amount: string;
  memo: string;
}

let lineKeySeq = 0;
const newLine = (overrides?: Partial<LineForm>): LineForm => ({
  key: `l${++lineKeySeq}`,
  accountId: '',
  type: 'debit',
  amount: '',
  memo: '',
  ...overrides,
});

const emptyCreateState = () => ({
  date: new Date().toISOString().slice(0, 10),
  memo: '',
  lines: [newLine({ type: 'debit' }), newLine({ type: 'credit' })],
});

const SOURCES: JournalEntrySource[] = [
  'manual',
  'invoice_sent', 'invoice_payment', 'invoice_void',
  'bill_received', 'bill_payment', 'bill_void',
  'credit_note_issue', 'credit_note_refund', 'credit_note_void',
  'debit_note_issue', 'debit_note_payment', 'debit_note_void',
];

const accountLabel = (a?: string | Account): string => {
  if (!a || typeof a === 'string') return '—';
  return `${a.code} — ${a.name}`;
};

/**
 * `/accounting/journal-entries` — manual journal entries onto the general ledger
 * (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 9.1). Posts through the same
 * `postJournalEntry` primitive every auto-posting hook uses, with `source: 'manual'`.
 * The create dialog's running balance-check indicator blocks Save client-side the
 * same way the server blocks an unbalanced entry — the list also shows every
 * source (manual and auto-posted) for a unified raw ledger view, but only manual,
 * non-void entries expose a Void action here.
 */
const JournalEntriesContent: React.FC = () => {
  const { t } = useTranslation();
  const canManage = usePermission('accounting.journal.manage');

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<JournalEntrySource | 'all'>('all');
  const [voidFilter, setVoidFilter] = useState<'all' | 'active' | 'void'>('active');

  const [createOpen, setCreateOpen] = useState(false);
  const [createState, setCreateState] = useState(emptyCreateState());
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [viewEntry, setViewEntry] = useState<JournalEntry | null>(null);

  const [voidTarget, setVoidTarget] = useState<JournalEntry | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [entriesRes, accountsRes] = await Promise.all([
        journalEntriesService.getJournalEntries({
          source: sourceFilter === 'all' ? undefined : sourceFilter,
          isVoid: voidFilter === 'all' ? undefined : voidFilter === 'void',
          limit: 200,
        }),
        accountsService.getAccounts(),
      ]);
      setEntries(Array.isArray(entriesRes.data.data) ? entriesRes.data.data : []);
      setAccounts(Array.isArray(accountsRes.data.data) ? accountsRes.data.data : []);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.journalEntries.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, voidFilter, t]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setCreateState(emptyCreateState());
    setCreateError(null);
    setCreateOpen(true);
  };

  const updateLine = (key: string, patch: Partial<LineForm>) => {
    setCreateState((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  };
  const addLine = () => setCreateState((s) => ({ ...s, lines: [...s.lines, newLine()] }));
  const removeLine = (key: string) => setCreateState((s) => ({ ...s, lines: s.lines.length > 2 ? s.lines.filter((l) => l.key !== key) : s.lines }));

  // The running balance-check indicator — computed client-side so it updates live as
  // the user edits, mirroring the server's own `sum(debit) === sum(credit)` guard.
  const balanceCheck = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of createState.lines) {
      const amount = round2(Number(l.amount) || 0);
      if (l.type === 'debit') totalDebit += amount;
      else totalCredit += amount;
    }
    totalDebit = round2(totalDebit);
    totalCredit = round2(totalCredit);
    const diff = round2(totalDebit - totalCredit);
    return { totalDebit, totalCredit, diff, balanced: Math.abs(diff) < 0.005 };
  }, [createState.lines]);

  const handleSave = async () => {
    setCreateError(null);
    if (!createState.memo.trim()) { setCreateError(t('accounting.journalEntries.form.memoRequired')); return; }
    if (createState.lines.length < 2) { setCreateError(t('accounting.journalEntries.form.minLines')); return; }

    const lines: JournalEntryLineInput[] = [];
    for (const l of createState.lines) {
      if (!l.accountId) { setCreateError(t('accounting.journalEntries.form.accountRequired')); return; }
      const amount = Number(l.amount);
      if (!l.amount || amount <= 0) { setCreateError(t('accounting.journalEntries.form.amountRequired')); return; }
      lines.push({
        account: l.accountId,
        debit: l.type === 'debit' ? round2(amount) : 0,
        credit: l.type === 'credit' ? round2(amount) : 0,
        memo: l.memo || undefined,
      });
    }
    if (!balanceCheck.balanced) { setCreateError(t('accounting.journalEntries.form.notBalanced')); return; }

    setSaving(true);
    try {
      await journalEntriesService.createJournalEntry({ date: createState.date, memo: createState.memo.trim(), lines });
      setCreateOpen(false);
      load();
    } catch (e: any) {
      setCreateError(e.response?.data?.message || t('accounting.journalEntries.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (entry: JournalEntry) => {
    try {
      const res = await journalEntriesService.getJournalEntry(entry._id);
      setViewEntry(res.data.data as JournalEntry);
    } catch {
      setViewEntry(entry);
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await journalEntriesService.voidJournalEntry(voidTarget._id, { reason: voidReason || undefined });
      setVoidTarget(null);
      load();
    } catch (e: any) {
      setVoidError(e.response?.data?.message || t('accounting.journalEntries.messages.voidFailed'));
    } finally {
      setVoiding(false);
    }
  };

  const entryTotal = (entry: JournalEntry) => round2(entry.lines.reduce((sum, l) => sum + (l.debit || 0), 0));

  if (loading && entries.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>{t('accounting.journalEntries.loading')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>{t('accounting.journalEntries.table.source')}</InputLabel>
            <Select value={sourceFilter} label={t('accounting.journalEntries.table.source')} onChange={(e) => setSourceFilter(e.target.value as JournalEntrySource | 'all')}>
              <MenuItem value="all">{t('common.all', 'All')}</MenuItem>
              {SOURCES.map((s) => <MenuItem key={s} value={s}>{t(`accounting.journalEntries.source.${s}`, s)}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('accounting.journalEntries.table.status')}</InputLabel>
            <Select value={voidFilter} label={t('accounting.journalEntries.table.status')} onChange={(e) => setVoidFilter(e.target.value as 'all' | 'active' | 'void')}>
              <MenuItem value="active">{t('accounting.journalEntries.status.active')}</MenuItem>
              <MenuItem value="void">{t('accounting.journalEntries.status.void')}</MenuItem>
              <MenuItem value="all">{t('common.all', 'All')}</MenuItem>
            </Select>
          </FormControl>
          {canManage && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ ml: 'auto' }}>
              {t('accounting.journalEntries.actions.create')}
            </Button>
          )}
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.journalEntries.table.number')}</TableCell>
                <TableCell>{t('accounting.journalEntries.table.date')}</TableCell>
                <TableCell>{t('accounting.journalEntries.table.memo')}</TableCell>
                <TableCell>{t('accounting.journalEntries.table.source')}</TableCell>
                <TableCell align="right">{t('accounting.journalEntries.table.total')}</TableCell>
                <TableCell>{t('accounting.journalEntries.table.status')}</TableCell>
                <TableCell align="right">{t('accounting.journalEntries.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center">{t('accounting.journalEntries.empty')}</TableCell></TableRow>
              ) : entries.map((entry) => (
                <TableRow key={entry._id} hover>
                  <TableCell>
                    <Typography component="span" fontWeight={600} sx={{ cursor: 'pointer' }} onClick={() => openView(entry)}>
                      {entry.entryNumber}
                    </Typography>
                  </TableCell>
                  <TableCell>{new Date(entry.date).toLocaleDateString()}</TableCell>
                  <TableCell>{entry.memo}</TableCell>
                  <TableCell>{t(`accounting.journalEntries.source.${entry.source}`, entry.source)}</TableCell>
                  <TableCell align="right">{formatMoney(entryTotal(entry))}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={entry.isVoid ? t('accounting.journalEntries.status.void') : t('accounting.journalEntries.status.posted')}
                      color={entry.isVoid ? 'error' : 'success'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('accounting.journalEntries.actions.view')}>
                      <IconButton size="small" onClick={() => openView(entry)}><VisibilityIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {canManage && entry.source === 'manual' && !entry.isVoid && (
                      <Tooltip title={t('accounting.journalEntries.actions.void')}>
                        <IconButton size="small" color="error" onClick={() => { setVoidError(null); setVoidReason(''); setVoidTarget(entry); }}>
                          <BlockIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Create manual journal entry */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('accounting.journalEntries.dialog.createTitle')}</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 2fr' } }}>
              <TextField label={t('accounting.journalEntries.form.date')} type="date" InputLabelProps={{ shrink: true }} value={createState.date} onChange={(e) => setCreateState((s) => ({ ...s, date: e.target.value }))} />
              <TextField label={t('accounting.journalEntries.form.memo')} value={createState.memo} onChange={(e) => setCreateState((s) => ({ ...s, memo: e.target.value }))} required fullWidth />
            </Box>

            <Divider />
            <Typography variant="subtitle2">{t('accounting.journalEntries.form.lines')}</Typography>

            {createState.lines.map((l) => (
              <Paper key={l.key} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr 2fr auto' }, alignItems: 'center' }}>
                  <FormControl size="small" required fullWidth>
                    <InputLabel>{t('accounting.journalEntries.form.account')}</InputLabel>
                    <Select value={l.accountId} label={t('accounting.journalEntries.form.account')} onChange={(e) => updateLine(l.key, { accountId: e.target.value })}>
                      {accounts.map((a) => <MenuItem key={a._id} value={a._id}>{a.code} — {a.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <InputLabel>{t('accounting.journalEntries.form.type')}</InputLabel>
                    <Select value={l.type} label={t('accounting.journalEntries.form.type')} onChange={(e) => updateLine(l.key, { type: e.target.value as LineType })}>
                      <MenuItem value="debit">{t('accounting.journalEntries.form.debit')}</MenuItem>
                      <MenuItem value="credit">{t('accounting.journalEntries.form.credit')}</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" type="number" label={t('accounting.journalEntries.form.amount')} value={l.amount} onChange={(e) => updateLine(l.key, { amount: e.target.value })} inputProps={{ min: 0, step: 0.01 }} required />
                  <TextField size="small" label={t('accounting.journalEntries.form.lineMemo')} value={l.memo} onChange={(e) => updateLine(l.key, { memo: e.target.value })} fullWidth />
                  <IconButton size="small" onClick={() => removeLine(l.key)} disabled={createState.lines.length <= 2}><DeleteIcon fontSize="small" /></IconButton>
                </Box>
              </Paper>
            ))}
            <Button size="small" startIcon={<AddIcon />} onClick={addLine} sx={{ justifySelf: 'start' }}>{t('accounting.journalEntries.form.addLine')}</Button>

            <Paper variant="outlined" sx={{ p: 2, ml: 'auto', minWidth: 280 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.journalEntries.form.totalDebit')}</Typography><Typography variant="body2">{formatMoney(balanceCheck.totalDebit)}</Typography></Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">{t('accounting.journalEntries.form.totalCredit')}</Typography><Typography variant="body2">{formatMoney(balanceCheck.totalCredit)}</Typography></Box>
              <Divider sx={{ my: 0.5 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography fontWeight={700}>{t('accounting.journalEntries.form.difference')}</Typography>
                <Typography fontWeight={700} color={balanceCheck.balanced ? 'success.main' : 'error.main'}>{formatMoney(balanceCheck.diff)}</Typography>
              </Box>
              <Chip
                size="small"
                sx={{ mt: 1 }}
                label={balanceCheck.balanced ? t('accounting.journalEntries.form.balanced') : t('accounting.journalEntries.form.unbalanced')}
                color={balanceCheck.balanced ? 'success' : 'warning'}
              />
            </Paper>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !balanceCheck.balanced}>
            {saving ? <CircularProgress size={18} /> : t('common.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View journal entry */}
      <Dialog open={!!viewEntry} onClose={() => setViewEntry(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{viewEntry?.entryNumber}</DialogTitle>
        <DialogContent>
          {viewEntry && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1" fontWeight={600}>{viewEntry.memo}</Typography>
                <Chip size="small" label={viewEntry.isVoid ? t('accounting.journalEntries.status.void') : t('accounting.journalEntries.status.posted')} color={viewEntry.isVoid ? 'error' : 'success'} />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {new Date(viewEntry.date).toLocaleDateString()} · {t(`accounting.journalEntries.source.${viewEntry.source}`, viewEntry.source)}
              </Typography>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('accounting.journalEntries.form.account')}</TableCell>
                      <TableCell align="right">{t('accounting.journalEntries.form.debit')}</TableCell>
                      <TableCell align="right">{t('accounting.journalEntries.form.credit')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {viewEntry.lines.map((l, i) => (
                      <TableRow key={l._id || i}>
                        <TableCell>{accountLabel(l.account)}</TableCell>
                        <TableCell align="right">{l.debit > 0 ? formatMoney(l.debit) : ''}</TableCell>
                        <TableCell align="right">{l.credit > 0 ? formatMoney(l.credit) : ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {viewEntry.isVoid && (
                <Alert severity="warning">
                  {t('accounting.journalEntries.dialog.voidedNotice', { date: viewEntry.voidedAt ? new Date(viewEntry.voidedAt).toLocaleDateString() : '' })}
                  {viewEntry.voidReason ? ` — ${viewEntry.voidReason}` : ''}
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewEntry(null)}>{t('common.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Void confirmation */}
      <Dialog open={!!voidTarget} onClose={() => setVoidTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.journalEntries.dialog.voidConfirmTitle')}</DialogTitle>
        <DialogContent>
          {voidError && <Alert severity="error" sx={{ mb: 2 }}>{voidError}</Alert>}
          <Typography variant="body2" sx={{ mb: 2 }}>{t('accounting.journalEntries.dialog.voidConfirmBody', { number: voidTarget?.entryNumber })}</Typography>
          <TextField label={t('accounting.journalEntries.form.voidReason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} fullWidth multiline minRows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleVoid} disabled={voiding}>
            {voiding ? <CircularProgress size={18} /> : t('accounting.journalEntries.actions.void')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default JournalEntriesContent;
