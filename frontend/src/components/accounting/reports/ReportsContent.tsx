import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Tabs, Tab, TextField, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, CircularProgress, Alert, Chip,
  FormControl, InputLabel, Select, MenuItem, Divider,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  accountingReportsService, accountsService, suppliersService, accountingCustomersService,
} from '../../../services/api';
import {
  Account, Supplier, Customer, AgingBucketKey,
  TrialBalanceReport, ProfitAndLossReport, BalanceSheetReport,
  ApAgingReport, ArAgingReport, GeneralLedgerReport,
  SupplierStatementReport, CustomerStatementReport,
} from '../../../types';
import { formatMoney } from '../../../utils/currency';

const todayStr = () => new Date().toISOString().slice(0, 10);
const yearStartStr = () => `${new Date().getFullYear()}-01-01`;
const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : '—');

const AGING_BUCKETS: AgingBucketKey[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];

type ReportTab = 'trialBalance' | 'profitAndLoss' | 'balanceSheet' | 'apAging' | 'arAging' | 'generalLedger' | 'supplierStatement' | 'customerStatement';

/**
 * `/accounting/reports` — every report from PILLOTO_ACCOUNTING_ARCHITECTURE.md §5.6,
 * computed live on each request (Phase 9.2). Report *variants* live as tabs within one
 * page rather than eight separate top-level sidebar entries — decision #9's own carve-out
 * for tabbed sub-views that aren't independently linkable top-level modules (same
 * reasoning as Settings' Roles/Users tabs). AP/AR aging rows link out to the underlying
 * Bill/Invoice list, filtered to that supplier/customer, per the plan's explicit wording.
 */
const ReportsContent: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ReportTab>('trialBalance');

  return (
    <Box>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', mb: 3 }}>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
          <Tab value="trialBalance" label={t('accounting.reports.tabs.trialBalance', 'Trial Balance')} />
          <Tab value="profitAndLoss" label={t('accounting.reports.tabs.profitAndLoss', 'Profit & Loss')} />
          <Tab value="balanceSheet" label={t('accounting.reports.tabs.balanceSheet', 'Balance Sheet')} />
          <Tab value="apAging" label={t('accounting.reports.tabs.apAging', 'AP Aging')} />
          <Tab value="arAging" label={t('accounting.reports.tabs.arAging', 'AR Aging')} />
          <Tab value="generalLedger" label={t('accounting.reports.tabs.generalLedger', 'General Ledger')} />
          <Tab value="supplierStatement" label={t('accounting.reports.tabs.supplierStatement', 'Supplier Statement')} />
          <Tab value="customerStatement" label={t('accounting.reports.tabs.customerStatement', 'Customer Statement')} />
        </Tabs>
      </Paper>

      {tab === 'trialBalance' && <TrialBalanceTab />}
      {tab === 'profitAndLoss' && <ProfitAndLossTab />}
      {tab === 'balanceSheet' && <BalanceSheetTab />}
      {tab === 'apAging' && <ApAgingTab navigate={navigate} />}
      {tab === 'arAging' && <ArAgingTab navigate={navigate} />}
      {tab === 'generalLedger' && <GeneralLedgerTab />}
      {tab === 'supplierStatement' && <SupplierStatementTab />}
      {tab === 'customerStatement' && <CustomerStatementTab />}
    </Box>
  );
};

// ── shared bits ────────────────────────────────────────────────────────

const ReportPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>{children}</Paper>
);

const FilterBar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 3 }}>{children}</Box>
);

const BalancedChip: React.FC<{ balanced: boolean }> = ({ balanced }) => {
  const { t } = useTranslation();
  return (
    <Chip
      size="small"
      color={balanced ? 'success' : 'error'}
      label={balanced ? t('accounting.reports.balanced', 'Balanced') : t('accounting.reports.unbalanced', 'Not balanced')}
    />
  );
};

// ── Trial Balance ─────────────────────────────────────────────────────

const TrialBalanceTab: React.FC = () => {
  const { t } = useTranslation();
  const [asOf, setAsOf] = useState(todayStr());
  const [data, setData] = useState<TrialBalanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await accountingReportsService.getTrialBalance({ asOf });
      setData(res.data.data as TrialBalanceReport);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.reports.messages.loadFailed'));
    } finally { setLoading(false); }
  }, [asOf, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <ReportPanel>
      <FilterBar>
        <TextField size="small" type="date" label={t('accounting.reports.filters.asOf', 'As of')} InputLabelProps={{ shrink: true }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        {data && <BalancedChip balanced={data.balanced} />}
      </FilterBar>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box> : data && (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.reports.table.account', 'Account')}</TableCell>
                <TableCell align="right">{t('accounting.reports.table.debit', 'Debit')}</TableCell>
                <TableCell align="right">{t('accounting.reports.table.credit', 'Credit')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.length === 0 ? (
                <TableRow><TableCell colSpan={3} align="center">{t('accounting.reports.empty', 'No data for this period')}</TableCell></TableRow>
              ) : data.rows.map((r) => (
                <TableRow key={r.account._id} hover>
                  <TableCell>{r.account.code} — {r.account.name}</TableCell>
                  <TableCell align="right">{r.debit > 0 ? formatMoney(r.debit) : ''}</TableCell>
                  <TableCell align="right">{r.credit > 0 ? formatMoney(r.credit) : ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableBody>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' }}>{t('accounting.reports.table.total', 'Total')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' }}>{formatMoney(data.totalDebit)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' }}>{formatMoney(data.totalCredit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </ReportPanel>
  );
};

// ── Profit & Loss ─────────────────────────────────────────────────────

const ProfitAndLossTab: React.FC = () => {
  const { t } = useTranslation();
  const [from, setFrom] = useState(yearStartStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<ProfitAndLossReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await accountingReportsService.getProfitAndLoss({ from, to });
      setData(res.data.data as ProfitAndLossReport);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.reports.messages.loadFailed'));
    } finally { setLoading(false); }
  }, [from, to, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <ReportPanel>
      <FilterBar>
        <TextField size="small" type="date" label={t('accounting.reports.filters.from', 'From')} InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField size="small" type="date" label={t('accounting.reports.filters.to', 'To')} InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
      </FilterBar>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box> : data && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('accounting.reports.pnl.revenue', 'Revenue')}</Typography>
          <LineTable rows={data.revenue.map((l) => ({ label: `${l.account.code} — ${l.account.name}`, amount: l.amount }))} total={data.totalRevenue} totalLabel={t('accounting.reports.pnl.totalRevenue', 'Total Revenue')} />
          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>{t('accounting.reports.pnl.expenses', 'Expenses')}</Typography>
          <LineTable rows={data.expenses.map((l) => ({ label: `${l.account.code} — ${l.account.name}`, amount: l.amount }))} total={data.totalExpenses} totalLabel={t('accounting.reports.pnl.totalExpenses', 'Total Expenses')} />
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="h6">{t('accounting.reports.pnl.netIncome', 'Net Income')}</Typography>
            <Typography variant="h6" color={data.netIncome >= 0 ? 'success.main' : 'error.main'}>{formatMoney(data.netIncome)}</Typography>
          </Box>
        </Box>
      )}
    </ReportPanel>
  );
};

const LineTable: React.FC<{ rows: { label: string; amount: number }[]; total: number; totalLabel: string }> = ({ rows, total, totalLabel }) => {
  const { t } = useTranslation();
  return (
    <TableContainer>
      <Table size="small">
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={2} align="center">{t('accounting.reports.empty', 'No data for this period')}</TableCell></TableRow>
          ) : rows.map((r) => (
            <TableRow key={r.label} hover>
              <TableCell>{r.label}</TableCell>
              <TableCell align="right">{formatMoney(r.amount)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell sx={{ fontWeight: 700, borderTop: '1px solid', borderColor: 'divider' }}>{totalLabel}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, borderTop: '1px solid', borderColor: 'divider' }}>{formatMoney(total)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
};

// ── Balance Sheet ─────────────────────────────────────────────────────

const BalanceSheetTab: React.FC = () => {
  const { t } = useTranslation();
  const [asOf, setAsOf] = useState(todayStr());
  const [data, setData] = useState<BalanceSheetReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await accountingReportsService.getBalanceSheet({ asOf });
      setData(res.data.data as BalanceSheetReport);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.reports.messages.loadFailed'));
    } finally { setLoading(false); }
  }, [asOf, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <ReportPanel>
      <FilterBar>
        <TextField size="small" type="date" label={t('accounting.reports.filters.asOf', 'As of')} InputLabelProps={{ shrink: true }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        {data && <BalancedChip balanced={data.balanced} />}
      </FilterBar>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box> : data && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('accounting.reports.bs.assets', 'Assets')}</Typography>
          <LineTable rows={data.assets.map((l) => ({ label: `${l.account.code} — ${l.account.name}`, amount: l.balance }))} total={data.totalAssets} totalLabel={t('accounting.reports.bs.totalAssets', 'Total Assets')} />

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>{t('accounting.reports.bs.liabilities', 'Liabilities')}</Typography>
          <LineTable rows={data.liabilities.map((l) => ({ label: `${l.account.code} — ${l.account.name}`, amount: l.balance }))} total={data.totalLiabilities} totalLabel={t('accounting.reports.bs.totalLiabilities', 'Total Liabilities')} />

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>{t('accounting.reports.bs.equity', 'Equity')}</Typography>
          <LineTable
            rows={[
              ...data.equity.map((l) => ({ label: `${l.account.code} — ${l.account.name}`, amount: l.balance })),
              { label: t('accounting.reports.bs.netIncomeToDate', 'Net Income (current)'), amount: data.netIncomeToDate },
            ]}
            total={data.totalEquity}
            totalLabel={t('accounting.reports.bs.totalEquity', 'Total Equity')}
          />

          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="h6">{t('accounting.reports.bs.totalLiabilitiesAndEquity', 'Total Liabilities + Equity')}</Typography>
            <Typography variant="h6">{formatMoney(data.totalLiabilitiesAndEquity)}</Typography>
          </Box>
        </Box>
      )}
    </ReportPanel>
  );
};

// ── AP / AR Aging ─────────────────────────────────────────────────────

const AgingTable: React.FC<{
  rows: { key: string; label: string; buckets: Record<AgingBucketKey, number>; total: number }[];
  grandTotal: Record<AgingBucketKey, number>;
  grandTotalSum: number;
  partyHeader: string;
  onRowClick: (key: string) => void;
}> = ({ rows, grandTotal, grandTotalSum, partyHeader, onRowClick }) => {
  const { t } = useTranslation();
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{partyHeader}</TableCell>
            {AGING_BUCKETS.map((b) => <TableCell key={b} align="right">{t(`accounting.reports.aging.buckets.${b}`)}</TableCell>)}
            <TableCell align="right">{t('accounting.reports.table.total', 'Total')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={AGING_BUCKETS.length + 2} align="center">{t('accounting.reports.empty', 'No data for this period')}</TableCell></TableRow>
          ) : rows.map((r) => (
            <TableRow key={r.key} hover sx={{ cursor: 'pointer' }} onClick={() => onRowClick(r.key)}>
              <TableCell><Typography component="span" fontWeight={600}>{r.label}</Typography></TableCell>
              {AGING_BUCKETS.map((b) => <TableCell key={b} align="right">{r.buckets[b] > 0 ? formatMoney(r.buckets[b]) : ''}</TableCell>)}
              <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(r.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableBody>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' }}>{t('accounting.reports.table.total', 'Total')}</TableCell>
            {AGING_BUCKETS.map((b) => <TableCell key={b} align="right" sx={{ fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' }}>{formatMoney(grandTotal[b])}</TableCell>)}
            <TableCell align="right" sx={{ fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' }}>{formatMoney(grandTotalSum)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
};

const ApAgingTab: React.FC<{ navigate: ReturnType<typeof useNavigate> }> = ({ navigate }) => {
  const { t } = useTranslation();
  const [asOf, setAsOf] = useState(todayStr());
  const [data, setData] = useState<ApAgingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await accountingReportsService.getApAging({ asOf });
      setData(res.data.data as ApAgingReport);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.reports.messages.loadFailed'));
    } finally { setLoading(false); }
  }, [asOf, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <ReportPanel>
      <FilterBar>
        <TextField size="small" type="date" label={t('accounting.reports.filters.asOf', 'As of')} InputLabelProps={{ shrink: true }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        <Typography variant="caption" color="text.secondary">{t('accounting.reports.aging.rowHintAp', 'Click a row to view its bills')}</Typography>
      </FilterBar>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box> : data && (
        <AgingTable
          rows={data.rows.map((r) => ({ key: r.supplier._id, label: r.supplier.name, buckets: r.buckets, total: r.total }))}
          grandTotal={data.grandTotal}
          grandTotalSum={data.grandTotalSum}
          partyHeader={t('accounting.reports.aging.supplier', 'Supplier')}
          onRowClick={(supplierId) => navigate('/accounting/bills', { state: { supplierId } })}
        />
      )}
    </ReportPanel>
  );
};

const ArAgingTab: React.FC<{ navigate: ReturnType<typeof useNavigate> }> = ({ navigate }) => {
  const { t } = useTranslation();
  const [asOf, setAsOf] = useState(todayStr());
  const [data, setData] = useState<ArAgingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await accountingReportsService.getArAging({ asOf });
      setData(res.data.data as ArAgingReport);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.reports.messages.loadFailed'));
    } finally { setLoading(false); }
  }, [asOf, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <ReportPanel>
      <FilterBar>
        <TextField size="small" type="date" label={t('accounting.reports.filters.asOf', 'As of')} InputLabelProps={{ shrink: true }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        <Typography variant="caption" color="text.secondary">{t('accounting.reports.aging.rowHintAr', 'Click a row to view its invoices')}</Typography>
      </FilterBar>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box> : data && (
        <AgingTable
          rows={data.rows.map((r) => ({ key: r.customer._id, label: r.customer.name, buckets: r.buckets, total: r.total }))}
          grandTotal={data.grandTotal}
          grandTotalSum={data.grandTotalSum}
          partyHeader={t('accounting.reports.aging.customer', 'Customer')}
          onRowClick={(customerId) => {
            // Individual (non-Company) customers are keyed `individual-<invoiceId>` in
            // the aging report (no stable id to filter by) — those rows just open the
            // unfiltered invoice list rather than a bogus customer filter.
            const realCustomerId = customerId.startsWith('individual-') ? undefined : customerId;
            navigate('/accounting/invoices', { state: { customerId: realCustomerId } });
          }}
        />
      )}
    </ReportPanel>
  );
};

// ── General Ledger ────────────────────────────────────────────────────

const StatementTable: React.FC<{ openingBalance: number; closingBalance: number; transactions: { date: string; label: string; debit: number; credit: number; runningBalance: number }[] }> = ({ openingBalance, closingBalance, transactions }) => {
  const { t } = useTranslation();
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('accounting.reports.table.date', 'Date')}</TableCell>
            <TableCell>{t('accounting.reports.table.reference', 'Reference')}</TableCell>
            <TableCell align="right">{t('accounting.reports.table.debit', 'Debit')}</TableCell>
            <TableCell align="right">{t('accounting.reports.table.credit', 'Credit')}</TableCell>
            <TableCell align="right">{t('accounting.reports.table.balance', 'Balance')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell colSpan={4} sx={{ fontStyle: 'italic' }}>{t('accounting.reports.statement.openingBalance', 'Opening Balance')}</TableCell>
            <TableCell align="right" sx={{ fontStyle: 'italic' }}>{formatMoney(openingBalance)}</TableCell>
          </TableRow>
          {transactions.length === 0 ? (
            <TableRow><TableCell colSpan={5} align="center">{t('accounting.reports.empty', 'No data for this period')}</TableCell></TableRow>
          ) : transactions.map((tr, i) => (
            <TableRow key={i} hover>
              <TableCell>{fmtDate(tr.date)}</TableCell>
              <TableCell>{tr.label}</TableCell>
              <TableCell align="right">{tr.debit > 0 ? formatMoney(tr.debit) : ''}</TableCell>
              <TableCell align="right">{tr.credit > 0 ? formatMoney(tr.credit) : ''}</TableCell>
              <TableCell align="right">{formatMoney(tr.runningBalance)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={4} sx={{ fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' }}>{t('accounting.reports.statement.closingBalance', 'Closing Balance')}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' }}>{formatMoney(closingBalance)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
};

const GeneralLedgerTab: React.FC = () => {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(yearStartStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<GeneralLedgerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    accountsService.getAccounts().then((res) => {
      const list = Array.isArray(res.data.data) ? res.data.data : [];
      setAccounts(list);
      if (list.length > 0) setAccountId((cur) => cur || list[0]._id);
    }).catch(() => setAccounts([]));
  }, []);

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      setLoading(true); setError(null);
      const res = await accountingReportsService.getGeneralLedger({ accountId, from, to });
      setData(res.data.data as GeneralLedgerReport);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.reports.messages.loadFailed'));
    } finally { setLoading(false); }
  }, [accountId, from, to, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <ReportPanel>
      <FilterBar>
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel>{t('accounting.reports.filters.account', 'Account')}</InputLabel>
          <Select value={accountId} label={t('accounting.reports.filters.account', 'Account')} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <MenuItem key={a._id} value={a._id}>{a.code} — {a.name}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField size="small" type="date" label={t('accounting.reports.filters.from', 'From')} InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField size="small" type="date" label={t('accounting.reports.filters.to', 'To')} InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
      </FilterBar>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box> : data && (
        <StatementTable
          openingBalance={data.openingBalance}
          closingBalance={data.closingBalance}
          transactions={data.transactions.map((tr) => ({ date: tr.date, label: `${tr.entryNumber} — ${tr.memo}`, debit: tr.debit, credit: tr.credit, runningBalance: tr.runningBalance }))}
        />
      )}
    </ReportPanel>
  );
};

// ── Supplier / Customer statements ───────────────────────────────────

const SupplierStatementTab: React.FC = () => {
  const { t } = useTranslation();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<SupplierStatementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    suppliersService.getSuppliers({ active: true, limit: 200 }).then((res) => {
      setSuppliers(Array.isArray(res.data.data) ? res.data.data : []);
    }).catch(() => setSuppliers([]));
  }, []);

  const load = useCallback(async () => {
    if (!supplierId) { setData(null); return; }
    try {
      setLoading(true); setError(null);
      const res = await accountingReportsService.getSupplierStatement(supplierId, { from: from || undefined, to });
      setData(res.data.data as SupplierStatementReport);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.reports.messages.loadFailed'));
    } finally { setLoading(false); }
  }, [supplierId, from, to, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <ReportPanel>
      <FilterBar>
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel>{t('accounting.reports.aging.supplier', 'Supplier')}</InputLabel>
          <Select value={supplierId} label={t('accounting.reports.aging.supplier', 'Supplier')} onChange={(e) => setSupplierId(e.target.value)}>
            <MenuItem value=""><em>{t('accounting.reports.filters.selectSupplier', 'Select a supplier')}</em></MenuItem>
            {suppliers.map((s) => <MenuItem key={s._id} value={s._id}>{s.name}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField size="small" type="date" label={t('accounting.reports.filters.from', 'From')} InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField size="small" type="date" label={t('accounting.reports.filters.to', 'To')} InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
      </FilterBar>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box>}
      {!loading && data && (
        <StatementTable
          openingBalance={data.openingBalance}
          closingBalance={data.closingBalance}
          transactions={data.transactions.map((tr) => ({ date: tr.date, label: tr.reference, debit: tr.debit, credit: tr.credit, runningBalance: tr.runningBalance }))}
        />
      )}
      {!loading && !data && <Typography variant="body2" color="text.secondary">{t('accounting.reports.filters.selectSupplier', 'Select a supplier')}</Typography>}
    </ReportPanel>
  );
};

const CustomerStatementTab: React.FC = () => {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<CustomerStatementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    accountingCustomersService.getCustomers({ active: true, limit: 200 }).then((res) => {
      setCustomers(Array.isArray(res.data.data) ? res.data.data : []);
    }).catch(() => setCustomers([]));
  }, []);

  const load = useCallback(async () => {
    if (!customerId) { setData(null); return; }
    try {
      setLoading(true); setError(null);
      const res = await accountingReportsService.getCustomerStatement(customerId, { from: from || undefined, to });
      setData(res.data.data as CustomerStatementReport);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.reports.messages.loadFailed'));
    } finally { setLoading(false); }
  }, [customerId, from, to, t]);

  useEffect(() => { load(); }, [load]);

  const customerLabel = useMemo(() => (c: Customer) => c.razonSocial || c.name, []);

  return (
    <ReportPanel>
      <FilterBar>
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel>{t('accounting.reports.aging.customer', 'Customer')}</InputLabel>
          <Select value={customerId} label={t('accounting.reports.aging.customer', 'Customer')} onChange={(e) => setCustomerId(e.target.value)}>
            <MenuItem value=""><em>{t('accounting.reports.filters.selectCustomer', 'Select a customer')}</em></MenuItem>
            {customers.map((c) => <MenuItem key={c._id} value={c._id}>{customerLabel(c)}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField size="small" type="date" label={t('accounting.reports.filters.from', 'From')} InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField size="small" type="date" label={t('accounting.reports.filters.to', 'To')} InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
      </FilterBar>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box>}
      {!loading && data && (
        <StatementTable
          openingBalance={data.openingBalance}
          closingBalance={data.closingBalance}
          transactions={data.transactions.map((tr) => ({ date: tr.date, label: tr.reference, debit: tr.debit, credit: tr.credit, runningBalance: tr.runningBalance }))}
        />
      )}
      {!loading && !data && <Typography variant="body2" color="text.secondary">{t('accounting.reports.filters.selectCustomer', 'Select a customer')}</Typography>}
    </ReportPanel>
  );
};

export default ReportsContent;
