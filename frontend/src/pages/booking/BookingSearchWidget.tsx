/**
 * BookingSearchWidget — Standalone embeddable date/guest selector.
 *
 * Rendered at /booking/widget/search — designed to be loaded in an
 * iframe on a tenant's external website.
 *
 * When the user clicks "Search", it posts back to the parent via
 * postMessage or navigates to the full booking page with params.
 */

import React, { useState, useEffect } from 'react';
import {
  Box, TextField, Button, Stack, InputAdornment, Typography,
  CircularProgress, ThemeProvider, createTheme, CssBaseline,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonIcon from '@mui/icons-material/Person';
import ChildCareIcon from '@mui/icons-material/ChildCare';
import { bookingService } from '../../services/api';

const BookingSearchWidget: React.FC = () => {
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [adults, setAdults] = useState<string>('2');
  const [children, setChildren] = useState<string>('0');
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bookingService.getConfig()
      .then(res => setConfig(res.data?.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const primaryColor = config?.primaryColor || '#2D3748';
  const minDate = new Date(Date.now() + (config?.minAdvanceHours || 24) * 3600000)
    .toISOString().split('T')[0];
  const maxDate = new Date(Date.now() + (config?.maxAdvanceDays || 365) * 86400000)
    .toISOString().split('T')[0];

  const widgetTheme = createTheme({
    palette: { primary: { main: primaryColor } },
    typography: { fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif' },
  });

  const handleSearch = () => {
    const params = new URLSearchParams({
      checkIn, checkOut,
      adults: String(Math.max(1, parseInt(adults) || 1)),
      children: String(Math.max(0, parseInt(children) || 0)),
    });

    // Try postMessage to parent (for iframe communication)
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'pilloto-booking-search',
        payload: { checkIn, checkOut, adults: Math.max(1, parseInt(adults) || 1), children: Math.max(0, parseInt(children) || 0) },
      }, '*');
    }

    // Also navigate the top-level window to the booking page
    const bookingUrl = `${window.location.origin}/booking?${params.toString()}`;
    window.open(bookingUrl, '_blank', 'noopener');
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={3}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <ThemeProvider theme={widgetTheme}>
      <CssBaseline />
      <Box sx={{ p: 2, fontFamily: '"Roboto", sans-serif' }}>
        {config?.tenantName && (
          <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ color: primaryColor }}>
            Book at {config.tenantName}
          </Typography>
        )}
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="Check-in"
              type="date"
              value={checkIn}
              onChange={e => setCheckIn(e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: minDate, max: maxDate }}
              fullWidth
              size="small"
            />
            <TextField
              label="Check-out"
              type="date"
              value={checkOut}
              onChange={e => setCheckOut(e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: checkIn || minDate, max: maxDate }}
              fullWidth
              size="small"
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Adults"
              type="number"
              value={adults}
              onChange={e => setAdults(e.target.value)}
              onBlur={() => setAdults(String(Math.max(1, parseInt(adults) || 1)))}
              InputProps={{
                startAdornment: <InputAdornment position="start"><PersonIcon fontSize="small" /></InputAdornment>,
                inputProps: { min: 1, max: 50 },
              }}
              fullWidth
              size="small"
            />
            <TextField
              label="Children"
              type="number"
              value={children}
              onChange={e => setChildren(e.target.value)}
              onBlur={() => setChildren(String(Math.max(0, parseInt(children) || 0)))}
              InputProps={{
                startAdornment: <InputAdornment position="start"><ChildCareIcon fontSize="small" /></InputAdornment>,
                inputProps: { min: 0, max: 50 },
              }}
              fullWidth
              size="small"
            />
          </Stack>
          <Button
            variant="contained"
            fullWidth
            onClick={handleSearch}
            disabled={!checkIn || !checkOut}
            startIcon={<SearchIcon />}
            sx={{
              bgcolor: primaryColor,
              '&:hover': { bgcolor: `${primaryColor}dd` },
              textTransform: 'none',
              fontWeight: 600,
            }}
          >
            Search Availability
          </Button>
        </Stack>
        <Typography variant="caption" sx={{ display: 'block', mt: 1, textAlign: 'center', opacity: 0.5 }}>
          Powered by Pilloto
        </Typography>
      </Box>
    </ThemeProvider>
  );
};

export default BookingSearchWidget;
