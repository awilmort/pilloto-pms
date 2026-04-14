/**
 * SingleDatePicker — Pill-shaped single-date calendar picker.
 *
 * Matches the visual design of DateRangePicker (pill trigger + popover calendar).
 * Opens a single-month calendar; clicking a day selects it and closes the popover.
 */

import React, { useState, useRef, useMemo } from 'react';
import {
  Box, Popover, Typography, IconButton, Stack, Button,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';

// ── Design tokens ─────────────────────────────────────────────────────────────
const ACCENT = '#F06543';
const TEXT_PRIMARY = '#222222';
const TEXT_SECONDARY = '#717171';
const BORDER = '#EBEBEB';
const FONT = '"Inter", "Plus Jakarta Sans", "Helvetica", sans-serif';

// ── Helpers ───────────────────────────────────────────────────────────────────
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
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

const WEEKDAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LABELS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// ── Month calendar (single selection) ────────────────────────────────────────
interface MonthCalendarProps {
  year: number;
  month: number;
  selectedDate: Date | null;
  hoverDate: Date | null;
  minDate?: Date;
  maxDate?: Date;
  onDayClick: (d: Date) => void;
  onDayHover: (d: Date | null) => void;
}

function MonthCalendar({
  year, month, selectedDate, hoverDate, minDate, maxDate, onDayClick, onDayHover,
}: MonthCalendarProps) {
  const { i18n } = useTranslation();
  const isEs = i18n.language?.startsWith('es');
  const weekdays = isEs ? WEEKDAY_LABELS_ES : WEEKDAY_LABELS_EN;
  const monthNames = isEs ? MONTH_NAMES_ES : MONTH_NAMES_EN;

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

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
    const isPast = date < today;
    const isSelected = selectedDate ? isSameDay(date, selectedDate) : false;
    const isHovered = hoverDate && !isSelected ? isSameDay(date, hoverDate) : false;

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
          borderRadius: '50%',
          bgcolor: isSelected
            ? ACCENT
            : isHovered
              ? 'rgba(240,101,67,0.1)'
              : 'transparent',
          color: isSelected
            ? 'white'
            : isDisabled || isPast
              ? '#DDDDDD'
              : TEXT_PRIMARY,
          cursor: isDisabled || isPast ? 'default' : 'pointer',
          fontFamily: FONT,
          fontSize: '0.875rem',
          fontWeight: isSelected ? 700 : 400,
          transition: 'background-color 0.15s ease-out',
          '&:hover': !isDisabled && !isPast ? {
            bgcolor: isSelected ? ACCENT : 'rgba(240,101,67,0.1)',
          } : {},
        }}
      >
        {day}
      </Box>
    );
  }

  return (
    <Box sx={{ width: 300, px: 1 }}>
      <Typography sx={{
        textAlign: 'center',
        fontWeight: 600,
        fontFamily: FONT,
        fontSize: '0.95rem',
        color: TEXT_PRIMARY,
        mb: 1.5,
      }}>
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

// ── SingleDatePicker ──────────────────────────────────────────────────────────
export interface SingleDatePickerProps {
  date: string;           // ISO date string or ''
  onChange: (date: string) => void;
  minDate?: Date;
  maxDate?: Date;
  placeholder?: string;
}

const SingleDatePicker: React.FC<SingleDatePickerProps> = ({
  date, onChange, minDate, maxDate, placeholder,
}) => {
  const { t, i18n } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  const selectedDate = useMemo(() => parseDate(date), [date]);

  const now = new Date();
  const [month, setMonth] = useState(selectedDate ? selectedDate.getMonth() : now.getMonth());
  const [year, setYear] = useState(selectedDate ? selectedDate.getFullYear() : now.getFullYear());

  const handlePrev = () => {
    if (month === 0) {
      setMonth(11);
      setYear(y => y - 1);
    } else {
      setMonth(m => m - 1);
    }
  };

  const handleNext = () => {
    if (month === 11) {
      setMonth(0);
      setYear(y => y + 1);
    } else {
      setMonth(m => m + 1);
    }
  };

  const handleDayClick = (d: Date) => {
    onChange(formatDate(d));
    setOpen(false);
  };

  const handleClear = () => {
    onChange('');
  };

  const isEs = i18n.language?.startsWith('es');

  const formatDisplayDate = (d: Date | null) => {
    if (!d) return null;
    return d.toLocaleDateString(isEs ? 'es' : 'en', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const displayText = selectedDate
    ? formatDisplayDate(selectedDate)!
    : placeholder || t('bookingEngine.search.selectDate', 'Seleccionar fecha');

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
          color: selectedDate ? TEXT_PRIMARY : TEXT_SECONDARY,
          fontWeight: selectedDate ? 500 : 400,
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
          },
        }}
      >
        {/* Month navigation + calendar */}
        <Stack direction="row" alignItems="flex-start" justifyContent="center" spacing={2}>
          <IconButton onClick={handlePrev} size="small" sx={{ mt: 0.5 }}>
            <ChevronLeftIcon />
          </IconButton>
          <MonthCalendar
            year={year}
            month={month}
            selectedDate={selectedDate}
            hoverDate={hoverDate}
            minDate={minDate}
            maxDate={maxDate}
            onDayClick={handleDayClick}
            onDayHover={setHoverDate}
          />
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
            {t('bookingEngine.search.clearDate', 'Limpiar')}
          </Button>
        </Stack>
      </Popover>
    </>
  );
};

export default SingleDatePicker;
