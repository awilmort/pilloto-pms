import React from 'react';

interface Props {
  width?: number | string;
  height?: number | string;
  className?: string;
}

const S = '#9CA3AF';

const AmenityIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Amenity">
    {/* towel roll */}
    <ellipse cx="35" cy="60" rx="14" ry="18" stroke={S} strokeWidth="2" />
    <path d="M35 42 Q55 42 55 60 Q55 78 35 78" stroke={S} strokeWidth="1.5" />
    {/* slippers */}
    <path d="M70 72 Q72 64 78 64 Q84 64 86 72 L84 76 Q78 74 72 76 Z" stroke={S} strokeWidth="1.5" />
    <path d="M90 72 Q92 64 98 64 Q104 64 106 72 L104 76 Q98 74 92 76 Z" stroke={S} strokeWidth="1.5" />
    {/* soap dispenser */}
    <rect x="75" y="34" width="14" height="22" rx="3" stroke={S} strokeWidth="1.5" />
    <line x1="82" y1="28" x2="82" y2="34" stroke={S} strokeWidth="1.5" />
    <path d="M79 28 L85 28 L86 30 L78 30 Z" stroke={S} strokeWidth="1" />
    {/* sparkle */}
    <path d="M108 30 L110 24 L112 30 L110 36 Z" stroke={S} strokeWidth="1" />
    <line x1="104" y1="30" x2="116" y2="30" stroke={S} strokeWidth="1" />
    {/* floor */}
    <line x1="6" y1="85" x2="114" y2="85" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default AmenityIllustration;
