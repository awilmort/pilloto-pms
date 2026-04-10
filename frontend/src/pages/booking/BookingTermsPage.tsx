import React, { useEffect, useState } from 'react';
import { Container, Typography, CircularProgress, Alert, Paper, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { bookingService } from '../../services/api';
import BookingLayout from '../../components/booking/BookingLayout';

const FONT = '"Inter", "Plus Jakarta Sans", "Helvetica", sans-serif';
const CARD_RADIUS = '12px';
const BORDER = '#EBEBEB';
const ACCENT = '#F06543';   // Sunset Orange

const BookingTermsPage: React.FC = () => {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    bookingService.getTerms()
      .then(res => setContent(res.data?.data?.content || ''))
      .catch(() => setError(t('bookingEngine.legal.termsLoadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <BookingLayout>
      <Container maxWidth="md" sx={{ py: 5 }}>
        {loading ? (
          <Box display="flex" justifyContent="center" py={8}>
            <CircularProgress sx={{ color: ACCENT }} />
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ borderRadius: '8px' }}>{error}</Alert>
        ) : (
          <Paper
            elevation={0}
            sx={{
              p: { xs: 2.5, md: 4 },
              borderRadius: CARD_RADIUS,
              border: `1px solid ${BORDER}`,
              boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            }}
          >
            <Typography
              component="div"
              sx={{
                fontFamily: FONT,
                '& h1': { typography: 'h4', fontWeight: 700, mb: 2, fontFamily: FONT },
                '& h2': { typography: 'h5', fontWeight: 600, mt: 3, mb: 1, fontFamily: FONT },
                '& h3': { typography: 'h6', fontWeight: 600, mt: 2, mb: 1, fontFamily: FONT },
                '& p': { mb: 1.5, lineHeight: 1.7, color: '#222222' },
                '& ul, & ol': { pl: 3, mb: 1.5 },
                '& li': { mb: 0.5 },
                '& a': { color: ACCENT, fontWeight: 600 },
              }}
              dangerouslySetInnerHTML={{ __html: content }}
            />
          </Paper>
        )}
      </Container>
    </BookingLayout>
  );
};

export default BookingTermsPage;
