import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, TextField, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Alert, Tooltip, InputAdornment, Grid, Autocomplete,
} from '@mui/material';
import { Edit, Delete, Search, ArrowBack, Email, Phone, Business } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { guestsService, companiesService } from '../../services/api';
import { Guest, Reservation, Company } from '../../types';
import SectionTitle from '../../components/admin/SectionTitle';
import AdminLayout from '../../components/admin/AdminLayout';

const emptyForm: Partial<Guest> = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  notes: '',
};

const GuestsManagement: React.FC = () => {
  const { t } = useTranslation();

  const [guests, setGuests] = useState<Guest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Detail view
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [guestReservations, setGuestReservations] = useState<Reservation[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Guest>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Company autocomplete
  const [companyOptions, setCompanyOptions] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchGuests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { limit: 100 };
      if (search) params.search = search;
      const res = await guestsService.getGuests(params);
      setGuests(res.data.data || []);
      setTotal((res.data as any).total || 0);
    } catch {
      setError(t('common.errorLoading', 'Error loading guests'));
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);

  useEffect(() => {
    if (companySearch.length < 1) { setCompanyOptions([]); return; }
    companiesService.getCompanies({ search: companySearch, limit: 20 })
      .then(res => setCompanyOptions(res.data.data ?? []))
      .catch(() => {});
  }, [companySearch]);

  const openEdit = (g: Guest, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(g._id);
    setForm({ firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone, notes: g.notes, companyId: typeof g.companyId === 'object' && g.companyId ? (g.companyId as Company)._id : (g.companyId as string) || '' });
    if (typeof g.companyId === 'object' && g.companyId) {
      const c = g.companyId as Company;
      setSelectedCompany(c);
      setCompanyOptions([c]);
    } else {
      setSelectedCompany(null);
      setCompanyOptions([]);
    }
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.email?.trim()) { setFormError(t('common.emailRequired', 'Email is required')); return; }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload: any = { ...form, companyId: form.companyId || null };
        await guestsService.updateGuest(editingId, payload);
      }
      setDialogOpen(false);
      fetchGuests();
    } catch (err: any) {
      setFormError(err?.response?.data?.message || t('common.errorSaving', 'Error saving'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await guestsService.deleteGuest(deleteId);
      setDeleteId(null);
      fetchGuests();
    } catch {
      setError(t('common.errorDeleting', 'Error deleting'));
    } finally {
      setDeleting(false);
    }
  };

  const openDetail = async (g: Guest) => {
    setSelectedGuest(g);
    setDetailLoading(true);
    try {
      const res = await guestsService.getGuest(g._id);
      const d = res.data.data as any;
      setSelectedGuest(d.guest);
      setGuestReservations(d.reservations || []);
    } catch {
      setGuestReservations([]);
    } finally {
      setDetailLoading(false);
    }
  };

  if (selectedGuest) {
    return (
      <AdminLayout>
      <Box>
        <Button startIcon={<ArrowBack />} onClick={() => setSelectedGuest(null)} sx={{ mb: 2 }}>
          {t('common.back', 'Back')}
        </Button>
        <SectionTitle title={`${selectedGuest.firstName} ${selectedGuest.lastName}`} />
        <Paper sx={{ p: 3, mb: 3 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">{t('common.email', 'Email')}</Typography>
              <Typography><Email fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />{selectedGuest.email}</Typography>
            </Grid>
            {selectedGuest.phone && (
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">{t('common.phone', 'Phone')}</Typography>
                <Typography><Phone fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />{selectedGuest.phone}</Typography>
              </Grid>
            )}
            {selectedGuest.notes && (
              <Grid item xs={12}>
                <Typography variant="caption" color="text.secondary">{t('common.notes', 'Notes')}</Typography>
                <Typography>{selectedGuest.notes}</Typography>
              </Grid>
            )}
            {selectedGuest.companyId && (
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">{t('guests.company', 'Company')}</Typography>
                <Typography><Business fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />{typeof selectedGuest.companyId === 'object' && selectedGuest.companyId ? (selectedGuest.companyId as Company).name : selectedGuest.companyId}</Typography>
              </Grid>
            )}
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">{t('guests.memberSince', 'Member Since')}</Typography>
              <Typography>{new Date(selectedGuest.createdAt).toLocaleDateString()}</Typography>
            </Grid>
          </Grid>
        </Paper>

        <Typography variant="h6" sx={{ mb: 2 }}>{t('guests.reservationHistory', 'Reservation History')}</Typography>
        {detailLoading ? <CircularProgress size={24} /> : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('reservations.code', 'Code')}</TableCell>
                  <TableCell>{t('reservations.type', 'Type')}</TableCell>
                  <TableCell>{t('reservations.checkIn', 'Check-In')}</TableCell>
                  <TableCell>{t('reservations.status', 'Status')}</TableCell>
                  <TableCell align="right">{t('reservations.total', 'Total')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {guestReservations.length === 0 ? (
                  <TableRow><TableCell colSpan={5} align="center">{t('common.noData', 'No reservations found')}</TableCell></TableRow>
                ) : guestReservations.map(r => (
                  <TableRow key={r._id}>
                    <TableCell>{r.reservationCode || r._id.slice(-6)}</TableCell>
                    <TableCell>{r.type}</TableCell>
                    <TableCell>{new Date(r.checkInDate).toLocaleDateString()}</TableCell>
                    <TableCell><Chip size="small" label={r.status} /></TableCell>
                    <TableCell align="right">${(r.estimatedTotal ?? r.totalPrice ?? 0).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
    <Box>
      <SectionTitle title={t('admin.nav.guests', 'Guests')} />

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder={t('common.search', 'Search...')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
          sx={{ minWidth: 250 }}
        />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('guests.name', 'Name')}</TableCell>
              <TableCell>{t('common.email', 'Email')}</TableCell>
              <TableCell>{t('common.phone', 'Phone')}</TableCell>
              <TableCell>{t('guests.memberSince', 'Since')}</TableCell>
              <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} align="center"><CircularProgress size={24} /></TableCell></TableRow>
            ) : guests.length === 0 ? (
              <TableRow><TableCell colSpan={5} align="center">{t('common.noData', 'No guests found')}</TableCell></TableRow>
            ) : guests.map(g => (
              <TableRow
                key={g._id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => openDetail(g)}
              >
                <TableCell><Typography fontWeight={600}>{g.firstName} {g.lastName}</Typography></TableCell>
                <TableCell>{g.email}</TableCell>
                <TableCell>{g.phone || '—'}</TableCell>
                <TableCell>{new Date(g.createdAt).toLocaleDateString()}</TableCell>
                <TableCell align="right">
                  <Tooltip title={t('common.edit', 'Edit')}>
                    <IconButton size="small" onClick={e => openEdit(g, e)}><Edit fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title={t('common.delete', 'Delete')}>
                    <IconButton size="small" color="error" onClick={e => { e.stopPropagation(); setDeleteId(g._id); }}><Delete fontSize="small" /></IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        {total} {t('guests.total', 'guests')}
      </Typography>

      {/* Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('guests.editGuest', 'Edit Guest')}</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('common.firstName', 'First Name')}
                value={form.firstName || ''}
                onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('common.lastName', 'Last Name')}
                value={form.lastName || ''}
                onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('common.email', 'Email')}
                value={form.email || ''}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('common.phone', 'Phone')}
                value={form.phone || ''}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                options={companyOptions}
                getOptionLabel={(o: Company) => o.name}
                value={selectedCompany}
                onChange={(_, newVal: Company | null) => {
                  setSelectedCompany(newVal);
                  setForm(f => ({ ...f, companyId: newVal?._id || '' }));
                }}
                onInputChange={(_, v) => setCompanySearch(v)}
                isOptionEqualToValue={(o, v) => o._id === v._id}
                renderInput={params => (
                  <TextField {...params} label={t('guests.company', 'Company')} />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label={t('common.notes', 'Notes')}
                value={form.notes || ''}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                fullWidth
                multiline
                rows={3}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={18} /> : t('common.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)} maxWidth="xs">
        <DialogTitle>{t('common.confirmDelete', 'Confirm Delete')}</DialogTitle>
        <DialogContent>
          <Typography>{t('guests.deleteConfirm', 'Are you sure you want to delete this guest record?')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={18} /> : t('common.delete', 'Delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
    </AdminLayout>
  );
};

export default GuestsManagement;
