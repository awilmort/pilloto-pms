/**
 * /set-password?token=… — the link in an invitation email. Shows who is invited, lets them choose
 * their first password and signs them in. Invalid, used or expired links say so.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Container, Paper, TextField, Typography } from '@mui/material';
import { Lock } from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authService } from '../../services/api';

type State = 'checking' | 'ready' | 'invalid' | 'expired';

const SetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<State>('checking');
  const [invite, setInvite] = useState<{ firstName: string; email: string; tenantName: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) { setState('invalid'); return; }
    authService.getInvitation(token)
      .then((res) => { setInvite(res.data.data ?? null); setState('ready'); })
      .catch((e) => setState(e?.response?.status === 410 ? 'expired' : 'invalid'));
  }, [token]);

  const passwordProblem = (p: string): string | null => {
    if (p.length < 6) return t('pages.passwordReset.errors.passwordMin');
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(p)) return t('pages.passwordReset.errors.passwordPattern');
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) { setError(problem); return; }
    if (password !== confirm) { setError(t('pages.passwordReset.errors.passwordsMismatch')); return; }
    setSaving(true);
    setError('');
    try {
      const res = await authService.acceptInvitation(token, password);
      if (res.data.token) localStorage.setItem('token', res.data.token);
      // Full reload so the session starts from the stored token
      window.location.assign('/admin');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 410) setState('expired');
      else if (status === 400 && err?.response?.data?.reason === 'invalid') setState('invalid');
      else setError(err?.response?.data?.message || t('pages.setPassword.failed'));
      setSaving(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Lock sx={{ fontSize: 56, color: 'primary.main', mb: 1.5 }} />
          <Typography variant="h4" component="h1" gutterBottom>{t('pages.setPassword.title')}</Typography>
          {state === 'ready' && invite && (
            <Typography variant="body1" color="text.secondary">
              {t('pages.setPassword.subtitle', { name: invite.firstName, tenant: invite.tenantName })}
            </Typography>
          )}
        </Box>

        {state === 'checking' && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
            <CircularProgress size={20} /><Typography color="text.secondary">{t('pages.setPassword.checking')}</Typography>
          </Box>
        )}

        {(state === 'invalid' || state === 'expired') && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Alert severity={state === 'expired' ? 'warning' : 'error'}>{t(`pages.setPassword.${state}`)}</Alert>
            <Button variant="contained" onClick={() => navigate('/login')}>{t('pages.setPassword.goToLogin')}</Button>
          </Box>
        )}

        {state === 'ready' && (
          <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: 2.5 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {invite && <TextField label={t('pages.setPassword.email')} value={invite.email} disabled fullWidth />}
            <TextField id="set-password" label={t('pages.setPassword.password')} type="password" value={password} autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)} helperText={t('pages.passwordReset.helperPassword')} required fullWidth autoFocus />
            <TextField id="set-password-confirm" label={t('pages.setPassword.confirm')} type="password" value={confirm} autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)} required fullWidth
              error={confirm !== '' && password !== confirm}
              helperText={confirm !== '' && password !== confirm ? t('pages.passwordReset.helperConfirmMismatch') : ''} />
            <Button type="submit" variant="contained" size="large" disabled={saving} fullWidth>
              {saving ? <CircularProgress size={24} color="inherit" /> : t('pages.setPassword.submit')}
            </Button>
          </Box>
        )}
      </Paper>
    </Container>
  );
};

export default SetPasswordPage;
