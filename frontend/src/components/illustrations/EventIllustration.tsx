import React from 'react';

interface Props {
  width?: number | string;
  height?: number | string;
  className?: string;
}

const S = '#9CA3AF';

const EventIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Event">
    {/* calendar body */}
    <rect x="20" y="25" width="80" height="60" rx="4" stroke={S} strokeWidth="2" />
    {/* calendar header */}
    <line x1="20" y1="40" x2="100" y2="40" stroke={S} strokeWidth="2" />
    {/* rings */}
    <line x1="40" y1="20" x2="40" y2="30" stroke={S} strokeWidth="2" strokeLinecap="round" />
    <line x1="80" y1="20" x2="80" y2="30" stroke={S} strokeWidth="2" strokeLinecap="round" />
    {/* date dots */}
    <circle cx="35" cy="50" r="2" stroke={S} strokeWidth="1" />
    <circle cx="50" cy="50" r="2" stroke={S} strokeWidth="1" />
    <circle cx="65" cy="50" r="2" stroke={S} strokeWidth="1" />
    <circle cx="80" cy="50" r="2" stroke={S} strokeWidth="1" />
    <circle cx="35" cy="63" r="2" stroke={S} strokeWidth="1" />
    <circle cx="50" cy="63" r="2" stroke={S} strokeWidth="1" />
    {/* highlighted date */}
    <circle cx="65" cy="63" r="5" stroke={S} strokeWidth="1.5" />
    <circle cx="80" cy="63" r="2" stroke={S} strokeWidth="1" />
    <circle cx="35" cy="76" r="2" stroke={S} strokeWidth="1" />
    <circle cx="50" cy="76" r="2" stroke={S} strokeWidth="1" />
    {/* flag */}
    <line x1="105" y1="18" x2="105" y2="55" stroke={S} strokeWidth="1.5" />
    <path d="M105 18 L116 24 L105 30" stroke={S} strokeWidth="1.5" />
  </svg>
);

export default EventIllustration;
