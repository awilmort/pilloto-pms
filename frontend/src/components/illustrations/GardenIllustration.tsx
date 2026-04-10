import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const GardenIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Garden">
    {/* tree */}
    <line x1="30" y1="45" x2="30" y2="75" stroke={S} strokeWidth="2" />
    <circle cx="30" cy="32" r="16" stroke={S} strokeWidth="2" />
    <circle cx="22" cy="38" r="10" stroke={S} strokeWidth="1" />
    <circle cx="38" cy="38" r="10" stroke={S} strokeWidth="1" />
    {/* flower 1 */}
    <line x1="70" y1="55" x2="70" y2="75" stroke={S} strokeWidth="1.5" />
    <circle cx="70" cy="50" r="5" stroke={S} strokeWidth="1.5" />
    <circle cx="70" cy="50" r="2" stroke={S} strokeWidth="1" />
    {/* flower 2 */}
    <line x1="88" y1="50" x2="88" y2="75" stroke={S} strokeWidth="1.5" />
    <path d="M83 42 Q88 36 93 42 Q88 48 83 42" stroke={S} strokeWidth="1.5" />
    {/* fence */}
    <line x1="4" y1="75" x2="116" y2="75" stroke={S} strokeWidth="1.5" />
    <line x1="10" y1="68" x2="10" y2="82" stroke={S} strokeWidth="1.5" />
    <line x1="25" y1="68" x2="25" y2="82" stroke={S} strokeWidth="1.5" />
    <line x1="55" y1="68" x2="55" y2="82" stroke={S} strokeWidth="1.5" />
    <line x1="100" y1="68" x2="100" y2="82" stroke={S} strokeWidth="1.5" />
    {/* butterfly */}
    <path d="M104 28 Q108 22 112 28 Q108 34 104 28" stroke={S} strokeWidth="1" />
    <path d="M100 28 Q96 22 92 28 Q96 34 100 28" stroke={S} strokeWidth="1" />
    <line x1="102" y1="26" x2="102" y2="30" stroke={S} strokeWidth="0.8" />
  </svg>
);

export default GardenIllustration;
