import React from 'react';
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  CardContent,
  CardMedia,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const HomePage: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Box>
      {/* Hero Section */}
      <Box
        sx={{
          minHeight: { xs: '60vh', md: '80vh' },
          backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('/images/home.jpg')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Container maxWidth="lg">
          <Box
            sx={{
              textAlign: 'center',
              color: 'white',
              maxWidth: 800,
              mx: 'auto',
            }}
          >
            <Typography
              variant={isMobile ? 'h3' : 'h1'}
              gutterBottom
              sx={{
                fontWeight: 700,
                textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
              }}
            >
              {t('pages.home.heroTitle')}
            </Typography>
            <Typography
              variant={isMobile ? 'h6' : 'h4'}
              gutterBottom
              sx={{
                mb: 4,
                fontWeight: 300,
                textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
              }}
            >
              {t('pages.home.heroSubtitle')}
            </Typography>
          </Box>
        </Container>
      </Box>

      {/* Welcome Section */}
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Typography
            variant="h2"
            gutterBottom
            sx={{
              fontWeight: 700,
              color: 'primary.main',
              mb: 3,
            }}
          >
            {t('pages.home.welcomeTitle')}
          </Typography>
          <Typography
            variant="h5"
            color="text.secondary"
            sx={{
              maxWidth: 800,
              mx: 'auto',
              lineHeight: 1.6,
            }}
          >
            {t('pages.home.welcomeBody')}
          </Typography>
        </Box>

        {/* Feature Cards */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 4, mt: 6 }}>
          <Card sx={{ flex: 1, borderRadius: 3, display: 'flex', flexDirection: 'column' }}>
            <CardMedia
              component="img"
              height="200"
              image="/images/villa.png"
              alt="Luxury Rooms"
            />
            <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
                {t('pages.home.cardLuxuryTitle')}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3, flexGrow: 1 }}>
                {t('pages.home.cardLuxuryBody')}
              </Typography>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                onClick={() => navigate('/rooms')}
                sx={{
                  py: 1.5,
                  fontSize: '1rem',
                  fontWeight: 600,
                  borderRadius: 2,
                  textTransform: 'none',
                  mt: 'auto',
                }}
              >
                {t('pages.home.cardLuxuryButton')}
              </Button>
            </CardContent>
          </Card>

          <Card sx={{ flex: 1, borderRadius: 3, display: 'flex', flexDirection: 'column' }}>
            <CardMedia
              component="img"
              height="200"
              image="/images/aqua-park.png"
              alt="Aqua Park"
            />
            <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
                {t('pages.home.cardAquaTitle')}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3, flexGrow: 1 }}>
                {t('pages.home.cardAquaBody')}
              </Typography>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                onClick={() => navigate('/daypass')}
                sx={{
                  py: 1.5,
                  fontSize: '1rem',
                  fontWeight: 600,
                  borderRadius: 2,
                  textTransform: 'none',
                  mt: 'auto',
                }}
              >
                {t('pages.home.cardAquaButton')}
              </Button>
            </CardContent>
          </Card>

          <Card sx={{ flex: 1, borderRadius: 3, display: 'flex', flexDirection: 'column' }}>
            <CardMedia
              component="img"
              height="200"
              image="/images/wedding.jpg"
              alt="Unforgettable Events"
            />
            <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
                {t('pages.home.cardEventsTitle')}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3, flexGrow: 1 }}>
                {t('pages.home.cardEventsBody')}
              </Typography>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                onClick={() => navigate('/events')}
                sx={{
                  py: 1.5,
                  fontSize: '1rem',
                  fontWeight: 600,
                  borderRadius: 2,
                  textTransform: 'none',
                  mt: 'auto',
                }}
              >
                {t('pages.home.cardEventsButton')}
              </Button>
            </CardContent>
          </Card>
        </Box>
      </Container>

      {/* Call to Action */}
      <Box
        sx={{
          bgcolor: 'primary.main',
          color: 'white',
          py: 8,
        }}
      >
        <Container maxWidth="lg">
          <Box sx={{ textAlign: 'center' }}>
            <Typography
              variant="h2"
              gutterBottom
              sx={{ fontWeight: 700, mb: 3 }}
            >
              {t('pages.home.ctaTitle')}
            </Typography>
            <Typography
              variant="h5"
              gutterBottom
              sx={{ mb: 4, fontWeight: 300, opacity: 0.9 }}
            >
              {t('pages.home.ctaBody')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                color="secondary"
                size="large"
                onClick={() => navigate('/rooms')}
                sx={{
                  px: 4,
                  py: 1.5,
                  fontSize: '1.2rem',
                  fontWeight: 600,
                  borderRadius: 3,
                  textTransform: 'none',
                }}
              >
                {t('pages.home.ctaBookStay')}
              </Button>
            </Box>
          </Box>
        </Container>
      </Box>
    </Box>
  );
};

export default HomePage;
