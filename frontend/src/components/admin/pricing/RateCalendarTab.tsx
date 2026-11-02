/**
 * Pricing → Calendar (CHANNEX_ARCHITECTURE.md §8.5, plan Phase 4.4).
 *
 * Per room type: rooms available per night ("why?" lists rooms, bookings and blocks), then per
 * rate plan the nightly price and a compact booking-rules row. Every value says where it comes
 * from on hover. Edits are staged (highlighted) and committed with ONE Save — one
 * `PUT /rate-calendar/bulk` together with any Bulk edit rows — or discarded.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, FormControlLabel, LinearProgress, Paper, Popover, Switch, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Block, ChevronLeft, ChevronRight, EditCalendar, Login, Logout, Save, Undo } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import {
  rateCalendarService, CalendarChange, CalendarField, CalendarRatePlanDay, RateCalendarView, RestrictionField, ValueSource,
} from '../../../services/api';
import {
  RESTRICTION_FIELDS, Staged, StagedValue, addDays, cellKey, eachDate, hasCalendarRestriction, sourceMark, stageEdit,
  stagedCount, stagedToChanges, todayLocal, weekdayOf,
} from '../../../utils/rateCalendar';
import { getCurrencyConfig } from '../../../utils/currency';
import { GlossaryButton, Term } from './Glossary';
import AvailabilityWhyPopover from './AvailabilityWhyPopover';
import BulkEditDialog, { PlanOption } from './BulkEditDialog';

const LABEL_WIDTH = 190;
const CELL_WIDTH = 68;
const STAGED_BG = 'rgba(255, 193, 7, 0.28)';
const CLOSED_BG = 'rgba(211, 47, 47, 0.08)';

type PlanRow = RateCalendarView['roomTypes'][number]['ratePlans'][number];
interface CellRef { anchor: HTMLElement; plan: PlanRow; date: string }

const RateCalendarTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('es') ? 'es-DO' : 'en-US';
  const today = todayLocal();
  const [from, setFrom] = useState(today);
  const [length, setLength] = useState<14 | 30>(14);
  const [view, setView] = useState<RateCalendarView | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [staged, setStaged] = useState<Staged>({});
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [priceCell, setPriceCell] = useState<CellRef | null>(null);
  const [rulesCell, setRulesCell] = useState<CellRef | null>(null);
  const [why, setWhy] = useState<{ anchor: HTMLElement; roomTypeId: string; roomTypeName: string; date: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const to = addDays(from, length - 1);
  const count = stagedCount(staged);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await rateCalendarService.get({ from, to });
      setView(res.data.data ?? null);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  // Unsaved edits survive moving through dates; warn before leaving the page
  useEffect(() => {
    if (!count) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [count]);

  const { symbol } = getCurrencyConfig();
  const num = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
  const money = (n: number) => `${symbol}${num.format(n)}`;
  const dayLabel = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }), [locale]);
  const fullDate = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }), [locale]);
  const asDate = (d: string) => new Date(`${d}T12:00:00Z`);

  const plans: PlanOption[] = useMemo(() => (view?.roomTypes ?? []).flatMap((rt) =>
    rt.ratePlans.map((p) => ({ _id: p._id, name: p.name, roomTypeName: rt.name }))), [view]);

  const sourceText = (src: ValueSource) => {
    if (src.kind === 'plan') return t('admin.pricing.calendar.source.plan');
    if (src.kind === 'default') return t('admin.pricing.calendar.source.default');
    if (src.kind === 'rule') return src.origin === 'calendar' ? t('admin.pricing.calendar.source.calendar') : t('admin.pricing.calendar.source.rule', { name: src.name });
    return src.origin === 'calendar' ? t('admin.pricing.calendar.source.calendarBookingRule') : t('admin.pricing.calendar.source.bookingRule', { name: src.name });
  };

  /** Staged value if any (not 'reset'), else the server value */
  const effective = (plan: PlanRow, date: string, field: RestrictionField) => {
    const s = staged[cellKey(plan._id, date)]?.[field];
    return s !== undefined && s !== 'reset' ? s : plan.days[date]?.restrictions[field].value;
  };

  // ── Saving ───────────────────────────────────────────────────────────────
  const save = async (extra: CalendarChange[] = []): Promise<boolean> => {
    const changes = [...stagedToChanges(staged), ...extra];
    if (!changes.length) return true;
    setSaving(true);
    setSaveErrors([]);
    try {
      await rateCalendarService.bulk(changes);
      setStaged({});
      setNotice(t('admin.pricing.calendar.saved'));
      await load();
      return true;
    } catch (e: any) {
      const errors: string[] = e?.response?.data?.errors ?? [e?.response?.data?.message ?? t('admin.pricing.calendar.saveFailed')];
      setSaveErrors(errors);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (count && !window.confirm(t('admin.pricing.calendar.discardConfirm'))) return;
    setStaged({});
    setSaveErrors([]);
  };

  const shift = (days: number) => setFrom((f) => addDays(f, days));

  // ── Cells ────────────────────────────────────────────────────────────────
  const markerDot = (mark: 'none' | 'named' | 'calendar') => mark === 'none' ? null : (
    <Box component="span" sx={{
      position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: '50%',
      bgcolor: mark === 'calendar' ? 'secondary.main' : 'info.main',
    }} />
  );

  const priceCellContent = (plan: PlanRow, date: string, day: CalendarRatePlanDay) => {
    const s = staged[cellKey(plan._id, date)]?.price;
    const closed = Boolean(effective(plan, date, 'stopSell')) || !!day.forcedStopSell;
    const text = s === 'reset' ? '↺' : typeof s === 'number' ? num.format(s) : num.format(day.price.base);
    const tip = (
      <Box sx={{ p: 0.5 }}>
        <Typography variant="caption" display="block" fontWeight={700}>{fullDate.format(asDate(date))}</Typography>
        <Typography variant="caption" display="block">
          {s === 'reset' ? t('admin.pricing.calendar.source.resetPending') : s !== undefined ? t('admin.pricing.calendar.cell.staged') : sourceText(day.price.source)}
        </Typography>
        {day.forcedStopSell && <Typography variant="caption" display="block">{t(`admin.pricing.calendar.forced.${day.forcedStopSell}`)}</Typography>}
        <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.3)' }} />
        <Typography variant="caption" display="block">
          {t('admin.pricing.calendar.cell.occupancyRates')}{view?.ratesIncludeTaxes ? ` (${t('admin.pricing.calendar.cell.taxesIncluded')})` : ''}:
        </Typography>
        {Object.entries(day.price.rates).map(([n, rate]) => (
          <Typography key={n} variant="caption" display="block">{t('admin.pricing.calendar.cell.guests', { count: Number(n) })}: {money(rate)}</Typography>
        ))}
      </Box>
    );
    return (
      <Tooltip title={tip} arrow placement="top" enterDelay={300}>
        <Box sx={{
          position: 'relative', px: 0.5, py: 0.75, textAlign: 'center', cursor: date < today ? 'default' : 'pointer', borderRadius: 1,
          bgcolor: s !== undefined ? STAGED_BG : closed ? CLOSED_BG : undefined,
          color: closed ? 'text.disabled' : sourceMark(day.price.source) === 'calendar' ? 'secondary.dark' : 'text.primary',
          fontWeight: sourceMark(day.price.source) === 'calendar' || s !== undefined ? 700 : 400,
          textDecoration: closed ? 'line-through' : 'none', fontSize: 13,
          '&:hover': date < today ? undefined : { outline: '1px solid', outlineColor: 'primary.light' },
        }} onClick={(e) => date >= today && setPriceCell({ anchor: e.currentTarget, plan, date })}>
          {text}
          {s === undefined && markerDot(sourceMark(day.price.source))}
        </Box>
      </Tooltip>
    );
  };

  const rulesCellContent = (plan: PlanRow, date: string, day: CalendarRatePlanDay) => {
    const cell = staged[cellKey(plan._id, date)] ?? {};
    const anyStaged = RESTRICTION_FIELDS.some((f) => cell[f] !== undefined);
    const min = Number(effective(plan, date, 'minStayArrival'));
    const max = Number(effective(plan, date, 'maxStay'));
    const cta = Boolean(effective(plan, date, 'closedToArrival'));
    const ctd = Boolean(effective(plan, date, 'closedToDeparture'));
    const closed = Boolean(effective(plan, date, 'stopSell')) || !!day.forcedStopSell;
    const marks = RESTRICTION_FIELDS.map((f) => sourceMark(day.restrictions[f].source));
    const mark = marks.includes('calendar') ? 'calendar' : marks.includes('named') ? 'named' : 'none';
    const lines: string[] = [];
    if (closed) lines.push(day.forcedStopSell ? t(`admin.pricing.calendar.forced.${day.forcedStopSell}`) : t('admin.pricing.glossary.stopSell.term'));
    if (min > 1) lines.push(`${t('admin.pricing.glossary.minStayArrival.term')}: ${min}`);
    if (max > 0) lines.push(`${t('admin.pricing.glossary.maxStay.term')}: ${max}`);
    if (cta) lines.push(t('admin.pricing.glossary.closedToArrival.term'));
    if (ctd) lines.push(t('admin.pricing.glossary.closedToDeparture.term'));
    const sources = RESTRICTION_FIELDS
      .filter((f) => day.restrictions[f].source.kind === 'booking_rule')
      .map((f) => sourceText(day.restrictions[f].source));
    const tip = (
      <Box sx={{ p: 0.5 }}>
        <Typography variant="caption" display="block" fontWeight={700}>{fullDate.format(asDate(date))}</Typography>
        {(lines.length ? lines : [t('admin.pricing.calendar.source.default')]).map((l) => <Typography key={l} variant="caption" display="block">{l}</Typography>)}
        {[...new Set(sources)].map((s) => <Typography key={s} variant="caption" display="block" sx={{ opacity: 0.8 }}>{s}</Typography>)}
        {anyStaged && <Typography variant="caption" display="block">{t('admin.pricing.calendar.cell.staged')}</Typography>}
      </Box>
    );
    return (
      <Tooltip title={tip} arrow placement="top" enterDelay={300}>
        <Box sx={{
          position: 'relative', minHeight: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.25, flexWrap: 'wrap',
          cursor: date < today ? 'default' : 'pointer', borderRadius: 1, fontSize: 11, color: 'text.secondary',
          bgcolor: anyStaged ? STAGED_BG : closed ? CLOSED_BG : undefined,
          '&:hover': date < today ? undefined : { outline: '1px solid', outlineColor: 'primary.light' },
        }} onClick={(e) => date >= today && setRulesCell({ anchor: e.currentTarget, plan, date })}>
          {closed && <Block sx={{ fontSize: 14, color: 'error.main' }} />}
          {min > 1 && <span>{min}+</span>}
          {max > 0 && <span>≤{max}</span>}
          {cta && <Login sx={{ fontSize: 14, color: 'warning.dark' }} />}
          {ctd && <Logout sx={{ fontSize: 14, color: 'warning.dark' }} />}
          {!anyStaged && markerDot(mark)}
        </Box>
      </Tooltip>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const dates = view ? eachDate(view.from, view.to) : [];
  const stickyLabel = { position: 'sticky' as const, left: 0, zIndex: 2, bgcolor: 'background.paper', minWidth: LABEL_WIDTH, maxWidth: LABEL_WIDTH, borderRight: 1, borderColor: 'divider' };
  const weekend = (d: string) => ['sa', 'su'].includes(weekdayOf(d));

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('admin.pricing.calendar.intro')}</Typography>

      <Paper sx={{ p: 1.5, mb: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="small" onClick={() => shift(-length)} startIcon={<ChevronLeft />}>{t('admin.pricing.calendar.prev')}</Button>
        <TextField size="small" type="date" label={t('admin.pricing.calendar.from')} InputLabelProps={{ shrink: true }} value={from}
          onChange={(e) => e.target.value && setFrom(e.target.value)} sx={{ width: 160 }} />
        <Button size="small" onClick={() => shift(length)} endIcon={<ChevronRight />}>{t('admin.pricing.calendar.next')}</Button>
        <Button size="small" onClick={() => setFrom(today)}>{t('admin.pricing.calendar.today')}</Button>
        <ToggleButtonGroup size="small" exclusive value={length} onChange={(_, v) => v && setLength(v)}>
          <ToggleButton value={14}>{t('admin.pricing.calendar.days14')}</ToggleButton>
          <ToggleButton value={30}>{t('admin.pricing.calendar.days30')}</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <GlossaryButton />
        <Button size="small" variant="outlined" startIcon={<EditCalendar />} onClick={() => setBulkOpen(true)} disabled={!plans.length}>
          {t('admin.pricing.calendar.bulkEdit')}
        </Button>
        <Button size="small" startIcon={<Undo />} onClick={discard} disabled={!count || saving}>{t('admin.pricing.calendar.discard')}</Button>
        <Button size="small" variant="contained" startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <Save />}
          onClick={() => save()} disabled={!count || saving}>
          {t('admin.pricing.calendar.save', { count })}
        </Button>
      </Paper>

      {count > 0 && <Alert severity="warning" sx={{ mb: 2 }}>{t('admin.pricing.calendar.stagedHint', { count })}</Alert>}
      {saveErrors.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveErrors([])}>{saveErrors.map((e) => <div key={e}>{e}</div>)}</Alert>
      )}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{t('admin.pricing.calendar.loadFailed')}</Alert>}
      {loading && <LinearProgress sx={{ mb: 1 }} />}

      {view && view.roomTypes.every((rt) => rt.ratePlans.length === 0) && (
        <Paper sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">{t('admin.pricing.calendar.noRoomTypes')}</Typography></Paper>
      )}

      {view && view.roomTypes.some((rt) => rt.ratePlans.length > 0) && (
        <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ tableLayout: 'fixed', '& td, & th': { px: 0.25, py: 0.25 } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...stickyLabel, zIndex: 3 }}>
                  <Typography variant="caption" color="text.secondary">{t('admin.pricing.calendar.preTax')}</Typography>
                </TableCell>
                {dates.map((d) => (
                  <TableCell key={d} align="center" sx={{ minWidth: CELL_WIDTH, width: CELL_WIDTH, bgcolor: weekend(d) ? 'action.hover' : undefined, borderBottom: d === today ? 2 : 1, borderBottomColor: d === today ? 'primary.main' : 'divider' }}>
                    <Typography variant="caption" display="block" color="text.secondary">{t(`admin.pricing.calendar.weekdays.${weekdayOf(d)}`)}</Typography>
                    <Typography variant="caption" display="block" fontWeight={600}>{dayLabel.format(asDate(d))}</Typography>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {view.roomTypes.filter((rt) => rt.ratePlans.length > 0).map((rt) => (
                <React.Fragment key={rt._id}>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ ...stickyLabel, bgcolor: 'grey.50' }}>
                      <Typography variant="body2" fontWeight={700} noWrap>{rt.name}{!rt.isActive && ` (${t('admin.pricing.calendar.inactive')})`}</Typography>
                      <Typography variant="caption" color="text.secondary"><Term term="availability" /></Typography>
                    </TableCell>
                    {dates.map((d) => {
                      const a = rt.availability[d];
                      return (
                        <TableCell key={d} align="center" sx={{ bgcolor: weekend(d) ? 'action.hover' : undefined }}>
                          <Tooltip title={t('admin.pricing.calendar.why.button')} enterDelay={500}>
                            <Box component="button" type="button" onClick={(e: React.MouseEvent<HTMLElement>) => setWhy({ anchor: e.currentTarget, roomTypeId: rt._id, roomTypeName: rt.name, date: d })}
                              sx={{ border: 0, background: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 700, fontSize: 13, color: a?.available ? 'success.dark' : 'error.main', px: 1, py: 0.25, borderRadius: 1, '&:hover': { bgcolor: 'action.selected' } }}>
                              {a?.available ?? 0}
                              {(a?.overbooked ?? 0) > 0 && <Box component="span" sx={{ color: 'error.main', fontSize: 11 }}> −{a.overbooked}</Box>}
                            </Box>
                          </Tooltip>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {rt.ratePlans.map((plan) => (
                    <React.Fragment key={plan._id}>
                      <TableRow>
                        <TableCell sx={stickyLabel}>
                          <Typography variant="body2" noWrap title={plan.name}>
                            {plan.name}{!plan.isActive && <Chip size="small" label={t('admin.pricing.calendar.inactive')} sx={{ ml: 0.5, height: 18 }} />}
                            {plan.isActive && (!plan.sellOnChannels || !rt.sellOnChannels) && <Chip size="small" label={t('admin.pricing.sellOnChannels.off')} sx={{ ml: 0.5, height: 18 }} />}
                          </Typography>
                          <Typography variant="caption" color="text.secondary"><Term term="price">{t('admin.pricing.calendar.price')}</Term></Typography>
                        </TableCell>
                        {dates.map((d) => (
                          <TableCell key={d} sx={{ bgcolor: weekend(d) ? 'action.hover' : undefined, borderBottom: 0 }}>
                            {plan.days[d] && priceCellContent(plan, d, plan.days[d])}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell sx={stickyLabel}>
                          <Typography variant="caption" color="text.secondary">{t('admin.pricing.calendar.restrictions')}</Typography>
                        </TableCell>
                        {dates.map((d) => (
                          <TableCell key={d} sx={{ bgcolor: weekend(d) ? 'action.hover' : undefined }}>
                            {plan.days[d] && rulesCellContent(plan, d, plan.days[d])}
                          </TableCell>
                        ))}
                      </TableRow>
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1.5, alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'info.main' }} /><Typography variant="caption"><Term term="namedRule">{t('admin.pricing.calendar.legend.named')}</Term></Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'secondary.main' }} /><Typography variant="caption"><Term term="calendarAdjustment">{t('admin.pricing.calendar.legend.calendar')}</Term></Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Box sx={{ width: 14, height: 10, bgcolor: STAGED_BG }} /><Typography variant="caption">{t('admin.pricing.calendar.legend.staged')}</Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Block sx={{ fontSize: 14, color: 'error.main' }} /><Typography variant="caption"><Term term="stopSell" /></Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Typography variant="caption" color="text.secondary">2+</Typography><Typography variant="caption"><Term term="minStayArrival" /></Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Typography variant="caption" color="text.secondary">≤7</Typography><Typography variant="caption"><Term term="maxStay" /></Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Login sx={{ fontSize: 14, color: 'warning.dark' }} /><Typography variant="caption"><Term term="closedToArrival" /></Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Logout sx={{ fontSize: 14, color: 'warning.dark' }} /><Typography variant="caption"><Term term="closedToDeparture" /></Typography></Box>
      </Box>

      {priceCell && (
        <PriceEditor cell={priceCell} staged={staged} dateLabel={fullDate.format(asDate(priceCell.date))}
          onClose={() => setPriceCell(null)} onStage={setStaged} />
      )}
      {rulesCell && (
        <RestrictionsEditor cell={rulesCell} staged={staged} dateLabel={fullDate.format(asDate(rulesCell.date))}
          onClose={() => setRulesCell(null)} onStage={setStaged} />
      )}
      {why && (
        <AvailabilityWhyPopover anchor={why.anchor} roomTypeId={why.roomTypeId} roomTypeName={why.roomTypeName} date={why.date}
          dateLabel={fullDate.format(asDate(why.date))} onClose={() => setWhy(null)} />
      )}
      <BulkEditDialog open={bulkOpen} plans={plans} today={today} stagedCount={count} saving={saving}
        onClose={() => setBulkOpen(false)} onSave={(rows) => save(rows)} />
    </Box>
  );
};

// ─── Cell editors (they only stage; nothing is saved until Save) ─────────────

interface EditorProps {
  cell: CellRef;
  staged: Staged;
  dateLabel: string;
  onClose: () => void;
  onStage: (next: Staged) => void;
}

const PriceEditor: React.FC<EditorProps> = ({ cell, staged, dateLabel, onClose, onStage }) => {
  const { t } = useTranslation();
  const day = cell.plan.days[cell.date];
  const current = staged[cellKey(cell.plan._id, cell.date)]?.price;
  const [value, setValue] = useState(typeof current === 'number' ? String(current) : String(day.price.base));
  const valid = /^\d+(\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0;
  const fromCalendar = sourceMark(day.price.source) === 'calendar';

  const apply = () => {
    if (!valid) return;
    onStage(stageEdit(staged, cell.plan._id, cell.date, 'price', Number(value), day.price.base));
    onClose();
  };
  const reset = () => {
    // A Calendar adjustment is removed on save; an unsaved edit is simply dropped
    onStage(stageEdit(staged, cell.plan._id, cell.date, 'price', fromCalendar ? 'reset' : undefined));
    onClose();
  };

  return (
    <Popover open anchorEl={cell.anchor} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}>
      <Box sx={{ p: 2, width: 260 }}>
        <Typography variant="subtitle2" fontWeight={700} noWrap>{cell.plan.name}</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>{dateLabel}</Typography>
        <TextField autoFocus fullWidth size="small" label={t('admin.pricing.calendar.cell.editPrice')} value={value}
          error={!valid} helperText={!valid ? t('admin.pricing.calendar.bulk.errors.price') : undefined}
          inputProps={{ inputMode: 'decimal' }} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} />
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" onClick={apply} disabled={!valid}>{t('admin.pricing.calendar.cell.apply')}</Button>
          {(fromCalendar || current !== undefined) && (
            <Button size="small" onClick={reset}>{t('admin.pricing.calendar.cell.resetPrice')}</Button>
          )}
        </Box>
      </Box>
    </Popover>
  );
};

const RestrictionsEditor: React.FC<EditorProps> = ({ cell, staged, dateLabel, onClose, onStage }) => {
  const { t } = useTranslation();
  const day = cell.plan.days[cell.date];
  const stagedCell = staged[cellKey(cell.plan._id, cell.date)] ?? {};
  const initial = (f: RestrictionField) => {
    const s = stagedCell[f];
    return s !== undefined && s !== 'reset' ? s : day.restrictions[f].value;
  };
  const [minStay, setMinStay] = useState(String(initial('minStayArrival')));
  const [maxStay, setMaxStay] = useState(String(initial('maxStay')));
  const [flags, setFlags] = useState({
    closedToArrival: Boolean(initial('closedToArrival')),
    closedToDeparture: Boolean(initial('closedToDeparture')),
    stopSell: Boolean(initial('stopSell')),
  });
  const [touched, setTouched] = useState<Set<RestrictionField>>(new Set());
  const touch = (f: RestrictionField) => setTouched((s) => new Set(s).add(f));

  const minOk = /^\d+$/.test(minStay) && Number(minStay) >= 1 && Number(minStay) <= 730;
  const maxOk = /^\d+$/.test(maxStay) && Number(maxStay) <= 730;
  const orderOk = !minOk || !maxOk || Number(maxStay) === 0 || Number(maxStay) >= Number(minStay);

  const apply = () => {
    if (!minOk || !maxOk || !orderOk) return;
    const values: Record<RestrictionField, number | boolean> = {
      minStayArrival: Number(minStay), maxStay: Number(maxStay), ...flags,
    };
    let next = staged;
    for (const f of RESTRICTION_FIELDS) {
      if (touched.has(f)) next = stageEdit(next, cell.plan._id, cell.date, f, values[f], day.restrictions[f].value);
    }
    onStage(next);
    onClose();
  };

  const reset = () => {
    let next = staged;
    for (const f of RESTRICTION_FIELDS) {
      const value: StagedValue | undefined = sourceMark(day.restrictions[f].source) === 'calendar' ? 'reset' : undefined;
      next = stageEdit(next, cell.plan._id, cell.date, f as CalendarField, value);
    }
    onStage(next);
    onClose();
  };

  const flag = (f: 'closedToArrival' | 'closedToDeparture' | 'stopSell', disabled = false) => (
    <FormControlLabel
      control={<Switch size="small" checked={flags[f]} disabled={disabled} onChange={(e) => { setFlags((s) => ({ ...s, [f]: e.target.checked })); touch(f); }} />}
      label={<Typography variant="body2"><Term term={f} /></Typography>}
    />
  );

  return (
    <Popover open anchorEl={cell.anchor} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}>
      <Box sx={{ p: 2, width: 320 }}>
        <Typography variant="subtitle2" fontWeight={700} noWrap>{cell.plan.name}</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>{dateLabel}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 1 }}>
          <TextField size="small" fullWidth label={<Term term="minStayArrival" />}
            value={minStay} error={!minOk} inputProps={{ inputMode: 'numeric' }}
            onChange={(e) => { setMinStay(e.target.value); touch('minStayArrival'); }} />
          <TextField size="small" fullWidth label={<Term term="maxStay" />}
            value={maxStay} error={!maxOk || !orderOk} helperText={t('admin.pricing.calendar.cell.noMax')} inputProps={{ inputMode: 'numeric' }}
            onChange={(e) => { setMaxStay(e.target.value); touch('maxStay'); }} />
        </Box>
        {!orderOk && <Typography variant="caption" color="error" display="block">{t('admin.pricing.calendar.bulk.errors.maxBelowMin')}</Typography>}
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {flag('closedToArrival')}
          {flag('closedToDeparture')}
          {flag('stopSell', !!day.forcedStopSell)}
          {day.forcedStopSell && <Typography variant="caption" color="text.secondary">{t(`admin.pricing.calendar.forced.${day.forcedStopSell}`)}</Typography>}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" onClick={apply} disabled={!minOk || !maxOk || !orderOk || touched.size === 0}>
            {t('admin.pricing.calendar.cell.apply')}
          </Button>
          {(hasCalendarRestriction(day.restrictions) || RESTRICTION_FIELDS.some((f) => stagedCell[f] !== undefined)) && (
            <Button size="small" onClick={reset}>{t('admin.pricing.calendar.cell.resetRestrictions')}</Button>
          )}
        </Box>
      </Box>
    </Popover>
  );
};

export default RateCalendarTab;
