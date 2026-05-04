import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, TextField, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Alert, Tooltip, FormControlLabel, Switch, InputAdornment, Grid, Container,
} from '@mui/material';
import {
  Add, Edit, Delete, Search, ArrowBack, Email, Phone,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { companiesService } from '../../services/api';
import { Company, Reservation } from '../../types';
import AdminLayout from '../../components/admin/AdminLayout';

const emptyForm: Partial<Company> = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  notes: '',
  isActive: true,
};

const CompaniesManagement: React.FC = () => {
  const { t } = useTranslation();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined);

  // Detail view
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [companyReservations, setCompanyReservations] = useState<Reservation[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create / Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Company>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { limit: 100 };
      if (search) params.search = search;
      if (activeFilter !== undefined) params.active = activeFilter;
      const res = await companiesService.getCompanies(params);
      setCompanies(res.data.data || []);
      setTotal((res.data as any).total || 0);
    } catch {
      setError(t('common.errorLoading', 'Error loading companies'));
    } finally {
      setLoading(false);
    }
  }, [search, activeFilter, t]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (c: Company, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(c._id);
    setForm({ name: c.name, contactName: c.contactName, email: c.email, phone: c.phone, address: c.address, notes: c.notes, isActive: c.isActive });
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) { setFormError(t('companies.nameRequired', 'Company name is required')); return; }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await companiesService.updateCompany(editingId, form);
      } else {
        await companiesService.createCompany(form);
      }
      setDialogOpen(false);
      fetchCompanies();
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
      await companiesService.deleteCompany(deleteId);
      setDeleteId(null);
      fetchCompanies();
    } catch {
      setError(t('common.errorDeleting', 'Error deleting'));
    } finally {
      setDeleting(false);
    }
  };

  const openDetail = async (c: Company) => {
    setSelectedCompany(c);
    setDetailLoading(true);
    try {
      const res = await companiesService.getCompany(c._id);
      const d = res.data.data as any;
      setSelectedCompany(d.company);
      setCompanyReservations(d.reservations || []);
    } catch {
      setCompanyReservations([]);
    } finally {
      setDetailLoading(false);
    }
  };

  if (selectedCompany) {
    return (
      <AdminLayout title={selectedCompany.name}>
      <Container maxWidth="xl" sx={{ pt: 0, pb: 4 }}>
        <Button startIcon={<ArrowBack />} onClick={() => setSelectedCompany(null)} sx={{ mb: 2 }}>
          {t('common.back', 'Back')}
        </Button>
        <Paper sx={{ p: 3, mb: 3 }}>
          <Grid container spacing={2}>
            {selectedCompany.contactName && (
              <Grid item xs={12} sm={6}><Typography variant="caption" color="text.secondary">{t('companies.contactName', 'Contact Name')}</Typography><Typography>{selectedCompany.contactName}</Typography></Grid>
            )}
            {selectedCompany.email && (
              <Grid item xs={12} sm={6}><Typography variant="caption" color="text.secondary">{t('common.email', 'Email')}</Typography><Typography><Email fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />{selectedCompany.email}</Typography></Grid>
            )}
            {selectedCompany.phone && (
              <Grid item xs={12} sm={6}><Typography variant="caption" color="text.secondary">{t('common.phone', 'Phone')}</Typography><Typography><Phone fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />{selectedCompany.phone}</Typography></Grid>
            )}
            {selectedCompany.address && (
              <Grid item xs={12}><Typography variant="caption" color="text.secondary">{t('companies.address', 'Address')}</Typography><Typography>{selectedCompany.address}</Typography></Grid>
            )}
            {selectedCompany.notes && (
              <Grid item xs={12}><Typography variant="caption" color="text.secondary">{t('common.notes', 'Notes')}</Typography><Typography>{selectedCompany.notes}</Typography></Grid>
            )}
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">{t('common.status', 'Status')}</Typography>
              <Box><Chip size="small" label={selectedCompany.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')} color={selectedCompany.isActive ? 'success' : 'default'} /></Box>
            </Grid>
          </Grid>
        </Paper>

        <Typography variant="h6" sx={{ mb: 2 }}>{t('companies.reservationHistory', 'Reservation History')}</Typography>
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
                {companyReservations.length === 0 ? (
                  <TableRow><TableCell colSpan={5} align="center">{t('common.noData', 'No reservations found')}</TableCell></TableRow>
                ) : companyReservations.map(r => (
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
      </Container>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title={t('admin.nav.companies', 'Companies')}>
    <Container maxWidth="xl" sx={{ pt: 0, pb: 4 }}>

      {/* Filter card */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder={t('common.search', 'Search...')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: 220 }}
          />
          <Button
            size="small"
            variant={activeFilter === undefined ? 'contained' : 'outlined'}
            onClick={() => setActiveFilter(undefined)}
          >{t('common.all', 'All')}</Button>
          <Button
            size="small"
            variant={activeFilter === true ? 'contained' : 'outlined'}
            color="success"
            onClick={() => setActiveFilter(true)}
          >{t('common.active', 'Active')}</Button>
          <Button
            size="small"
            variant={activeFilter === false ? 'contained' : 'outlined'}
            color="inherit"
            onClick={() => setActiveFilter(false)}
          >{t('common.inactive', 'Inactive')}</Button>
          <Box sx={{ ml: 'auto' }}>
            <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
              {t('companies.addCompany', 'Add Company')}
            </Button>
          </Box>
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('companies.name', 'Name')}</TableCell>
              <TableCell>{t('companies.contactName', 'Contact')}</TableCell>
              <TableCell>{t('common.email', 'Email')}</TableCell>
              <TableCell>{t('common.phone', 'Phone')}</TableCell>
              <TableCell>{t('common.status', 'Status')}</TableCell>
              <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={24} /></TableCell></TableRow>
            ) : companies.length === 0 ? (
              <TableRow><TableCell colSpan={6} align="center">{t('common.noData', 'No companies found')}</TableCell></TableRow>
            ) : companies.map(c => (
              <TableRow
                key={c._id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => openDetail(c)}
              >
                <TableCell><Typography fontWeight={600}>{c.name}</Typography></TableCell>
                <TableCell>{c.contactName || '—'}</TableCell>
                <TableCell>{c.email || '—'}</TableCell>
                <TableCell>{c.phone || '—'}</TableCell>
                <TableCell>
                  <Chip size="small" label={c.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')} color={c.isActive ? 'success' : 'default'} />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={t('common.edit', 'Edit')}>
                    <IconButton size="small" onClick={e => openEdit(c, e)}><Edit fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title={t('common.delete', 'Delete')}>
                    <IconButton size="small" color="error" onClick={e => { e.stopPropagation(); setDeleteId(c._id); }}><Delete fontSize="small" /></IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        {total} {t('companies.total', 'companies')}
      </Typography>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? t('companies.editCompany', 'Edit Company') : t('companies.addCompany', 'Add Company')}</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                label={t('companies.name', 'Name')}
                value={form.name || ''}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('companies.contactName', 'Contact Name')}
                value={form.contactName || ''}
                onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('common.email', 'Email')}
                value={form.email || ''}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                fullWidth
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
            <Grid item xs={12}>
              <TextField
                label={t('companies.address', 'Address')}
                value={form.address || ''}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                fullWidth
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
            <Grid item xs={12}>
              <FormControlLabel
                control={<Switch checked={!!form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />}
                label={t('common.active', 'Active')}
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
          <Typography>{t('companies.deleteConfirm', 'Are you sure you want to delete this company?')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={18} /> : t('common.delete', 'Delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
    </AdminLayout>
  );
};

export default CompaniesManagement;
