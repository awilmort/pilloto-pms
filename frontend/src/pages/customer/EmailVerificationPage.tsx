import React, { useEffect, useState } from 'react';
import { Box, Paper, Typography, CircularProgress, Container, Button, Divider } from '@mui/material';
import { CheckCircle, ErrorOutline, EmailOutlined } from '@mui/icons-material';
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

  const token = searchParams.get('token');

  useEffect(() => {
    const verifyEmail = async () => {
      if (!token) {
        setVerificationState('error');
        return;
      }

      try {
        const response = await authService.verifyEmail(token);
        const data = response.data as any;
        if (data.success) {
          setVerificationState('success');

          // Store auth token if returned (user is now logged in)
          if (data.token) {
            localStorage.setItem('token', data.token);
          }
        } else {
          setVerificationState('error');
        }
      } catch (error) {
        console.error('Email verification error:', error);
        setVerificationState('error');
      }
    };

    verifyEmail();
  }, [token]);

  return (
    <Container maxWidth="sm" sx={{ mt: 8, mb: 6 }}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 4, sm: 5 },
          textAlign: 'center',
          border: '1px solid',
          borderColor: 'grey.200',
          borderRadius: 2,
          bgcolor: '#ffffff',
        }}
      >
        {verificationState === 'loading' && (
          <>
            <Box sx={{ mb: 3 }}>
              <EmailOutlined sx={{ fontSize: 56, color: 'grey.400', mb: 2 }} />
              <CircularProgress size={40} sx={{ color: '#111111' }} />
            </Box>
            <Typography variant="h5" fontWeight={700} color="text.primary" gutterBottom>
              {t('pages.emailVerification.verifyingTitle')}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {t('pages.emailVerification.verifyingBody')}
            </Typography>
          </>
        )}

        {verificationState === 'success' && (
          <>
            <CheckCircle sx={{ fontSize: 72, color: '#2E7D32', mb: 2 }} />
            <Typography variant="h4" component="h1" fontWeight={700} color="text.primary" gutterBottom>
              {t('pages.emailVerification.successTitle')}
            </Typography>
            <Typography variant="h6" fontWeight={500} color="text.secondary" sx={{ mb: 3 }}>
              {t('pages.emailVerification.successWelcome')}
            </Typography>

            <Box
              sx={{
                mb: 4,
                p: 3,
                bgcolor: '#fafafa',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'grey.200',
              }}
            >
              <Typography variant="body1" color="text.primary">
                {t('pages.emailVerification.successInfo')}
              </Typography>
            </Box>

            <Button
              variant="contained"
              onClick={() => navigate('/admin')}
              size="large"
              fullWidth
              sx={{
                bgcolor: '#111111',
                color: '#ffffff',
                fontWeight: 600,
                py: 1.5,
                borderRadius: 1,
                '&:hover': { bgcolor: '#333333' },
              }}
            >
              {t('pages.emailVerification.exploreRooms')}
            </Button>
          </>
        )}

        {verificationState === 'error' && (
          <>
            <ErrorOutline sx={{ fontSize: 72, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h4" component="h1" fontWeight={700} color="text.primary" gutterBottom>
              {t('pages.emailVerification.errorTitle')}
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
              {t('pages.emailVerification.errorBody')}
            </Typography>

            <Box
              sx={{
                mb: 4,
                p: 3,
                bgcolor: '#fafafa',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'grey.200',
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line', textAlign: 'left' }}>
                {t('pages.emailVerification.errorHints')}
              </Typography>
            </Box>

            <Divider sx={{ mb: 3 }} />

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t('pages.emailVerification.errorNext')}
            </Typography>

            <Button
              variant="contained"
              onClick={() => navigate('/login')}
              size="large"
              fullWidth
              sx={{
                bgcolor: '#111111',
                color: '#ffffff',
                fontWeight: 600,
                py: 1.5,
                borderRadius: 1,
                '&:hover': { bgcolor: '#333333' },
              }}
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
