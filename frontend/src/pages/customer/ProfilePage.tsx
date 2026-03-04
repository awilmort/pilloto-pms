import React, { useEffect, useState } from 'react';
import { Container, Card, CardContent, Typography, Box, Grid, TextField, Button, Alert } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/api';
import { useTranslation } from 'react-i18next';

const ProfilePage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  const handleSaveProfile = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const res = await authService.updateProfile({ firstName, lastName, phone, email });
      if (res.data.success) {
        await refreshUser();
        setSuccess(res.data.message || t('pages.profile.updateSuccess'));
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('pages.profile.updateError'));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    try {
      setChangingPwd(true);
      setError(null);
      setSuccess(null);
      const res = await authService.changePassword({ currentPassword, newPassword });
      if (res.data.success) {
        setSuccess(t('pages.profile.passwordSuccess'));
        setCurrentPassword('');
        setNewPassword('');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('pages.profile.passwordError'));
    } finally {
      setChangingPwd(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography variant="h4" gutterBottom color="primary">{t('pages.profile.title')}</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>{t('pages.profile.personalInfo')}</Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField label={t('pages.profile.firstName')} value={firstName} onChange={(e) => setFirstName(e.target.value)} fullWidth />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField label={t('pages.profile.lastName')} value={lastName} onChange={(e) => setLastName(e.target.value)} fullWidth />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField label={t('pages.profile.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField label={t('pages.profile.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth />
            </Grid>
          </Grid>
          <Box sx={{ mt: 3, textAlign: 'right' }}>
            <Button variant="contained" onClick={handleSaveProfile} disabled={saving || !firstName || !lastName || !email}>{t('pages.profile.saveChanges')}</Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>{t('pages.profile.changePassword')}</Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField label={t('pages.profile.currentPassword')} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} fullWidth />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField label={t('pages.profile.newPassword')} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} fullWidth />
            </Grid>
          </Grid>
          <Box sx={{ mt: 3, textAlign: 'right' }}>
            <Button variant="outlined" onClick={handleChangePassword} disabled={changingPwd || !currentPassword || !newPassword}>{t('pages.profile.updatePassword')}</Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
};

export default ProfilePage;
