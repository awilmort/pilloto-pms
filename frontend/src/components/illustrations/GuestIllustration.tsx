import React from 'react';

interface Props {
  width?: number | string;
  height?: number | string;
  className?: string;
}

const S = '#9CA3AF';

const GuestIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Guest">
    {/* head */}
    <circle cx="45" cy="28" r="12" stroke={S} strokeWidth="2" />
    {/* body */}
    <path d="M28 52 Q28 42 45 42 Q62 42 62 52 L62 72 L28 72 Z" stroke={S} strokeWidth="2" />
    {/* suitcase */}
    <rect x="72" y="42" width="24" height="30" rx="3" stroke={S} strokeWidth="2" />
    <rect x="79" y="36" width="10" height="8" rx="3" stroke={S} strokeWidth="1.5" />
    <line x1="76" y1="55" x2="92" y2="55" stroke={S} strokeWidth="1" />
    {/* wheels */}
    <circle cx="78" cy="74" r="2" stroke={S} strokeWidth="1" />
    <circle cx="90" cy="74" r="2" stroke={S} strokeWidth="1" />
    {/* floor */}
    <line x1="10" y1="80" x2="110" y2="80" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default GuestIllustration;
