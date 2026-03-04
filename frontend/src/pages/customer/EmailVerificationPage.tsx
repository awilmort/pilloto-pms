import React, { useEffect, useState } from 'react';
import { Box, Paper, Typography, CircularProgress, Container, Button } from '@mui/material';
import { CheckCircle, Error, ArrowBack } from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/api';

const EmailVerificationPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  useAuth();
  const { t } = useTranslation();
  const [verificationState, setVerificationState] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const token = searchParams.get('token');

  useEffect(() => {
    const verifyEmail = async () => {
      if (!token) {
        setVerificationState('error');
        setMessage('No verification token provided');
        return;
      }

      try {
        const response = await authService.verifyEmail(token);
        const data = response.data as any;
        if (data.success) {
          setVerificationState('success');
          setMessage(data.message);

          // If token and user data are returned, store them manually
          if (data.token) {
            localStorage.setItem('token', data.token);
          }

          // Redirect to dashboard after 3 seconds
          setTimeout(() => {
            navigate('/rooms');
          }, 3000);
        } else {
          setVerificationState('error');
          setMessage(data.message || 'Email verification failed');
        }
      } catch (error) {
        console.error('Email verification error:', error);
        setVerificationState('error');
        setMessage('An error occurred during email verification');
      }
    };

    verifyEmail();
  }, [token, navigate]);

  const handleBackToLogin = () => {
    navigate('/login');
  };

  const handleGoToRooms = () => {
    navigate('/rooms');
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}>
        {verificationState === 'loading' && (
          <>
            <CircularProgress size={80} sx={{ mb: 3 }} />
            <Typography variant="h5" gutterBottom>
              {t('pages.emailVerification.verifyingTitle')}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {t('pages.emailVerification.verifyingBody')}
            </Typography>
          </>
        )}

        {verificationState === 'success' && (
          <>
            <CheckCircle sx={{ fontSize: 80, color: 'success.main', mb: 2 }} />
            <Typography variant="h4" component="h1" gutterBottom color="success.main">
              {t('pages.emailVerification.successTitle')}
            </Typography>
            <Typography variant="h6" gutterBottom sx={{ mb: 3 }}>
              {t('pages.emailVerification.successWelcome')}
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
              {message}
            </Typography>

            <Box sx={{ mb: 4, p: 3, bgcolor: 'success.light', borderRadius: 2 }}>
              <Typography variant="body1" color="success.dark">
                {t('pages.emailVerification.successInfo')}
              </Typography>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t('pages.emailVerification.redirectInfo')}
            </Typography>

            <Button
              variant="contained"
              onClick={handleGoToRooms}
              size="large"
              fullWidth
            >
              {t('pages.emailVerification.exploreRooms')}
            </Button>
          </>
        )}

        {verificationState === 'error' && (
          <>
            <Error sx={{ fontSize: 80, color: 'error.main', mb: 2 }} />
            <Typography variant="h4" component="h1" gutterBottom color="error.main">
              {t('pages.emailVerification.errorTitle')}
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
              {message}
            </Typography>

            <Box sx={{ mb: 4, p: 3, bgcolor: 'error.light', borderRadius: 2 }}>
              <Typography variant="body2" color="error.dark" sx={{ whiteSpace: 'pre-line' }}>
                {t('pages.emailVerification.errorHints')}
              </Typography>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t('pages.emailVerification.errorNext')}
            </Typography>

            <Button
              variant="contained"
              startIcon={<ArrowBack />}
              onClick={handleBackToLogin}
              fullWidth
            >
              {t('pages.emailVerification.backToLogin')}
            </Button>
          </>
        )}
      </Paper>
    </Container>
  );
};

export default EmailVerificationPage;
