import React from 'react';
import { Box, ButtonBase, Button, Paper, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AgingBuckets } from '../../../types';
import { AGING_COLORS, agingSegments } from './dashboardLogic';
import { formatAccountingMoney } from '../../../utils/currency';

export interface AgingListRow {
  key: string;
  primary: string;
  secondary: string;
  /** Draws the secondary line in the error colour (it is overdue). */
  late?: boolean;
  amount: number;
  onClick?: () => void;
}

interface Props {
  title: string;
  subtitle: string;
  total: number;
  buckets: AgingBuckets;
  listTitle: string;
  rows: AgingListRow[];
  emptyListText: string;
  emptyAllText: string;
  hasOpenDocuments: boolean;
  actions: { label: string; onClick: () => void }[];
}

/**
 * Receivables / payables at a glance: how much is open, how old it is (one stacked bar + a labelled
 * legend — amounts are always written out), and the few documents that most need action.
 */
const AgingCard: React.FC<Props> = ({ title, subtitle, total, buckets, listTitle, rows, emptyListText, emptyAllText, hasOpenDocuments, actions }) => {
  const { t } = useTranslation();
  const segments = agingSegments(buckets);
  const summary = segments.map((s) => `${t(`accounting.dashboard.aging.${s.key}`)}: ${formatAccountingMoney(s.amount)}`).join(', ');

  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
          <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
        </Box>
        <Typography variant="h5" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatAccountingMoney(total)}</Typography>
      </Stack>

      {hasOpenDocuments ? (
        <>
          <Box>
            <Box role="img" aria-label={summary} sx={{ display: 'flex', gap: '2px', height: 12, borderRadius: 6, overflow: 'hidden', bgcolor: 'divider' }}>
              {segments.filter((s) => s.amount > 0).map((s) => (
                <Box key={s.key} sx={{ flexGrow: s.share, flexBasis: 0, minWidth: 6, bgcolor: AGING_COLORS[s.key] }} />
              ))}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(5, 1fr)' }, gap: 1.5, mt: 1.5 }}>
              {segments.map((s) => (
                <Box key={s.key} sx={{ opacity: s.amount > 0 ? 1 : 0.55 }}>
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: AGING_COLORS[s.key], flexShrink: 0 }} />
                    <Typography variant="caption" color="text.secondary" noWrap>{t(`accounting.dashboard.aging.${s.key}`)}</Typography>
                  </Stack>
                  <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatAccountingMoney(s.amount)}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.8 }}>{listTitle}</Typography>
            {rows.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{emptyListText}</Typography>
            ) : (
              <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {rows.map((r) => {
                  const inner = (
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ py: 1, width: '100%', textAlign: 'left' }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{r.primary}</Typography>
                        <Typography variant="caption" color={r.late ? 'error.main' : 'text.secondary'} noWrap sx={{ display: 'block' }}>{r.secondary}</Typography>
                      </Box>
                      <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatAccountingMoney(r.amount)}</Typography>
                    </Stack>
                  );
                  return (
                    <Box component="li" key={r.key} sx={{ borderTop: 1, borderColor: 'divider' }}>
                      {r.onClick ? <ButtonBase onClick={r.onClick} sx={{ display: 'block', width: '100%', '&:hover': { bgcolor: 'action.hover' } }}>{inner}</ButtonBase> : inner}
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Box>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, py: 3, textAlign: 'center' }}>{emptyAllText}</Typography>
      )}

      <Stack direction="row" spacing={1} className="no-print">
        {actions.map((a) => <Button key={a.label} size="small" onClick={a.onClick}>{a.label}</Button>)}
      </Stack>
    </Paper>
  );
};

export default AgingCard;
