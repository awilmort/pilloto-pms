import React from 'react';
import { Box, ButtonBase, Paper, Stack, Typography } from '@mui/material';
import { CheckCircleOutline, ChevronRight, ErrorOutline, InfoOutlined, WarningAmberOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { AttentionItem, AttentionLink, AttentionTone } from './dashboardLogic';
import { formatAccountingMoney } from '../../../utils/currency';

const TONE: Record<AttentionTone, { icon: React.ReactElement; color: string; bg: string }> = {
  error: { icon: <ErrorOutline fontSize="small" />, color: 'error.main', bg: 'rgba(217, 45, 32, 0.07)' },
  warning: { icon: <WarningAmberOutlined fontSize="small" />, color: 'warning.dark', bg: 'rgba(217, 138, 11, 0.09)' },
  info: { icon: <InfoOutlined fontSize="small" />, color: 'info.dark', bg: 'rgba(61, 123, 245, 0.07)' },
};

interface Props {
  items: AttentionItem[];
  onNavigate: (link: AttentionLink) => void;
}

/** "Needs attention": one scannable row per open problem, worst first; a calm confirmation when there are none. */
const AttentionBar: React.FC<Props> = ({ items, onNavigate }) => {
  const { t } = useTranslation();

  if (items.length === 0) {
    return (
      <Paper variant="outlined" sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.25 }} role="status">
        <CheckCircleOutline fontSize="small" sx={{ color: 'success.main' }} />
        <Typography variant="body2" color="text.secondary">{t('accounting.dashboard.attention.allClear')}</Typography>
      </Paper>
    );
  }

  const text = (item: AttentionItem): string => {
    if (item.key === 'deadline' && item.count === 0) return t('accounting.dashboard.attention.deadlineToday');
    return t(`accounting.dashboard.attention.${item.key}`, { count: item.count, amount: formatAccountingMoney(item.amount) });
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} component="section" aria-label={t('accounting.dashboard.attention.title')}>
      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', px: 0.5, lineHeight: 1.8 }}>
        {t('accounting.dashboard.attention.title')} · {items.length}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, mt: 0.5, display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
        {items.map((item) => {
          const tone = TONE[item.tone];
          const content = (
            <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: 1.5, py: 1, width: '100%', textAlign: 'left' }}>
              <Box sx={{ display: 'flex', color: tone.color }}>{tone.icon}</Box>
              <Typography variant="body2" fontWeight={600} sx={{ flexGrow: 1 }}>{text(item)}</Typography>
              {item.link && <ChevronRight fontSize="small" sx={{ color: 'text.secondary' }} />}
            </Stack>
          );
          return (
            <Box component="li" key={item.key} sx={{ bgcolor: tone.bg, borderRadius: 1.5, borderLeft: 3, borderColor: tone.color, display: 'flex' }}>
              {item.link ? (
                <ButtonBase onClick={() => onNavigate(item.link!)} sx={{ width: '100%', display: 'block', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(18, 26, 51, 0.04)' } }}>{content}</ButtonBase>
              ) : content}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
};

export default AttentionBar;
