import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const RestaurantIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Restaurant">
    {/* table */}
    <ellipse cx="60" cy="52" rx="40" ry="6" stroke={S} strokeWidth="2" />
    <line x1="35" y1="58" x2="30" y2="80" stroke={S} strokeWidth="2" />
    <line x1="85" y1="58" x2="90" y2="80" stroke={S} strokeWidth="2" />
    {/* plate left */}
    <ellipse cx="42" cy="48" rx="10" ry="3" stroke={S} strokeWidth="1.5" />
    {/* plate right */}
    <ellipse cx="78" cy="48" rx="10" ry="3" stroke={S} strokeWidth="1.5" />
    {/* wine glass */}
    <line x1="60" y1="36" x2="60" y2="46" stroke={S} strokeWidth="1.5" />
    <path d="M55 28 Q60 36 65 28" stroke={S} strokeWidth="1.5" />
    <line x1="56" y1="46" x2="64" y2="46" stroke={S} strokeWidth="1" />
    {/* chair left */}
    <rect x="10" y="40" width="12" height="28" rx="2" stroke={S} strokeWidth="1.5" />
    <line x1="12" y1="68" x2="12" y2="80" stroke={S} strokeWidth="1.5" />
    <line x1="20" y1="68" x2="20" y2="80" stroke={S} strokeWidth="1.5" />
    {/* chair right */}
    <rect x="98" y="40" width="12" height="28" rx="2" stroke={S} strokeWidth="1.5" />
    <line x1="100" y1="68" x2="100" y2="80" stroke={S} strokeWidth="1.5" />
    <line x1="108" y1="68" x2="108" y2="80" stroke={S} strokeWidth="1.5" />
    {/* chandelier */}
    <line x1="60" y1="8" x2="60" y2="16" stroke={S} strokeWidth="1" />
    <path d="M50 16 L60 22 L70 16" stroke={S} strokeWidth="1.5" />
  </svg>
);

export default RestaurantIllustration;
