import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Container,
  Alert,
  CircularProgress
} from '@mui/material';
import { Email, ArrowBack } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const ForgotPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      setError(t('pages.forgotPassword.errors.emailRequired'));
      return;
    }

    if (!validateEmail(email)) {
      setError(t('pages.forgotPassword.errors.emailInvalid'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
      } else {
        setError(data.message || t('pages.forgotPassword.errors.sendFailed'));
      }
    } catch (error) {
      console.error('Forgot password error:', error);
      setError(t('pages.forgotPassword.errors.sendError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = () => {
    navigate('/login');
  };

  if (success) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8, mb: 4 }}>
        <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}>
          <Email sx={{ fontSize: 80, color: 'success.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom color="success.main">
            {t('pages.forgotPassword.successTitle')}
          </Typography>
          <Typography variant="h6" gutterBottom sx={{ mb: 3 }}>
            {t('pages.forgotPassword.successSubtitle')}
          </Typography>

          <Box sx={{ mb: 4 }}>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
              {t('pages.forgotPassword.sentInfo', { email })}
            </Typography>
          </Box>

          <Box sx={{ mb: 4, p: 3, bgcolor: 'info.light', borderRadius: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('pages.forgotPassword.importantInfo')}
            </Typography>
          </Box>

          <Button
            variant="contained"
            startIcon={<ArrowBack />}
            onClick={handleBackToLogin}
            fullWidth
          >
            {t('pages.forgotPassword.backToLogin')}
          </Button>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ mt: 8, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Email sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom>
            {t('pages.forgotPassword.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('pages.forgotPassword.subtitle')}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={handleSubmit}>
          <TextField
            fullWidth
            type="email"
            label={t('pages.forgotPassword.emailLabel')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            sx={{ mb: 4 }}
            placeholder={t('pages.forgotPassword.emailPlaceholder') as string}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={isLoading}
            sx={{ mb: 2 }}
          >
            {isLoading ? (
              <CircularProgress size={24} />
            ) : (
              t('pages.forgotPassword.sendButton')
            )}
          </Button>

          <Button
            fullWidth
            variant="text"
            onClick={handleBackToLogin}
            startIcon={<ArrowBack />}
          >
            {t('pages.forgotPassword.backToLogin')}
          </Button>
        </Box>

        <Box sx={{ mt: 4, p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            {t('pages.forgotPassword.rememberPrompt')} <Button onClick={handleBackToLogin} sx={{ textTransform: 'none' }}>{t('pages.forgotPassword.signInHere')}</Button>
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
};

export default ForgotPasswordPage;
