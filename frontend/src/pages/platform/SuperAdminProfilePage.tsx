import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  TextField,
  Button,
  Alert,
  Divider,
  Avatar,
  Chip,
  InputAdornment,
  IconButton,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  AdminPanelSettings,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/api';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import PlatformLayout from './PlatformLayout';

const SuperAdminProfilePage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { t } = useTranslation();

  // ── Profile form ─────────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // ── Password form ─────────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setEmail(user.email || '');
    }
  }, [user]);

  const handleSaveProfile = async () => {
    setProfileError(null);
    setProfileSuccess(null);
    try {
      setProfileSaving(true);
      const res = await authService.updateProfile({ firstName, lastName, email });
      if (res.data.success) {
        await refreshUser();
        setProfileSuccess(t('pages.profile.profileUpdated'));
        toast.success(t('pages.profile.profileUpdatedToast'));
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || t('pages.profile.profileUpdateFailed');
      setProfileError(msg);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPwdError(null);
    setPwdSuccess(null);

    if (newPassword.length < 8) {
      setPwdError(t('platform.profile.tooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError(t('pages.profile.passwordMismatch'));
      return;
    }

    try {
      setPwdSaving(true);
      const res = await authService.changePassword({ currentPassword, newPassword });
      if (res.data.success) {
        setPwdSuccess(t('pages.profile.passwordChanged'));
        toast.success(t('pages.profile.passwordUpdatedToast'));
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || t('pages.profile.passwordChangeFailed');
      setPwdError(msg);
    } finally {
      setPwdSaving(false);
    }
  };

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '';

  const passwordCanSubmit =
    currentPassword.length > 0 && newPassword.length >= 8 && confirmPassword.length > 0;

  return (
    <PlatformLayout>
      {/* Page header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={700} color="text.primary" gutterBottom>
          {t('platform.profile.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('platform.profile.subtitle')}
        </Typography>
      </Box>

      {/* Identity banner */}
      <Card elevation={0} sx={{ mb: 4, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar
              sx={{
                width: 64,
                height: 64,
                bgcolor: '#1E3A5F',
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              {initials}
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight={700}>
                {user?.firstName} {user?.lastName}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {user?.email}
              </Typography>
              <Chip
                icon={<AdminPanelSettings sx={{ fontSize: 15 }} />}
                label={t('platform.profile.role')}
                size="small"
                sx={{ bgcolor: '#EFF6FF', color: '#1D4ED8', fontWeight: 600, fontSize: 11 }}
              />
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* ── Personal information ─────────────────────────────────────────────── */}
      <Card
        elevation={0}
        sx={{ mb: 4, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
      >
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            {t('platform.profile.personal')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('platform.profile.personalHint')}
          </Typography>

          {profileError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setProfileError(null)}>
              {profileError}
            </Alert>
          )}
          {profileSuccess && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setProfileSuccess(null)}>
              {profileSuccess}
            </Alert>
          )}

          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('platform.profile.firstName')}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('platform.profile.lastName')}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={8}>
              <TextField
                label={t('platform.profile.email')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                fullWidth
                required
              />
            </Grid>
          </Grid>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleSaveProfile}
              disabled={profileSaving || !firstName.trim() || !lastName.trim() || !email.trim()}
            >
              {profileSaving ? t('platform.profile.saving') : t('platform.profile.save')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* ── Change password ──────────────────────────────────────────────────── */}
      <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            {t('platform.profile.changePassword')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('platform.profile.passwordHint')}
          </Typography>

          <Divider sx={{ mb: 3 }} />

          {pwdError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPwdError(null)}>
              {pwdError}
            </Alert>
          )}
          {pwdSuccess && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setPwdSuccess(null)}>
              {pwdSuccess}
            </Alert>
          )}

          <Grid container spacing={3}>
            <Grid item xs={12} sm={8}>
              <TextField
                label={t('platform.profile.currentPassword')}
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                fullWidth
                required
                autoComplete="current-password"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowCurrent((v) => !v)}
                        edge="end"
                        aria-label={showCurrent ? t('pages.profile.hidePassword') : t('pages.profile.showPassword')}
                      >
                        {showCurrent ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                label={t('platform.profile.newPassword')}
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                fullWidth
                required
                autoComplete="new-password"
                helperText={t('platform.profile.minChars')}
                error={newPassword.length > 0 && newPassword.length < 8}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowNew((v) => !v)}
                        edge="end"
                        aria-label={showNew ? t('pages.profile.hidePassword') : t('pages.profile.showPassword')}
                      >
                        {showNew ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                label={t('platform.profile.confirmPassword')}
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                fullWidth
                required
                autoComplete="new-password"
                error={confirmPassword.length > 0 && confirmPassword !== newPassword}
                helperText={
                  confirmPassword.length > 0 && confirmPassword !== newPassword
                    ? t('platform.profile.mismatchHelp')
                    : ' '
                }
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowConfirm((v) => !v)}
                        edge="end"
                        aria-label={showConfirm ? t('pages.profile.hidePassword') : t('pages.profile.showPassword')}
                      >
                        {showConfirm ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
          </Grid>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="outlined"
              color="warning"
              onClick={handleChangePassword}
              disabled={pwdSaving || !passwordCanSubmit}
            >
              {pwdSaving ? t('platform.profile.updating') : t('platform.profile.update')}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </PlatformLayout>
  );
};

export default SuperAdminProfilePage;
