import React from 'react';

interface Props {
  width?: number | string;
  height?: number | string;
  className?: string;
}

const S = '#9CA3AF';

const ServiceIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="Service">
    {/* bell dome */}
    <path d="M30 62 Q30 35 60 32 Q90 35 90 62 Z" stroke={S} strokeWidth="2" />
    {/* bell base */}
    <rect x="25" y="62" width="70" height="6" rx="3" stroke={S} strokeWidth="2" />
    {/* button */}
    <circle cx="60" cy="32" r="4" stroke={S} strokeWidth="1.5" />
    {/* ding lines */}
    <line x1="100" y1="40" x2="108" y2="34" stroke={S} strokeWidth="1.5" strokeLinecap="round" />
    <line x1="102" y1="50" x2="112" y2="48" stroke={S} strokeWidth="1.5" strokeLinecap="round" />
    <line x1="20" y1="40" x2="12" y2="34" stroke={S} strokeWidth="1.5" strokeLinecap="round" />
    {/* counter */}
    <line x1="10" y1="72" x2="110" y2="72" stroke={S} strokeWidth="2" />
    {/* floor */}
    <line x1="6" y1="85" x2="114" y2="85" stroke={S} strokeWidth="1" strokeDasharray="4 3" />
  </svg>
);

export default ServiceIllustration;
