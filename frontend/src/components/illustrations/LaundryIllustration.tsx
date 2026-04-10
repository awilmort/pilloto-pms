import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const LaundryIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Laundry">
    {/* washing machine body */}
    <rect x="25" y="18" width="70" height="62" rx="4" stroke={S} strokeWidth="2" />
    {/* top panel */}
    <line x1="25" y1="32" x2="95" y2="32" stroke={S} strokeWidth="1.5" />
    {/* control knobs */}
    <circle cx="38" cy="25" r="3" stroke={S} strokeWidth="1" />
    <circle cx="52" cy="25" r="3" stroke={S} strokeWidth="1" />
    {/* window / drum */}
    <circle cx="60" cy="55" r="18" stroke={S} strokeWidth="2" />
    <circle cx="60" cy="55" r="12" stroke={S} strokeWidth="1" />
    {/* clothes swirl */}
    <path d="M54 50 Q60 46 66 50 Q60 58 54 50" stroke={S} strokeWidth="1" />
    {/* legs */}
    <line x1="30" y1="80" x2="30" y2="86" stroke={S} strokeWidth="2" />
    <line x1="90" y1="80" x2="90" y2="86" stroke={S} strokeWidth="2" />
    {/* floor */}
    <line x1="10" y1="88" x2="110" y2="88" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default LaundryIllustration;
