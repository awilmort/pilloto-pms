import React, { useState, useEffect } from 'react';
import { Box, Button, Typography, Link, Stack, Slide } from '@mui/material';
import { useTranslation } from 'react-i18next';

const STORAGE_KEY = 'pilloto_cookie_consent';
const BRAND = '#1A3C34';

type ConsentChoice = 'accepted' | 'rejected';

const CookieConsent: React.FC = () => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleChoice = (choice: ConsentChoice) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, date: new Date().toISOString() }));
    setVisible(false);
  };

  return (
    <Slide direction="up" in={visible} mountOnEnter unmountOnExit>
      <Box
        role="dialog"
        aria-label={t('legal.cookies.consentTitle')}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1400,
          backgroundColor: 'white',
          borderTop: '1px solid #E5E7EB',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
          py: 3,
          px: { xs: 2, md: 6 },
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          alignItems={{ md: 'center' }}
          justifyContent="space-between"
          spacing={2}
          sx={{ maxWidth: 1200, mx: 'auto' }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              {t('legal.cookies.consentTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
              {t('legal.cookies.consentBody')}{' '}
              <Link href="/cookies" underline="hover" sx={{ color: BRAND }}>
                {t('legal.nav.cookies')}
              </Link>.
            </Typography>
          </Box>
          <Stack direction="row" spacing={2} sx={{ flexShrink: 0 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={() => handleChoice('rejected')}
              sx={{ borderColor: '#CBD5E1', color: '#64748B', '&:hover': { borderColor: '#94A3B8' } }}
            >
              {t('legal.cookies.reject')}
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={() => handleChoice('accepted')}
              sx={{ backgroundColor: BRAND, '&:hover': { backgroundColor: '#14302A' } }}
            >
              {t('legal.cookies.accept')}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Slide>
  );
};

export default CookieConsent;
