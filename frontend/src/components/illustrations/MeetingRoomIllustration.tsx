import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const MeetingRoomIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Meeting room">
    {/* table */}
    <rect x="22" y="42" width="76" height="20" rx="3" stroke={S} strokeWidth="2" />
    <line x1="30" y1="62" x2="30" y2="78" stroke={S} strokeWidth="2" />
    <line x1="90" y1="62" x2="90" y2="78" stroke={S} strokeWidth="2" />
    {/* chair left */}
    <path d="M10 38 L10 64 L18 64 L18 38" stroke={S} strokeWidth="1.5" />
    <path d="M10 38 Q14 34 18 38" stroke={S} strokeWidth="1.5" />
    {/* chair right */}
    <path d="M102 38 L102 64 L110 64 L110 38" stroke={S} strokeWidth="1.5" />
    <path d="M102 38 Q106 34 110 38" stroke={S} strokeWidth="1.5" />
    {/* chair back top */}
    <path d="M44 38 L44 42" stroke={S} strokeWidth="1.5" />
    <path d="M76 38 L76 42" stroke={S} strokeWidth="1.5" />
    <path d="M40 34 L48 34" stroke={S} strokeWidth="1.5" />
    <path d="M72 34 L80 34" stroke={S} strokeWidth="1.5" />
    {/* projector screen */}
    <rect x="35" y="12" width="50" height="4" rx="1" stroke={S} strokeWidth="1.5" />
    <line x1="36" y1="16" x2="36" y2="28" stroke={S} strokeWidth="1" />
    <line x1="84" y1="16" x2="84" y2="28" stroke={S} strokeWidth="1" />
    <rect x="36" y="16" width="48" height="12" rx="1" stroke={S} strokeWidth="1" />
    {/* floor */}
    <line x1="4" y1="84" x2="116" y2="84" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default MeetingRoomIllustration;
