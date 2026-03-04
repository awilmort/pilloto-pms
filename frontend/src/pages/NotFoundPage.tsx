import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: 3,
        textAlign: 'center',
        p: 3,
      }}
    >
      <Typography variant="h1" sx={{ fontWeight: 800, fontSize: { xs: '6rem', md: '10rem' }, color: 'text.disabled', lineHeight: 1 }}>
        404
      </Typography>
      <Typography variant="h5" fontWeight={600}>
        {t('errors.notFound.title', 'Page not found')}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 400 }}>
        {t('errors.notFound.description', "The page you're looking for doesn't exist or has been moved.")}
      </Typography>
      <Button variant="contained" size="large" onClick={() => navigate('/')}>
        {t('errors.notFound.returnHome', 'Return Home')}
      </Button>
    </Box>
  );
};

export default NotFoundPage;
