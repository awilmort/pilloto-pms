import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const BasketballIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Basketball court">
    {/* ball */}
    <circle cx="42" cy="45" r="16" stroke={S} strokeWidth="2" />
    <path d="M28 38 Q42 50 56 38" stroke={S} strokeWidth="1" />
    <path d="M28 52 Q42 40 56 52" stroke={S} strokeWidth="1" />
    <line x1="42" y1="29" x2="42" y2="61" stroke={S} strokeWidth="1" />
    {/* hoop backboard */}
    <line x1="82" y1="24" x2="82" y2="50" stroke={S} strokeWidth="2" />
    <rect x="82" y="30" width="18" height="12" rx="1" stroke={S} strokeWidth="1.5" />
    {/* rim */}
    <ellipse cx="92" cy="42" rx="8" ry="3" stroke={S} strokeWidth="1.5" />
    {/* net lines */}
    <line x1="86" y1="45" x2="84" y2="56" stroke={S} strokeWidth="1" />
    <line x1="92" y1="45" x2="92" y2="58" stroke={S} strokeWidth="1" />
    <line x1="98" y1="45" x2="100" y2="56" stroke={S} strokeWidth="1" />
    {/* court floor */}
    <line x1="6" y1="75" x2="114" y2="75" stroke={S} strokeWidth="2" />
    <path d="M6 75 Q60 64 114 75" stroke={S} strokeWidth="1" strokeDasharray="3 2" />
  </svg>
);

export default BasketballIllustration;
