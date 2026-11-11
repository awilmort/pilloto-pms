import React from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import { ArrowDownwardRounded, ArrowUpwardRounded, EventOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import type { DashboardDeadline, DashboardEcfHealth, DashboardFinancial, DashboardRecentPayment } from '../../../types';
import { deadlineTone } from './dashboardLogic';
import { formatAccountingMoney } from '../../../utils/currency';

const Card: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <Paper variant="outlined" sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
    <Box>
      <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
      {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
    </Box>
    {children}
  </Paper>
);

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center', flexGrow: 1 }}>{text}</Typography>
);

const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleDateString(i18n.language, opts);

export const TopExpensesCard: React.FC<{ expenses: DashboardFinancial['topExpenses'] }> = ({ expenses }) => {
  const { t } = useTranslation();
  const max = Math.max(...expenses.map((e) => e.amount), 1);
  return (
    <Card title={t('accounting.dashboard.topExpenses.title')} subtitle={t('accounting.dashboard.topExpenses.subtitle')}>
      {expenses.length === 0 ? <Empty text={t('accounting.dashboard.topExpenses.empty')} /> : (
        <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {expenses.map((e) => (
            <Box component="li" key={e.code}>
              <Stack direction="row" justifyContent="space-between" spacing={2}>
                <Typography variant="body2" noWrap>{e.name}</Typography>
                <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatAccountingMoney(e.amount)}</Typography>
              </Stack>
              <Box sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: 'divider' }} role="presentation">
                <Box sx={{ height: '100%', width: `${Math.max((e.amount / max) * 100, 2)}%`, borderRadius: 3, bgcolor: 'secondary.light' }} />
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </Card>
  );
};

export const RecentPaymentsCard: React.FC<{ payments: DashboardRecentPayment[] }> = ({ payments }) => {
  const { t } = useTranslation();
  return (
    <Card title={t('accounting.dashboard.recent.title')}>
      {payments.length === 0 ? <Empty text={t('accounting.dashboard.recent.empty')} /> : (
        <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {payments.map((p, i) => {
            const incoming = p.kind === 'in';
            return (
              <Stack component="li" key={`${p.docNumber}-${i}`} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
                <Box sx={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: incoming ? 'rgba(22,163,74,0.12)' : 'rgba(217,138,11,0.12)', color: incoming ? 'success.dark' : 'warning.dark' }}>
                  {incoming ? <ArrowDownwardRounded sx={{ fontSize: 16 }} /> : <ArrowUpwardRounded sx={{ fontSize: 16 }} />}
                </Box>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>{p.party}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {t(incoming ? 'accounting.dashboard.recent.in' : 'accounting.dashboard.recent.out')} · {p.docNumber} · {fmtDate(p.date, { day: 'numeric', month: 'short' })}
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', color: incoming ? 'success.dark' : 'text.primary' }}>
                  {incoming ? '+' : '−'}{formatAccountingMoney(p.amount)}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Card>
  );
};

const TONE_COLOR = { error: 'error.main', warning: 'warning.dark', neutral: 'text.secondary' } as const;

export const ComplianceCard: React.FC<{ deadlines: DashboardDeadline[]; ecf?: DashboardEcfHealth }> = ({ deadlines, ecf }) => {
  const { t } = useTranslation();
  const sorted = [...deadlines].sort((a, b) => a.daysLeft - b.daysLeft);
  return (
    <Card title={t('accounting.dashboard.compliance.title')}>
      <Stack component="ul" spacing={1.25} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {sorted.map((d) => {
          const tone = deadlineTone(d.daysLeft);
          return (
            <Stack component="li" key={d.key} direction="row" alignItems="center" spacing={1.5}>
              <EventOutlined fontSize="small" sx={{ color: TONE_COLOR[tone] }} />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="body2" fontWeight={600}>{t(`accounting.dashboard.compliance.${d.key}`)}</Typography>
                <Typography variant="caption" color="text.secondary">{t('accounting.dashboard.compliance.dueOn', { date: fmtDate(d.date, { day: 'numeric', month: 'long' }) })}</Typography>
              </Box>
              <Typography variant="body2" fontWeight={700} color={TONE_COLOR[tone]} sx={{ flexShrink: 0 }}>
                {d.daysLeft === 0 ? t('accounting.dashboard.compliance.today') : t('accounting.dashboard.compliance.inDays', { count: d.daysLeft })}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
      <Typography variant="caption" color="text.secondary">{t('accounting.dashboard.compliance.note')}</Typography>

      {ecf && (
        <Box sx={{ mt: 0.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.8 }}>
            {t('accounting.dashboard.compliance.ecfTitle', { days: ecf.windowDays })}
          </Typography>
          {ecf.total === 0 ? (
            <Typography variant="body2" color="text.secondary">{t('accounting.dashboard.compliance.ecfNone')}</Typography>
          ) : (
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip size="small" color="success" variant="outlined" label={`${t('accounting.dashboard.compliance.accepted')}: ${ecf.accepted}`} />
              {ecf.inProcess > 0 && <Chip size="small" color="info" variant="outlined" label={`${t('accounting.dashboard.compliance.inProcess')}: ${ecf.inProcess}`} />}
              {ecf.contingency > 0 && <Chip size="small" color="warning" variant="outlined" label={`${t('accounting.dashboard.compliance.contingency')}: ${ecf.contingency}`} />}
              {ecf.rejected > 0 && <Chip size="small" color="error" label={`${t('accounting.dashboard.compliance.rejected')}: ${ecf.rejected}`} />}
            </Stack>
          )}
        </Box>
      )}
    </Card>
  );
};
