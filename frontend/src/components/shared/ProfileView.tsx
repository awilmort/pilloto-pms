import React, { useEffect, useMemo, useState } from 'react';
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
  Tooltip,
  Collapse,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Visibility,
  VisibilityOff,
  Lock,
  Person,
  Shield,
  ExpandMore,
  ExpandLess,
  CheckCircle,
  RadioButtonUnchecked,
  VpnKey,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/api';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

// ─── Password strength ────────────────────────────────────────────────────────

interface PasswordStrength {
  score: number; // 0-4
  label: string;
  color: string;
}

function evaluatePassword(pwd: string): PasswordStrength {
  if (!pwd) return { score: 0, label: '', color: '#e0e0e0' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  score = Math.min(score, 4);
  const map: Record<number, { label: string; color: string }> = {
    0: { label: '', color: '#e0e0e0' },
    1: { label: 'Weak', color: '#ef5350' },
    2: { label: 'Fair', color: '#ff9800' },
    3: { label: 'Good', color: '#66bb6a' },
    4: { label: 'Strong', color: '#2e7d32' },
  };
  return { score, ...map[score] };
}

interface PasswordRule {
  label: string;
  met: (pwd: string) => boolean;
}

// ─── Pilloto SVG mark ─────────────────────────────────────────────────────────

const PillotoMark: React.FC<{ size?: number }> = ({ size = 32 }) => (
  <svg width={size * 0.74} height={size} viewBox="0 0 52 70" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="2" width="44" height="66" rx="3" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
    <rect x="10" y="11" width="12" height="10" rx="1.5" fill="rgba(255,255,255,0.9)" />
    <rect x="30" y="11" width="12" height="10" rx="1.5" fill="rgba(255,255,255,0.9)" />
    <rect x="10" y="27" width="12" height="10" rx="1.5" fill="rgba(255,255,255,0.45)" />
    <rect x="30" y="27" width="12" height="10" rx="1.5" fill="rgba(255,255,255,0.9)" />
    <rect x="10" y="43" width="12" height="10" rx="1.5" fill="rgba(255,255,255,0.9)" />
  </svg>
);

// ─── Role chip colours ────────────────────────────────────────────────────────

function roleChip(role: string): { label: string; bg: string; color: string } {
  switch (role) {
    case 'admin': return { label: 'Administrator', bg: '#EFF6FF', color: '#1D4ED8' };
    case 'superadmin': return { label: 'Super Admin', bg: '#FDF2F8', color: '#9333EA' };
    case 'staff': return { label: 'Staff', bg: '#ECFDF5', color: '#065F46' };
    case 'cashier': return { label: 'Cashier', bg: '#FFF7ED', color: '#C2410C' };
    default: return { label: role ?? 'Guest', bg: '#F1F5F9', color: '#475569' };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Profile content shared by every app's profile page (PMS, accounting, ...).
 * Each app supplies its own layout wrapper (AdminLayout, AccountingLayout, ...)
 * around this component rather than duplicating the form/logic per app.
 */
const ProfileView: React.FC = () => {
  const { user, refreshUser, permissions } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();

  const passwordRules = useMemo<PasswordRule[]>(() => [
    { label: t('pages.profile.rules.minLength', 'At least 8 characters'), met: (p) => p.length >= 8 },
    { label: t('pages.profile.rules.upperLower', 'Uppercase & lowercase letters'), met: (p) => /[A-Z]/.test(p) && /[a-z]/.test(p) },
    { label: t('pages.profile.rules.number', 'At least one number'), met: (p) => /[0-9]/.test(p) },
    { label: t('pages.profile.rules.special', 'Special character (e.g. !@#$)'), met: (p) => /[^A-Za-z0-9]/.test(p) },
  ], [t]);

  // ── Profile form ─────────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
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
  const [showRules, setShowRules] = useState(false);

  const strength = evaluatePassword(newPassword);
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canChangePassword =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword;

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  const handleSaveProfile = async () => {
    setProfileError(null);
    setProfileSuccess(null);
    try {
      setProfileSaving(true);
      const res = await authService.updateProfile({ firstName, lastName, phone, email });
      if (res.data.success) {
        await refreshUser();
        setProfileSuccess('Profile updated successfully.');
        toast.success('Profile updated.');
      }
    } catch (err: any) {
      setProfileError(err?.response?.data?.message || 'Failed to update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPwdError(null);
    setPwdSuccess(null);
    if (newPassword !== confirmPassword) {
      setPwdError('New password and confirmation do not match.');
      return;
    }
    try {
      setPwdSaving(true);
      const res = await authService.changePassword({ currentPassword, newPassword });
      if (res.data.success) {
        setPwdSuccess('Password changed successfully.');
        toast.success('Password updated.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      setPwdError(err?.response?.data?.message || 'Failed to change password.');
    } finally {
      setPwdSaving(false);
    }
  };

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '';

  const chip = roleChip(user?.role ?? '');

  return (
    <>
      {/* ── Hero banner ─────────────────────────────────────────────────────── */}
      <Box
        sx={{
          background: `linear-gradient(135deg, ${theme.palette.primary.light} 0%, ${theme.palette.primary.main} 60%, ${theme.palette.primary.dark} 100%)`,
          borderRadius: 3,
          p: { xs: 3, md: 4 },
          mb: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background grid decoration */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle at 80% 50%, rgba(255,255,255,0.04) 0%, transparent 60%)',
            pointerEvents: 'none',
          }}
        />

        {/* Pilloto logomark */}
        <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1.5, zIndex: 1 }}>
          <PillotoMark size={48} />
          <Typography
            sx={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontWeight: 700,
              fontSize: { xs: 22, md: 28 },
              color: '#F0F0F0',
              letterSpacing: '-0.5px',
              lineHeight: 1,
              userSelect: 'none',
            }}
          >
            Pilloto
          </Typography>
        </Box>

        <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.18)', mx: 1 }} />

        {/* Avatar + name */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, zIndex: 1, flexGrow: 1, minWidth: 0 }}>
          <Avatar
            sx={{
              width: 64,
              height: 64,
              bgcolor: 'rgba(255,255,255,0.15)',
              border: '2px solid rgba(255,255,255,0.3)',
              fontSize: 24,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {initials}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" fontWeight={700} color="#fff" noWrap>
              {user?.firstName} {user?.lastName}
            </Typography>
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.65)', mb: 0.75 }} noWrap>
              {user?.email}
            </Typography>
            <Chip
              label={chip.label}
              size="small"
              sx={{
                bgcolor: 'rgba(255,255,255,0.15)',
                color: '#fff',
                fontWeight: 600,
                fontSize: 11,
                border: '1px solid rgba(255,255,255,0.25)',
              }}
            />
          </Box>
        </Box>

        {/* Shield badge */}
        <Box
          sx={{
            flexShrink: 0,
            display: { xs: 'none', md: 'flex' },
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.5,
            zIndex: 1,
          }}
        >
          <Shield sx={{ color: 'rgba(255,255,255,0.35)', fontSize: 40 }} />
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>
            {t('pages.profile.secureSession', 'SECURE SESSION')}
          </Typography>
        </Box>
      </Box>

      {/* ── Personal information ─────────────────────────────────────────────── */}
      <Card
        elevation={0}
        sx={{ mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
      >
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <Person sx={{ color: 'text.secondary', fontSize: 20 }} />
            <Typography variant="h6" fontWeight={700}>
              {t('pages.profile.personalInfo', 'Personal Information')}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, pl: 4 }}>
            {t('pages.profile.personalInfoSubtitle', 'Your display name and contact details visible to other staff.')}
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

          <Grid container spacing={2.5}>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('pages.profile.firstName', 'First Name')}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('pages.profile.lastName', 'Last Name')}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={8}>
              <TextField
                label={t('pages.profile.email', 'Email Address')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label={t('pages.profile.phone', 'Phone')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                fullWidth
              />
            </Grid>
          </Grid>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleSaveProfile}
              disabled={profileSaving || !firstName.trim() || !lastName.trim() || !email.trim()}
            >
              {profileSaving ? t('pages.profile.saving', 'Saving…') : t('pages.profile.saveChanges', 'Save Changes')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* ── Change password ──────────────────────────────────────────────────── */}
      <Card
        elevation={0}
        sx={{ mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
      >
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <Lock sx={{ color: 'text.secondary', fontSize: 20 }} />
            <Typography variant="h6" fontWeight={700}>
              {t('pages.profile.changePassword', 'Change Password')}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, pl: 4 }}>
            {t('pages.profile.changePasswordSubtitle', "Use a strong, unique password that you don't use anywhere else.")}
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

          <Grid container spacing={2.5}>
            {/* Current password */}
            <Grid item xs={12} sm={8} md={6}>
              <TextField
                label={t('pages.profile.currentPassword', 'Current Password')}
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
                        aria-label={showCurrent ? 'Hide password' : 'Show password'}
                      >
                        {showCurrent ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            {/* Spacer */}
            <Grid item xs={12} />

            {/* New password */}
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('pages.profile.newPassword', 'New Password')}
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (e.target.value.length > 0) setShowRules(true);
                }}
                fullWidth
                required
                autoComplete="new-password"
                error={newPassword.length > 0 && newPassword.length < 8}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowNew((v) => !v)}
                        edge="end"
                        aria-label={showNew ? 'Hide password' : 'Show password'}
                      >
                        {showNew ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              {/* Strength bar */}
              {newPassword.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5 }}>
                    {[1, 2, 3, 4].map((i) => (
                      <Box
                        key={i}
                        sx={{
                          flex: 1,
                          height: 4,
                          borderRadius: 2,
                          bgcolor: i <= strength.score ? strength.color : '#e0e0e0',
                          transition: 'background-color 0.3s',
                        }}
                      />
                    ))}
                  </Box>
                  {strength.label && (
                    <Typography
                      variant="caption"
                      sx={{ color: strength.color, fontWeight: 600 }}
                    >
                      {strength.label}
                    </Typography>
                  )}
                </Box>
              )}
            </Grid>

            {/* Confirm password */}
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('pages.profile.confirmNewPassword', 'Confirm New Password')}
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                fullWidth
                required
                autoComplete="new-password"
                error={passwordMismatch}
                helperText={
                  passwordMismatch
                    ? t('pages.profile.passwordsDoNotMatch', 'Passwords do not match')
                    : passwordsMatch
                    ? t('pages.profile.passwordsMatch', '✓ Passwords match')
                    : undefined
                }
                FormHelperTextProps={{
                  sx: { color: passwordsMatch ? 'success.main' : undefined },
                }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowConfirm((v) => !v)}
                        edge="end"
                        aria-label={showConfirm ? 'Hide password' : 'Show password'}
                      >
                        {showConfirm ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
          </Grid>

          {/* Password rules */}
          <Collapse in={showRules}>
            <Box
              sx={{
                mt: 2,
                p: 2,
                bgcolor: 'action.hover',
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography
                variant="caption"
                fontWeight={700}
                color="text.secondary"
                sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                {t('pages.profile.passwordRequirements', 'Password Requirements')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {passwordRules.map((rule) => {
                  const met = rule.met(newPassword);
                  return (
                    <Box
                      key={rule.label}
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: { xs: '100%', sm: 'auto' } }}
                    >
                      {met ? (
                        <CheckCircle sx={{ fontSize: 14, color: 'success.main' }} />
                      ) : (
                        <RadioButtonUnchecked sx={{ fontSize: 14, color: 'text.disabled' }} />
                      )}
                      <Typography
                        variant="caption"
                        sx={{ color: met ? 'success.main' : 'text.secondary', fontWeight: met ? 600 : 400 }}
                      >
                        {rule.label}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Collapse>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
            {showRules && (
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setShowRules(false);
                  setPwdError(null);
                }}
                sx={{ color: 'text.secondary' }}
              >
                {t('pages.profile.cancel', 'Cancel')}
              </Button>
            )}
            <Button
              variant="contained"
              onClick={handleChangePassword}
              disabled={pwdSaving || !canChangePassword}
              startIcon={<VpnKey sx={{ fontSize: 16 }} />}
            >
              {pwdSaving ? t('pages.profile.updating', 'Updating…') : t('pages.profile.updatePassword', 'Update Password')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* ── Permissions & role ───────────────────────────────────────────────── */}
      {permissions.length > 0 && (
        <Card
          elevation={0}
          sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
        >
          <CardContent sx={{ p: 3 }}>
            <Box
              sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => setShowRules((v) => !v)}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Shield sx={{ color: 'text.secondary', fontSize: 20 }} />
                <Typography variant="h6" fontWeight={700}>
                  {t('pages.profile.accessAndPermissions', 'Access & Permissions')}
                </Typography>
                <Chip
                  label={chip.label}
                  size="small"
                  sx={{ bgcolor: chip.bg, color: chip.color, fontWeight: 600, fontSize: 11 }}
                />
              </Box>
              <Tooltip title="Toggle permissions list">
                <IconButton size="small">
                  {showRules ? <ExpandLess /> : <ExpandMore />}
                </IconButton>
              </Tooltip>
            </Box>

            <Collapse in={showRules}>
              <Divider sx={{ my: 2 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('pages.profile.accessDescription', 'Your account has the following access permissions in this property.')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {permissions.map((p) => (
                  <Chip
                    key={p}
                    label={p}
                    size="small"
                    variant="outlined"
                    sx={{ fontFamily: 'monospace', fontSize: 11 }}
                  />
                ))}
              </Box>
            </Collapse>
          </CardContent>
        </Card>
      )}
    </>
  );
};

export default ProfileView;
