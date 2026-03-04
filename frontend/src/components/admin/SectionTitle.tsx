import React from 'react';
import { Typography, Box } from '@mui/material';

interface SectionTitleProps {
  title: string;
  right?: React.ReactNode;
}

const SectionTitle: React.FC<SectionTitleProps> = ({ title, right }) => {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
      <Typography variant="h3" component="h1" gutterBottom>
        {title}
      </Typography>
      {right}
    </Box>
  );
};

export default SectionTitle;
