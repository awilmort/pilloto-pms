import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, IconButton, MenuItem, Paper, Select, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { AddOutlined, InfoOutlined, Refresh, ReceiptLongOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import i18n from '../../../i18n';
import { accountingDashboardService } from '../../../services/api';
import type { AccountingDashboardData, DashboardPeriod } from '../../../types';
import { usePermission } from '../../../lib/permissions';
import { formatAccountingMoney } from '../../../utils/currency';
import DashTile from './DashTile';
import AttentionBar from './AttentionBar';
import AgingCard, { AgingListRow } from './AgingCard';
import { CashFlowChart, IncomeExpensesChart } from './TrendCharts';
import { ComplianceCard, RecentPaymentsCard, TopExpensesCard } from './SideCards';
import { AttentionLink, attentionItems, hasAnyBlock, isLedgerEmpty, pctChange } from './dashboardLogic';

const PERIODS: DashboardPeriod[] = ['month', 'lastMonth', 'quarter', 'year'];
const SECTION_GAP = 2.5;

const fmtShort = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

const DashboardSkeleton: React.FC = () => (
  <Stack spacing={SECTION_GAP} aria-busy="true">
    <Skeleton variant="rounded" height={56} />
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', xl: 'repeat(6, 1fr)' } }}>
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} variant="rounded" height={112} />)}
    </Box>
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' } }}>
      <Skeleton variant="rounded" height={330} />
      <Skeleton variant="rounded" height={330} />
    </Box>
  </Stack>
);

/**
 * The Accounting landing page. Reading order follows what an owner / accountant asks first:
 * what needs me now → where do I stand (cash, owed to me, I owe, results) → how is it trending →
 * who is late → recent movement and DGII obligations. Every block is permission-gated by the
 * server, so a role sees only the modules it can open.
 */
const AccountingDashboardContent: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canCreateInvoice = usePermission('accounting.invoices.manage');
  const canCreateBill = usePermission('accounting.bills.manage');

  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [data, setData] = useState<AccountingDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (p: DashboardPeriod, isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(false);
    try {
      const res = await accountingDashboardService.get(p);
      setData(res.data.data!);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(period, data !== null); }, [period]);

  const go = (path: string, state?: Record<string, unknown>) => navigate(path, state ? { state } : undefined);
  const goLink = (l: AttentionLink) => go(l.path, l.state);

  const attention = useMemo(() => (data ? attentionItems(data) : []), [data]);

  if (loading && !data) return <DashboardSkeleton />;
  if (error && !data) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => load(period)}>{t('accounting.dashboard.retry')}</Button>}>
        {t('accounting.dashboard.loadError')}
      </Alert>
    );
  }
  if (!data) return null;

  const { financial: f, receivables: ar, payables: ap, ecf } = data;
  const money = formatAccountingMoney;

  const toolbar = (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        {f && (
          <>
            <ToggleButtonGroup size="small" exclusive value={period} aria-label={t('accounting.dashboard.period.label')}
              onChange={(_e, v) => v && setPeriod(v)} sx={{ display: { xs: 'none', sm: 'inline-flex' }, bgcolor: 'background.paper' }}>
              {PERIODS.map((p) => <ToggleButton key={p} value={p} sx={{ px: 1.75, textTransform: 'none', fontWeight: 600 }}>{t(`accounting.dashboard.period.${p}`)}</ToggleButton>)}
            </ToggleButtonGroup>
            <Select size="small" value={period} onChange={(e) => setPeriod(e.target.value as DashboardPeriod)} inputProps={{ 'aria-label': t('accounting.dashboard.period.label') }}
              sx={{ display: { xs: 'inline-flex', sm: 'none' }, bgcolor: 'background.paper', minWidth: 170 }}>
              {PERIODS.map((p) => <MenuItem key={p} value={p}>{t(`accounting.dashboard.period.${p}`)}</MenuItem>)}
            </Select>
            <Typography variant="body2" color="text.secondary">{fmtShort(data.period.from)} – {fmtShort(data.period.to)}</Typography>
            <Tooltip title={t('accounting.dashboard.period.help')} arrow>
              <InfoOutlined fontSize="small" sx={{ color: 'text.secondary', cursor: 'help' }} aria-label={t('accounting.dashboard.period.help')} />
            </Tooltip>
          </>
        )}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="caption" color="text.secondary">
          {t('accounting.dashboard.updated', { time: new Date(data.asOf).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' }) })}
        </Typography>
        <Tooltip title={t('accounting.dashboard.refresh')}>
          <span>
            <IconButton size="small" onClick={() => load(period, true)} disabled={refreshing} aria-label={t('accounting.dashboard.refresh')}><Refresh fontSize="small" /></IconButton>
          </span>
        </Tooltip>
        {canCreateBill && (
          <Button variant="outlined" startIcon={<AddOutlined />} onClick={() => go('/accounting/bills', { create: true })}>{t('accounting.dashboard.actions.newBill')}</Button>
        )}
        {canCreateInvoice && (
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => go('/accounting/invoices/new')}>{t('accounting.dashboard.actions.newInvoice')}</Button>
        )}
      </Stack>
    </Stack>
  );

  if (!hasAnyBlock(data)) {
    return (
      <Stack spacing={SECTION_GAP}>
        {toolbar}
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">{t('accounting.dashboard.noBlocks')}</Typography>
        </Paper>
        <Box sx={{ maxWidth: 520 }}><ComplianceCard deadlines={data.deadlines} ecf={ecf} /></Box>
      </Stack>
    );
  }

  const prevLabel = t('accounting.dashboard.vsPrevious');
  const kpis: React.ReactNode[] = [];
  if (f) {
    kpis.push(
      <DashTile key="cash" label={t('accounting.dashboard.kpi.cash')} value={money(f.cash.total)} negative={f.cash.total < 0}
        captions={f.cash.accounts.map((a) => ({ text: `${a.name}: ${money(a.balance)}` }))} />,
    );
  }
  if (ar) {
    kpis.push(
      <DashTile key="ar" label={t('accounting.dashboard.kpi.receivables')} value={money(ar.total)} onClick={() => go('/accounting/reports', { tab: 'arAging' })}
        captions={ar.openCount === 0
          ? [{ text: t('accounting.dashboard.kpi.receivablesNone') }]
          : [
            { text: t('accounting.dashboard.kpi.receivablesOverdue', { amount: money(ar.overdue) }), tone: ar.overdue > 0 ? 'error' : 'default' },
            ...(ar.dsoDays != null ? [{ text: t('accounting.dashboard.kpi.dso', { days: ar.dsoDays }), help: t('accounting.dashboard.kpi.dsoHelp') }] : []),
          ]} />,
    );
  }
  if (ap) {
    kpis.push(
      <DashTile key="ap" label={t('accounting.dashboard.kpi.payables')} value={money(ap.total)} onClick={() => go('/accounting/reports', { tab: 'apAging' })}
        captions={ap.openCount === 0
          ? [{ text: t('accounting.dashboard.kpi.payablesNone') }]
          : [
            { text: t('accounting.dashboard.kpi.payablesOverdue', { amount: money(ap.overdue) }), tone: ap.overdue > 0 ? 'error' : 'default' },
            { text: t('accounting.dashboard.kpi.payablesDueSoon', { amount: money(ap.dueSoon) }) },
          ]} />,
    );
  }
  if (f) {
    const margin = f.current.revenue > 0 ? Math.round((f.current.netIncome / f.current.revenue) * 100) : null;
    kpis.push(
      <DashTile key="revenue" label={t('accounting.dashboard.kpi.revenue')} value={money(f.current.revenue)}
        delta={{ value: pctChange(f.current.revenue, f.previous.revenue), label: prevLabel }} onClick={() => go('/accounting/reports', { tab: 'profitAndLoss' })} />,
      <DashTile key="net" label={t('accounting.dashboard.kpi.netIncome')} value={money(f.current.netIncome)} negative={f.current.netIncome < 0}
        delta={{ value: pctChange(f.current.netIncome, f.previous.netIncome), label: prevLabel }}
        captions={margin != null ? [{ text: t('accounting.dashboard.kpi.margin', { pct: margin }) }] : undefined}
        onClick={() => go('/accounting/reports', { tab: 'profitAndLoss' })} />,
      <DashTile key="itbis" label={t('accounting.dashboard.kpi.itbis')} value={money(f.itbis.net)} negative={f.itbis.net < 0}
        captions={[{ text: t('accounting.dashboard.kpi.itbisCaption', { sales: money(f.itbis.sales), purchases: money(f.itbis.purchases) }), help: t('accounting.dashboard.kpi.itbisHelp') }]} />,
    );
  }

  const arRows: AgingListRow[] = (ar?.invoices ?? []).map((i) => ({
    key: i._id,
    primary: i.customerName,
    secondary: `${i.invoiceNumber} · ${t('accounting.dashboard.ar.daysLate', { count: i.daysOverdue })}`,
    late: true,
    amount: i.balanceDue,
    onClick: () => go(`/accounting/invoices/${i._id}`),
  }));
  const apRows: AgingListRow[] = (ap?.bills ?? []).map((b) => ({
    key: b._id,
    primary: b.supplierName,
    secondary: `${b.billNumber} · ${b.daysOverdue > 0
      ? t('accounting.dashboard.ap.daysLate', { count: b.daysOverdue })
      : b.daysOverdue === 0 ? t('accounting.dashboard.ap.dueToday') : t('accounting.dashboard.ap.dueIn', { count: -b.daysOverdue })}`,
    late: b.daysOverdue > 0,
    amount: b.balanceDue,
    onClick: b.supplierId ? () => go('/accounting/bills', { supplierId: b.supplierId }) : undefined,
  }));

  const empty = isLedgerEmpty(data);
  const showSidePanels = !empty;

  return (
    <Stack spacing={SECTION_GAP}>
      {toolbar}
      {error && <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => load(period, true)}>{t('accounting.dashboard.retry')}</Button>}>{t('accounting.dashboard.loadError')}</Alert>}

      <AttentionBar items={attention} onNavigate={goLink} />

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', xl: `repeat(${Math.min(kpis.length, 6)}, minmax(0, 1fr))` }, opacity: refreshing ? 0.6 : 1, transition: 'opacity .15s' }}>
        {kpis.map((k, i) => <Box key={i}>{k}</Box>)}
      </Box>

      {empty ? (
        <Paper variant="outlined" sx={{ p: { xs: 3, md: 5 }, textAlign: 'center' }}>
          <ReceiptLongOutlined sx={{ fontSize: 44, color: 'primary.main', mb: 1 }} />
          <Typography variant="h6" fontWeight={700} gutterBottom>{t('accounting.dashboard.welcomeTitle')}</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 520, mx: 'auto', mb: canCreateInvoice || canCreateBill ? 3 : 0 }}>{t('accounting.dashboard.welcomeBody')}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="center">
            {canCreateInvoice && <Button variant="contained" startIcon={<AddOutlined />} onClick={() => go('/accounting/invoices/new')}>{t('accounting.dashboard.actions.newInvoice')}</Button>}
            {canCreateBill && <Button variant="outlined" startIcon={<AddOutlined />} onClick={() => go('/accounting/bills', { create: true })}>{t('accounting.dashboard.actions.newBill')}</Button>}
          </Stack>
        </Paper>
      ) : (
        <>
          {f && (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' } }}>
              <IncomeExpensesChart trend={f.trend} />
              <CashFlowChart trend={f.trend} />
            </Box>
          )}
          {(ar || ap) && (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' } }}>
              {ar && (
                <AgingCard title={t('accounting.dashboard.ar.title')} subtitle={t('accounting.dashboard.ar.open', { count: ar.openCount })}
                  total={ar.total} buckets={ar.buckets} listTitle={t('accounting.dashboard.ar.listTitle')} rows={arRows}
                  emptyListText={t('accounting.dashboard.ar.emptyList')} emptyAllText={t('accounting.dashboard.ar.emptyAll')} hasOpenDocuments={ar.openCount > 0}
                  actions={[{ label: t('accounting.dashboard.ar.seeReport'), onClick: () => go('/accounting/reports', { tab: 'arAging' }) }, { label: t('accounting.dashboard.ar.seeInvoices'), onClick: () => go('/accounting/invoices') }]} />
              )}
              {ap && (
                <AgingCard title={t('accounting.dashboard.ap.title')} subtitle={t('accounting.dashboard.ap.open', { count: ap.openCount })}
                  total={ap.total} buckets={ap.buckets} listTitle={t('accounting.dashboard.ap.listTitle')} rows={apRows}
                  emptyListText={t('accounting.dashboard.ap.emptyList')} emptyAllText={t('accounting.dashboard.ap.emptyAll')} hasOpenDocuments={ap.openCount > 0}
                  actions={[{ label: t('accounting.dashboard.ap.seeReport'), onClick: () => go('/accounting/reports', { tab: 'apAging' }) }, { label: t('accounting.dashboard.ap.seeBills'), onClick: () => go('/accounting/bills') }]} />
              )}
            </Box>
          )}
        </>
      )}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' } }}>
        {showSidePanels && f && <TopExpensesCard expenses={f.topExpenses} />}
        {showSidePanels && data.recentPayments && <RecentPaymentsCard payments={data.recentPayments} />}
        <ComplianceCard deadlines={data.deadlines} ecf={ecf} />
      </Box>
    </Stack>
  );
};

export default AccountingDashboardContent;
