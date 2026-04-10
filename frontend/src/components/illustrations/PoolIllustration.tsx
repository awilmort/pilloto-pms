import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const PoolIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Pool">
    {/* pool outline */}
    <rect x="10" y="35" width="100" height="45" rx="10" stroke={S} strokeWidth="2" />
    {/* water ripples */}
    <path d="M25 52 Q35 46 45 52 Q55 58 65 52 Q75 46 85 52" stroke={S} strokeWidth="1.5" />
    <path d="M30 62 Q40 56 50 62 Q60 68 70 62 Q80 56 90 62" stroke={S} strokeWidth="1" />
    {/* ladder */}
    <line x1="96" y1="28" x2="96" y2="42" stroke={S} strokeWidth="1.5" />
    <line x1="104" y1="28" x2="104" y2="42" stroke={S} strokeWidth="1.5" />
    <line x1="96" y1="32" x2="104" y2="32" stroke={S} strokeWidth="1.5" />
    <line x1="96" y1="37" x2="104" y2="37" stroke={S} strokeWidth="1.5" />
    {/* diving board */}
    <line x1="10" y1="30" x2="32" y2="30" stroke={S} strokeWidth="2" />
    <line x1="10" y1="30" x2="10" y2="35" stroke={S} strokeWidth="2" />
    {/* floor */}
    <line x1="4" y1="88" x2="116" y2="88" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default PoolIllustration;
