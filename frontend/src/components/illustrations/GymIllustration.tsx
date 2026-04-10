import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const GymIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Gym">
    {/* dumbbell bar */}
    <line x1="22" y1="45" x2="98" y2="45" stroke={S} strokeWidth="2" />
    {/* weight plates left */}
    <rect x="12" y="34" width="10" height="22" rx="2" stroke={S} strokeWidth="2" />
    <rect x="6" y="38" width="8" height="14" rx="2" stroke={S} strokeWidth="1.5" />
    {/* weight plates right */}
    <rect x="98" y="34" width="10" height="22" rx="2" stroke={S} strokeWidth="2" />
    <rect x="106" y="38" width="8" height="14" rx="2" stroke={S} strokeWidth="1.5" />
    {/* treadmill */}
    <rect x="30" y="62" width="60" height="8" rx="3" stroke={S} strokeWidth="1.5" />
    <line x1="30" y1="70" x2="25" y2="80" stroke={S} strokeWidth="1.5" />
    <line x1="90" y1="70" x2="95" y2="80" stroke={S} strokeWidth="1.5" />
    {/* treadmill handle */}
    <line x1="30" y1="62" x2="30" y2="54" stroke={S} strokeWidth="1.5" />
    <line x1="30" y1="54" x2="42" y2="54" stroke={S} strokeWidth="1.5" />
    {/* floor */}
    <line x1="4" y1="84" x2="116" y2="84" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default GymIllustration;
