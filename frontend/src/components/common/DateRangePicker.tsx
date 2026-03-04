import React, { useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Paper,
  alpha,
  useTheme,
} from '@mui/material';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface DateRangePickerProps {
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  onChange: (start: string, end: string) => void;
  /** Minimum selectable date (YYYY-MM-DD). Defaults to today. */
  minDate?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function toStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return toStr(new Date());
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// ─── Component ─────────────────────────────────────────────────────────────────
const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onChange,
  minDate,
}) => {
  const theme = useTheme();
  const minDateStr = minDate ?? todayStr();

  // Which month the LEFT panel shows (0-indexed month)
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  // Single-click state: first click = start, second click = end
  const [selecting, setSelecting] = useState<'start' | 'end'>('start');
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // Right panel is always left+1 month
  const rightYear = viewMonth === 11 ? viewYear + 1 : viewYear;
  const rightMonth = viewMonth === 11 ? 0 : viewMonth + 1;

  const canGoBack = (() => {
    const minD = new Date(minDateStr + 'T00:00:00');
    return (
      viewYear > minD.getFullYear() ||
      (viewYear === minD.getFullYear() && viewMonth > minD.getMonth())
    );
  })();

  const goBack = () => {
    if (!canGoBack) return;
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };

  const goForward = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const handleDayClick = (dateStr: string) => {
    if (dateStr < minDateStr) return;
    if (selecting === 'start') {
      onChange(dateStr, '');
      setSelecting('end');
    } else {
      if (!startDate || dateStr <= startDate) {
        // clicked before (or same as) existing start → new start
        onChange(dateStr, '');
        setSelecting('end');
      } else {
        onChange(startDate, dateStr);
        setSelecting('start');
      }
    }
  };

  // ─── Render a single month grid ──────────────────────────────────────────────
  const renderMonth = (year: number, month: number) => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    // Build date strings for hover range preview
    const effectiveEnd =
      endDate ||
      (selecting === 'end' && hoverDate && startDate ? hoverDate : null);

    return (
      <Box sx={{ minWidth: 220 }}>
        {/* Month header */}
        <Typography
          variant="subtitle2"
          sx={{ textAlign: 'center', mb: 1, fontWeight: 700, letterSpacing: '0.03em' }}
        >
          {MONTH_NAMES[month]} {year}
        </Typography>

        {/* Day name headers */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', mb: 0.5 }}>
          {DAY_LABELS.map(dn => (
            <Typography
              key={dn}
              variant="caption"
              sx={{
                textAlign: 'center',
                color: 'text.secondary',
                fontWeight: 600,
                py: 0.25,
                fontSize: '0.7rem',
              }}
            >
              {dn}
            </Typography>
          ))}
        </Box>

        {/* Day cells */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((day, idx) => {
            if (!day) return <Box key={`e-${year}-${month}-${idx}`} />;

            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isPast = dateStr < minDateStr;
            const isStart = dateStr === startDate;
            const isEnd = dateStr === endDate;
            const isRangeEdge = isStart || isEnd;

            let inRange = false;
            if (startDate && effectiveEnd) {
              const lo = startDate < effectiveEnd ? startDate : effectiveEnd;
              const hi = startDate < effectiveEnd ? effectiveEnd : startDate;
              inRange = dateStr > lo && dateStr < hi;
            }

            // Edge rounding: start = left half round, end = right half round
            // If both start and end on same day, full circle
            const sameDay = startDate === endDate && isStart;
            const borderRadius = sameDay || (!endDate && isStart)
              ? '50%'
              : isStart
              ? '50% 0 0 50%'
              : isEnd
              ? '0 50% 50% 0'
              : inRange
              ? '0'
              : '50%';

            return (
              <Box
                key={dateStr}
                onMouseEnter={() => !isPast && setHoverDate(dateStr)}
                onMouseLeave={() => setHoverDate(null)}
                onClick={() => handleDayClick(dateStr)}
                sx={{
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: isPast ? 'default' : 'pointer',
                  bgcolor: inRange
                    ? alpha(theme.palette.primary.main, 0.15)
                    : 'transparent',
                  borderRadius: inRange ? 0 : undefined,
                }}
              >
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius,
                    bgcolor: isRangeEdge
                      ? 'primary.main'
                      : 'transparent',
                    transition: 'background-color 0.1s',
                    '&:hover': !isPast && !isRangeEdge
                      ? { bgcolor: alpha(theme.palette.primary.main, 0.2) }
                      : {},
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '0.8rem',
                      fontWeight: isRangeEdge ? 700 : 400,
                      color: isRangeEdge
                        ? 'primary.contrastText'
                        : isPast
                        ? 'text.disabled'
                        : 'text.primary',
                      userSelect: 'none',
                    }}
                  >
                    {day}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  };

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, borderRadius: 2 }}
    >
      {/* Navigation row */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <IconButton onClick={goBack} disabled={!canGoBack} size="small">
          <ChevronLeft />
        </IconButton>
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={goForward} size="small">
          <ChevronRight />
        </IconButton>
      </Box>

      {/* Two months side by side */}
      <Box
        sx={{
          display: 'flex',
          gap: { xs: 2, sm: 4 },
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        {renderMonth(viewYear, viewMonth)}
        {renderMonth(rightYear, rightMonth)}
      </Box>

      {/* Selection hint */}
      <Typography
        variant="caption"
        sx={{ display: 'block', textAlign: 'center', mt: 1.5, color: 'text.secondary' }}
      >
        {!startDate
          ? 'Select check-in date'
          : !endDate
          ? 'Select check-out date'
          : `${startDate} → ${endDate}`}
      </Typography>
    </Paper>
  );
};

export default DateRangePicker;
