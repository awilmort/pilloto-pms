/**
 * CorporatePriceActionPage
 *
 * Public page linked from the corporate price request email.
 * Accessible without authentication to allow admins to approve/decline
 * directly from their email client.
 *
 * Route: /reservations/:id/corporate-price/:action (action = approve | decline)
 */
import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Paper,
  Typography,
} from '@mui/material';
import { CheckCircle, Cancel, ErrorOutline } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { reservationsService } from '../../services/api';

type PageState = 'loading' | 'success' | 'already_processed' | 'error';

const CorporatePriceActionPage: React.FC = () => {
  const { id, action } = useParams<{ id: string; action: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const isApprove = action === 'approve';

  useEffect(() => {
    if (!id || (action !== 'approve' && action !== 'decline')) {
      setState('error');
      setErrorMessage('Acción no válida.');
      return;
    }

    reservationsService
      .corporatePriceAction(id, action as 'approve' | 'decline')
      .then(() => {
        setState('success');
      })
      .catch((err: any) => {
        const message: string =
          err?.response?.data?.message || 'Ocurrió un error al procesar la solicitud.';
        if (message.toLowerCase().includes('already') || err?.response?.status === 400) {
          setState('already_processed');
          setErrorMessage(message);
        } else {
          setState('error');
          setErrorMessage(message);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, action]);

  const iconSize = { fontSize: 64 };

  return (
    <Container maxWidth="sm" sx={{ mt: 10, mb: 6 }}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, sm: 5 },
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          textAlign: 'center',
        }}
      >
        {state === 'loading' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={56} />
            <Typography variant="h6" color="text.secondary">
              Procesando solicitud...
            </Typography>
          </Box>
        )}

        {state === 'success' && isApprove && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <CheckCircle sx={{ ...iconSize, color: 'success.main' }} />
            <Typography variant="h5" fontWeight={700}>
              Precio corporativo aprobado
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 380 }}>
              La reserva ha sido aprobada con precio corporativo. Puedes asignar la empresa
              específica desde el panel de administración.
            </Typography>
            <Divider sx={{ width: '100%', my: 1 }} />
            <Button variant="contained" onClick={() => navigate('/admin/reservations')}>
              Ver reservas
            </Button>
          </Box>
        )}

        {state === 'success' && !isApprove && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <Cancel sx={{ ...iconSize, color: 'error.main' }} />
            <Typography variant="h5" fontWeight={700}>
              Solicitud rechazada
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 380 }}>
              La solicitud de precio corporativo ha sido rechazada. La reserva permanecerá con la
              tarifa estándar. El huésped será notificado.
            </Typography>
            <Divider sx={{ width: '100%', my: 1 }} />
            <Button variant="outlined" onClick={() => navigate('/admin/reservations')}>
              Ver reservas
            </Button>
          </Box>
        )}

        {state === 'already_processed' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <CheckCircle sx={{ ...iconSize, color: 'info.main' }} />
            <Typography variant="h5" fontWeight={700}>
              Solicitud ya procesada
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 380 }}>
              Esta solicitud ya fue procesada anteriormente y no requiere ninguna acción adicional.
            </Typography>
            <Divider sx={{ width: '100%', my: 1 }} />
            <Button variant="outlined" onClick={() => navigate('/admin/reservations')}>
              Ver reservas
            </Button>
          </Box>
        )}

        {state === 'error' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <ErrorOutline sx={{ ...iconSize, color: 'warning.main' }} />
            <Typography variant="h5" fontWeight={700}>
              No se pudo procesar la solicitud
            </Typography>
            {errorMessage && (
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 380 }}>
                {errorMessage}
              </Typography>
            )}
            <Divider sx={{ width: '100%', my: 1 }} />
            <Button variant="outlined" onClick={() => navigate('/admin/reservations')}>
              Ir al panel de reservas
            </Button>
          </Box>
        )}
      </Paper>
    </Container>
  );
};

export default CorporatePriceActionPage;
