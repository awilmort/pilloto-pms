import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Container, Dialog, DialogActions, DialogContent, DialogTitle, Grid, IconButton, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Checkbox, Chip } from '@mui/material';
import NumberField from '../../components/common/NumberField';
import { Edit, Delete, Add } from '@mui/icons-material';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import { eventTypesService } from '../../services/api';
import { EventType } from '../../types';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../utils/currency';

const EventTypesManagement: React.FC = () => {
  const { t } = useTranslation();
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editing, setEditing] = useState<EventType | null>(null);
  const [form, setForm] = useState({
    type: '',
    title: '',
    description: '',
    features: '' as string,
    priceFrom: 0,
    maxGuests: 1,
    maxChildren: 0,
    maxAdults: undefined as number | undefined,
    isActive: true
  });

  const loadEventTypes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await eventTypesService.getEventTypes({ active: undefined });
      const payload = res.data?.data as EventType[] | undefined;
      setEventTypes(payload || []);
    } catch (err: any) {
      setError(err.response?.data?.message || t('admin.eventTypes.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadEventTypes(); }, [loadEventTypes]);

  const openCreate = () => {
    setEditing(null);
    setForm({ type: '', title: '', description: '', features: '', priceFrom: 0, maxGuests: 1, maxChildren: 0, maxAdults: undefined, isActive: true });
    setOpenDialog(true);
  };

  const openEdit = (et: EventType) => {
    setEditing(et);
    setForm({
      type: et.type,
      title: et.title,
      description: et.description || '',
      features: (et.features || []).join(', '),
      priceFrom: et.priceFrom,
      maxGuests: et.maxGuests,
      maxChildren: et.maxChildren ?? 0,
      maxAdults: et.maxAdults,
      isActive: et.isActive
    });
    setOpenDialog(true);
  };

  const submitForm = async () => {
    try {
      const payload = {
        type: form.type.trim().toLowerCase(),
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        features: form.features.split(',').map(f => f.trim()).filter(Boolean),
        priceFrom: Number(form.priceFrom),
        maxGuests: Number(form.maxGuests),
        maxChildren: Number(form.maxChildren),
        maxAdults: form.maxAdults !== undefined && form.maxAdults !== null ? Number(form.maxAdults) : undefined,
        isActive: form.isActive
      };
      if (editing) {
        await eventTypesService.updateEventType(editing._id, payload);
      } else {
        await eventTypesService.createEventType(payload);
      }
      setOpenDialog(false);
      await loadEventTypes();
    } catch (err: any) {
      setError(err.response?.data?.message || t('admin.eventTypes.messages.saveFailed'));
    }
  };

  const deleteEventType = async (id: string) => {
    if (!window.confirm(t('admin.eventTypes.dialog.deletePrompt'))) return;
    try {
      await eventTypesService.deleteEventType(id);
      await loadEventTypes();
    } catch (err: any) {
      setError(err.response?.data?.message || t('admin.eventTypes.messages.deleteFailed'));
    }
  };

  return (
    <AdminLayout>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <SectionTitle
          title={t('admin.eventTypes.title')}
          right={<Button variant="contained" startIcon={<Add />} onClick={openCreate}>{t('admin.eventTypes.actions.newEventType')}</Button>}
        />
        {error && (
          <Paper sx={{ p: 2, mb: 2, color: 'error.main' }}>{error}</Paper>
        )}
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.eventTypes.table.identifier')}</TableCell>
                <TableCell>{t('admin.eventTypes.table.title')}</TableCell>
                <TableCell>{t('admin.eventTypes.table.priceFrom')}</TableCell>
                <TableCell>{t('admin.eventTypes.table.maxGuests')}</TableCell>
                <TableCell>{t('admin.eventTypes.table.features')}</TableCell>
                <TableCell>{t('admin.eventTypes.table.active')}</TableCell>
                <TableCell align="right">{t('admin.eventTypes.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {eventTypes.map((et) => (
                <TableRow key={et._id} hover>
                  <TableCell>{et.type}</TableCell>
                  <TableCell>{et.title}</TableCell>
                  <TableCell>{formatMoney(et.priceFrom)}</TableCell>
                  <TableCell>{et.maxGuests}</TableCell>
                  <TableCell>
                    {(et.features || []).slice(0, 3).map((f, i) => (
                      <Chip key={i} label={f} size="small" sx={{ mr: 0.5 }} />
                    ))}
                  </TableCell>
                  <TableCell>
                    <Checkbox checked={et.isActive} disabled />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton onClick={() => openEdit(et)}><Edit /></IconButton>
                    <IconButton color="error" onClick={() => deleteEventType(et._id)}><Delete /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {eventTypes.length === 0 && !loading && (
                <TableRow><TableCell colSpan={7} align="center">{t('admin.eventTypes.empty')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="md">
          <DialogTitle>{editing ? t('admin.eventTypes.dialog.editTitle') : t('admin.eventTypes.dialog.createTitle')}</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} md={6}>
                <TextField label={t('admin.eventTypes.form.identifier')} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} fullWidth required />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField label={t('admin.eventTypes.form.title')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} fullWidth required />
              </Grid>
              <Grid item xs={12}>
                <TextField label={t('admin.eventTypes.form.description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth multiline rows={3} />
              </Grid>
              <Grid item xs={12}>
                <TextField label={t('admin.eventTypes.form.features')} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} fullWidth />
              </Grid>
              <Grid item xs={12} md={6}>
                <NumberField label={t('admin.eventTypes.form.priceFrom')} value={form.priceFrom} onChange={(val) => setForm({ ...form, priceFrom: val ?? 0 })} min={0} fullWidth required />
              </Grid>
              <Grid item xs={12} md={6}>
                <NumberField label={t('admin.eventTypes.form.maxGuests')} value={form.maxGuests} onChange={(val) => setForm({ ...form, maxGuests: val ?? 1 })} min={1} fullWidth required />
              </Grid>
              <Grid item xs={12} md={6}>
                <NumberField label={t('admin.eventTypes.form.maxChildren')} value={form.maxChildren} onChange={(val) => setForm({ ...form, maxChildren: val ?? 0 })} min={0} fullWidth />
              </Grid>
              <Grid item xs={12} md={6}>
                <NumberField
                  label={t('admin.eventTypes.form.maxAdults')}
                  value={form.maxAdults ?? null}
                  onChange={(val) => setForm({ ...form, maxAdults: val === null ? undefined : val })}
                  min={1}
                  fullWidth
                  helperText={t('admin.eventTypes.form.maxAdultsHelper')}
                />
              </Grid>
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Checkbox checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                  <Typography>{t('admin.eventTypes.form.active')}</Typography>
                </Box>
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenDialog(false)}>{t('admin.eventTypes.actions.cancel')}</Button>
            <Button variant="contained" onClick={submitForm}>{editing ? t('admin.eventTypes.actions.save') : t('admin.eventTypes.actions.create')}</Button>
          </DialogActions>
        </Dialog>
      </Container>
    </AdminLayout>
  );
};

export default EventTypesManagement;
