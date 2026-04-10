import React from 'react';

interface Props {
  width?: number | string;
  height?: number | string;
  className?: string;
}

const S = '#9CA3AF';

const MediaIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Media">
    {/* frame */}
    <rect x="18" y="18" width="84" height="60" rx="4" stroke={S} strokeWidth="2" />
    {/* mountain */}
    <path d="M18 68 L42 40 L58 56 L70 42 L102 68" stroke={S} strokeWidth="1.5" strokeLinejoin="round" />
    {/* sun */}
    <circle cx="85" cy="32" r="7" stroke={S} strokeWidth="1.5" />
    {/* camera below */}
    <rect x="46" y="84" width="28" height="12" rx="3" stroke={S} strokeWidth="1.5" />
    <circle cx="60" cy="90" r="3" stroke={S} strokeWidth="1" />
  </svg>
);

export default MediaIllustration;
