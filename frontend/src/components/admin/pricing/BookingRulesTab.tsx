/**
 * Pricing → Booking rules ("Reglas de reserva", CHANNEX_ARCHITECTURE.md §4.3, §8.5): named
 * RestrictionRules with presets and plain-language summaries, plus the rules typed in the
 * Calendar (grouped apart; changed from the Calendar).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Paper, Select, Switch, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Add, DeleteOutline, Edit, EventBusy, ExpandLess, ExpandMore, NightsStay, NoMeetingRoom, Tune } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { restrictionRulesService, RestrictionField, RestrictionRuleInput, RestrictionRuleRecord, WeekdayCode } from '../../../services/api';
import { RESTRICTION_FIELDS, WEEKDAYS, addDays, todayLocal } from '../../../utils/rateCalendar';
import { GlossaryButton, Term } from './Glossary';

export interface Named { _id: string; name: string }
export interface PlanRef extends Named { roomTypeName: string }

interface Props {
  roomTypes: Named[];
  ratePlans: PlanRef[];
  onOpenCalendar: () => void;
}

export interface RuleForm {
  _id?: string;
  name: string;
  scope: RestrictionRuleRecord['scope'];
  roomTypeIds: string[];
  ratePlanIds: string[];
  dateStart: string;
  dateEnd: string;
  days: WeekdayCode[];
  on: Record<RestrictionField, boolean>;
  minStayArrival: string;
  maxStay: string;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
  isActive: boolean;
}

export type Preset = 'weekendMin' | 'closeDates' | 'noArrivals' | 'custom';

const noneOn = (): Record<RestrictionField, boolean> =>
  ({ minStayArrival: false, maxStay: false, closedToArrival: false, closedToDeparture: false, stopSell: false });

export function presetForm(preset: Preset, name: string, today: string): RuleForm {
  const base: RuleForm = {
    name, scope: 'property', roomTypeIds: [], ratePlanIds: [], dateStart: today, dateEnd: addDays(today, 180), days: [...WEEKDAYS],
    on: noneOn(), minStayArrival: '2', maxStay: '0', closedToArrival: true, closedToDeparture: true, stopSell: true, isActive: true,
  };
  if (preset === 'weekendMin') return { ...base, days: ['fr', 'sa'], on: { ...noneOn(), minStayArrival: true } };
  if (preset === 'closeDates') return { ...base, dateEnd: today, on: { ...noneOn(), stopSell: true } };
  if (preset === 'noArrivals') return { ...base, days: ['su'], on: { ...noneOn(), closedToArrival: true } };
  return base;
}

function formFromRule(rule: RestrictionRuleRecord): RuleForm {
  const has = (f: RestrictionField) => rule[f] !== undefined && rule[f] !== null;
  return {
    _id: rule._id, name: rule.name, scope: rule.scope, roomTypeIds: rule.roomTypeIds.map(String), ratePlanIds: rule.ratePlanIds.map(String),
    dateStart: rule.dateStart, dateEnd: rule.dateEnd, days: rule.days.length ? rule.days : [...WEEKDAYS],
    on: Object.fromEntries(RESTRICTION_FIELDS.map((f) => [f, has(f)])) as Record<RestrictionField, boolean>,
    minStayArrival: String(rule.minStayArrival ?? 2), maxStay: String(rule.maxStay ?? 0),
    closedToArrival: rule.closedToArrival ?? true, closedToDeparture: rule.closedToDeparture ?? true, stopSell: rule.stopSell ?? true,
    isActive: rule.isActive,
  };
}

/** API body; on update, restrictions that were turned off are cleared with null. */
function toInput(form: RuleForm): RestrictionRuleInput {
  const off = form._id ? null : undefined;
  const nights = (f: 'minStayArrival' | 'maxStay') => (form.on[f] ? Number(form[f]) : off);
  const flag = (f: 'closedToArrival' | 'closedToDeparture' | 'stopSell') => (form.on[f] ? form[f] : off);
  return {
    name: form.name.trim(), scope: form.scope,
    roomTypeIds: form.scope === 'room_types' ? form.roomTypeIds : [],
    ratePlanIds: form.scope === 'rate_plans' ? form.ratePlanIds : [],
    dateStart: form.dateStart, dateEnd: form.dateEnd,
    days: form.days.length === 7 ? [] : WEEKDAYS.filter((d) => form.days.includes(d)),
    minStayArrival: nights('minStayArrival'), maxStay: nights('maxStay'),
    closedToArrival: flag('closedToArrival'), closedToDeparture: flag('closedToDeparture'), stopSell: flag('stopSell'),
    isActive: form.isActive,
  };
}

const BookingRulesTab: React.FC<Props> = ({ roomTypes, ratePlans, onOpenCalendar }) => {
  const { t, i18n } = useTranslation();
  const lang: 'es' | 'en' = i18n.language?.startsWith('es') ? 'es' : 'en';
  const today = todayLocal();
  const [rules, setRules] = useState<RestrictionRuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await restrictionRulesService.list();
      setRules(res.data.data ?? []);
    } catch {
      setError(t('admin.pricing.bookingRules.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const named = rules.filter((r) => r.origin !== 'calendar');
  const fromCalendar = rules.filter((r) => r.origin === 'calendar');

  const remove = async (rule: RestrictionRuleRecord) => {
    if (!window.confirm(t('admin.pricing.bookingRules.deleteConfirm'))) return;
    try { await restrictionRulesService.remove(rule._id); await load(); } catch { setError(t('admin.pricing.bookingRules.saveFailed')); }
  };
  const toggleActive = async (rule: RestrictionRuleRecord) => {
    try { await restrictionRulesService.update(rule._id, { isActive: !rule.isActive }); await load(); } catch (e: any) {
      setError(e?.response?.data?.message || t('admin.pricing.bookingRules.saveFailed'));
    }
  };

  const presets: { key: Preset; icon: React.ReactNode }[] = [
    { key: 'weekendMin', icon: <NightsStay color="primary" /> },
    { key: 'closeDates', icon: <EventBusy color="error" /> },
    { key: 'noArrivals', icon: <NoMeetingRoom color="warning" /> },
    { key: 'custom', icon: <Tune color="action" /> },
  ];
  const openPreset = (p: Preset) =>
    setForm(presetForm(p, p === 'custom' ? '' : t(`admin.pricing.bookingRules.presets.${p}.name`), today));

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{t('admin.pricing.bookingRules.description')}</Typography>
        <GlossaryButton />
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('admin.pricing.bookingRules.presetsTitle')}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5, mb: 3 }}>
        {presets.map(({ key, icon }) => (
          <Paper key={key} variant="outlined" onClick={() => openPreset(key)}
            sx={{ p: 1.5, cursor: 'pointer', display: 'flex', gap: 1, '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' } }}>
            {icon}
            <Box>
              <Typography variant="body2" fontWeight={600}>{t(`admin.pricing.bookingRules.presets.${key}.title`)}</Typography>
              <Typography variant="caption" color="text.secondary">{t(`admin.pricing.bookingRules.presets.${key}.description`)}</Typography>
            </Box>
          </Paper>
        ))}
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <Button variant="contained" startIcon={<Add />} onClick={() => openPreset('custom')}>{t('admin.pricing.bookingRules.new')}</Button>
      </Box>
      <TableContainer component={Paper} sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.pricing.bookingRules.table.name')}</TableCell>
              <TableCell>{t('admin.pricing.bookingRules.table.summary')}</TableCell>
              <TableCell>{t('admin.pricing.bookingRules.table.active')}</TableCell>
              <TableCell align="right">{t('admin.pricing.bookingRules.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {named.map((rule) => (
              <TableRow key={rule._id} sx={{ opacity: rule.isActive ? 1 : 0.6 }}>
                <TableCell sx={{ fontWeight: 600 }}>{rule.name}</TableCell>
                <TableCell>{rule.summary[lang]}</TableCell>
                <TableCell><Switch size="small" checked={rule.isActive} onChange={() => toggleActive(rule)} /></TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <IconButton size="small" onClick={() => setForm(formFromRule(rule))}><Edit fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => remove(rule)}><DeleteOutline fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {!loading && named.length === 0 && (
              <TableRow><TableCell colSpan={4} align="center"><Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{t('admin.pricing.bookingRules.empty')}</Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={() => setShowCalendar((s) => !s)}>
          {showCalendar ? <ExpandLess /> : <ExpandMore />}
          <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
            {t('admin.pricing.bookingRules.calendarGroup.title')} ({fromCalendar.length})
          </Typography>
          <Button size="small" onClick={(e) => { e.stopPropagation(); onOpenCalendar(); }}>{t('admin.pricing.calendar.adjustments.openCalendar')}</Button>
        </Box>
        <Collapse in={showCalendar}>
          <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>{t('admin.pricing.bookingRules.calendarGroup.description')}</Typography>
          {fromCalendar.length === 0 && <Typography variant="body2" color="text.secondary">{t('admin.pricing.bookingRules.calendarGroup.empty')}</Typography>}
          {fromCalendar.map((rule) => (
            <Box key={rule._id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
              <Typography variant="body2" sx={{ flex: 1 }}>{rule.summary[lang]}</Typography>
              <IconButton size="small" color="error" onClick={() => remove(rule)}><DeleteOutline fontSize="small" /></IconButton>
            </Box>
          ))}
        </Collapse>
      </Paper>

      {form && (
        <BookingRuleDialog form={form} roomTypes={roomTypes} ratePlans={ratePlans} lang={lang}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />
      )}
    </Box>
  );
};

// ─── Create / edit dialog ────────────────────────────────────────────────────

interface DialogProps {
  form: RuleForm;
  roomTypes: Named[];
  ratePlans: PlanRef[];
  lang: 'es' | 'en';
  onClose: () => void;
  onSaved: () => void;
}

export const BookingRuleDialog: React.FC<DialogProps> = ({ form: initial, roomTypes, ratePlans, lang, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [form, setForm] = useState<RuleForm>(initial);
  const [summary, setSummary] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<RuleForm>) => setForm((f) => ({ ...f, ...patch }));

  const localErrors = useMemo(() => {
    const out: string[] = [];
    if (!form.name.trim()) out.push(t('admin.pricing.bookingRules.dialog.errors.name'));
    if (!form.dateStart || !form.dateEnd || form.dateEnd < form.dateStart) out.push(t('admin.pricing.bookingRules.dialog.errors.dates'));
    if ((form.scope === 'room_types' && !form.roomTypeIds.length) || (form.scope === 'rate_plans' && !form.ratePlanIds.length)) {
      out.push(t('admin.pricing.bookingRules.dialog.errors.scope'));
    }
    if (form.days.length === 0) out.push(t('admin.pricing.calendar.bulk.errors.days'));
    if (!RESTRICTION_FIELDS.some((f) => form.on[f])) out.push(t('admin.pricing.bookingRules.dialog.errors.nothing'));
    const min = Number(form.minStayArrival);
    const max = Number(form.maxStay);
    if (form.on.minStayArrival && !(/^\d+$/.test(form.minStayArrival) && min >= 1 && min <= 730)) out.push(t('admin.pricing.calendar.bulk.errors.minStay'));
    if (form.on.maxStay && !(/^\d+$/.test(form.maxStay) && max <= 730)) out.push(t('admin.pricing.calendar.bulk.errors.maxStay'));
    if (form.on.minStayArrival && form.on.maxStay && max > 0 && max < min) out.push(t('admin.pricing.calendar.bulk.errors.maxBelowMin'));
    return out;
  }, [form, t]);

  // Live plain-language summary (the same sentence the list shows)
  useEffect(() => {
    if (localErrors.length) { setSummary(null); return; }
    const timer = setTimeout(() => {
      restrictionRulesService.preview(toInput({ ...form, _id: undefined }))
        .then((res) => setSummary(res.data.data?.summary?.[lang] ?? null))
        .catch(() => setSummary(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [form, lang, localErrors.length]);

  const save = async () => {
    if (localErrors.length) { setErrors(localErrors); return; }
    setSaving(true);
    try {
      const body = toInput(form);
      if (form._id) await restrictionRulesService.update(form._id, body);
      else await restrictionRulesService.create(body);
      onSaved();
    } catch (e: any) {
      setErrors([e?.response?.data?.message || t('admin.pricing.bookingRules.saveFailed')]);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (f: RestrictionField) => (
    <Checkbox size="small" checked={form.on[f]} onChange={(e) => set({ on: { ...form.on, [f]: e.target.checked } })} />
  );
  const yesNo = (f: 'closedToArrival' | 'closedToDeparture' | 'stopSell') => (
    <Select size="small" value={form[f] ? 'on' : 'off'} disabled={!form.on[f]} sx={{ minWidth: 240 }}
      onChange={(e) => set({ [f]: e.target.value === 'on' } as Partial<RuleForm>)}>
      <MenuItem value="on">{t('admin.pricing.bookingRules.dialog.on')}</MenuItem>
      <MenuItem value="off">{t('admin.pricing.bookingRules.dialog.off')}</MenuItem>
    </Select>
  );

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t(form._id ? 'admin.pricing.bookingRules.dialog.titleEdit' : 'admin.pricing.bookingRules.dialog.titleNew')}</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField size="small" label={t('admin.pricing.bookingRules.dialog.name')} value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />

        <FormControl size="small">
          <InputLabel>{t('admin.pricing.bookingRules.dialog.appliesTo')}</InputLabel>
          <Select label={t('admin.pricing.bookingRules.dialog.appliesTo')} value={form.scope}
            onChange={(e) => set({ scope: e.target.value as RuleForm['scope'] })}>
            {(['property', 'room_types', 'rate_plans'] as const).map((s) => (
              <MenuItem key={s} value={s}>{t(`admin.pricing.bookingRules.dialog.scope.${s}`)}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {form.scope === 'room_types' && (
          <Autocomplete multiple size="small" options={roomTypes} getOptionLabel={(o) => o.name} isOptionEqualToValue={(a, b) => a._id === b._id}
            value={roomTypes.filter((r) => form.roomTypeIds.includes(r._id))} onChange={(_, v) => set({ roomTypeIds: v.map((r) => r._id) })}
            renderInput={(p) => <TextField {...p} label={t('admin.pricing.bookingRules.dialog.roomTypes')} />} />
        )}
        {form.scope === 'rate_plans' && (
          <Autocomplete multiple size="small" options={ratePlans} groupBy={(o) => o.roomTypeName} getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a._id === b._id} value={ratePlans.filter((r) => form.ratePlanIds.includes(r._id))}
            onChange={(_, v) => set({ ratePlanIds: v.map((r) => r._id) })}
            renderInput={(p) => <TextField {...p} label={t('admin.pricing.bookingRules.dialog.ratePlans')} />} />
        )}

        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField size="small" type="date" fullWidth label={t('admin.pricing.bookingRules.dialog.dateStart')} InputLabelProps={{ shrink: true }}
            value={form.dateStart} onChange={(e) => set({ dateStart: e.target.value })} />
          <TextField size="small" type="date" fullWidth label={t('admin.pricing.bookingRules.dialog.dateEnd')} InputLabelProps={{ shrink: true }}
            value={form.dateEnd} inputProps={{ min: form.dateStart }} onChange={(e) => set({ dateEnd: e.target.value })} />
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">{t('admin.pricing.bookingRules.dialog.days')}</Typography>
          <ToggleButtonGroup size="small" value={form.days} onChange={(_, v: WeekdayCode[]) => set({ days: v })}>
            {WEEKDAYS.map((d) => <ToggleButton key={d} value={d} sx={{ px: 1.25, py: 0.25 }}>{t(`admin.pricing.calendar.weekdays.${d}`)}</ToggleButton>)}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{t('admin.pricing.bookingRules.dialog.daysHint')}</Typography>
        </Box>

        <Divider />
        <Typography variant="subtitle2" fontWeight={700}>{t('admin.pricing.bookingRules.dialog.restrictionsTitle')}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'center', columnGap: 1, rowGap: 1 }}>
          <FormControlLabel control={toggle('minStayArrival')} label={<Term term="minStayArrival" />} />
          <TextField size="small" value={form.minStayArrival} disabled={!form.on.minStayArrival} sx={{ width: 100 }}
            inputProps={{ inputMode: 'numeric' }} onChange={(e) => set({ minStayArrival: e.target.value })} />
          <FormControlLabel control={toggle('maxStay')} label={<Term term="maxStay" />} />
          <TextField size="small" value={form.maxStay} disabled={!form.on.maxStay} sx={{ width: 100 }} helperText={t('admin.pricing.calendar.cell.noMax')}
            inputProps={{ inputMode: 'numeric' }} onChange={(e) => set({ maxStay: e.target.value })} />
          <FormControlLabel control={toggle('closedToArrival')} label={<Term term="closedToArrival" />} />
          {yesNo('closedToArrival')}
          <FormControlLabel control={toggle('closedToDeparture')} label={<Term term="closedToDeparture" />} />
          {yesNo('closedToDeparture')}
          <FormControlLabel control={toggle('stopSell')} label={<Term term="stopSell" />} />
          {yesNo('stopSell')}
        </Box>

        <FormControlLabel control={<Switch checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />}
          label={t('admin.pricing.bookingRules.dialog.active')} />

        {summary && (
          <Alert severity="info" icon={false}>
            <Typography variant="caption" fontWeight={700} display="block">{t('admin.pricing.bookingRules.dialog.summary')}</Typography>
            {summary}
          </Alert>
        )}
        {errors.length > 0 && <Alert severity="error">{errors.map((e) => <div key={e}>{e}</div>)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('admin.pricing.bookingRules.dialog.cancel')}</Button>
        <Tooltip title={localErrors.join(' ')}>
          <span><Button variant="contained" onClick={save} disabled={saving}>{t('admin.pricing.bookingRules.dialog.save')}</Button></span>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
};

export default BookingRulesTab;
