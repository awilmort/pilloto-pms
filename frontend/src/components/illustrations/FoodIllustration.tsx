import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const FoodIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Food">
    {/* plate */}
    <ellipse cx="55" cy="62" rx="32" ry="8" stroke={S} strokeWidth="2" />
    <ellipse cx="55" cy="58" rx="26" ry="6" stroke={S} strokeWidth="1" />
    {/* steam lines */}
    <path d="M42 40 Q44 34 42 28" stroke={S} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M55 38 Q57 32 55 26" stroke={S} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M68 40 Q70 34 68 28" stroke={S} strokeWidth="1.5" strokeLinecap="round" />
    {/* fork */}
    <line x1="95" y1="30" x2="95" y2="70" stroke={S} strokeWidth="1.5" />
    <line x1="91" y1="30" x2="91" y2="44" stroke={S} strokeWidth="1" />
    <line x1="95" y1="30" x2="95" y2="44" stroke={S} strokeWidth="1" />
    <line x1="99" y1="30" x2="99" y2="44" stroke={S} strokeWidth="1" />
    {/* knife */}
    <line x1="106" y1="30" x2="106" y2="70" stroke={S} strokeWidth="1.5" />
    <path d="M106 30 Q112 38 106 46" stroke={S} strokeWidth="1" />
    {/* table */}
    <line x1="8" y1="74" x2="112" y2="74" stroke={S} strokeWidth="2" />
  </svg>
);

export default FoodIllustration;
