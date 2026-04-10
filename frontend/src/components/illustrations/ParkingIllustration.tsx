import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const ParkingIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Parking">
    {/* car body */}
    <path d="M20 58 L24 44 Q30 38 50 38 Q70 38 76 44 L80 58" stroke={S} strokeWidth="2" />
    <rect x="16" y="58" width="68" height="14" rx="4" stroke={S} strokeWidth="2" />
    {/* wheels */}
    <circle cx="30" cy="72" r="5" stroke={S} strokeWidth="1.5" />
    <circle cx="70" cy="72" r="5" stroke={S} strokeWidth="1.5" />
    {/* windshield */}
    <path d="M32 44 L36 53 L64 53 L68 44" stroke={S} strokeWidth="1" />
    {/* P sign */}
    <rect x="92" y="22" width="18" height="22" rx="2" stroke={S} strokeWidth="1.5" />
    <line x1="101" y1="44" x2="101" y2="80" stroke={S} strokeWidth="2" />
    <text x="97" y="38" fontFamily="Arial" fontSize="14" fontWeight="bold" stroke={S} fill="none" strokeWidth="1">P</text>
    {/* ground */}
    <line x1="4" y1="80" x2="116" y2="80" stroke={S} strokeWidth="2" />
  </svg>
);

export default ParkingIllustration;
