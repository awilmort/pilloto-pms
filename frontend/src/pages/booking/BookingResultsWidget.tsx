/**
 * BookingResultsWidget — Standalone embeddable room/service display.
 *
 * Rendered at /booking/widget/results?checkIn=...&checkOut=...&adults=...&children=...
 * Designed to be loaded in an iframe on a tenant's external website.
 *
 * Shows available room types and online-bookable services for the given params.
 * "Book Now" buttons link to the full booking page.
 */

import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, CardMedia, CardActions,
  Button, Grid, CircularProgress, Stack, Chip, Divider, Alert,
  ThemeProvider, createTheme, CssBaseline,
} from '@mui/material';
import BedIcon from '@mui/icons-material/Bed';
import { bookingService } from '../../services/api';
import { resolveMediaUrl } from '../../services/api';

function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

const BookingResultsWidget: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [availability, setAvailability] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = new URLSearchParams(window.location.search);
  const checkIn = params.get('checkIn') || '';
  const checkOut = params.get('checkOut') || '';
  const adults = parseInt(params.get('adults') || '2', 10);
  const children = parseInt(params.get('children') || '0', 10);

  useEffect(() => {
    const load = async () => {
      try {
        const [configRes, availRes, svcRes] = await Promise.all([
          bookingService.getConfig(),
          checkIn && checkOut
            ? bookingService.getAvailability({ checkIn, checkOut, adults, children })
            : Promise.resolve({ data: { data: [] } }),
          bookingService.getServices(),
        ]);
        setConfig(configRes.data?.data);
        setAvailability(availRes.data?.data || []);
        setServices(svcRes.data?.data || []);
      } catch {
        setError('Unable to load availability.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [checkIn, checkOut, adults, children]);

  const primaryColor = config?.primaryColor || '#2D3748';
  const currency = config?.currency || 'USD';

  const nights = checkIn && checkOut
    ? Math.max(1, Math.ceil(
        (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000
      ))
    : 0;

  const widgetTheme = createTheme({
    palette: { primary: { main: primaryColor } },
    typography: { fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif' },
  });

  const bookingBaseUrl = `${window.location.origin}/booking`;

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <ThemeProvider theme={widgetTheme}>
      <CssBaseline />
      <Box sx={{ p: 2, fontFamily: '"Roboto", sans-serif' }}>
        {config?.tenantName && (
          <Typography variant="h6" fontWeight={700} sx={{ color: primaryColor, mb: 2 }}>
            {config.tenantName}
          </Typography>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {!checkIn || !checkOut ? (
          <Alert severity="info">
            Please provide checkIn and checkOut dates as URL parameters.
          </Alert>
        ) : (
          <>
            {/* Date summary */}
            <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
              <Chip label={`Check-in: ${checkIn}`} size="small" variant="outlined" />
              <Chip label={`Check-out: ${checkOut}`} size="small" variant="outlined" />
              {nights > 0 && <Chip label={`${nights} night${nights > 1 ? 's' : ''}`} size="small" color="primary" />}
            </Stack>

            {/* Rooms */}
            {availability.length > 0 && (
              <>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>Available Rooms</Typography>
                <Grid container spacing={2} sx={{ mb: 3 }}>
                  {availability.map((room: any) => (
                    <Grid item xs={12} sm={6} key={room.roomType._id}>
                      <Card variant="outlined" sx={{ borderRadius: 2 }}>
                        {room.roomType?.image && (
                          <CardMedia
                            component="img"
                            height={140}
                            image={resolveMediaUrl(room.roomType.image)}
                            alt={room.roomType.name}
                            sx={{ objectFit: 'cover' }}
                          />
                        )}
                        <CardContent sx={{ pb: 1 }}>
                          <Typography variant="subtitle1" fontWeight={600}>{room.roomType.name}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            Up to {room.roomType.capacity} guests
                          </Typography>
                          <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mt: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                              {formatCurrency(room.pricing.perNight, currency)}/night
                            </Typography>
                            <Typography variant="h6" fontWeight={700} color={primaryColor}>
                              {formatCurrency(room.pricing.finalTotal, currency)}
                            </Typography>
                          </Stack>
                        </CardContent>
                        <CardActions sx={{ px: 2, pb: 2 }}>
                          <Button
                            variant="contained"
                            size="small"
                            fullWidth
                            href={`${bookingBaseUrl}?checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&children=${children}`}
                            target="_blank"
                            rel="noopener"
                            sx={{
                              bgcolor: primaryColor,
                              '&:hover': { bgcolor: `${primaryColor}dd` },
                              textTransform: 'none',
                              fontWeight: 600,
                            }}
                          >
                            Book Now
                          </Button>
                        </CardActions>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </>
            )}

            {availability.length === 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>No rooms available for the selected dates.</Alert>
            )}

            {/* Services */}
            {services.length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>Services</Typography>
                <Grid container spacing={2}>
                  {services.map((svc: any) => (
                    <Grid item xs={12} sm={6} key={svc._id}>
                      <Card variant="outlined" sx={{ borderRadius: 2 }}>
                        <CardContent>
                          <Typography variant="subtitle1" fontWeight={600}>{svc.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {svc.chargeBasis === 'perPerson' ? 'Per person' :
                             svc.chargeBasis === 'perRoom' ? 'Per room' :
                             svc.chargeBasis === 'perStay' ? 'Per stay' : 'Per event'}
                          </Typography>
                          {svc.prices?.[0]?.price != null && (
                            <Typography variant="h6" fontWeight={700} color={primaryColor} sx={{ mt: 1 }}>
                              {formatCurrency(svc.prices[0].price, currency)}
                            </Typography>
                          )}
                        </CardContent>
                        <CardActions sx={{ px: 2, pb: 2 }}>
                          <Button
                            variant="outlined"
                            size="small"
                            fullWidth
                            href={bookingBaseUrl}
                            target="_blank"
                            rel="noopener"
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                          >
                            Book Now
                          </Button>
                        </CardActions>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </>
            )}
          </>
        )}

        <Typography variant="caption" sx={{ display: 'block', mt: 2, textAlign: 'center', opacity: 0.5 }}>
          Powered by Pilloto
        </Typography>
      </Box>
    </ThemeProvider>
  );
};

export default BookingResultsWidget;
