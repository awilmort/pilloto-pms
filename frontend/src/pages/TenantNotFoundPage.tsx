import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import SearchOffIcon from '@mui/icons-material/SearchOff';

const TenantNotFoundPage: React.FC = () => {
  const slug = window.location.hostname.split('.')[0];

  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="center"
      minHeight="100vh"
      sx={{ backgroundColor: '#f5f5f5', px: 2 }}
    >
      <Paper elevation={3} sx={{ p: 6, maxWidth: 480, textAlign: 'center' }}>
        <SearchOffIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Property not found
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
          <strong>{slug}</strong> is not registered on Pilloto.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
          The property may have been removed, renamed, or the link may be incorrect.
        </Typography>
        <Button variant="outlined" onClick={() => window.location.href = 'https://pilloto.com'}>
          Go to pilloto.com
        </Button>
      </Paper>
    </Box>
  );
};

export default TenantNotFoundPage;
