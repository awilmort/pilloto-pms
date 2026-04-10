/**
 * GuestSelector — Airbnb-style guest count dropdown.
 *
 * Pill-shaped trigger button that opens a popover with
 * Adults and Children rows, each with +/- stepper buttons.
 */

import React, { useState, useRef } from 'react';
import {
  Box, Popover, Typography, IconButton, Stack, Button, Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import PersonIcon from '@mui/icons-material/Person';
import { useTranslation } from 'react-i18next';

const ACCENT = '#F06543';   // Sunset Orange — matches booking page
const TEXT_PRIMARY = '#222222';
const TEXT_SECONDARY = '#717171';
const BORDER = '#EBEBEB';
const FONT = '"Inter", "Plus Jakarta Sans", "Helvetica", sans-serif';

interface GuestSelectorProps {
  adults: number;
  children: number;
  onChange: (adults: number, children: number) => void;
  maxGuests?: number;
}

interface CounterRowProps {
  label: string;
  subtitle: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

function CounterRow({ label, subtitle, value, min, max, onChange }: CounterRowProps) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 1.5 }}>
      <Box>
        <Typography sx={{ fontFamily: FONT, fontWeight: 500, color: TEXT_PRIMARY, fontSize: '0.95rem' }}>
          {label}
        </Typography>
        <Typography sx={{ fontFamily: FONT, color: TEXT_SECONDARY, fontSize: '0.8rem' }}>
          {subtitle}
        </Typography>
      </Box>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <IconButton
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          size="small"
          sx={{
            border: `1px solid ${value <= min ? '#EBEBEB' : '#B0B0B0'}`,
            width: 32,
            height: 32,
            color: value <= min ? '#EBEBEB' : TEXT_SECONDARY,
            '&:hover': { borderColor: TEXT_PRIMARY, color: TEXT_PRIMARY },
            transition: 'all 0.15s ease-out',
          }}
        >
          <RemoveIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <Typography sx={{ fontFamily: FONT, fontWeight: 500, minWidth: 24, textAlign: 'center' }}>
          {value}
        </Typography>
        <IconButton
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          size="small"
          sx={{
            border: `1px solid ${value >= max ? '#EBEBEB' : '#B0B0B0'}`,
            width: 32,
            height: 32,
            color: value >= max ? '#EBEBEB' : TEXT_SECONDARY,
            '&:hover': { borderColor: TEXT_PRIMARY, color: TEXT_PRIMARY },
            transition: 'all 0.15s ease-out',
          }}
        >
          <AddIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
    </Stack>
  );
}

const GuestSelector: React.FC<GuestSelectorProps> = ({
  adults, children: childrenCount, onChange, maxGuests = 50,
}) => {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const totalGuests = adults + childrenCount;
  const displayText = childrenCount > 0
    ? `${adults} ${t('bookingEngine.search.adults').toLowerCase()}, ${childrenCount} ${t('bookingEngine.search.children').toLowerCase()}`
    : `${totalGuests} ${t('bookingEngine.guests.guests', 'guests')}`;

  return (
    <>
      <Box
        ref={anchorRef}
        onClick={() => setOpen(true)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          height: 44,
          px: 2,
          borderRadius: '9999px',
          border: `1px solid ${open ? ACCENT : BORDER}`,
          cursor: 'pointer',
          fontFamily: FONT,
          fontSize: '0.875rem',
          color: TEXT_PRIMARY,
          fontWeight: 500,
          bgcolor: 'white',
          transition: 'all 0.2s ease-out',
          whiteSpace: 'nowrap',
          '&:hover': { borderColor: TEXT_PRIMARY },
        }}
      >
        <PersonIcon sx={{ fontSize: 18, color: TEXT_SECONDARY }} />
        {displayText}
      </Box>

      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{
          sx: {
            borderRadius: '16px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.15)',
            mt: 1,
            p: 3,
            minWidth: 300,
          },
        }}
      >
        <CounterRow
          label={t('bookingEngine.guests.adults', 'Adults')}
          subtitle={t('bookingEngine.guests.adultsSubtitle', 'Ages 13 or above')}
          value={adults}
          min={1}
          max={maxGuests - childrenCount}
          onChange={v => onChange(v, childrenCount)}
        />
        <Divider sx={{ borderColor: BORDER }} />
        <CounterRow
          label={t('bookingEngine.guests.children', 'Children')}
          subtitle={t('bookingEngine.guests.childrenSubtitle', 'Ages 0–12')}
          value={childrenCount}
          min={0}
          max={maxGuests - adults}
          onChange={v => onChange(adults, v)}
        />
      </Popover>
    </>
  );
};

export default GuestSelector;
