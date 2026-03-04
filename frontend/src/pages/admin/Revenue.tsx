import React, { useEffect, useMemo, useState } from 'react';
import { Container, Typography, Grid, Card, CardContent, Box, Paper, TextField, Button, TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Chip, Accordion, AccordionSummary, AccordionDetails, Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { AttachMoney, Group, Payments, ExpandMore } from '@mui/icons-material';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../utils/currency';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminService, settingsService } from '../../services/api';
import { AppSettings } from '../../services/api';

type ReservationEntry = {
  id: string;
  guest: string;
  adults: number;
  children: number;
  adultPrice: number;
  childrenPrice: number;
  totalPrice: number;
};

type RevenueData = {
  filters: { from: string; to: string };
  categories: Record<'room' | 'daypass' | 'event' | 'pasatarde', { adults: number; children: number; guests: number; revenue: number }>;
  income: { total: number; cash: number; transfer: number; card: number };
  pending: Array<{ id: string; paymentId: string; reservationCode: string; type: 'room' | 'daypass' | 'PasaTarde' | 'event'; guest: string; company?: { _id: string; name?: string; email?: string } | null; endedOn: string; balanceDue: number; totalPrice: number; totalPayments: number }>;
  reservations?: Record<'room' | 'daypass' | 'event' | 'pasatarde', ReservationEntry[]>;
};

type CreditPaymentMethod = 'cash' | 'card' | 'transfer' | 'check';

const CombinedStatCard = ({ title, adults, children, revenue, color }: { title: string; adults: number; children: number; revenue: number; color: string }) => (
  <Card sx={{ height: '100%' }}>
    <CardContent>
      <Typography variant="subtitle1" color="text.secondary" gutterBottom>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Group sx={{ color }} />
          <Typography variant="h6">{adults.toLocaleString()}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Group sx={{ color: 'warning.main' }} />
          <Typography variant="h6">{children.toLocaleString()}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AttachMoney sx={{ color: 'success.main' }} />
          <Typography variant="h6">{formatMoney(revenue)}</Typography>
        </Box>
      </Box>
    </CardContent>
  </Card>
);

const StatCard = ({ title, guests, revenue, color }: { title: string; guests: number; revenue: number; color: string }) => (
  <Card sx={{ height: '100%' }}>
    <CardContent>
      <Typography variant="subtitle1" color="text.secondary" gutterBottom>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Group sx={{ color }} />
          <Typography variant="h6">{guests.toLocaleString()}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AttachMoney sx={{ color: 'success.main' }} />
          <Typography variant="h6">{formatMoney(revenue)}</Typography>
        </Box>
      </Box>
    </CardContent>
  </Card>
);

const IncomeCard = ({ title, amount, highlight }: { title: string; amount: number; highlight?: boolean }) => (
  <Card sx={{ height: '100%', border: highlight ? '2px solid #38A169' : undefined }}>
    <CardContent>
      <Typography variant="subtitle1" color="text.secondary" gutterBottom>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Payments color={highlight ? 'success' : 'primary'} />
        <Typography variant="h4">{formatMoney(amount)}</Typography>
      </Box>
    </CardContent>
  </Card>
);

const ReservationBreakdownSection = ({ title, rows }: { title: string; rows: ReservationEntry[] }) => {
  const { t } = useTranslation();
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Typography variant="h5">{title} ({rows.length})</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.revenue.breakdown.guest')}</TableCell>
                <TableCell align="center">{t('admin.revenue.breakdown.adults')}</TableCell>
                <TableCell align="right">{t('admin.revenue.breakdown.adultPrice')}</TableCell>
                <TableCell align="center">{t('admin.revenue.breakdown.children')}</TableCell>
                <TableCell align="right">{t('admin.revenue.breakdown.childPrice')}</TableCell>
                <TableCell align="right">{t('admin.revenue.breakdown.total')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary">{t('admin.revenue.breakdown.noRecords')}</Typography>
                  </TableCell>
                </TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.guest}</TableCell>
                  <TableCell align="center">{r.adults}</TableCell>
                  <TableCell align="right">{r.adultPrice > 0 ? formatMoney(r.adultPrice) : '—'}</TableCell>
                  <TableCell align="center">{r.children}</TableCell>
                  <TableCell align="right">{r.childrenPrice > 0 ? formatMoney(r.childrenPrice) : '—'}</TableCell>
                  <TableCell align="right">{formatMoney(r.totalPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </AccordionDetails>
    </Accordion>
  );
};

const Revenue: React.FC = () => {
  const { t } = useTranslation();
  const [from, setFrom] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [to, setTo] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [data, setData] = useState<RevenueData | null>(null);
  const [services, setServices] = useState<AppSettings['services']>({ daypass: true, accommodation: true, pasatarde: true, event: true });
  const [processOpen, setProcessOpen] = useState(false);
  const [selectedAr, setSelectedAr] = useState<RevenueData['pending'][number] | null>(null);
  const [creditPaymentMethod, setCreditPaymentMethod] = useState<CreditPaymentMethod>('cash');
  const [processing, setProcessing] = useState(false);
  const today = useMemo(() => dayjs().format('YYYY-MM-DD'), []);

  const loadData = async () => {
    try {
      const res = await adminService.getRevenue({ from, to });
      if (res.data.success) {
        setData(res.data.data);
      }
    } catch (e) {
      console.error('Revenue fetch error:', e);
    }
  };

  useEffect(() => {
    loadData();
    settingsService.getSettings()
      .then(res => { if (res.data.data?.services) setServices(res.data.data.services); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    // Prevent future dates
    const fromClamped = dayjs(from).isAfter(today) ? today : from;
    const toClamped = dayjs(to).isAfter(today) ? today : to;
    setFrom(fromClamped);
    setTo(toClamped);
    setTimeout(loadData, 0);
  };

  const cat = data?.categories;
  const income = data?.income;

  const openProcessModal = (item: RevenueData['pending'][number]) => {
    setSelectedAr(item);
    setCreditPaymentMethod('cash');
    setProcessOpen(true);
  };

  const processPayment = async () => {
    if (!selectedAr?.paymentId) return;
    try {
      setProcessing(true);
      await adminService.processAccountReceivablePayment(selectedAr.paymentId, { creditPaymentMethod });
      setProcessOpen(false);
      setSelectedAr(null);
      loadData();
    } catch (e) {
      console.error('Process account receivable payment error:', e);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <AdminLayout>
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom>
          {t('admin.revenue.title')}
        </Typography>

        {/* Filters */}
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              label={t('admin.revenue.filters.from')}
              type="date"
              value={from}
              inputProps={{ max: today }}
              onChange={(e) => setFrom(e.target.value)}
            />
            <TextField
              label={t('admin.revenue.filters.to')}
              type="date"
              value={to}
              inputProps={{ max: today }}
              onChange={(e) => setTo(e.target.value)}
            />
            <Button variant="contained" onClick={applyFilters}>
              {t('admin.revenue.filters.apply')}
            </Button>
          </Box>
        </Paper>

        {/* Category cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {services.daypass && (
            <Grid item xs={12} sm={6} md={3}>
              <CombinedStatCard title={t('admin.revenue.cards.daypass')} adults={cat?.daypass.adults || 0} children={cat?.daypass.children || 0} revenue={cat?.daypass.revenue || 0} color={'primary.main'} />
            </Grid>
          )}
          {services.accommodation && (
            <Grid item xs={12} sm={6} md={3}>
              <CombinedStatCard title={t('admin.revenue.cards.room')} adults={cat?.room.adults || 0} children={cat?.room.children || 0} revenue={cat?.room.revenue || 0} color={'info.main'} />
            </Grid>
          )}
          {services.event && (
            <Grid item xs={12} sm={6} md={3}>
              <StatCard title={t('admin.revenue.cards.events')} guests={cat?.event.guests || 0} revenue={cat?.event.revenue || 0} color={'success.main'} />
            </Grid>
          )}
          {services.pasatarde && (
            <Grid item xs={12} sm={6} md={3}>
              <StatCard title={t('admin.revenue.cards.pasatarde')} guests={cat?.pasatarde.guests || 0} revenue={cat?.pasatarde.revenue || 0} color={'error.main'} />
            </Grid>
          )}
        </Grid>

        {/* Income summary */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={3}>
            <IncomeCard title={t('admin.revenue.summary.totalIncomeCash')} amount={income?.cash || 0} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <IncomeCard title={t('admin.revenue.summary.totalIncomeTransfers')} amount={income?.transfer || 0} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <IncomeCard title={t('admin.revenue.summary.totalIncomeCard')} amount={income?.card || 0} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <IncomeCard title={t('admin.revenue.summary.totalIncome')} amount={income?.total || 0} highlight />
          </Grid>
        </Grid>

        {/* Account Receivable */}
        <Accordion sx={{ mb: 2 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="h5">{t('admin.revenue.accountReceivable.title', 'Account Receivable')} ({data?.pending?.length ?? 0})</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('reservations.code', 'Reservation')}</TableCell>
                    <TableCell>{t('admin.revenue.pending.table.guest')}</TableCell>
                    <TableCell>{t('admin.revenue.pending.table.type')}</TableCell>
                    <TableCell>{t('admin.revenue.pending.table.endedOn')}</TableCell>
                    <TableCell>{t('admin.revenue.pending.table.balanceDue')}</TableCell>
                    <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data?.pending?.map((r) => (
                    <TableRow key={r.paymentId}>
                      <TableCell>{r.reservationCode}</TableCell>
                      <TableCell>{r.guest}</TableCell>
                      <TableCell>
                        <Chip label={t(`admin.revenue.typeLabels.${r.type === 'PasaTarde' ? 'pasatarde' : r.type}`)} size="small" />
                      </TableCell>
                      <TableCell>{r.endedOn ? dayjs(r.endedOn).format('YYYY-MM-DD') : '-'}</TableCell>
                      <TableCell>{formatMoney(r.balanceDue || 0)}</TableCell>
                      <TableCell align="right">
                        <Button size="small" variant="contained" onClick={() => openProcessModal(r)}>
                          {t('admin.revenue.accountReceivable.processPayment', 'Process Payment')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </AccordionDetails>
        </Accordion>

        <Dialog open={processOpen} onClose={() => setProcessOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{t('admin.revenue.accountReceivable.processPayment', 'Process Payment')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              <TextField
                label={t('admin.revenue.accountReceivable.reservationNumber', 'Reservation Number')}
                value={selectedAr?.reservationCode || ''}
                InputProps={{ readOnly: true }}
                fullWidth
              />
              <TextField
                label={t('admin.revenue.accountReceivable.guestCompany', 'Guest + Company')}
                value={selectedAr ? `${selectedAr.guest}${selectedAr.company?.name ? ` / ${selectedAr.company.name}` : ''}` : ''}
                InputProps={{ readOnly: true }}
                fullWidth
              />
              <TextField
                label={t('admin.revenue.accountReceivable.balance', 'Balance')}
                value={selectedAr ? formatMoney(selectedAr.balanceDue || 0) : ''}
                InputProps={{ readOnly: true }}
                fullWidth
              />
              <FormControl fullWidth>
                <InputLabel>{t('admin.revenue.accountReceivable.creditPaymentMethod', 'Credit Payment Method')}</InputLabel>
                <Select
                  label={t('admin.revenue.accountReceivable.creditPaymentMethod', 'Credit Payment Method')}
                  value={creditPaymentMethod}
                  onChange={(e) => setCreditPaymentMethod(e.target.value as CreditPaymentMethod)}
                >
                  <MenuItem value="cash">Cash</MenuItem>
                  <MenuItem value="card">Card</MenuItem>
                  <MenuItem value="transfer">Transfer</MenuItem>
                  <MenuItem value="check">Check</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label={t('admin.revenue.accountReceivable.creditPaymentDate', 'Credit Payment Date')}
                value={dayjs().format('YYYY-MM-DD')}
                InputProps={{ readOnly: true }}
                fullWidth
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setProcessOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button variant="contained" onClick={processPayment} disabled={processing || !selectedAr}>
              {t('common.confirm', 'Confirm')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Per-category reservation breakdowns */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {services.daypass && (
            <ReservationBreakdownSection
              title={t('admin.revenue.cards.daypass')}
              rows={data?.reservations?.daypass ?? []}
            />
          )}
          {services.accommodation && (
            <ReservationBreakdownSection
              title={t('admin.revenue.cards.room')}
              rows={data?.reservations?.room ?? []}
            />
          )}
          {services.event && (
            <ReservationBreakdownSection
              title={t('admin.revenue.cards.events')}
              rows={data?.reservations?.event ?? []}
            />
          )}
          {services.pasatarde && (
            <ReservationBreakdownSection
              title={t('admin.revenue.cards.pasatarde')}
              rows={data?.reservations?.pasatarde ?? []}
            />
          )}
        </Box>
      </Container>
    </AdminLayout>
  );
};

export default Revenue;