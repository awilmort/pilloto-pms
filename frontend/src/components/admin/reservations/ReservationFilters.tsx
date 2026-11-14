/**
 * ReservationFilters
 *
 * Filter bar for the ReservationManagement list page.
 * Purely presentational — all state and callbacks come from the parent.
 *
 * Layout: search + the primary action on top; status as one-click chips (the filter people change
 * most); then an aligned grid for type, origin and dates, with "Today" and "Clear" beside it.
 */
import React from 'react';
import {
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { Add, Clear, FilterAltOff, Search, TodayOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { otaLabel } from '../../../utils/channels';

interface ReservationServices {
  daypass: boolean;
  accommodation: boolean;
  pasatarde: boolean;
  event: boolean;
}

type FilterType = 'all' | 'room' | 'daypass' | 'PasaTarde' | 'event';

/** Status chips, in lifecycle order; `value` is what the API filters on, `labelKey` the statusLabels entry. */
const STATUS_CHIPS: Array<{ value: string; labelKey: string }> = [
  { value: 'pending', labelKey: 'pending' },
  { value: 'confirmed', labelKey: 'confirmed' },
  { value: 'checked-in', labelKey: 'checked_in' },
  { value: 'checked-out', labelKey: 'checked_out' },
  { value: 'cancelled', labelKey: 'cancelled' },
];

interface Props {
  filterStatus: string;
  filterType: FilterType;
  searchInput: string;
  filterDateFrom: string;
  filterDateTo: string;
  /** '' | 'direct' | 'booking_engine' | 'channel' | 'ota:<name>' */
  filterSource: string;
  /** OTA names reservations came from */
  channelSources: string[];
  reservationServices: ReservationServices;
  /** Number of reservations currently listed; omitted until the first load finishes. */
  resultCount?: number;
  onFilterStatusChange: (v: string) => void;
  onFilterTypeChange: (v: FilterType) => void;
  onSearchInputChange: (v: string) => void;
  onFilterDateFromChange: (v: string) => void;
  onFilterDateToChange: (v: string) => void;
  onFilterSourceChange: (v: string) => void;
  onFilterToday: () => void;
  onClear: () => void;
  onCreateNew?: () => void;
}

const ReservationFilters: React.FC<Props> = ({
  filterStatus,
  filterType,
  searchInput,
  filterDateFrom,
  filterDateTo,
  filterSource,
  channelSources,
  reservationServices,
  resultCount,
  onFilterStatusChange,
  onFilterTypeChange,
  onSearchInputChange,
  onFilterDateFromChange,
  onFilterDateToChange,
  onFilterSourceChange,
  onFilterToday,
  onClear,
  onCreateNew,
}) => {
  const { t } = useTranslation();

  const activeCount =
    (filterStatus !== 'all' ? 1 : 0) +
    (filterType !== 'all' ? 1 : 0) +
    (filterSource ? 1 : 0) +
    (searchInput.trim() ? 1 : 0) +
    (filterDateFrom ? 1 : 0) +
    (filterDateTo ? 1 : 0);

  return (
    <Paper sx={{ p: { xs: 2, md: 2.5 }, mb: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Row 1 — search on the left, the primary action on the right */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder={t('admin.reservations.filters.search')}
          value={searchInput}
          onChange={(e) => onSearchInputChange(e.target.value)}
          inputProps={{ 'aria-label': t('admin.reservations.filters.search') }}
          sx={{ flex: '1 1 280px', maxWidth: { md: 520 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: searchInput ? (
              <InputAdornment position="end">
                <IconButton size="small" edge="end" aria-label={t('admin.reservations.filters.clear')} onClick={() => onSearchInputChange('')}>
                  <Clear fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />
        {onCreateNew && (
          <Button variant="contained" startIcon={<Add />} onClick={onCreateNew} sx={{ ml: 'auto', flexShrink: 0 }}>
            {t('admin.reservations.actions.newReservation', 'New Reservation')}
          </Button>
        )}
      </Box>

      {/* Row 2 — status, one click */}
      <Box role="group" aria-label={t('admin.reservations.filters.statusLabel')} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          label={t('admin.reservations.filters.status.allShort')}
          color={filterStatus === 'all' ? 'primary' : 'default'}
          variant={filterStatus === 'all' ? 'filled' : 'outlined'}
          onClick={() => onFilterStatusChange('all')}
          aria-pressed={filterStatus === 'all'}
        />
        {STATUS_CHIPS.map(({ value, labelKey }) => {
          const selected = filterStatus === value;
          return (
            <Chip
              key={value}
              label={t(`admin.reservations.statusLabels.${labelKey}`)}
              color={selected ? 'primary' : 'default'}
              variant={selected ? 'filled' : 'outlined'}
              onClick={() => onFilterStatusChange(selected ? 'all' : value)}
              aria-pressed={selected}
            />
          );
        })}
      </Box>

      {/* Row 3 — type, origin, dates; shortcuts at the end */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          alignItems: 'center',
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr)) auto' },
        }}
      >
        <FormControl size="small" fullWidth sx={{ gridColumn: { xs: 'span 2', sm: 'auto' } }}>
          <InputLabel>{t('admin.reservations.filters.typeLabel')}</InputLabel>
          <Select
            value={filterType}
            label={t('admin.reservations.filters.typeLabel')}
            onChange={(e) => onFilterTypeChange(e.target.value as FilterType)}
          >
            <MenuItem value="all">{t('admin.reservations.filters.types.all')}</MenuItem>
            {reservationServices.accommodation && <MenuItem value="room">{t('admin.reservations.typeLabels.room')}</MenuItem>}
            {reservationServices.daypass && <MenuItem value="daypass">{t('admin.reservations.typeLabels.daypass')}</MenuItem>}
            {reservationServices.pasatarde && <MenuItem value="PasaTarde">{t('admin.reservations.typeLabels.pasatarde')}</MenuItem>}
            {reservationServices.event && <MenuItem value="event">{t('admin.reservations.typeLabels.event')}</MenuItem>}
          </Select>
        </FormControl>

        <FormControl size="small" fullWidth sx={{ gridColumn: { xs: 'span 2', sm: 'auto' } }}>
          <InputLabel>{t('admin.reservations.filters.sourceLabel')}</InputLabel>
          <Select
            value={filterSource}
            label={t('admin.reservations.filters.sourceLabel')}
            onChange={(e) => onFilterSourceChange(e.target.value)}
          >
            <MenuItem value="">{t('admin.reservations.filters.sources.all')}</MenuItem>
            <MenuItem value="direct">{t('admin.reservations.filters.sources.direct')}</MenuItem>
            <MenuItem value="booking_engine">{t('admin.reservations.filters.sources.booking_engine')}</MenuItem>
            {channelSources.length > 0 && <MenuItem value="channel">{t('admin.reservations.filters.sources.channel')}</MenuItem>}
            {channelSources.map((name) => (
              <MenuItem key={name} value={`ota:${name}`}>{otaLabel(name)}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          size="small"
          type="date"
          fullWidth
          label={t('admin.reservations.filters.from')}
          value={filterDateFrom}
          onChange={(e) => onFilterDateFromChange(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ max: filterDateTo || undefined }}
        />
        <TextField
          size="small"
          type="date"
          fullWidth
          label={t('admin.reservations.filters.to')}
          value={filterDateTo}
          onChange={(e) => onFilterDateToChange(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ min: filterDateFrom || undefined }}
        />

        <Box sx={{ display: 'flex', gap: 1, justifyContent: { xs: 'flex-start', lg: 'flex-end' }, gridColumn: { xs: 'span 2', lg: 'auto' } }}>
          <Button size="small" variant="outlined" color="inherit" startIcon={<TodayOutlined />} onClick={onFilterToday} sx={{ borderColor: 'divider' }}>
            {t('admin.reservations.filters.today')}
          </Button>
          <Button size="small" color="inherit" startIcon={<FilterAltOff />} onClick={onClear} disabled={activeCount === 0}>
            {t('admin.reservations.filters.clear')}{activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>
        </Box>
      </Box>

      {resultCount !== undefined && (
        <Typography variant="caption" color="text.secondary" aria-live="polite">
          {t('admin.reservations.resultCount', { count: resultCount })}
        </Typography>
      )}
    </Paper>
  );
};

export default ReservationFilters;
