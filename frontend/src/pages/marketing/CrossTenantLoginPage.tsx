import React, { useState } from 'react';
import {
  Box, Typography, TextField, Button, CircularProgress, Alert, Paper,
  Container, Stack, Link,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import axios from 'axios';
import PillotoLogo from '../../components/marketing/PillotoLogo';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

function getOrigin(): string {
  try { return new URL(API_BASE_URL).origin; } catch { return ''; }
}

const CrossTenantLoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setLoading(true);
    setError('');

    try {
      const res = await axios.post(
        `${getOrigin()}/api/auth/lookup-tenant`,
        { email: trimmed },
        { headers: { 'X-Tenant-Slug': '__login_portal__' } },
      );
      const { slug } = res.data.data;

      // Determine the target URL based on environment
      const hostname = window.location.hostname;
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

      const redirectUrl = isLocalhost
        ? `http://${slug}.localhost:3000/login?email=${encodeURIComponent(trimmed)}`
        : `https://${slug}.pilloto.com/login?email=${encodeURIComponent(trimmed)}`;

      window.location.href = redirectUrl;
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      setError(msg || 'No workspace found for this email address.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      backgroundColor: '#F7F7F5',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      px: 2,
    }}>
      <Container maxWidth="xs">
        {/* Logo */}
        <Stack alignItems="center" mb={5}>
          <PillotoLogo iconHeight={42} />
          <Typography variant="body2" color="text.secondary" mt={1.5}>
            Sign in to your workspace
          </Typography>
        </Stack>

        <Paper elevation={0} sx={{
          p: 4, borderRadius: 3,
          border: '1px solid', borderColor: 'grey.200',
          boxShadow: '0 4px 24px rgba(15,23,42,0.06)',
        }}>
          <Typography variant="h6" fontWeight={700} mb={0.5}>
            Find your workspace
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Enter your email and we'll take you to the right place.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
          )}

          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              fullWidth
              required
              autoFocus
              sx={{ mb: 2 }}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={loading || !email.trim()}
              endIcon={loading ? <CircularProgress size={18} color="inherit" /> : <ArrowForwardIcon />}
            >
              Continue
            </Button>
          </Box>
        </Paper>

        <Typography variant="caption" color="text.secondary" textAlign="center" display="block" mt={4}>
          Don't have an account?{' '}
          <Link href="https://pilloto.com/#pricing" underline="hover">
            See plans
          </Link>
        </Typography>
      </Container>
    </Box>
  );
};

export default CrossTenantLoginPage;
