import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * Official Pilloto logo — inline SVG icon + Cormorant Garamond wordmark.
 * variant='on-light'  → dark icon + dark text  (use on white / light backgrounds)
 * variant='on-dark'   → light icon + white text (use on dark backgrounds)
 */

interface PillotoLogoProps {
  variant?: 'on-light' | 'on-dark';
  /** Height of the SVG icon in px. Wordmark scales proportionally. */
  iconHeight?: number;
  /** Hide the "Pilloto" wordmark; show icon mark only. */
  iconOnly?: boolean;
}

const PillotoLogo: React.FC<PillotoLogoProps> = ({
  variant = 'on-light',
  iconHeight = 36,
  iconOnly = false,
}) => {
  const isDark = variant === 'on-dark';

  // Scale SVG (original viewBox is 52×70)
  const iconWidth = Math.round(iconHeight * (52 / 70));

  // Colour sets
  const outline    = isDark ? '#888888' : '#999999';
  const fill       = isDark ? '#CCCCCC' : '#1A3C34';   // brand green on light
  const fillDim    = isDark ? '#555555' : '#A8C4BC';   // muted window
  const bgFill     = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const textColor  = isDark ? 'white' : '#111111';

  return (
    <Box display="flex" alignItems="center" gap={iconOnly ? 0 : 1.25}>
      <svg
        width={iconWidth}
        height={iconHeight}
        viewBox="0 0 52 70"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Building frame */}
        <rect x="4" y="2" width="44" height="66" rx="3"
          fill={bgFill} stroke={outline} strokeWidth="1.5" />
        {/* Row 1 — both lit */}
        <rect x="10" y="11" width="12" height="10" rx="1.5" fill={fill} />
        <rect x="30" y="11" width="12" height="10" rx="1.5" fill={fill} />
        {/* Row 2 — left dim */}
        <rect x="10" y="27" width="12" height="10" rx="1.5" fill={fillDim} />
        <rect x="30" y="27" width="12" height="10" rx="1.5" fill={fill} />
        {/* Row 3 — left only */}
        <rect x="10" y="43" width="12" height="10" rx="1.5" fill={fill} />
      </svg>

      {!iconOnly && (
        <Typography
          component="span"
          sx={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontWeight: 700,
            fontSize: `${Math.round(iconHeight * 0.72)}px`,
            letterSpacing: '-0.5px',
            lineHeight: 1,
            color: textColor,
            userSelect: 'none',
          }}
        >
          Pilloto
        </Typography>
      )}
    </Box>
  );
};

export default PillotoLogo;
