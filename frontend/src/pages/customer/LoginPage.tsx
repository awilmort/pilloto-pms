import React, { useState } from 'react';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Link,
  Alert,
  InputAdornment,
  IconButton,
  Divider,
} from '@mui/material';
import {
  Email,
  Lock,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

interface LoginFormData {
  email: string;
  password: string;
}

const LoginPageSimple: React.FC = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loading } = useAuth();
  const { t } = useTranslation();

  const from = (location.state as any)?.from?.pathname || '/';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      setError(null);
      await login(data.email, data.password);
      navigate(from, { replace: true });
    } catch (error: any) {
      setError(error.response?.data?.message || t('pages.login.error'));
    }
  };

  const handleTogglePassword = () => {
    setShowPassword(!showPassword);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#F7F7F5', py: 8 }}>
      <Container maxWidth="sm">
        <Paper
          elevation={8}
          sx={{
            p: 4,
            borderRadius: 3,
            background: '#FFFFFF',
            border: '1px solid',
            borderColor: 'grey.200',
            boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
          }}
        >
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 1.5 }}>
            <svg width="24" height="32" viewBox="0 0 52 70" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="2" width="44" height="66" rx="3" fill="rgba(15,23,42,0.02)" stroke="#606060" strokeWidth="1.5"/>
              <rect x="10" y="11" width="12" height="10" rx="1.5" fill="#CCCCCC"/>
              <rect x="30" y="11" width="12" height="10" rx="1.5" fill="#CCCCCC"/>
              <rect x="10" y="27" width="12" height="10" rx="1.5" fill="#787878"/>
              <rect x="30" y="27" width="12" height="10" rx="1.5" fill="#CCCCCC"/>
              <rect x="10" y="43" width="12" height="10" rx="1.5" fill="#CCCCCC"/>
            </svg>
            <Typography
              variant="h5"
              sx={{
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontWeight: 700,
                color: 'text.primary',
                letterSpacing: '-0.3px',
              }}
            >
              Pilloto
            </Typography>
          </Box>
          <Typography
            variant="h4"
            gutterBottom
            sx={{
              fontWeight: 700,
              color: 'primary.main',
            }}
          >
            {t('pages.login.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('pages.login.subtitle')}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit(onSubmit)}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
              {...register('email', {
                required: t('pages.login.validation.emailRequired'),
                pattern: {
                  value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                  message: t('pages.login.validation.emailInvalid'),
                },
              })}
              label={t('pages.login.emailLabel')}
              type="email"
              fullWidth
              error={!!errors.email}
              helperText={errors.email?.message}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Email color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                },
              }}
            />

            <TextField
              {...register('password', {
                required: t('pages.login.validation.passwordRequired'),
                minLength: {
                  value: 6,
                  message: t('pages.login.validation.passwordMin'),
                },
              })}
              label={t('pages.login.passwordLabel')}
              type={showPassword ? 'text' : 'password'}
              fullWidth
              error={!!errors.password}
              helperText={errors.password?.message}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Lock color="action" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle password visibility"
                      onClick={handleTogglePassword}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                },
              }}
            />

            <Button
              type="submit"
              variant="contained"
              color="primary"
              size="large"
              fullWidth
              disabled={isSubmitting || loading}
              sx={{
                py: 1.5,
                fontSize: '1.1rem',
                fontWeight: 600,
                borderRadius: 2,
                textTransform: 'none',
              }}
            >
              {isSubmitting || loading ? t('pages.login.signingIn') : t('pages.login.signIn')}
            </Button>
          </Box>
        </form>

        <Divider sx={{ my: 3 }} />

        {/* Additional Links */}
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Typography variant="body2" sx={{ mt: 1 }}>
            <Link
              component={RouterLink}
              to="/forgot-password"
              sx={{
                color: 'secondary.main',
                textDecoration: 'none',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
            >
              {t('pages.login.forgotPassword')}
            </Link>
          </Typography>
        </Box>
        </Paper>
      </Container>
    </Box>
  );
};

export default LoginPageSimple;
