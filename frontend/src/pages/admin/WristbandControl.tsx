import React, { useState, useEffect } from 'react';
import { Box, Container, Paper, Typography, Grid, TextField, Button, Alert, TableContainer, Table, TableBody, TableCell, TableHead, TableRow, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import NumberField from '../../components/common/NumberField';
import { wristbandsService, settingsService, AppSettings } from '../../services/api';
import { Edit, Delete } from '@mui/icons-material';
import { WristbandDelivery } from '../../types';

const WristbandControl: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [date, setDate] = useState<Date>(new Date());
  const [type, setType] = useState<'delivery' | 'collection'>('delivery');
  const [recipient, setRecipient] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [counts, setCounts] = useState({ daypassAdults: 0, daypassChildren: 0, accommodations: 0, pasatarde: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // List & filters
  const [from, setFrom] = useState<Date>(new Date());
  const [to, setTo] = useState<Date>(new Date());
  const [deliveries, setDeliveries] = useState<WristbandDelivery[]>([]);
  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<WristbandDelivery | null>(null);

  // Check if user has manage permission
  const hasManagePermission = () => {
    const perms = (user as any)?.permissions || [];
    return user?.role === 'admin' || perms.includes('admin.wristbands.manage') || perms.includes('admin.access');
  };

  const loadDeliveries = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        from: format(from, 'yyyy-MM-dd'),
        to: format(to, 'yyyy-MM-dd'),
      };
      const res = await wristbandsService.getDeliveries(params);
      const data = res.data?.data as WristbandDelivery[];
      setDeliveries(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.response?.data?.message || t('admin.wristbands.messages.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadAll = async () => {
      await loadDeliveries();
      try {
        const params = { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
        const usageRes = await wristbandsService.getUsage(params);
        const u = usageRes.data?.data as any;
        if (u) setUsed({
          daypassAdults: Number(u.daypassAdults) || 0,
          daypassChildren: Number(u.daypassChildren) || 0,
          accommodations: Number(u.accommodations) || 0,
          pasatarde: Number(u.pasatarde) || 0,
        });
      } catch (err) {
        console.error('Usage fetch failed', err);
      }
    };
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    setDate(new Date());
    setType('delivery');
    setRecipient('');
    setNotes('');
    setCounts({ daypassAdults: 0, daypassChildren: 0, accommodations: 0, pasatarde: 0 });
    setEditOpen(true);
  };

  const handleEdit = (item: WristbandDelivery) => {
    setEditing(item);
    // preload form fields
    setDate(new Date(item.date));
    setRecipient(item.recipient || '');
    setNotes(item.notes || '');
    setCounts({
      daypassAdults: item.counts.daypassAdults || 0,
      daypassChildren: item.counts.daypassChildren || 0,
      accommodations: item.counts.accommodations || 0,
      pasatarde: item.counts.pasatarde || 0,
    });
    setEditOpen(true);
  };

  const handleUpdate = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (editing) {
        await wristbandsService.updateDelivery(editing._id, {
          date,
          type,
          recipient: recipient || '',
          counts,
          notes: notes || '',
        });
        setSuccess(t('admin.wristbands.messages.updateSuccess'));
      } else {
        await wristbandsService.createDelivery({
          date,
          type,
          recipient: recipient || undefined,
          counts,
          notes: notes || undefined,
        });
        setSuccess(t('admin.wristbands.messages.createSuccess'));
      }
      setEditOpen(false);
      setEditing(null);
      await loadDeliveries();
      try {
        const params = { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
        const usageRes = await wristbandsService.getUsage(params);
        const u = usageRes.data?.data as any;
        if (u) setUsed({
          daypassAdults: Number(u.daypassAdults) || 0,
          daypassChildren: Number(u.daypassChildren) || 0,
          accommodations: Number(u.accommodations) || 0,
          pasatarde: Number(u.pasatarde) || 0,
        });
      } catch (err) {
        console.error('Usage fetch failed', err);
      }
    } catch (err: any) {
      const defaultMsg = editing ? t('admin.wristbands.messages.updateFailed') : t('admin.wristbands.messages.createFailed');
      setError(err?.response?.data?.message || defaultMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('admin.wristbands.messages.confirmDelete'))) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await wristbandsService.deleteDelivery(id);
      setSuccess(t('admin.wristbands.messages.deleteSuccess'));
      await loadDeliveries();
      try {
        const params = { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
        const usageRes = await wristbandsService.getUsage(params);
        const u = usageRes.data?.data as any;
        if (u) setUsed({
          daypassAdults: Number(u.daypassAdults) || 0,
          daypassChildren: Number(u.daypassChildren) || 0,
          accommodations: Number(u.accommodations) || 0,
          pasatarde: Number(u.pasatarde) || 0,
        });
      } catch (err) {
        console.error('Usage fetch failed', err);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('admin.wristbands.messages.deleteFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Summary helpers - deliveries add, collections subtract (filtered by date range)
  const totals = {
    daypassAdults: deliveries.reduce((sum, d) => {
      const deliveryDate = new Date(d.date);
      const fromDate = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
      const toDate = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
      if (deliveryDate >= fromDate && deliveryDate <= toDate) {
        const amount = d.counts?.daypassAdults ?? 0;
        return sum + (d.type === 'collection' ? -amount : amount);
      }
      return sum;
    }, 0),
    daypassChildren: deliveries.reduce((sum, d) => {
      const deliveryDate = new Date(d.date);
      const fromDate = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
      const toDate = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
      if (deliveryDate >= fromDate && deliveryDate <= toDate) {
        const amount = d.counts?.daypassChildren ?? 0;
        return sum + (d.type === 'collection' ? -amount : amount);
      }
      return sum;
    }, 0),
    accommodations: deliveries.reduce((sum, d) => {
      const deliveryDate = new Date(d.date);
      const fromDate = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
      const toDate = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
      if (deliveryDate >= fromDate && deliveryDate <= toDate) {
        const amount = d.counts?.accommodations ?? 0;
        return sum + (d.type === 'collection' ? -amount : amount);
      }
      return sum;
    }, 0),
    pasatarde: deliveries.reduce((sum, d) => {
      const deliveryDate = new Date(d.date);
      const fromDate = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
      const toDate = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
      if (deliveryDate >= fromDate && deliveryDate <= toDate) {
        const amount = d.counts?.pasatarde ?? 0;
        return sum + (d.type === 'collection' ? -amount : amount);
      }
      return sum;
    }, 0),
  };
  const [used, setUsed] = useState({ daypassAdults: 0, daypassChildren: 0, accommodations: 0, pasatarde: 0 });
  const [services, setServices] = useState<AppSettings['services']>({ daypass: true, accommodation: true, pasatarde: true, event: true });

  useEffect(() => {
    settingsService.getSettings()
      .then(res => { if (res.data.data?.services) setServices(res.data.data.services); })
      .catch(() => {});
  }, []);

  const WristbandStatCard = ({ title, available, used, total }: { title: string; available: number; used: number; total: number }) => (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" color="text.secondary" gutterBottom>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('admin.wristbands.summary.available')}</Typography>
          <Typography variant="h6" sx={{ color: available < 0 ? 'error.main' : 'success.main' }}>{available.toLocaleString()}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('admin.wristbands.summary.used')}</Typography>
          <Typography variant="h6" sx={{ color: 'warning.main' }}>{used.toLocaleString()}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('admin.wristbands.summary.total')}</Typography>
          <Typography variant="h6" sx={{ color: 'text.primary' }}>{total.toLocaleString()}</Typography>
        </Box>
      </Box>
    </Paper>
  );

  return (
    <AdminLayout>
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <SectionTitle title={t('admin.wristbands.title')} right={hasManagePermission() ? <Button variant="contained" onClick={openCreate} sx={{ alignSelf: 'flex-start' }}>{t('admin.wristbands.actions.addDelivery')}</Button> : undefined} />

        {/* Alerts */}
        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 3 }}>{success}</Alert>}

        {/* Filters */}
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              label={t('admin.revenue.filters.from')}
              type="date"
              value={format(from, 'yyyy-MM-dd')}
              onChange={(e) => {
                const [y, m, d] = e.target.value.split('-').map(Number);
                setFrom(new Date(y, m - 1, d));
              }}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label={t('admin.revenue.filters.to')}
              type="date"
              value={format(to, 'yyyy-MM-dd')}
              onChange={(e) => {
                const [y, m, d] = e.target.value.split('-').map(Number);
                setTo(new Date(y, m - 1, d));
              }}
              InputLabelProps={{ shrink: true }}
            />
            <Button
              variant="contained"
              onClick={async () => {
                await loadDeliveries();
                try {
                  const params = { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
                  const usageRes = await wristbandsService.getUsage(params);
                  const u = usageRes.data?.data as any;
                  if (u) setUsed({
                    daypassAdults: Number(u.daypassAdults) || 0,
                    daypassChildren: Number(u.daypassChildren) || 0,
                    accommodations: Number(u.accommodations) || 0,
                    pasatarde: Number(u.pasatarde) || 0,
                  });
                } catch (err) {
                  console.error('Usage fetch failed', err);
                }
              }}
              disabled={loading}
            >
              {t('admin.revenue.filters.apply')}
            </Button>
          </Box>
        </Paper>

        {/* Summary cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {services.daypass && (
            <Grid item xs={12} sm={6} md={3}>
              <WristbandStatCard title={t('admin.wristbands.categories.daypassAdults')} available={totals.daypassAdults - used.daypassAdults} used={used.daypassAdults} total={totals.daypassAdults} />
            </Grid>
          )}
          {services.daypass && (
            <Grid item xs={12} sm={6} md={3}>
              <WristbandStatCard title={t('admin.wristbands.categories.daypassChildren')} available={totals.daypassChildren - used.daypassChildren} used={used.daypassChildren} total={totals.daypassChildren} />
            </Grid>
          )}
          {services.accommodation && (
            <Grid item xs={12} sm={6} md={3}>
              <WristbandStatCard title={t('admin.wristbands.categories.accommodations')} available={totals.accommodations - used.accommodations} used={used.accommodations} total={totals.accommodations} />
            </Grid>
          )}
          {services.pasatarde && (
            <Grid item xs={12} sm={6} md={3}>
              <WristbandStatCard title={t('admin.wristbands.categories.pasatarde')} available={totals.pasatarde - used.pasatarde} used={used.pasatarde} total={totals.pasatarde} />
            </Grid>
          )}
        </Grid>

        {/* Table */}
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.wristbands.deliveryDate')}</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>{t('admin.wristbands.recipient')}</TableCell>
                {services.daypass && <TableCell>{t('admin.wristbands.categories.daypassAdults')}</TableCell>}
                {services.daypass && <TableCell>{t('admin.wristbands.categories.daypassChildren')}</TableCell>}
                {services.accommodation && <TableCell>{t('admin.wristbands.categories.accommodations')}</TableCell>}
                {services.pasatarde && <TableCell>{t('admin.wristbands.categories.pasatarde')}</TableCell>}
                <TableCell>{t('admin.wristbands.notes')}</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {deliveries.map((d) => (
                <TableRow key={d._id}>
                  <TableCell>{format(new Date(d.date), 'yyyy-MM-dd')}</TableCell>
                  <TableCell>
                    <Box 
                      sx={{ 
                        display: 'inline-block',
                        px: 1.5, 
                        py: 0.5, 
                        borderRadius: 1, 
                        bgcolor: d.type === 'collection' ? 'error.light' : 'success.light',
                        color: d.type === 'collection' ? 'error.dark' : 'success.dark',
                        fontWeight: 500,
                        fontSize: '0.875rem'
                      }}
                    >
                      {d.type === 'collection' ? '← Collection' : '→ Delivery'}
                    </Box>
                  </TableCell>
                  <TableCell>{d.recipient || '-'}</TableCell>
                  {services.daypass && <TableCell>{d.counts?.daypassAdults ?? 0}</TableCell>}
                  {services.daypass && <TableCell>{d.counts?.daypassChildren ?? 0}</TableCell>}
                  {services.accommodation && <TableCell>{d.counts?.accommodations ?? 0}</TableCell>}
                  {services.pasatarde && <TableCell>{d.counts?.pasatarde ?? 0}</TableCell>}
                  <TableCell>{d.notes || '-'}</TableCell>
                  <TableCell align="right">
                    {hasManagePermission() && (
                      <>
                        <IconButton size="small" onClick={() => handleEdit(d)}><Edit /></IconButton>
                        <IconButton size="small" color="error" onClick={() => handleDelete(d._id)}><Delete /></IconButton>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {deliveries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5 + (services.daypass ? 2 : 0) + (services.accommodation ? 1 : 0) + (services.pasatarde ? 1 : 0)} align="center">
                    <Typography variant="body2" color="text.secondary">No deliveries found</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Add/Edit dialog */}
        <Dialog open={editOpen} onClose={() => setEditOpen(false)} fullWidth maxWidth="md">
          <DialogTitle>{editing ? t('admin.wristbands.title') : t('admin.wristbands.actions.addDelivery')}</DialogTitle>
          <DialogContent>
            <Grid container spacing={3} sx={{ mt: 0 }}>
              <Grid item xs={12} md={4}>
                <TextField
                  label={t('admin.wristbands.deliveryDate')}
                  type="date"
                  value={format(date, 'yyyy-MM-dd')}
                  onChange={(e) => {
                    const [y, m, d] = e.target.value.split('-').map(Number);
                    setDate(new Date(y, m - 1, d));
                  }}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={type}
                    label="Type"
                    onChange={(e) => setType(e.target.value as 'delivery' | 'collection')}
                  >
                    <MenuItem value="delivery">Delivery (Add)</MenuItem>
                    <MenuItem value="collection">Collection (Remove)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label={t('admin.wristbands.recipient')}
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <Paper sx={{ p: 2 }}>
                  <Typography variant="h6" sx={{ mb: 2 }}>{t('admin.wristbands.categoriesTitle')}</Typography>
                  <Grid container spacing={2}>
                    {services.daypass && (
                      <Grid item xs={12} md={3}>
                        <NumberField
                          label={t('admin.wristbands.categories.daypassAdults')}
                          value={counts.daypassAdults}
                          onChange={(val) => setCounts(prev => ({ ...prev, daypassAdults: val || 0 }))}
                          min={0}
                          fullWidth
                        />
                      </Grid>
                    )}
                    {services.daypass && (
                      <Grid item xs={12} md={3}>
                        <NumberField
                          label={t('admin.wristbands.categories.daypassChildren')}
                          value={counts.daypassChildren}
                          onChange={(val) => setCounts(prev => ({ ...prev, daypassChildren: val || 0 }))}
                          min={0}
                          fullWidth
                        />
                      </Grid>
                    )}
                    {services.accommodation && (
                      <Grid item xs={12} md={3}>
                        <NumberField
                          label={t('admin.wristbands.categories.accommodations')}
                          value={counts.accommodations}
                          onChange={(val) => setCounts(prev => ({ ...prev, accommodations: val || 0 }))}
                          min={0}
                          fullWidth
                        />
                      </Grid>
                    )}
                    {services.pasatarde && (
                      <Grid item xs={12} md={3}>
                        <NumberField
                          label={t('admin.wristbands.categories.pasatarde')}
                          value={counts.pasatarde}
                          onChange={(val) => setCounts(prev => ({ ...prev, pasatarde: val || 0 }))}
                          min={0}
                          fullWidth
                        />
                      </Grid>
                    )}
                  </Grid>
                </Paper>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label={t('admin.wristbands.notes')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  fullWidth
                  multiline
                  rows={3}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditOpen(false)}>{t('admin.eventTypes.actions.cancel')}</Button>
            <Button variant="contained" onClick={handleUpdate} disabled={loading}>{editing ? t('admin.eventTypes.actions.save') : t('admin.wristbands.actions.registerDelivery')}</Button>
          </DialogActions>
        </Dialog>
      </Container>
    </AdminLayout>
  );
};

export default WristbandControl;
