/**
 * Calendar → Bulk edit: several rows (rates + dates + weekdays + any field), saved together
 * with the Calendar's staged edits in ONE request.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  FormControlLabel, IconButton, InputLabel, MenuItem, Paper, Select, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Add, DeleteOutline } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { CalendarChange, WeekdayCode } from '../../../services/api';
import { BulkRow, BulkRowError, TriState, WEEKDAYS, bulkRowNights, bulkRowToChange, emptyBulkRow } from '../../../utils/rateCalendar';
import { Term } from './Glossary';

export interface PlanOption { _id: string; name: string; roomTypeName: string }

interface Props {
  open: boolean;
  plans: PlanOption[];
  today: string;
  /** Unsaved Calendar edits that go in the same request */
  stagedCount: number;
  saving: boolean;
  onClose: () => void;
  /** Saves the rows (after the staged edits); resolves true on success */
  onSave: (changes: CalendarChange[]) => Promise<boolean>;
}

const BulkEditDialog: React.FC<Props> = ({ open, plans, today, stagedCount, saving, onClose, onSave }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (open) { setRows([emptyBulkRow(today)]); setShowErrors(false); }
  }, [open, today]);

  const results = useMemo(() => rows.map((r) => bulkRowToChange(r, today)), [rows, today]);
  const update = (id: string, patch: Partial<BulkRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = async () => {
    if (results.some((r) => r.errors.length)) { setShowErrors(true); return; }
    if (await onSave(results.map((r) => r.change!))) onClose();
  };

  const tri = (row: BulkRow, field: 'closedToArrival' | 'closedToDeparture' | 'stopSell', key: 'cta' | 'ctd' | 'stopSell') => (
    <FormControl size="small" sx={{ minWidth: 170 }}>
      <InputLabel>{t(`admin.pricing.glossary.${field}.term`)}</InputLabel>
      <Select label={t(`admin.pricing.glossary.${field}.term`)} value={row[field]}
        onChange={(e) => update(row.id, { [field]: e.target.value as TriState } as Partial<BulkRow>)}>
        <MenuItem value="keep">{t('admin.pricing.calendar.bulk.keep')}</MenuItem>
        <MenuItem value="on">{t(`admin.pricing.calendar.bulk.${key}.on`)}</MenuItem>
        <MenuItem value="off">{t(`admin.pricing.calendar.bulk.${key}.off`)}</MenuItem>
      </Select>
    </FormControl>
  );

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('admin.pricing.calendar.bulk.title')}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('admin.pricing.calendar.bulk.intro')}</Typography>
        {stagedCount > 0 && <Alert severity="info" sx={{ mb: 2 }}>{t('admin.pricing.calendar.bulk.includesStaged', { count: stagedCount })}</Alert>}

        {rows.map((row, i) => {
          const nights = bulkRowNights(row);
          const errors: BulkRowError[] = results[i]?.errors ?? [];
          const selected = plans.filter((p) => row.ratePlanIds.includes(p._id));
          return (
            <Paper key={row.id} variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700}>{t('admin.pricing.calendar.bulk.row', { n: i + 1 })}</Typography>
                {rows.length > 1 && (
                  <Tooltip title={t('admin.pricing.calendar.bulk.removeRow')}>
                    <IconButton size="small" onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}><DeleteOutline fontSize="small" /></IconButton>
                  </Tooltip>
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 1.5 }}>
                <Autocomplete
                  multiple size="small" sx={{ flex: 1 }} options={plans} value={selected} disableCloseOnSelect
                  groupBy={(p) => p.roomTypeName} getOptionLabel={(p) => p.name} isOptionEqualToValue={(a, b) => a._id === b._id}
                  onChange={(_, v) => update(row.id, { ratePlanIds: v.map((p) => p._id) })}
                  renderTags={(value, getTagProps) => value.map((p, idx) => (
                    <Chip size="small" label={`${p.roomTypeName} · ${p.name}`} {...getTagProps({ index: idx })} key={p._id} />
                  ))}
                  renderInput={(params) => <TextField {...params} label={t('admin.pricing.calendar.bulk.plans')} />}
                />
                <Button size="small" sx={{ mt: 0.5, whiteSpace: 'nowrap' }} onClick={() => update(row.id, { ratePlanIds: plans.map((p) => p._id) })}>
                  {t('admin.pricing.calendar.bulk.allPlans')}
                </Button>
              </Box>

              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
                <TextField size="small" type="date" label={t('admin.pricing.calendar.bulk.dateFrom')} InputLabelProps={{ shrink: true }}
                  value={row.dateFrom} inputProps={{ min: today }}
                  onChange={(e) => update(row.id, { dateFrom: e.target.value, ...(row.dateTo < e.target.value ? { dateTo: e.target.value } : {}) })} />
                <TextField size="small" type="date" label={t('admin.pricing.calendar.bulk.dateTo')} InputLabelProps={{ shrink: true }}
                  value={row.dateTo} inputProps={{ min: row.dateFrom || today }}
                  onChange={(e) => update(row.id, { dateTo: e.target.value })} />
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">{t('admin.pricing.calendar.bulk.days')}</Typography>
                  <ToggleButtonGroup size="small" value={row.days} onChange={(_, v: WeekdayCode[]) => update(row.id, { days: v })}>
                    {WEEKDAYS.map((d) => (
                      <ToggleButton key={d} value={d} sx={{ px: 1, py: 0.25 }}>{t(`admin.pricing.calendar.weekdays.${d}`)}</ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                  {row.days.length < 7 && (
                    <Button size="small" sx={{ ml: 0.5 }} onClick={() => update(row.id, { days: [...WEEKDAYS] })}>{t('admin.pricing.calendar.bulk.everyDay')}</Button>
                  )}
                </Box>
              </Box>

              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
                <TextField size="small" label={<Term term="price" />} placeholder={t('admin.pricing.calendar.bulk.empty')}
                  value={row.price} disabled={row.resetPrice} sx={{ width: 150 }} inputProps={{ inputMode: 'decimal' }}
                  onChange={(e) => update(row.id, { price: e.target.value })} />
                <TextField size="small" label={<Term term="minStayArrival" />} placeholder={t('admin.pricing.calendar.bulk.empty')}
                  value={row.minStayArrival} sx={{ width: 230 }} inputProps={{ inputMode: 'numeric' }}
                  onChange={(e) => update(row.id, { minStayArrival: e.target.value })} />
                <TextField size="small" label={<Term term="maxStay" />} placeholder={t('admin.pricing.calendar.cell.noMax')}
                  value={row.maxStay} sx={{ width: 230 }} inputProps={{ inputMode: 'numeric' }}
                  onChange={(e) => update(row.id, { maxStay: e.target.value })} />
              </Box>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
                {tri(row, 'closedToArrival', 'cta')}
                {tri(row, 'closedToDeparture', 'ctd')}
                {tri(row, 'stopSell', 'stopSell')}
              </Box>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <FormControlLabel control={<Checkbox size="small" checked={row.resetPrice} onChange={(e) => update(row.id, { resetPrice: e.target.checked, ...(e.target.checked ? { price: '' } : {}) })} />}
                  label={<Typography variant="body2">{t('admin.pricing.calendar.bulk.resetPrice')}</Typography>} />
                <FormControlLabel control={<Checkbox size="small" checked={row.resetRestrictions} onChange={(e) => update(row.id, { resetRestrictions: e.target.checked })} />}
                  label={<Typography variant="body2">{t('admin.pricing.calendar.bulk.resetRestrictions')}</Typography>} />
              </Box>

              <Typography variant="body2" sx={{ mt: 1 }} color={nights && row.ratePlanIds.length ? 'text.primary' : 'text.secondary'}>
                {t('admin.pricing.calendar.bulk.preview', {
                  nights: t('admin.pricing.calendar.bulk.previewNights', { count: nights }),
                  plans: t('admin.pricing.calendar.bulk.previewPlans', { count: row.ratePlanIds.length }),
                })}
              </Typography>
              {showErrors && errors.length > 0 && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {errors.map((e) => <div key={e}>{t(`admin.pricing.calendar.bulk.errors.${e}`)}</div>)}
                </Alert>
              )}
            </Paper>
          );
        })}

        <Button startIcon={<Add />} onClick={() => setRows((rs) => [...rs, emptyBulkRow(today, rs[rs.length - 1]?.ratePlanIds ?? [])])}>
          {t('admin.pricing.calendar.bulk.addRow')}
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('admin.pricing.calendar.cell.cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{t('admin.pricing.calendar.bulk.save')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default BulkEditDialog;
