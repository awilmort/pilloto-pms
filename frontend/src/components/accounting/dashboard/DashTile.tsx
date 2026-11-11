import React from 'react';
import { ButtonBase, Card, Stack, Tooltip, Typography } from '@mui/material';
import { ArrowDownward, ArrowUpward, Remove } from '@mui/icons-material';

export interface DashTileProps {
  label: string;
  value: string;
  /** Change vs the comparison period; `value` null = nothing to compare against. */
  delta?: { value: number | null; label: string };
  /** Whether an increase is good news (false for liabilities / expenses). */
  goodWhenUp?: boolean;
  /** Supporting lines under the value. */
  captions?: { text: string; help?: string; tone?: 'default' | 'error' }[];
  onClick?: () => void;
  /** The value is negative and should read as a loss. */
  negative?: boolean;
}

/**
 * A headline number. The whole tile is a button when it leads somewhere (keyboard + screen reader
 * friendly); change is always shown with an arrow and a sign, never by colour alone.
 */
const DashTile: React.FC<DashTileProps> = ({ label, value, delta, goodWhenUp = true, captions, onClick, negative }) => {
  const d = delta?.value;
  const flat = d == null || Math.abs(d) < 0.05;
  const good = !flat && (d! > 0) === goodWhenUp;
  const deltaColor = flat ? 'text.secondary' : good ? 'success.dark' : 'error.main';
  const DeltaIcon = flat ? Remove : d! > 0 ? ArrowUpward : ArrowDownward;

  const body = (
    <Stack spacing={0.5} sx={{ p: 2, textAlign: 'left', width: '100%', alignItems: 'flex-start' }}>
      <Typography variant="body2" color="text.secondary" fontWeight={600} sx={{ maxWidth: '100%', lineHeight: 1.35 }}>{label}</Typography>
      <Typography variant="h5" fontWeight={700} sx={{ fontSize: { xs: '1.15rem', sm: '1.5rem' }, lineHeight: 1.2, color: negative ? 'error.main' : 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {delta && d != null && (
        <Stack direction="row" alignItems="center" columnGap={0.5} flexWrap="wrap">
          <Stack direction="row" alignItems="center" spacing={0.25}>
            <DeltaIcon sx={{ fontSize: 15, color: deltaColor }} />
            <Typography variant="caption" fontWeight={700} color={deltaColor}>{`${d > 0 ? '+' : ''}${d.toFixed(1)}%`}</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">{delta.label}</Typography>
        </Stack>
      )}
      {captions?.map((c) => {
        const line = (
          <Typography key={c.text} variant="caption" color={c.tone === 'error' ? 'error.main' : 'text.secondary'} fontWeight={c.tone === 'error' ? 600 : 400}
            sx={{ display: 'block', maxWidth: '100%', ...(c.help ? { textDecoration: 'underline dotted', textUnderlineOffset: 3, cursor: 'help' } : {}) }}>
            {c.text}
          </Typography>
        );
        return c.help ? <Tooltip key={c.text} title={c.help} arrow placement="bottom-start">{line}</Tooltip> : line;
      })}
    </Stack>
  );

  return (
    <Card variant="outlined" sx={{ height: '100%', transition: 'border-color .15s, box-shadow .15s', ...(onClick ? { '&:hover': { borderColor: 'primary.main' } } : {}) }}>
      {onClick ? (
        <ButtonBase onClick={onClick} focusRipple sx={{ width: '100%', height: '100%', display: 'block', alignItems: 'stretch', borderRadius: 'inherit' }}>{body}</ButtonBase>
      ) : body}
    </Card>
  );
};

export default DashTile;
