import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const BeachIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Beach">
    {/* sun */}
    <circle cx="95" cy="22" r="10" stroke={S} strokeWidth="1.5" />
    <line x1="95" y1="8" x2="95" y2="12" stroke={S} strokeWidth="1" />
    <line x1="95" y1="32" x2="95" y2="36" stroke={S} strokeWidth="1" />
    <line x1="81" y1="22" x2="85" y2="22" stroke={S} strokeWidth="1" />
    <line x1="105" y1="22" x2="109" y2="22" stroke={S} strokeWidth="1" />
    {/* umbrella pole */}
    <line x1="38" y1="30" x2="38" y2="72" stroke={S} strokeWidth="2" />
    {/* umbrella canopy */}
    <path d="M14 32 Q26 16 38 28 Q50 16 62 32" stroke={S} strokeWidth="2" />
    {/* waves */}
    <path d="M0 72 Q15 66 30 72 Q45 78 60 72 Q75 66 90 72 Q105 78 120 72" stroke={S} strokeWidth="1.5" />
    {/* beach chair */}
    <path d="M58 56 L78 56 L82 72 L54 72 Z" stroke={S} strokeWidth="1.5" />
    <path d="M62 56 L56 44" stroke={S} strokeWidth="1.5" />
    {/* seashell */}
    <path d="M14 76 Q18 72 22 76 Q18 80 14 76" stroke={S} strokeWidth="1" />
    {/* sand */}
    <line x1="0" y1="82" x2="120" y2="82" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default BeachIllustration;
