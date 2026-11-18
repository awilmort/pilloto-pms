import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, Grid,
  IconButton, InputLabel, MenuItem, Paper, Select, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { Add, UploadFile, Link as LinkIcon, LinkOff, Block, PostAdd, DeleteOutline, Star } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import { usePermission } from '../../lib/permissions';
import { accountsService } from '../../services/api';
import { BankAccountView, BookLine, bankService, ReconciliationView, StatementLine } from '../../services/bankApi';
import BankImportDialog from '../../components/accounting/banks/BankImportDialog';
import { formatAccountingMoney as formatMoney } from '../../utils/currency';
import type { Account } from '../../types';

const STATUS_COLOR = { unmatched: 'warning', matched: 'success', ignored: 'default' } as const;
const todayDr = () => new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);

/**
 * `/accounting/banks` — bank accounts, their statement movements matched against the books, and
 * the monthly reconciliation (Esencial plan and up).
 */
const BanksPage: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('accounting.banks.title', 'Banks'));
  const canManage = usePermission('accounting.banks.manage');
  const [accounts, setAccounts] = useState<BankAccountView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'movements' | 'reconciliation'>('movements');
  const [lines, setLines] = useState<StatementLine[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'unmatched'>('unmatched');
  const [rec, setRec] = useState<{ open: ReconciliationView | null; lastClosed: ReconciliationView['reconciliation'] | null } | null>(null);
  const [glAccounts, setGlAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', bankName: '', accountNumberLast4: '', currency: 'DOP' });
  const [importOpen, setImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ date: todayDr(), description: '', amount: '', reference: '' });
  const [entryFor, setEntryFor] = useState<StatementLine | null>(null);
  const [entryForm, setEntryForm] = useState({ account: '', memo: '' });
  const [matchFor, setMatchFor] = useState<StatementLine | null>(null);
  const [book, setBook] = useState<BookLine[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [recForm, setRecForm] = useState({ statementDate: todayDr(), statementEndingBalance: '', openingBalance: '' });

  const fail = useCallback((e: any) => setError(e?.response?.data?.message || t('accounting.banks.failed', 'The action failed')), [t]);

  const loadAccounts = useCallback(async () => {
    try {
      const r = await bankService.list();
      setAccounts(r.data.data);
      setSelected((s) => s ?? r.data.data.find((a) => a.isDefault)?._id ?? r.data.data[0]?._id ?? null);
    } catch (e) { fail(e); }
  }, [fail]);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    try {
      const [l, r] = await Promise.all([bankService.lines(selected, filter === 'unmatched' ? { status: 'unmatched' } : undefined), bankService.reconciliation(selected)]);
      setLines(l.data.data);
      setRec(r.data.data);
    } catch (e) { fail(e); }
  }, [selected, filter, fail]);

  useEffect(() => { loadAccounts(); accountsService.getAccounts({ active: true }).then((r) => setGlAccounts(r.data.data ?? [])).catch(() => undefined); }, [loadAccounts]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const current = useMemo(() => accounts?.find((a) => a._id === selected) ?? null, [accounts, selected]);
  const refresh = async (message?: string) => { if (message) setNotice(message); await Promise.all([loadAccounts(), loadDetail()]); };
  const run = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError(null);
    try { await fn(); await refresh(message); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const openMatch = async (line: StatementLine) => {
    if (!selected) return;
    setMatchFor(line);
    setPicked([]);
    const r = await bankService.bookLines(selected, { uncleared: true });
    setBook(r.data.data);
  };
  const pickedSum = book.filter((b) => picked.includes(b.line)).reduce((s, b) => s + b.amount, 0);

  if (!accounts) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {accounts.filter((a) => a.isActive).map((a) => (
          <Grid item xs={12} sm={6} md={4} key={a._id}>
            <Paper variant="outlined" onClick={() => setSelected(a._id)} sx={{ p: 2, cursor: 'pointer', borderColor: a._id === selected ? 'primary.main' : 'divider', borderWidth: a._id === selected ? 2 : 1 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={700}>{a.name}{a.accountNumberLast4 ? ` ···${a.accountNumberLast4}` : ''}</Typography>
                {a.isDefault && <Chip size="small" icon={<Star fontSize="small" />} label={t('accounting.banks.default', 'Default')} />}
              </Stack>
              <Typography variant="caption" color="text.secondary">{a.bankName || a.glAccount.name} · {a.glAccount.code} · {a.currency}</Typography>
              <Typography variant="h6" fontWeight={800} sx={{ mt: 1 }}>{formatMoney(a.balance)}</Typography>
              <Typography variant="caption" color={a.unmatched ? 'warning.main' : 'text.secondary'}>
                {a.unmatched ? t('accounting.banks.toReview', '{{count}} movements to review', { count: a.unmatched }) : t('accounting.banks.upToDate', 'All movements reviewed')}
                {a.lastReconciled ? ` · ${t('accounting.banks.reconciledTo', 'reconciled to {{date}}', { date: a.lastReconciled })}` : ''}
              </Typography>
            </Paper>
          </Grid>
        ))}
        {canManage && (
          <Grid item xs={12} sm={6} md={4}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%', borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Button startIcon={<Add />} onClick={() => setNewOpen(true)}>{t('accounting.banks.new', 'Add bank account')}</Button>
            </Paper>
          </Grid>
        )}
      </Grid>

      {current && (
        <Paper variant="outlined">
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ px: 2, pt: 1 }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab value="movements" label={t('accounting.banks.tabs.movements', 'Bank movements')} />
              <Tab value="reconciliation" label={t('accounting.banks.tabs.reconciliation', 'Reconciliation')} />
            </Tabs>
            {canManage && tab === 'movements' && (
              <Stack direction="row" spacing={1} sx={{ py: 1 }}>
                {!current.isDefault && <Button size="small" onClick={() => run(() => bankService.update(current._id, { isDefault: true }), t('accounting.banks.madeDefault', 'Default account changed.'))}>{t('accounting.banks.makeDefault', 'Make default')}</Button>}
                <Button size="small" startIcon={<Add />} onClick={() => setManualOpen(true)}>{t('accounting.banks.addLine', 'Add movement')}</Button>
                <Button size="small" variant="contained" startIcon={<UploadFile />} onClick={() => setImportOpen(true)}>{t('accounting.banks.import.open', 'Import statement')}</Button>
              </Stack>
            )}
          </Stack>

          {tab === 'movements' && (
            <Box sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                <Chip label={t('accounting.banks.filter.unmatched', 'To review')} color={filter === 'unmatched' ? 'primary' : 'default'} onClick={() => setFilter('unmatched')} />
                <Chip label={t('accounting.banks.filter.all', 'All')} color={filter === 'all' ? 'primary' : 'default'} onClick={() => setFilter('all')} />
              </Stack>
              {!lines ? <CircularProgress size={24} /> : lines.length === 0 ? (
                <Typography variant="body2" color="text.secondary">{t('accounting.banks.noLines', 'No movements. Import your bank statement to start.')}</Typography>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead><TableRow>
                      <TableCell>{t('accounting.banks.cols.date', 'Date')}</TableCell>
                      <TableCell>{t('accounting.banks.cols.description', 'Description')}</TableCell>
                      <TableCell align="right">{t('accounting.banks.cols.amount', 'Amount')}</TableCell>
                      <TableCell>{t('accounting.banks.cols.status', 'Status')}</TableCell>
                      <TableCell>{t('accounting.banks.cols.match', 'In your books')}</TableCell>
                      <TableCell />
                    </TableRow></TableHead>
                    <TableBody>
                      {lines.map((l) => (
                        <TableRow key={l._id} hover>
                          <TableCell>{l.date}</TableCell>
                          <TableCell>{l.description}{l.reference ? <Typography variant="caption" display="block" color="text.secondary">{l.reference}</Typography> : null}</TableCell>
                          <TableCell align="right" sx={{ color: l.amount < 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>{formatMoney(l.amount)}</TableCell>
                          <TableCell><Chip size="small" color={STATUS_COLOR[l.status]} label={t(`accounting.banks.status.${l.status}`, l.status)} /></TableCell>
                          <TableCell>
                            {l.status === 'unmatched' && l.suggestions.length > 0 && canManage && (
                              <Button size="small" variant="outlined" disabled={busy} startIcon={<LinkIcon />} onClick={() => run(() => bankService.match(current._id, l._id, [l.suggestions[0].line]), t('accounting.banks.matched', 'Matched.'))}>
                                {l.suggestions[0].entryNumber} · {l.suggestions[0].date} · {l.suggestions[0].memo.slice(0, 30)}
                              </Button>
                            )}
                            {l.status === 'unmatched' && l.suggestions.length === 0 && <Typography variant="caption" color="text.secondary">{t('accounting.banks.noSuggestion', 'No movement of this amount nearby')}</Typography>}
                            {l.status === 'matched' && <Typography variant="caption" color="text.secondary">{l.matches.length} {t('accounting.banks.entries', 'entry line(s)')}</Typography>}
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            {canManage && !l.reconciliation && l.status === 'unmatched' && (
                              <>
                                <Tooltip title={t('accounting.banks.actions.match', 'Match with entries')}><IconButton size="small" onClick={() => openMatch(l)}><LinkIcon fontSize="small" /></IconButton></Tooltip>
                                <Tooltip title={t('accounting.banks.actions.entry', 'Record the missing entry (fee, interest…)')}><IconButton size="small" onClick={() => { setEntryFor(l); setEntryForm({ account: '', memo: l.description }); }}><PostAdd fontSize="small" /></IconButton></Tooltip>
                                <Tooltip title={t('accounting.banks.actions.ignore', 'Ignore')}><IconButton size="small" onClick={() => run(() => bankService.ignore(current._id, l._id, true))}><Block fontSize="small" /></IconButton></Tooltip>
                                <Tooltip title={t('accounting.banks.actions.delete', 'Delete')}><IconButton size="small" onClick={() => run(() => bankService.deleteLine(current._id, l._id))}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                              </>
                            )}
                            {canManage && !l.reconciliation && l.status === 'matched' && (
                              <Tooltip title={t('accounting.banks.actions.unmatch', 'Undo match')}><IconButton size="small" onClick={() => run(() => bankService.unmatch(current._id, l._id))}><LinkOff fontSize="small" /></IconButton></Tooltip>
                            )}
                            {canManage && !l.reconciliation && l.status === 'ignored' && (
                              <Button size="small" onClick={() => run(() => bankService.ignore(current._id, l._id, false))}>{t('accounting.banks.actions.restore', 'Restore')}</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          )}

          {tab === 'reconciliation' && rec && (
            <Box sx={{ p: 2.5, display: 'grid', gap: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {rec.lastClosed
                  ? t('accounting.banks.rec.last', 'Last reconciled to {{date}} with a balance of {{amount}}.', { date: rec.lastClosed.statementDate, amount: formatMoney(rec.lastClosed.statementEndingBalance) })
                  : t('accounting.banks.rec.first', 'First reconciliation: enter the balance your statement started the period with.')}
              </Typography>
              {canManage && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                  <TextField size="small" type="date" label={t('accounting.banks.rec.date', 'Statement date')} InputLabelProps={{ shrink: true }} value={recForm.statementDate} onChange={(e) => setRecForm((f) => ({ ...f, statementDate: e.target.value }))} />
                  {!rec.lastClosed && <TextField size="small" type="number" label={t('accounting.banks.rec.opening', 'Opening balance')} value={recForm.openingBalance} onChange={(e) => setRecForm((f) => ({ ...f, openingBalance: e.target.value }))} />}
                  <TextField size="small" type="number" label={t('accounting.banks.rec.ending', 'Statement ending balance')} value={recForm.statementEndingBalance} onChange={(e) => setRecForm((f) => ({ ...f, statementEndingBalance: e.target.value }))} />
                  <Button variant="outlined" disabled={busy || recForm.statementEndingBalance === ''} onClick={() => run(() => bankService.startReconciliation(current._id, {
                    statementDate: recForm.statementDate, statementEndingBalance: Number(recForm.statementEndingBalance),
                    ...(rec.lastClosed ? {} : { openingBalance: Number(recForm.openingBalance) || 0 }),
                  }))}>{rec.open ? t('accounting.banks.rec.update', 'Update') : t('accounting.banks.rec.start', 'Start reconciliation')}</Button>
                </Stack>
              )}
              {rec.open && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Grid container spacing={2}>
                    {[
                      [t('accounting.banks.rec.beginning', 'Beginning balance'), rec.open.beginningBalance],
                      [t('accounting.banks.rec.movements', 'Statement movements to {{date}}', { date: rec.open.reconciliation.statementDate }), rec.open.statementTotal],
                      [t('accounting.banks.rec.calculated', 'Calculated balance'), rec.open.clearedBalance],
                      [t('accounting.banks.rec.statement', 'Statement balance'), rec.open.reconciliation.statementEndingBalance],
                      [t('accounting.banks.rec.difference', 'Difference'), rec.open.difference],
                      [t('accounting.banks.rec.books', 'Balance in your books'), rec.open.bookBalance],
                    ].map(([label, value]) => (
                      <Grid item xs={6} md={4} key={label as string}>
                        <Typography variant="caption" color="text.secondary">{label}</Typography>
                        <Typography variant="h6" fontWeight={700} color={label === t('accounting.banks.rec.difference', 'Difference') && Math.abs(value as number) >= 0.005 ? 'error.main' : undefined}>{formatMoney(value as number)}</Typography>
                      </Grid>
                    ))}
                  </Grid>
                  {rec.open.pendingLines > 0 && <Alert severity="warning" sx={{ mt: 1.5 }}>{t('accounting.banks.rec.pending', '{{count}} movement(s) up to that date still need to be matched or ignored.', { count: rec.open.pendingLines })}</Alert>}
                  {canManage && (
                    <Button sx={{ mt: 1.5 }} variant="contained" disabled={busy || !rec.open.canClose} onClick={() => run(() => bankService.closeReconciliation(current._id, rec.open!.reconciliation._id), t('accounting.banks.rec.closed', 'Reconciliation closed.'))}>
                      {t('accounting.banks.rec.close', 'Close reconciliation')}
                    </Button>
                  )}
                </Paper>
              )}
            </Box>
          )}
        </Paper>
      )}

      {/* New bank account */}
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.banks.new', 'Add bank account')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          <TextField label={t('accounting.banks.form.name', 'Name')} value={newForm.name} onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))} required />
          <TextField label={t('accounting.banks.form.bank', 'Bank')} value={newForm.bankName} onChange={(e) => setNewForm((f) => ({ ...f, bankName: e.target.value }))} />
          <TextField label={t('accounting.banks.form.last4', 'Last digits of the account')} value={newForm.accountNumberLast4} onChange={(e) => setNewForm((f) => ({ ...f, accountNumberLast4: e.target.value.replace(/\D/g, '').slice(0, 6) }))} />
          <FormControl>
            <InputLabel>{t('accounting.banks.form.currency', 'Currency')}</InputLabel>
            <Select label={t('accounting.banks.form.currency', 'Currency')} value={newForm.currency} onChange={(e) => setNewForm((f) => ({ ...f, currency: e.target.value }))}>
              {['DOP', 'USD', 'EUR'].map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" disabled={busy || !newForm.name.trim()} onClick={() => run(async () => { await bankService.create(newForm); setNewOpen(false); setNewForm({ name: '', bankName: '', accountNumberLast4: '', currency: 'DOP' }); }, t('accounting.banks.created', 'Bank account added, with its own account in the chart.'))}>
            {t('common.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manual movement */}
      <Dialog open={manualOpen} onClose={() => setManualOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.banks.addLine', 'Add movement')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          <TextField type="date" label={t('accounting.banks.cols.date', 'Date')} InputLabelProps={{ shrink: true }} value={manual.date} onChange={(e) => setManual((m) => ({ ...m, date: e.target.value }))} />
          <TextField label={t('accounting.banks.cols.description', 'Description')} value={manual.description} onChange={(e) => setManual((m) => ({ ...m, description: e.target.value }))} />
          <TextField type="number" label={t('accounting.banks.form.amountSigned', 'Amount (− for a withdrawal)')} value={manual.amount} onChange={(e) => setManual((m) => ({ ...m, amount: e.target.value }))} />
          <TextField label={t('accounting.banks.import.reference', 'Reference')} value={manual.reference} onChange={(e) => setManual((m) => ({ ...m, reference: e.target.value }))} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" disabled={busy || !manual.description.trim() || !Number(manual.amount)} onClick={() => current && run(async () => {
            await bankService.addLine(current._id, { date: manual.date, description: manual.description.trim(), amount: Number(manual.amount), reference: manual.reference || undefined });
            setManualOpen(false);
            setManual({ date: todayDr(), description: '', amount: '', reference: '' });
          })}>{t('common.save', 'Save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Record the missing entry */}
      <Dialog open={!!entryFor} onClose={() => setEntryFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.banks.entry.title', 'Record the missing entry')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          <Typography variant="body2">{entryFor?.description} · <strong>{entryFor ? formatMoney(entryFor.amount) : ''}</strong></Typography>
          <FormControl>
            <InputLabel>{t('accounting.banks.entry.account', 'Account')}</InputLabel>
            <Select label={t('accounting.banks.entry.account', 'Account')} value={entryForm.account} onChange={(e) => setEntryForm((f) => ({ ...f, account: e.target.value }))}>
              {glAccounts.filter((a) => a._id !== current?.glAccount._id).map((a) => <MenuItem key={a._id} value={a._id}>{a.code} — {a.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label={t('accounting.banks.entry.memo', 'Memo')} value={entryForm.memo} onChange={(e) => setEntryForm((f) => ({ ...f, memo: e.target.value }))} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEntryFor(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" disabled={busy || !entryForm.account} onClick={() => current && entryFor && run(async () => {
            await bankService.createEntry(current._id, entryFor._id, entryForm.account, entryForm.memo);
            setEntryFor(null);
          }, t('accounting.banks.entry.done', 'Entry recorded and matched.'))}>{t('accounting.banks.entry.save', 'Record and match')}</Button>
        </DialogActions>
      </Dialog>

      {/* Manual match */}
      <Dialog open={!!matchFor} onClose={() => setMatchFor(null)} maxWidth="md" fullWidth>
        <DialogTitle>{t('accounting.banks.matchDialog.title', 'Match {{amount}} with entries in your books', { amount: matchFor ? formatMoney(matchFor.amount) : '' })}</DialogTitle>
        <DialogContent>
          {book.length === 0 ? <Typography variant="body2" color="text.secondary">{t('accounting.banks.matchDialog.none', 'No unmatched movements in your books for this account.')}</Typography> : (
            <Table size="small">
              <TableBody>
                {book.map((b) => (
                  <TableRow key={b.line} hover onClick={() => setPicked((p) => (p.includes(b.line) ? p.filter((x) => x !== b.line) : [...p, b.line]))} sx={{ cursor: 'pointer' }}>
                    <TableCell padding="checkbox"><Checkbox checked={picked.includes(b.line)} /></TableCell>
                    <TableCell>{b.date}</TableCell>
                    <TableCell>{b.entryNumber}</TableCell>
                    <TableCell>{b.memo}</TableCell>
                    <TableCell align="right">{formatMoney(b.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Typography variant="body2" sx={{ mt: 1.5 }} color={matchFor && Math.abs(pickedSum - matchFor.amount) < 0.005 ? 'success.main' : 'text.secondary'}>
            {t('accounting.banks.matchDialog.sum', 'Selected: {{sum}}', { sum: formatMoney(pickedSum) })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMatchFor(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" disabled={busy || !matchFor || picked.length === 0 || Math.abs(pickedSum - (matchFor?.amount ?? 0)) >= 0.005} onClick={() => current && matchFor && run(async () => {
            await bankService.match(current._id, matchFor._id, picked);
            setMatchFor(null);
          }, t('accounting.banks.matched', 'Matched.'))}>{t('accounting.banks.matchDialog.save', 'Match')}</Button>
        </DialogActions>
      </Dialog>

      {current && <BankImportDialog open={importOpen} bankId={current._id} onClose={() => setImportOpen(false)} onImported={(m) => { setImportOpen(false); refresh(m); }} />}
    </Box>
  );
};

export default BanksPage;
