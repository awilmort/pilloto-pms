import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const SpaIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Spa">
    {/* lotus flower */}
    <path d="M60 40 Q50 28 60 18 Q70 28 60 40" stroke={S} strokeWidth="1.5" />
    <path d="M60 40 Q44 34 42 22 Q56 26 60 40" stroke={S} strokeWidth="1.5" />
    <path d="M60 40 Q76 34 78 22 Q64 26 60 40" stroke={S} strokeWidth="1.5" />
    <path d="M60 40 Q38 40 34 30 Q48 32 60 40" stroke={S} strokeWidth="1.5" />
    <path d="M60 40 Q82 40 86 30 Q72 32 60 40" stroke={S} strokeWidth="1.5" />
    {/* water/bowl */}
    <path d="M28 58 Q32 50 60 48 Q88 50 92 58" stroke={S} strokeWidth="2" />
    <path d="M28 58 Q60 66 92 58" stroke={S} strokeWidth="2" />
    {/* ripples */}
    <path d="M40 54 Q50 50 60 54 Q70 58 80 54" stroke={S} strokeWidth="1" />
    {/* candle left */}
    <rect x="14" y="60" width="8" height="16" rx="2" stroke={S} strokeWidth="1.5" />
    <path d="M18 56 Q16 52 18 48 Q20 52 18 56" stroke={S} strokeWidth="1" />
    {/* candle right */}
    <rect x="98" y="60" width="8" height="16" rx="2" stroke={S} strokeWidth="1.5" />
    <path d="M102 56 Q100 52 102 48 Q104 52 102 56" stroke={S} strokeWidth="1" />
    {/* surface */}
    <line x1="6" y1="82" x2="114" y2="82" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default SpaIllustration;
