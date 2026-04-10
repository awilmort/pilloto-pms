import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const BarIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Bar">
    {/* bar counter */}
    <rect x="10" y="55" width="100" height="8" rx="2" stroke={S} strokeWidth="2" />
    {/* cocktail glass */}
    <path d="M30 30 L40 48 L40 52" stroke={S} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M50 30 L40 48" stroke={S} strokeWidth="1.5" strokeLinecap="round" />
    <line x1="34" y1="52" x2="46" y2="52" stroke={S} strokeWidth="1.5" />
    {/* olive/garnish */}
    <circle cx="44" cy="35" r="2" stroke={S} strokeWidth="1" />
    {/* beer mug */}
    <rect x="62" y="34" width="14" height="20" rx="2" stroke={S} strokeWidth="1.5" />
    <path d="M76 38 Q82 40 82 44 Q82 48 76 50" stroke={S} strokeWidth="1.5" />
    {/* foam */}
    <path d="M62 36 Q66 32 69 36 Q72 32 76 36" stroke={S} strokeWidth="1" />
    {/* bar stool */}
    <circle cx="35" cy="68" r="5" stroke={S} strokeWidth="1.5" />
    <line x1="35" y1="73" x2="35" y2="84" stroke={S} strokeWidth="1.5" />
    <line x1="29" y1="84" x2="41" y2="84" stroke={S} strokeWidth="1.5" />
    {/* bar stool 2 */}
    <circle cx="75" cy="68" r="5" stroke={S} strokeWidth="1.5" />
    <line x1="75" y1="73" x2="75" y2="84" stroke={S} strokeWidth="1.5" />
    <line x1="69" y1="84" x2="81" y2="84" stroke={S} strokeWidth="1.5" />
  </svg>
);

export default BarIllustration;
