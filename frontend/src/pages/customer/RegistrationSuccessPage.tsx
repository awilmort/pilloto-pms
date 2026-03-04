import React from 'react';
import { Box, Paper, Typography, Button, Container } from '@mui/material';
import { CheckCircle, Email, ArrowBack } from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const RegistrationSuccessPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || '';
  const { t } = useTranslation();

  const handleBackToLogin = () => {
    navigate('/login');
  };

  const handleResendEmail = async () => {
    if (!email) return;

    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        alert(t('pages.registrationSuccess.resendSuccess'));
      } else {
        alert(data.message || t('pages.registrationSuccess.resendFailed'));
      }
    } catch (error) {
      console.error('Resend email error:', error);
      alert(t('pages.registrationSuccess.resendError'));
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}>
        <CheckCircle sx={{ fontSize: 80, color: 'success.main', mb: 2 }} />

        <Typography variant="h4" component="h1" gutterBottom color="success.main">
          {t('pages.registrationSuccess.title')}
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mb: 3 }}>
          {t('pages.registrationSuccess.checkEmail')}
        </Typography>

        <Box sx={{ mb: 4 }}>
          <Email sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            {t('pages.registrationSuccess.sentTo')}
          </Typography>
          <Typography variant="body1" fontWeight="bold" color="primary.main">
            {email}
          </Typography>
        </Box>

        <Box sx={{ mb: 4, p: 3, bgcolor: 'info.light', borderRadius: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('pages.registrationSuccess.importantInfo')}
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('pages.registrationSuccess.resendHint')}
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {email && (
            <Button
              variant="outlined"
              onClick={handleResendEmail}
              sx={{ mb: 1 }}
            >
              {t('pages.registrationSuccess.resendButton')}
            </Button>
          )}

          <Button
            variant="contained"
            startIcon={<ArrowBack />}
            onClick={handleBackToLogin}
            fullWidth
          >
            {t('pages.registrationSuccess.backToLogin')}
          </Button>
        </Box>

        <Box sx={{ mt: 4, p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
            <strong>{t('pages.registrationSuccess.nextStepsTitle')}</strong>
            {"\n"}
            {t('pages.registrationSuccess.nextStepsList')}
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
};

export default RegistrationSuccessPage;
