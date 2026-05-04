/**
 * ReservationFilters
 *
 * Filter bar for the ReservationManagement list page.
 * Purely presentational — all state and callbacks come from the parent.
 */
import React from 'react';
import { Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, TextField } from '@mui/material';
import { Add } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface ReservationServices {
  daypass: boolean;
  accommodation: boolean;
  pasatarde: boolean;
  event: boolean;
}

interface Props {
  filterStatus: string;
  filterType: 'all' | 'room' | 'daypass' | 'PasaTarde' | 'event';
  searchInput: string;
  filterDateFrom: string;
  filterDateTo: string;
  reservationServices: ReservationServices;
  onFilterStatusChange: (v: string) => void;
  onFilterTypeChange: (v: 'all' | 'room' | 'daypass' | 'PasaTarde' | 'event') => void;
  onSearchInputChange: (v: string) => void;
  onFilterDateFromChange: (v: string) => void;
  onFilterDateToChange: (v: string) => void;
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
  reservationServices,
  onFilterStatusChange,
  onFilterTypeChange,
  onSearchInputChange,
  onFilterDateFromChange,
  onFilterDateToChange,
  onFilterToday,
  onClear,
  onCreateNew,
}) => {
  const { t } = useTranslation();

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel>{t('admin.reservations.filters.statusLabel')}</InputLabel>
        <Select
          value={filterStatus}
          label={t('admin.reservations.filters.statusLabel')}
          onChange={e => onFilterStatusChange(e.target.value)}
        >
          <MenuItem value="all">{t('admin.reservations.filters.status.all')}</MenuItem>
          <MenuItem value="pending">{t('admin.reservations.statusLabels.pending')}</MenuItem>
          <MenuItem value="confirmed">{t('admin.reservations.statusLabels.confirmed')}</MenuItem>
          <MenuItem value="checked-in">{t('admin.reservations.statusLabels.checked_in')}</MenuItem>
          <MenuItem value="checked-out">{t('admin.reservations.statusLabels.checked_out')}</MenuItem>
          <MenuItem value="cancelled">{t('admin.reservations.statusLabels.cancelled')}</MenuItem>
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel>{t('admin.reservations.filters.typeLabel')}</InputLabel>
        <Select
          value={filterType}
          label={t('admin.reservations.filters.typeLabel')}
          onChange={e => onFilterTypeChange(e.target.value as any)}
        >
          <MenuItem value="all">{t('admin.reservations.filters.types.all')}</MenuItem>
          {reservationServices.accommodation && <MenuItem value="room">{t('admin.reservations.typeLabels.room')}</MenuItem>}
          {reservationServices.daypass        && <MenuItem value="daypass">{t('admin.reservations.typeLabels.daypass')}</MenuItem>}
          {reservationServices.pasatarde      && <MenuItem value="PasaTarde">{t('admin.reservations.typeLabels.pasatarde')}</MenuItem>}
          {reservationServices.event          && <MenuItem value="event">{t('admin.reservations.typeLabels.event')}</MenuItem>}
        </Select>
      </FormControl>

      <TextField
        size="small"
        label={t('admin.reservations.filters.search')}
        value={searchInput}
        onChange={e => onSearchInputChange(e.target.value)}
      />

      <TextField
        size="small" type="date"
        label={t('admin.reservations.filters.from')}
        value={filterDateFrom}
        onChange={e => onFilterDateFromChange(e.target.value)}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        size="small" type="date"
        label={t('admin.reservations.filters.to')}
        value={filterDateTo}
        onChange={e => onFilterDateToChange(e.target.value)}
        InputLabelProps={{ shrink: true }}
      />

      <Button onClick={onFilterToday}>{t('admin.reservations.filters.today')}</Button>

      <Button color="error" variant="outlined" onClick={onClear}>
        {t('admin.reservations.filters.clear')}
      </Button>

      {onCreateNew && (
        <Box sx={{ ml: 'auto' }}>
          <Button variant="contained" size="large" startIcon={<Add />} onClick={onCreateNew}>
            {t('admin.reservations.actions.newReservation', 'New Reservation')}
          </Button>
        </Box>
      )}
    </Box>
    </Paper>
  );
};

export default ReservationFilters;
