/**
 * BookingReservationPage — public customer-facing reservation view.
 *
 * Accessible at /booking/reservation/:code?token=:token
 * The token is required to authenticate the guest's access to their reservation.
 */

import React, { useEffect, useState } from 'react';
import {
  Box, Button, CircularProgress, Container, Divider, Paper,
  Stack, Typography, Alert, Chip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import PersonIcon from '@mui/icons-material/Person';
import GroupIcon from '@mui/icons-material/Group';
import BedIcon from '@mui/icons-material/Bed';
import RoomServiceIcon from '@mui/icons-material/RoomService';
import CommentIcon from '@mui/icons-material/Comment';
import { useParams, useSearchParams } from 'react-router-dom';
import BookingLayout from '../../components/booking/BookingLayout';
import { bookingService } from '../../services/api';

// ── Design tokens (matches BookingPage) ──────────────────────────────────────
const BRAND         = '#0A7EA4';
const BRAND_LIGHT   = '#E6F4F9';
const ACCENT        = '#F06543';
const TEXT_PRIMARY  = '#222222';
const TEXT_SECONDARY = '#717171';
const BORDER        = '#EBEBEB';
const CARD_RADIUS   = '12px';
const BTN_RADIUS    = '8px';
const FONT          = '"Inter", "Plus Jakarta Sans", "Helvetica", sans-serif';

function formatCurrency(amount: number, currency: string = 'DOP'): string {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency }).format(amount);
}

function formatDate(value: string | Date | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('es-DO', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ReservationData {
  reservationCode: string;
  status: string;
  type: string;
  primaryKind?: string | null;
  guestName: { firstName: string; lastName: string };
  guestDetails: { adults: number; children: number; infants: number };
  checkInDate?: string;
  checkOutDate?: string;
  totalNights?: number | null;
  estimatedTotal: number;
  currency: string;
  tenantName: string;
  tenantLogoUrl?: string;
  roomTypeName?: string | null;
  ratePlanName?: string | null;
  specialRequests?: string | null;
  items: Array<{
    kind: string;
    serviceName?: string | null;
    date?: string;
    checkIn?: string;
    checkOut?: string;
    quantity: number;
    subtotal: number;
  }>;
}

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmada',
  pending: 'Pendiente',
  cancelled: 'Cancelada',
  checked_in: 'En estadía',
  checked_out: 'Completada',
  no_show: 'No show',
};

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  confirmed:   'success',
  pending:     'warning',
  cancelled:   'error',
  checked_in:  'info',
  checked_out: 'default',
  no_show:     'error',
};

// ── Page Component ────────────────────────────────────────────────────────────
export default function BookingReservationPage() {
  const { code } = useParams<{ code: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [data, setData]       = useState<ReservationData | null>(null);

  useEffect(() => {
    if (!code || !token) {
      setError('El enlace de tu reserva no es válido. Por favor revisa el correo de confirmación.');
      setLoading(false);
      return;
    }

    bookingService.getReservation(code, token)
      .then((res: any) => {
        setData(res.data?.data ?? null);
      })
      .catch((err: any) => {
        const status = err?.response?.status;
        if (status === 403 || status === 401) {
          setError('Enlace de acceso inválido o expirado. Por favor revisa el correo de confirmación.');
        } else if (status === 404) {
          setError('No encontramos una reserva con ese código.');
        } else {
          setError('No pudimos cargar tu reserva. Inténtalo de nuevo.');
        }
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BookingLayout>
      <Container maxWidth="sm" sx={{ py: 6 }}>
        {loading && (
          <Box sx={{ textAlign: 'center', py: 10 }}>
            <CircularProgress sx={{ color: BRAND }} />
          </Box>
        )}

        {!loading && error && (
          <Alert
            severity="error"
            sx={{ borderRadius: BTN_RADIUS, fontFamily: FONT }}
            action={
              <Button color="inherit" size="small" href="/booking" sx={{ fontFamily: FONT, textTransform: 'none' }}>
                Volver
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {!loading && data && (
          <Stack spacing={3}>
            {/* Hotel header */}
            <Box sx={{ textAlign: 'center', pb: 1 }}>
              {data.tenantLogoUrl && (
                <Box
                  component="img"
                  src={data.tenantLogoUrl}
                  alt={data.tenantName}
                  sx={{ maxHeight: 60, maxWidth: 180, objectFit: 'contain', mb: 1.5 }}
                />
              )}
              <Typography variant="h6" sx={{ fontWeight: 700, fontFamily: FONT, color: TEXT_PRIMARY }}>
                {data.tenantName}
              </Typography>
            </Box>

            {/* Confirmation hero */}
            <Paper
              elevation={0}
              sx={{
                p: 4,
                borderRadius: CARD_RADIUS,
                border: `1px solid ${BORDER}`,
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                textAlign: 'center',
                bgcolor: BRAND_LIGHT,
              }}
            >
              <CheckCircleIcon sx={{ fontSize: 56, color: BRAND, mb: 1.5 }} />
              <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}>
                {data.guestName.firstName ? `¡Hola, ${data.guestName.firstName}!` : '¡Tu reserva está confirmada!'}
              </Typography>
              <Chip
                label={STATUS_LABELS[data.status] ?? data.status}
                color={STATUS_COLORS[data.status] ?? 'default'}
                size="small"
                sx={{ fontFamily: FONT, fontWeight: 600, mt: 0.5 }}
              />
            </Paper>

            {/* Reservation details card */}
            <Paper
              elevation={0}
              sx={{
                p: 3,
                borderRadius: CARD_RADIUS,
                border: `1px solid ${BORDER}`,
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
              }}
            >
              <Stack spacing={2}>
                {/* Code */}
                <Box>
                  <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Código de reserva
                  </Typography>
                  <Typography
                    variant="h4"
                    sx={{ fontWeight: 700, fontFamily: 'monospace', color: BRAND, letterSpacing: 3, mt: 0.25 }}
                  >
                    {data.reservationCode}
                  </Typography>
                </Box>

                <Divider sx={{ borderColor: BORDER }} />

                {/* Accommodation / Service info */}
                {data.roomTypeName && (
                  <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                    <BedIcon sx={{ color: BRAND, fontSize: 20, mt: 0.25 }} />
                    <Box>
                      <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>Alojamiento</Typography>
                      <Typography sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, fontSize: 14 }}>
                        {data.roomTypeName}
                        {data.totalNights != null && data.totalNights > 0 && (
                          <Typography component="span" sx={{ fontWeight: 400, color: TEXT_SECONDARY, fontSize: 13, ml: 1 }}>
                            · {data.totalNights} {data.totalNights === 1 ? 'noche' : 'noches'}
                          </Typography>
                        )}
                      </Typography>
                      {data.ratePlanName && (
                        <Typography sx={{ fontFamily: FONT, color: TEXT_SECONDARY, fontSize: 13, mt: 0.25 }}>
                          {data.ratePlanName}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                )}

                {/* Services (daypass / PasaTarde / misc) */}
                {data.items.filter(i => i.kind === 'service' && i.serviceName).map((item, idx) => (
                  <Stack key={idx} direction="row" alignItems="center" spacing={1.5}>
                    <RoomServiceIcon sx={{ color: BRAND, fontSize: 20 }} />
                    <Box>
                      <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>Servicio</Typography>
                      <Typography sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, fontSize: 14 }}>
                        {item.serviceName}
                        {item.quantity > 1 && (
                          <Typography component="span" sx={{ fontWeight: 400, color: TEXT_SECONDARY, fontSize: 13, ml: 1 }}>
                            · x{item.quantity}
                          </Typography>
                        )}
                      </Typography>
                    </Box>
                  </Stack>
                ))}

                {/* Dates */}
                {(data.checkInDate || data.checkOutDate) && (
                  <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                    <CalendarTodayIcon sx={{ color: BRAND, fontSize: 20, mt: 0.25 }} />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>Fechas</Typography>
                      <Stack direction="row" spacing={3} sx={{ mt: 0.25 }}>
                        {data.checkInDate && (
                          <Box>
                            <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>Check-in</Typography>
                            <Typography sx={{ fontFamily: FONT, fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY }}>
                              {formatDate(data.checkInDate)}
                            </Typography>
                          </Box>
                        )}
                        {data.checkOutDate && (
                          <Box>
                            <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>Check-out</Typography>
                            <Typography sx={{ fontFamily: FONT, fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY }}>
                              {formatDate(data.checkOutDate)}
                            </Typography>
                          </Box>
                        )}
                      </Stack>
                    </Box>
                  </Stack>
                )}

                {/* Guest */}
                <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                  <PersonIcon sx={{ color: BRAND, fontSize: 20, mt: 0.25 }} />
                  <Box>
                    <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>Titular</Typography>
                    <Typography sx={{ fontFamily: FONT, fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY }}>
                      {[data.guestName.firstName, data.guestName.lastName].filter(Boolean).join(' ')}
                    </Typography>
                  </Box>
                </Stack>

                {/* Guest distribution */}
                {(data.guestDetails.adults > 0 || data.guestDetails.children > 0 || data.guestDetails.infants > 0) && (
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <GroupIcon sx={{ color: BRAND, fontSize: 20 }} />
                    <Box>
                      <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>Huéspedes</Typography>
                      <Typography sx={{ fontFamily: FONT, fontSize: 14, color: TEXT_PRIMARY }}>
                        {[
                          data.guestDetails.adults > 0 ? `${data.guestDetails.adults} ${data.guestDetails.adults === 1 ? 'adulto' : 'adultos'}` : null,
                          data.guestDetails.children > 0 ? `${data.guestDetails.children} ${data.guestDetails.children === 1 ? 'niño' : 'niños'}` : null,
                          data.guestDetails.infants > 0 ? `${data.guestDetails.infants} ${data.guestDetails.infants === 1 ? 'bebé' : 'bebés'}` : null,
                        ].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  </Stack>
                )}

                {/* Special requests */}
                {data.specialRequests && (
                  <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                    <CommentIcon sx={{ color: BRAND, fontSize: 20, mt: 0.25 }} />
                    <Box>
                      <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>Solicitudes especiales</Typography>
                      <Typography sx={{ fontFamily: FONT, fontSize: 14, color: TEXT_PRIMARY, fontStyle: 'italic' }}>
                        {data.specialRequests}
                      </Typography>
                    </Box>
                  </Stack>
                )}

                <Divider sx={{ borderColor: BORDER }} />

                {/* Total */}
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ color: TEXT_SECONDARY, fontFamily: FONT, fontSize: 14 }}>
                    Total estimado
                  </Typography>
                  <Typography sx={{ fontWeight: 700, fontFamily: FONT, fontSize: 18, color: BRAND }}>
                    {formatCurrency(data.estimatedTotal, data.currency)}
                  </Typography>
                </Stack>
              </Stack>
            </Paper>

            {/* Pay at property note */}
            <Alert
              severity="info"
              icon={false}
              sx={{
                borderRadius: BTN_RADIUS,
                bgcolor: BRAND_LIGHT,
                color: TEXT_PRIMARY,
                '& .MuiAlert-message': { fontFamily: FONT, fontSize: 13 },
              }}
            >
              El pago se realiza al llegar a la propiedad. No se cobra ningún monto en línea.
            </Alert>

            {/* Back button */}
            <Button
              variant="outlined"
              href="/booking"
              fullWidth
              sx={{
                textTransform: 'none',
                fontFamily: FONT,
                fontWeight: 600,
                borderColor: BRAND,
                color: BRAND,
                borderRadius: BTN_RADIUS,
                py: 1.25,
                '&:hover': { bgcolor: BRAND_LIGHT, borderColor: BRAND },
              }}
            >
              Hacer otra reserva
            </Button>
          </Stack>
        )}
      </Container>
    </BookingLayout>
  );
}
