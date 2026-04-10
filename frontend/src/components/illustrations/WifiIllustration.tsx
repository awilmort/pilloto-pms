import React from 'react';

interface Props { width?: number | string; height?: number | string; className?: string; }
const S = '#9CA3AF';

const WifiIllustration: React.FC<Props> = ({ width = 400, height = 300, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width={width} height={height} className={className} fill="none" role="img" aria-label="WiFi">
    {/* wifi arcs */}
    <path d="M28 48 Q60 20 92 48" stroke={S} strokeWidth="2" strokeLinecap="round" />
    <path d="M38 56 Q60 34 82 56" stroke={S} strokeWidth="2" strokeLinecap="round" />
    <path d="M48 64 Q60 48 72 64" stroke={S} strokeWidth="2" strokeLinecap="round" />
    {/* center dot */}
    <circle cx="60" cy="72" r="4" stroke={S} strokeWidth="2" />
    {/* device */}
    <rect x="34" y="80" width="52" height="6" rx="3" stroke={S} strokeWidth="1.5" />
  </svg>
);

export default WifiIllustration;
