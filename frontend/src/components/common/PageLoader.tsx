import React from 'react';
import { Box, CircularProgress } from '@mui/material';

interface PageLoaderProps {
  /** Fill the viewport (before any shell is on screen) instead of the content area. */
  fullPage?: boolean;
  /** Milliseconds to wait before showing the spinner, so a chunk that loads quickly never flashes one. */
  delay?: number;
}

/** Suspense fallback for lazily loaded pages: reserves the space at once, shows the spinner only if loading drags. */
const PageLoader: React.FC<PageLoaderProps> = ({ fullPage = false, delay = 200 }) => {
  const [visible, setVisible] = React.useState(delay <= 0);
  React.useEffect(() => {
    if (delay <= 0) return undefined;
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: fullPage ? '100vh' : '50vh' }}>
      {visible && <CircularProgress size={48} />}
    </Box>
  );
};

export default PageLoader;
