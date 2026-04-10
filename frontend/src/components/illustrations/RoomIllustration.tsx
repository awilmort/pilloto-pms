import React from 'react';

interface Props {
  width?: number | string;
  height?: number | string;
  className?: string;
}

const S = '#9CA3AF'; // neutral warm gray stroke

const RoomIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Room">
    {/* bed frame */}
    <rect x="15" y="52" width="90" height="28" rx="4" stroke={S} strokeWidth="2" />
    {/* headboard */}
    <rect x="15" y="38" width="90" height="16" rx="4" stroke={S} strokeWidth="2" />
    {/* pillow left */}
    <rect x="24" y="43" width="22" height="8" rx="4" stroke={S} strokeWidth="1.5" />
    {/* pillow right */}
    <rect x="74" y="43" width="22" height="8" rx="4" stroke={S} strokeWidth="1.5" />
    {/* blanket fold */}
    <line x1="15" y1="65" x2="105" y2="65" stroke={S} strokeWidth="1.5" />
    {/* nightstand */}
    <rect x="2" y="55" width="10" height="14" rx="2" stroke={S} strokeWidth="1.5" />
    {/* lamp */}
    <line x1="7" y1="46" x2="7" y2="55" stroke={S} strokeWidth="1.5" />
    <path d="M2 46 Q7 38 12 46" stroke={S} strokeWidth="1.5" />
    {/* floor */}
    <line x1="2" y1="85" x2="118" y2="85" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default RoomIllustration;
