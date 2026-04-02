import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Container, Grid, TextField,
  MenuItem, Select, Link, Stack, Alert, CircularProgress, Chip, Divider,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import PillotoLogo from '../../components/marketing/PillotoLogo';

const BRAND = '#1A3C34';
const BRAND_LIGHT = '#E8F0EE';

const PLAN_OPTIONS = [
  { value: 'basic',      label: 'Basic — up to 20 rooms' },
  { value: 'pro',        label: 'Pro — up to 80 rooms' },
  { value: 'enterprise', label: 'Enterprise — unlimited rooms' },
  { value: 'general',    label: 'General inquiry' },
];

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

const ContactPage: React.FC = () => {
  const { t, i18n } = useTranslation();

  // Pre-fill plan from URL query param
  const initialPlan = (() => {
    const p = new URLSearchParams(window.location.search).get('plan') || '';
    return PLAN_OPTIONS.some(o => o.value === p) ? p : 'general';
  })();

  const [name,    setName]    = useState('');
  const [email,   setEmail]   = useState('');
  const [phone,   setPhone]   = useState('');
  const [plan,    setPlan]    = useState(initialPlan);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Keep plan in sync if user navigates directly with ?plan= in URL
    const params = new URLSearchParams(window.location.search);
    const p = params.get('plan') || '';
    if (PLAN_OPTIONS.some(o => o.value === p)) setPlan(p);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await axios.post(`${API_BASE}/auth/contact`, { name, email, phone, plan, message });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || t('marketing.contact.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#F8FAFC' }}>
      {/* Minimal nav */}
      <Box sx={{ backgroundColor: 'white', borderBottom: '1px solid #E5E7EB', py: 2, px: { xs: 2, md: 5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Link href="https://pilloto.com" underline="none">
            <PillotoLogo iconHeight={32} />
          </Link>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Select
              size="small"
              value={i18n.language.startsWith('en') ? 'en' : 'es'}
              onChange={e => i18n.changeLanguage(e.target.value as string)}
              sx={{ minWidth: 64, '& .MuiSelect-select': { py: 0.75, fontSize: '0.875rem' } }}
            >
              <MenuItem value="en">EN</MenuItem>
              <MenuItem value="es">ES</MenuItem>
            </Select>
            <Link href="https://pilloto.com" underline="hover"
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.875rem', color: 'text.secondary' }}>
              <ArrowBackIcon fontSize="small" />
              {t('marketing.contact.backToSite')}
            </Link>
          </Stack>
        </Stack>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 10 } }}>
        <Grid container spacing={8} alignItems="flex-start">

          {/* ── Left: contact info ────────────────────────────────────────── */}
          <Grid item xs={12} md={4}>
            <Box sx={{ position: { md: 'sticky' }, top: { md: 32 } }}>
              <Typography variant="overline" fontWeight={700} color={BRAND} letterSpacing={1.5} display="block" mb={2}>
                {t('marketing.contact.label')}
              </Typography>
              <Typography variant="h3" fontWeight={800} color="#0F172A" mb={2} lineHeight={1.15}>
                {t('marketing.contact.heading')}
              </Typography>
              <Typography color="text.secondary" mb={5} lineHeight={1.8}>
                {t('marketing.contact.subheading')}
              </Typography>

              <Stack spacing={3}>
                <Stack direction="row" alignItems="flex-start" spacing={2}>
                  <Box sx={{ mt: 0.3, color: BRAND }}><PhoneIcon /></Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}
                      sx={{ textTransform: 'uppercase', letterSpacing: 1 }} display="block" mb={0.5}>
                      {t('marketing.contact.phone')}
                    </Typography>
                    <Link href="tel:+18299679441" underline="hover" sx={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A' }}>
                      +1 (829) 967-9441
                    </Link>
                  </Box>
                </Stack>

                <Stack direction="row" alignItems="flex-start" spacing={2}>
                  <Box sx={{ mt: 0.3, color: BRAND }}><EmailIcon /></Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}
                      sx={{ textTransform: 'uppercase', letterSpacing: 1 }} display="block" mb={0.5}>
                      {t('marketing.contact.email')}
                    </Typography>
                    <Link href="mailto:info@pilloto.com" underline="hover" sx={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A' }}>
                      info@pilloto.com
                    </Link>
                  </Box>
                </Stack>
              </Stack>

              <Divider sx={{ my: 5 }} />

              <Typography variant="body2" color="text.secondary" mb={2} fontWeight={600}>
                {t('marketing.contact.responsetime')}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
                {(['Basic', 'Pro', 'Enterprise'] as const).map(p => (
                  <Chip key={p} label={p} size="small"
                    sx={{ backgroundColor: BRAND_LIGHT, color: BRAND, fontWeight: 700 }} />
                ))}
              </Stack>
            </Box>
          </Grid>

          {/* ── Right: form ───────────────────────────────────────────────── */}
          <Grid item xs={12} md={8}>
            <Box sx={{
              backgroundColor: 'white',
              border: '1px solid #E5E7EB',
              borderRadius: 3,
              p: { xs: 3, md: 5 },
              boxShadow: '0 4px 24px rgba(15,23,42,0.06)',
            }}>
              {success ? (
                <Stack alignItems="center" spacing={3} py={4} textAlign="center">
                  <CheckCircleOutlineIcon sx={{ fontSize: 64, color: BRAND }} />
                  <Typography variant="h5" fontWeight={800} color="#0F172A">
                    {t('marketing.contact.successTitle')}
                  </Typography>
                  <Typography color="text.secondary" sx={{ maxWidth: 400 }}>
                    {t('marketing.contact.successBody')}
                  </Typography>
                  <Button variant="outlined" href="https://pilloto.com"
                    sx={{ borderColor: BRAND, color: BRAND, mt: 1 }}>
                    {t('marketing.contact.backToSite')}
                  </Button>
                </Stack>
              ) : (
                <>
                  <Typography variant="h5" fontWeight={800} color="#0F172A" mb={0.5}>
                    {t('marketing.contact.formTitle')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={4}>
                    {t('marketing.contact.formSubtitle')}
                  </Typography>

                  {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

                  <Box component="form" onSubmit={handleSubmit}>
                    <Grid container spacing={2.5}>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          label={t('marketing.contact.fieldName')}
                          value={name}
                          onChange={e => setName(e.target.value)}
                          required fullWidth autoFocus
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          label={t('marketing.contact.fieldEmail')}
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          required fullWidth
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          label={t('marketing.contact.fieldPhone')}
                          type="tel"
                          value={phone}
                          onChange={e => setPhone(e.target.value)}
                          fullWidth
                          helperText={t('marketing.contact.fieldPhoneHint')}
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          label={t('marketing.contact.fieldPlan')}
                          select
                          value={plan}
                          onChange={e => setPlan(e.target.value)}
                          required fullWidth
                        >
                          {PLAN_OPTIONS.map(o => (
                            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                          ))}
                        </TextField>
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          label={t('marketing.contact.fieldMessage')}
                          value={message}
                          onChange={e => setMessage(e.target.value)}
                          required fullWidth multiline rows={5}
                          placeholder={t('marketing.contact.fieldMessageHint')}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <Button
                          type="submit"
                          variant="contained"
                          size="large"
                          fullWidth
                          disabled={loading || !name.trim() || !email.trim() || !message.trim()}
                          endIcon={loading ? <CircularProgress size={18} color="inherit" /> : undefined}
                          sx={{ backgroundColor: BRAND, '&:hover': { backgroundColor: '#14302A' }, py: 1.5 }}
                        >
                          {loading ? t('marketing.contact.sending') : t('marketing.contact.submitButton')}
                        </Button>
                      </Grid>
                    </Grid>
                  </Box>
                </>
              )}
            </Box>
          </Grid>
        </Grid>
      </Container>

      {/* Footer */}
      <Box component="footer" sx={{ backgroundColor: '#0F172A', py: 4, mt: 'auto' }}>
        <Container maxWidth="lg">
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" spacing={2}>
            <PillotoLogo variant="on-dark" iconHeight={28} />
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>
              © {new Date().getFullYear()} Pilloto. All rights reserved.
            </Typography>
            <Link href="mailto:info@pilloto.com" variant="caption"
              sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'white' } }}>
              info@pilloto.com
            </Link>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
};

export default ContactPage;
