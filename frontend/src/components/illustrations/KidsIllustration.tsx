import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const KidsIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Kids area">
    {/* slide */}
    <line x1="20" y1="24" x2="20" y2="72" stroke={S} strokeWidth="2" />
    <line x1="20" y1="24" x2="30" y2="24" stroke={S} strokeWidth="2" />
    <path d="M30 24 Q32 24 60 72" stroke={S} strokeWidth="2" />
    {/* swing frame */}
    <path d="M70 20 L80 20 L90 20" stroke={S} strokeWidth="2" />
    <line x1="70" y1="20" x2="72" y2="72" stroke={S} strokeWidth="1.5" />
    <line x1="90" y1="20" x2="88" y2="72" stroke={S} strokeWidth="1.5" />
    {/* swing seat */}
    <line x1="76" y1="20" x2="74" y2="52" stroke={S} strokeWidth="1.5" />
    <line x1="84" y1="20" x2="86" y2="52" stroke={S} strokeWidth="1.5" />
    <line x1="74" y1="52" x2="86" y2="52" stroke={S} strokeWidth="2" />
    {/* ball */}
    <circle cx="105" cy="68" r="8" stroke={S} strokeWidth="1.5" />
    <path d="M99 64 Q105 68 111 64" stroke={S} strokeWidth="1" />
    {/* ground */}
    <line x1="4" y1="78" x2="116" y2="78" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default KidsIllustration;
