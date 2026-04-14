/**
 * DateRangePicker — Airbnb-style dual-month calendar date range picker.
 *
 * Opens a popover with two side-by-side month calendars.
 * User clicks to select check-in, then check-out.
 * Highlights the selected range between dates.
 */

import React, { useState, useRef, useMemo } from 'react';
import {
  Box, Popover, Typography, IconButton, Stack, Button, useTheme, useMediaQuery,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';

// ── Design tokens (matching booking page) ────────────────────────────────────
const ACCENT = '#F06543';   // Sunset Orange — matches booking page
const TEXT_PRIMARY = '#222222';
const TEXT_SECONDARY = '#717171';
const BORDER = '#EBEBEB';
const FONT = '"Inter", "Plus Jakarta Sans", "Helvetica", sans-serif';

interface DateRangePickerProps {
  checkIn: string;        // ISO date string or ''
  checkOut: string;       // ISO date string or ''
  onChange: (checkIn: string, checkOut: string) => void;
  minDate?: Date;
  maxDate?: Date;
  placeholder?: string;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isInRange(day: Date, start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false;
  return day > start && day < end;
}

interface MonthCalendarProps {
  year: number;
  month: number;
  checkInDate: Date | null;
  checkOutDate: Date | null;
  hoverDate: Date | null;
  minDate?: Date;
  maxDate?: Date;
  onDayClick: (d: Date) => void;
  onDayHover: (d: Date | null) => void;
  selecting: 'checkIn' | 'checkOut';
}

const WEEKDAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LABELS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function MonthCalendar({
  year, month, checkInDate, checkOutDate, hoverDate, minDate, maxDate,
  onDayClick, onDayHover, selecting,
}: MonthCalendarProps) {
  const { i18n } = useTranslation();
  const isEs = i18n.language?.startsWith('es');
  const weekdays = isEs ? WEEKDAY_LABELS_ES : WEEKDAY_LABELS_EN;
  const monthNames = isEs ? MONTH_NAMES_ES : MONTH_NAMES_EN;

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const rangeEnd = selecting === 'checkOut' && checkInDate && hoverDate && !checkOutDate
    ? hoverDate : checkOutDate;

  const cells: React.ReactNode[] = [];

  // Empty cells for days before the 1st
  for (let i = 0; i < firstDay; i++) {
    cells.push(<Box key={`e-${i}`} sx={{ width: 40, height: 40 }} />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isDisabled = (minDate && date < minDate) || (maxDate && date > maxDate);
    const isCheckIn = checkInDate && isSameDay(date, checkInDate);
    const isCheckOut = checkOutDate && isSameDay(date, checkOutDate);
    const inRange = isInRange(date, checkInDate, rangeEnd);
    const isHovered = hoverDate && isSameDay(date, hoverDate) && !isCheckIn && !isCheckOut;
    const isPast = date < today;

    cells.push(
      <Box
        key={day}
        onClick={() => !isDisabled && !isPast && onDayClick(date)}
        onMouseEnter={() => !isDisabled && !isPast && onDayHover(date)}
        onMouseLeave={() => onDayHover(null)}
        sx={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: isCheckIn ? '50% 0 0 50%' : isCheckOut ? '0 50% 50% 0' : inRange ? 0 : '50%',
          bgcolor: isCheckIn || isCheckOut
            ? ACCENT
            : inRange
              ? 'rgba(240,101,67,0.08)'
              : isHovered
                ? 'rgba(240,101,67,0.05)'
                : 'transparent',
          color: isCheckIn || isCheckOut
            ? 'white'
            : isDisabled || isPast
              ? '#DDDDDD'
              : TEXT_PRIMARY,
          cursor: isDisabled || isPast ? 'default' : 'pointer',
          fontFamily: FONT,
          fontSize: '0.875rem',
          fontWeight: isCheckIn || isCheckOut ? 700 : 400,
          transition: 'background-color 0.15s ease-out',
          '&:hover': !isDisabled && !isPast ? {
            bgcolor: isCheckIn || isCheckOut ? ACCENT : 'rgba(240,101,67,0.1)',
          } : {},
          position: 'relative',
          // Range background extends to fill the gap
          ...(inRange && {
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: -1,
              right: -1,
              bottom: 0,
              bgcolor: 'rgba(240,101,67,0.08)',
              zIndex: -1,
            },
          }),
        }}
      >
        {day}
      </Box>
    );
  }

  return (
    <Box sx={{ width: 300, px: 1 }}>
      <Typography
        sx={{
          textAlign: 'center',
          fontWeight: 600,
          fontFamily: FONT,
          fontSize: '0.95rem',
          color: TEXT_PRIMARY,
          mb: 1.5,
        }}
      >
        {monthNames[month]} {year}
      </Typography>

      {/* Weekday headers */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 40px)', justifyContent: 'center', mb: 0.5 }}>
        {weekdays.map(d => (
          <Box key={d} sx={{
            textAlign: 'center',
            fontSize: '0.75rem',
            color: TEXT_SECONDARY,
            fontFamily: FONT,
            fontWeight: 600,
            py: 0.5,
          }}>
            {d}
          </Box>
        ))}
      </Box>

      {/* Day grid */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 40px)', justifyContent: 'center' }}>
        {cells}
      </Box>
    </Box>
  );
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({
  checkIn, checkOut, onChange, minDate, maxDate, placeholder,
}) => {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState<'checkIn' | 'checkOut'>('checkIn');
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  const checkInDate = useMemo(() => parseDate(checkIn), [checkIn]);
  const checkOutDate = useMemo(() => parseDate(checkOut), [checkOut]);

  const now = new Date();
  const [leftMonth, setLeftMonth] = useState(checkInDate ? checkInDate.getMonth() : now.getMonth());
  const [leftYear, setLeftYear] = useState(checkInDate ? checkInDate.getFullYear() : now.getFullYear());

  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1;
  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear;

  const handlePrev = () => {
    if (leftMonth === 0) {
      setLeftMonth(11);
      setLeftYear(y => y - 1);
    } else {
      setLeftMonth(m => m - 1);
    }
  };

  const handleNext = () => {
    if (leftMonth === 11) {
      setLeftMonth(0);
      setLeftYear(y => y + 1);
    } else {
      setLeftMonth(m => m + 1);
    }
  };

  const handleDayClick = (date: Date) => {
    const dateStr = formatDate(date);
    if (selecting === 'checkIn') {
      onChange(dateStr, '');
      setSelecting('checkOut');
    } else {
      if (checkInDate && date <= checkInDate) {
        // If clicked date is before check-in, restart
        onChange(dateStr, '');
        setSelecting('checkOut');
      } else {
        onChange(checkIn, dateStr);
        setSelecting('checkIn');
        setOpen(false);
      }
    }
  };

  const handleClear = () => {
    onChange('', '');
    setSelecting('checkIn');
  };

  const isEs = i18n.language?.startsWith('es');

  const formatDisplayDate = (d: Date | null) => {
    if (!d) return null;
    return d.toLocaleDateString(isEs ? 'es' : 'en', { month: 'short', day: 'numeric' });
  };

  const displayText = checkInDate && checkOutDate
    ? `${formatDisplayDate(checkInDate)} — ${formatDisplayDate(checkOutDate)}`
    : checkInDate
      ? `${formatDisplayDate(checkInDate)} — ${t('bookingEngine.search.checkOut')}`
      : placeholder || t('bookingEngine.search.selectDates', 'Select dates');

  return (
    <>
      <Box
        ref={anchorRef}
        onClick={() => setOpen(true)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          height: 44,
          px: 2,
          borderRadius: '9999px',
          border: `1px solid ${open ? ACCENT : BORDER}`,
          cursor: 'pointer',
          fontFamily: FONT,
          fontSize: '0.875rem',
          color: checkInDate ? TEXT_PRIMARY : TEXT_SECONDARY,
          fontWeight: checkInDate ? 500 : 400,
          bgcolor: 'white',
          transition: 'all 0.2s ease-out',
          minWidth: { xs: 160, sm: 200 },
          whiteSpace: 'nowrap',
          '&:hover': { borderColor: TEXT_PRIMARY },
        }}
      >
        {displayText}
      </Box>
      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        PaperProps={{
          sx: {
            borderRadius: '16px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.15)',
            mt: 1,
            p: 3,
            maxWidth: isMobile ? '95vw' : 'auto',
          },
        }}
      >
        {/* Header with selecting indicator */}
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <Box
            onClick={() => setSelecting('checkIn')}
            sx={{
              flex: 1,
              py: 1,
              px: 2,
              borderRadius: '12px',
              border: `2px solid ${selecting === 'checkIn' ? ACCENT : BORDER}`,
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <Typography sx={{ fontSize: '0.7rem', color: TEXT_SECONDARY, fontFamily: FONT, fontWeight: 600, textTransform: 'uppercase' }}>
              {t('bookingEngine.search.checkIn')}
            </Typography>
            <Typography sx={{ fontFamily: FONT, fontWeight: 500, color: checkInDate ? TEXT_PRIMARY : TEXT_SECONDARY, fontSize: '0.9rem' }}>
              {checkInDate ? formatDisplayDate(checkInDate) : t('bookingEngine.search.addDate', 'Add date')}
            </Typography>
          </Box>
          <Box
            onClick={() => setSelecting('checkOut')}
            sx={{
              flex: 1,
              py: 1,
              px: 2,
              borderRadius: '12px',
              border: `2px solid ${selecting === 'checkOut' ? ACCENT : BORDER}`,
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <Typography sx={{ fontSize: '0.7rem', color: TEXT_SECONDARY, fontFamily: FONT, fontWeight: 600, textTransform: 'uppercase' }}>
              {t('bookingEngine.search.checkOut')}
            </Typography>
            <Typography sx={{ fontFamily: FONT, fontWeight: 500, color: checkOutDate ? TEXT_PRIMARY : TEXT_SECONDARY, fontSize: '0.9rem' }}>
              {checkOutDate ? formatDisplayDate(checkOutDate) : t('bookingEngine.search.addDate', 'Add date')}
            </Typography>
          </Box>
        </Stack>

        {/* Month navigation + calendars */}
        <Stack direction="row" alignItems="flex-start" justifyContent="center" spacing={2}>
          <IconButton onClick={handlePrev} size="small" sx={{ mt: 0.5 }}>
            <ChevronLeftIcon />
          </IconButton>
          <Stack direction={isMobile ? 'column' : 'row'} spacing={3}>
            <MonthCalendar
              year={leftYear}
              month={leftMonth}
              checkInDate={checkInDate}
              checkOutDate={checkOutDate}
              hoverDate={hoverDate}
              minDate={minDate}
              maxDate={maxDate}
              onDayClick={handleDayClick}
              onDayHover={setHoverDate}
              selecting={selecting}
            />
            <MonthCalendar
              year={rightYear}
              month={rightMonth}
              checkInDate={checkInDate}
              checkOutDate={checkOutDate}
              hoverDate={hoverDate}
              minDate={minDate}
              maxDate={maxDate}
              onDayClick={handleDayClick}
              onDayHover={setHoverDate}
              selecting={selecting}
            />
          </Stack>
          <IconButton onClick={handleNext} size="small" sx={{ mt: 0.5 }}>
            <ChevronRightIcon />
          </IconButton>
        </Stack>

        {/* Footer */}
        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 2 }}>
          <Button
            size="small"
            onClick={handleClear}
            sx={{ textTransform: 'none', fontFamily: FONT, color: TEXT_PRIMARY, fontWeight: 600, textDecoration: 'underline' }}
          >
            {t('bookingEngine.search.clearDates', 'Clear dates')}
          </Button>
        </Stack>
      </Popover>
    </>
  );
};

export default DateRangePicker;
