/** Building blocks shared by the marketing pages (home and /contabilidad). */
import React from 'react';
import { Box, List, ListItem, ListItemIcon, ListItemText, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { BRAND, alpha } from '../../brand';

export const asList = (v: unknown): string[] => (Array.isArray(v) ? v : []);

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = BRAND.vermilionText }) => (
  <Typography variant="overline" sx={{ color, display: 'block', mb: 1.5, fontSize: '0.75rem' }}>
    {children}
  </Typography>
);

export const SectionHeader: React.FC<{ eyebrow: string; heading: string; sub?: string; light?: boolean }> = ({ eyebrow, heading, sub, light }) => (
  <Box textAlign="center" mb={{ xs: 6, md: 8 }} sx={{ maxWidth: 720, mx: 'auto' }}>
    <Eyebrow color={light ? BRAND.vermilionOnDark : undefined}>{eyebrow}</Eyebrow>
    <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.75rem' }, color: light ? 'white' : BRAND.ink, mb: sub ? 2 : 0 }}>
      {heading}
    </Typography>
    {sub && (
      <Typography sx={{ color: light ? 'rgba(255,255,255,0.7)' : BRAND.slate, fontSize: '1.0625rem', lineHeight: 1.7 }}>
        {sub}
      </Typography>
    )}
  </Box>
);

export const CheckList: React.FC<{ items: string[]; color: string; dense?: boolean }> = ({ items, color, dense }) => (
  <List disablePadding>
    {items.map(f => (
      <ListItem key={f} disablePadding sx={{ py: dense ? 0.5 : 0.75, alignItems: 'flex-start' }}>
        <ListItemIcon sx={{ minWidth: 28, mt: '3px' }}>
          <CheckIcon sx={{ fontSize: 18, color }} />
        </ListItemIcon>
        <ListItemText primary={f} primaryTypographyProps={{ variant: 'body2', color: BRAND.ink, fontWeight: 500 }} />
      </ListItem>
    ))}
  </List>
);

/** Browser-window frame used by the product illustrations. */
export const WindowFrame: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
  <Box sx={{
    borderRadius: 3, bgcolor: 'white', border: `1px solid ${BRAND.mist}`, overflow: 'hidden',
    boxShadow: `0 1px 2px ${alpha(BRAND.ink, 0.06)}, 0 24px 60px -12px ${alpha(BRAND.ink, 0.22)}`,
  }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 1.25, borderBottom: `1px solid ${BRAND.mist}`, bgcolor: '#FAFBFC' }}>
      {['#FF5F57', '#FEBC2E', '#28C840'].map(c => <Box key={c} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c }} />)}
      {title && <Typography sx={{ ml: 1.5, fontSize: '0.75rem', fontWeight: 600, color: BRAND.slate }}>{title}</Typography>}
    </Box>
    {children}
  </Box>
);


export const FloatingStat: React.FC<{ label: string; value: string; accent: string; sx?: object; icon?: React.ReactNode }> = ({ label, value, accent, sx, icon }) => (
  <Box sx={{
    position: 'absolute', bgcolor: 'white', borderRadius: 2.5, px: 2, py: 1.5, display: { xs: 'none', sm: 'flex' },
    alignItems: 'center', gap: 1.5, border: `1px solid ${BRAND.mist}`,
    boxShadow: `0 12px 32px -8px ${alpha(BRAND.ink, 0.2)}`, ...sx,
  }}>
    <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: alpha(accent, 0.12), color: accent, display: 'grid', placeItems: 'center' }}>
      {icon ?? <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: accent }} />}
    </Box>
    <Box>
      <Typography sx={{ fontSize: '0.6875rem', color: BRAND.slate, fontWeight: 500 }}>{label}</Typography>
      <Typography sx={{ fontSize: '1.0625rem', color: BRAND.ink, fontWeight: 800, lineHeight: 1.2 }}>{value}</Typography>
    </Box>
  </Box>
);
