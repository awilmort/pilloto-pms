import React from 'react';
import { Box } from '@mui/material';
import MarketingNavBar from './MarketingNavBar';
import MarketingFooter from './MarketingFooter';

interface MarketingLayoutProps {
  children: React.ReactNode;
}

const MarketingLayout: React.FC<MarketingLayoutProps> = ({ children }) => (
  <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
    <MarketingNavBar />
    <Box component="main" sx={{ flexGrow: 1 }}>
      {children}
    </Box>
    <MarketingFooter />
  </Box>
);

export default MarketingLayout;
