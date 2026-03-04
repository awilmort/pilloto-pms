import React, { useState, useEffect } from 'react';
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
import { Lock, Visibility, VisibilityOff } from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const PasswordResetPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setError(t('pages.passwordReset.errors.invalidLink'));
    }
  }, [token, t]);

  const validatePassword = (password: string): string | null => {
    if (password.length < 6) {
      return t('pages.passwordReset.errors.passwordMin');
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return t('pages.passwordReset.errors.passwordPattern');
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      setError(t('pages.passwordReset.errors.invalidLink'));
      return;
    }

    // Validate password
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setError(t('pages.passwordReset.errors.passwordsMismatch'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, password }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      } else {
        setError(data.message || t('pages.passwordReset.errors.resetFailed'));
      }
    } catch (error) {
      console.error('Password reset error:', error);
      setError(t('pages.passwordReset.errors.resetError'));
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
          <Lock sx={{ fontSize: 80, color: 'success.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom color="success.main">
            {t('pages.passwordReset.successTitle')}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            {t('pages.passwordReset.successBody')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('pages.passwordReset.redirectInfo')}
          </Typography>
          <Button
            variant="contained"
            onClick={handleBackToLogin}
            fullWidth
          >
            {t('pages.passwordReset.goToLogin')}
          </Button>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ mt: 8, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Lock sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom>
            {t('pages.passwordReset.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('pages.passwordReset.subtitle')}
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
            type={showPassword ? 'text' : 'password'}
            label={t('pages.passwordReset.newPassword')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            sx={{ mb: 3 }}
            InputProps={{
              endAdornment: (
                <Button
                  onClick={() => setShowPassword(!showPassword)}
                  sx={{ minWidth: 'auto', p: 1 }}
                >
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </Button>
              ),
            }}
            helperText={t('pages.passwordReset.helperPassword')}
          />

          <TextField
            fullWidth
            type={showConfirmPassword ? 'text' : 'password'}
            label={t('pages.passwordReset.confirmNewPassword')}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            sx={{ mb: 4 }}
            InputProps={{
              endAdornment: (
                <Button
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  sx={{ minWidth: 'auto', p: 1 }}
                >
                  {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                </Button>
              ),
            }}
            error={confirmPassword !== '' && password !== confirmPassword}
            helperText={confirmPassword !== '' && password !== confirmPassword ? t('pages.passwordReset.helperConfirmMismatch') : ''}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={isLoading || !token}
            sx={{ mb: 2 }}
          >
            {isLoading ? (
              <CircularProgress size={24} />
            ) : (
              t('pages.passwordReset.resetButton')
            )}
          </Button>

          <Button
            fullWidth
            variant="text"
            onClick={handleBackToLogin}
          >
            {t('pages.passwordReset.backToLogin')}
          </Button>
        </Box>
      </Paper>
    </Container>
  );
};

export default PasswordResetPage;
