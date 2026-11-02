import React from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { BRAND, FONT_UI, PRODUCT_COLORS, ProductCode } from '../../brand';

/**
 * Pilloto logo family, drawn from pilloto-brand-kit/svg (wordmark, symbol, app icon).
 *
 * Lockups ("pilloto pms", "pilloto accounting") render the product name as
 * live Inter text matched to the wordmark's x-height, so it follows the UI
 * language (accounting ↔ contable) instead of baking one spelling into paths.
 */

type Tone = 'color' | 'reversed';
export type LogoProduct = ProductCode | 'platform';

// Wordmark geometry — viewBox "0 10.25 239.5 89.75", baseline at y=80, x-height 36→80.
const WM_VIEW_H = 89.75;
const WM_VIEW_W = 239.5;
const WM_BASELINE = (80 - 10.25) / WM_VIEW_H;
const WM_XHEIGHT = 44 / WM_VIEW_H;
const INTER_XHEIGHT_EM = 0.546;

function dotColor(tone: Tone, product?: LogoProduct): string {
  if (product && product !== 'platform') return PRODUCT_COLORS[product];
  return tone === 'reversed' ? BRAND.vermilionOnDark : BRAND.vermilion;
}

interface WordmarkProps {
  height: number;
  tone?: Tone;
  product?: LogoProduct;
}

export const PillotoWordmark: React.FC<WordmarkProps> = ({ height, tone = 'color', product }) => {
  const ink = tone === 'reversed' ? '#FFFFFF' : BRAND.ink;
  return (
    <svg
      width={(height * WM_VIEW_W) / WM_VIEW_H}
      height={height}
      viewBox={`0 10.25 ${WM_VIEW_W} ${WM_VIEW_H}`}
      role="img"
      aria-label="Pilloto"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect x="0" y="36" width="11" height="64" fill={ink} />
      <path fillRule="evenodd" d="M0.0 58A22.8 22.8 0 1 0 45.6 58A22.8 22.8 0 1 0 0.0 58Z M11.4 58A11.4 11.4 0 1 1 34.2 58A11.4 11.4 0 1 1 11.4 58Z" fill={ink} />
      <rect x="51.5" y="36" width="11" height="44" fill={ink} />
      <circle cx="57.0" cy="25.10" r="6.4" fill={dotColor(tone, product)} />
      <path d="M73.5 80V20.15L84.5 16.85V80Z" fill={ink} />
      <path d="M95.5 80V13.55L106.5 10.25V80Z" fill={ink} />
      <path fillRule="evenodd" d="M116.2 58A22.8 22.8 0 1 0 161.8 58A22.8 22.8 0 1 0 116.2 58Z M127.6 58A11.4 11.4 0 1 1 150.4 58A11.4 11.4 0 1 1 127.6 58Z" fill={ink} />
      <rect x="169.5" y="22" width="11" height="58" fill={ink} />
      <rect x="163.5" y="36" width="27" height="9.5" fill={ink} />
      <path fillRule="evenodd" d="M193.7 58A22.8 22.8 0 1 0 239.3 58A22.8 22.8 0 1 0 193.7 58Z M205.1 58A11.4 11.4 0 1 1 227.9 58A11.4 11.4 0 1 1 205.1 58Z" fill={ink} />
    </svg>
  );
};

interface PillotoLogoProps {
  /** Rendered height of the wordmark (top of the "l" to bottom of the "p" descender), px. */
  height?: number;
  tone?: Tone;
  /** Adds the product name and swaps the dot to the product color. */
  product?: LogoProduct;
}

/** Wordmark, or a product lockup when `product` is set. */
const PillotoLogo: React.FC<PillotoLogoProps> = ({ height = 28, tone = 'color', product }) => {
  const { t } = useTranslation();
  const descender = height * (1 - WM_BASELINE);
  if (!product) return <PillotoWordmark height={height} tone={tone} />;

  const label = t(`brand.product.${product}`, { defaultValue: product === 'pms' ? 'pms' : product });
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'baseline', whiteSpace: 'nowrap' }}
      aria-label={`Pilloto ${label}`}
      role="img"
    >
      <PillotoWordmark height={height} tone={tone} product={product} />
      <Box
        component="span"
        aria-hidden
        sx={{
          ml: `${height * 0.26}px`,
          // Baseline alignment lands on the svg's bottom edge; lift the label to the wordmark baseline.
          position: 'relative',
          top: `-${descender}px`,
          fontFamily: FONT_UI,
          fontWeight: 400,
          fontSize: `${(height * WM_XHEIGHT) / INTER_XHEIGHT_EM}px`,
          lineHeight: 1,
          letterSpacing: '-0.01em',
          color: tone === 'reversed' ? '#AEB5C8' : BRAND.slate,
          userSelect: 'none',
        }}
      >
        {label}
      </Box>
    </Box>
  );
};

interface SymbolProps {
  size: number;
  /** 'tile' = the app icon (ink rounded square, white "p"); 'bare' = the "p" alone. */
  variant?: 'tile' | 'bare';
  tone?: Tone;
  product?: LogoProduct;
}

/** The "p" + dot symbol, bare or as the rounded app-icon tile. */
export const PillotoSymbol: React.FC<SymbolProps> = ({ size, variant = 'tile', tone = 'color', product }) => {
  const dot = dotColor(variant === 'tile' ? 'reversed' : tone, product);
  if (variant === 'tile') {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
        <rect width="100" height="100" rx="22.5" fill={BRAND.ink} />
        <g transform="translate(50 50) scale(0.6757) translate(-54.0 -51.0)">
          <rect x="24" y="30" width="13" height="58" fill="#FFFFFF" />
          <circle cx="50" cy="56" r="19.5" fill="none" stroke="#FFFFFF" strokeWidth="13" />
          <circle cx="76" cy="22" r="8" fill={dot} />
        </g>
      </svg>
    );
  }
  const ink = tone === 'reversed' ? '#FFFFFF' : BRAND.ink;
  return (
    <svg width={(size * 60) / 74} height={size} viewBox="24 14 60 74" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <rect x="24" y="30" width="13" height="58" fill={ink} />
      <circle cx="50" cy="56" r="19.5" fill="none" stroke={ink} strokeWidth="13" />
      <circle cx="76" cy="22" r="8" fill={dot} />
    </svg>
  );
};

export default PillotoLogo;
