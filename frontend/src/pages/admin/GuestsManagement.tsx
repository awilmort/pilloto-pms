import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, TextField, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Alert, Tooltip, InputAdornment, Grid, Autocomplete, Container,
  Switch, FormControlLabel, Divider, List, ListItem, ListItemText,
  ListItemSecondaryAction, MenuItem,
} from '@mui/material';
import { Edit, Delete, Search, ArrowBack, Email, Phone, Business, Add, LinkOff } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { guestsService, companiesService } from '../../services/api';
import { Guest, GuestCompanyLink, Reservation, Company } from '../../types';
import AdminLayout from '../../components/admin/AdminLayout';

interface PendingCompanyLink {
  companyId: string;
  companyName: string;
  autoApproveCorporateRate: boolean;
}

const emptyForm: { firstName: string; lastName: string; email: string; phone: string; notes: string; fiscalInfo: { tipoId: string; rnc: string; cedula: string; razonSocial: string } } = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  notes: '',
  fiscalInfo: { tipoId: '', rnc: '', cedula: '', razonSocial: '' },
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

  // Add / Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Company links within Add/Edit dialog
  const [dialogCompanyLinks, setDialogCompanyLinks] = useState<PendingCompanyLink[]>([]);

  // Link Company sub-dialog
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkCompany, setLinkCompany] = useState<Company | null>(null);
  const [linkAutoApprove, setLinkAutoApprove] = useState(false);
  const [linkCompanyOptions, setLinkCompanyOptions] = useState<Company[]>([]);
  const [linkCompanySearch, setLinkCompanySearch] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  // Company autocomplete for list view filter (shared search)
  const [companyOptions, setCompanyOptions] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState('');

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

  useEffect(() => {
    if (linkCompanySearch.length < 1) { setLinkCompanyOptions([]); return; }
    companiesService.getCompanies({ search: linkCompanySearch, limit: 20 })
      .then(res => setLinkCompanyOptions(res.data.data ?? []))
      .catch(() => {});
  }, [linkCompanySearch]);

  // ── Dialog open helpers ─────────────────────────────────────

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogCompanyLinks([]);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (g: Guest) => {
    setEditingId(g._id);
    setForm({ firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone || '', notes: g.notes || '',
      fiscalInfo: {
        tipoId: g.fiscalInfo?.tipoId || '',
        rnc: g.fiscalInfo?.rnc || '',
        cedula: g.fiscalInfo?.cedula || '',
        razonSocial: g.fiscalInfo?.razonSocial || '',
      },
    });
    // Load existing company links into pending state
    const links: PendingCompanyLink[] = (g.companyLinks || []).map((l: GuestCompanyLink) => {
      const co = typeof l.companyId === 'object' ? (l.companyId as Company) : null;
      return {
        companyId: co ? co._id : String(l.companyId),
        companyName: co ? co.name : String(l.companyId),
        autoApproveCorporateRate: !!l.autoApproveCorporateRate,
      };
    });
    setDialogCompanyLinks(links);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.email?.trim()) { setFormError(t('common.emailRequired', 'Email is required')); return; }
    if (!form.firstName?.trim()) { setFormError(t('common.firstNameRequired', 'First name is required')); return; }
    if (!form.lastName?.trim()) { setFormError(t('common.lastNameRequired', 'Last name is required')); return; }
    setSaving(true);
    setFormError(null);
    try {
      const companyLinksPayload = dialogCompanyLinks.map(l => ({
        companyId: l.companyId,
        autoApproveCorporateRate: l.autoApproveCorporateRate,
      }));
      // Build fiscalInfo — only include if tipoId selected
      const fiscalInfo = form.fiscalInfo.tipoId
        ? {
            tipoId: (form.fiscalInfo.tipoId || undefined) as 'RNC' | 'Cedula' | 'Pasaporte' | 'Otro' | undefined,
            rnc: form.fiscalInfo.rnc || undefined,
            cedula: form.fiscalInfo.cedula || undefined,
            razonSocial: form.fiscalInfo.razonSocial || undefined,
          }
        : undefined;
      const guestPayload = { ...form, companyLinks: companyLinksPayload, fiscalInfo };
      if (editingId) {
        await guestsService.updateGuest(editingId, guestPayload);
      } else {
        await guestsService.createGuest(guestPayload);
      }
      setDialogOpen(false);
      fetchGuests();
    } catch (err: any) {
      setFormError(err?.response?.data?.message || t('common.errorSaving', 'Error saving'));
    } finally {
      setSaving(false);
    }
  };

  // ── Link Company sub-dialog ──────────────────────────────────

  const openLinkDialog = () => {
    setLinkCompany(null);
    setLinkAutoApprove(false);
    setLinkCompanyOptions([]);
    setLinkCompanySearch('');
    setLinkError(null);
    setLinkDialogOpen(true);
  };

  const handleAddLink = () => {
    if (!linkCompany) { setLinkError(t('guests.companyRequired', 'Please select a company')); return; }
    const alreadyAdded = dialogCompanyLinks.some(l => l.companyId === linkCompany._id);
    if (alreadyAdded) { setLinkError(t('guests.companyAlreadyLinked', 'Company already linked')); return; }
    setDialogCompanyLinks(prev => [
      ...prev,
      { companyId: linkCompany._id, companyName: linkCompany.name, autoApproveCorporateRate: linkAutoApprove },
    ]);
    setLinkDialogOpen(false);
  };

  const handleRemoveLink = (companyId: string) => {
    setDialogCompanyLinks(prev => prev.filter(l => l.companyId !== companyId));
  };

  const handleToggleAutoApprove = (companyId: string, value: boolean) => {
    setDialogCompanyLinks(prev =>
      prev.map(l => l.companyId === companyId ? { ...l, autoApproveCorporateRate: value } : l)
    );
  };

  // ── Delete ───────────────────────────────────────────────────

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

  // ── Detail view ──────────────────────────────────────────────

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

  // ── Detail page / List page ──────────────────────────────────

  return (
    <AdminLayout title={selectedGuest ? `${selectedGuest.firstName} ${selectedGuest.lastName}` : t('admin.nav.guests', 'Guests')}>
    <Container maxWidth="xl" sx={{ pt: 0, pb: 4 }}>

      {selectedGuest ? (
        <>
          {/* Header: Back on left, Edit Guest on right */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Button startIcon={<ArrowBack />} onClick={() => setSelectedGuest(null)}>
              {t('common.back', 'Back')}
            </Button>
            <Button variant="outlined" startIcon={<Edit />} onClick={() => openEdit(selectedGuest)}>
              {t('guests.editGuest', 'Edit Guest')}
            </Button>
          </Box>

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
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">{t('guests.memberSince', 'Member Since')}</Typography>
                <Typography>{new Date(selectedGuest.createdAt).toLocaleDateString()}</Typography>
              </Grid>
            </Grid>
          </Paper>

          {/* Linked Companies */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('guests.linkedCompanies', 'Linked Companies')}</Typography>
            {(selectedGuest.companyLinks || []).length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('guests.noCompanyLinks', 'No companies linked yet')}
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('guests.company', 'Company')}</TableCell>
                    <TableCell>{t('guests.autoApproveCorporateRate', 'Auto-Approve Corporate Rate')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(selectedGuest.companyLinks || []).map((l: GuestCompanyLink) => {
                    const co = typeof l.companyId === 'object' ? (l.companyId as Company) : null;
                    const name = co ? co.name : String(l.companyId);
                    const key = co ? co._id : String(l.companyId);
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Business fontSize="small" color="action" />
                            <Typography variant="body2" fontWeight={600}>{name}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={l.autoApproveCorporateRate ? t('common.yes', 'Yes') : t('common.no', 'No')}
                            color={l.autoApproveCorporateRate ? 'success' : 'default'}
                            size="small"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
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
        </>
      ) : (
        <>
          {/* Filters */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <TextField
                size="small"
                placeholder={t('common.search', 'Search...')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
                sx={{ minWidth: 250 }}
              />
              <Button variant="contained" startIcon={<Add />} onClick={openAdd}>
                {t('guests.addGuest', 'Add Guest')}
              </Button>
            </Box>
          </Paper>

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
                        <IconButton size="small" onClick={e => { e.stopPropagation(); openEdit(g); }}><Edit fontSize="small" /></IconButton>
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
        </>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? t('guests.editGuest', 'Edit Guest') : t('guests.addGuest', 'Add Guest')}</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('common.firstName', 'First Name')}
                value={form.firstName}
                onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('common.lastName', 'Last Name')}
                value={form.lastName}
                onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('common.email', 'Email')}
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={t('common.phone', 'Phone')}
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label={t('common.notes', 'Notes')}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                fullWidth
                multiline
                rows={3}
              />
            </Grid>

            {/* Fiscal information */}
            <Grid item xs={12}>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="subtitle2" gutterBottom>
                {t('guests.fiscalInfo.title', 'Información fiscal')}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                label={t('guests.fiscalInfo.tipoId', 'Tipo de identificación')}
                value={form.fiscalInfo.tipoId}
                onChange={e => setForm(f => ({ ...f, fiscalInfo: { ...f.fiscalInfo, tipoId: e.target.value } }))}
                fullWidth
                size="small"
              >
                <MenuItem value="">{t('common.none', '—')}</MenuItem>
                <MenuItem value="RNC">{t('guests.fiscalInfo.tipoIdOptions.RNC', 'RNC (empresa)')}</MenuItem>
                <MenuItem value="Cedula">{t('guests.fiscalInfo.tipoIdOptions.Cedula', 'Cédula')}</MenuItem>
                <MenuItem value="Pasaporte">{t('guests.fiscalInfo.tipoIdOptions.Pasaporte', 'Pasaporte')}</MenuItem>
                <MenuItem value="Otro">{t('guests.fiscalInfo.tipoIdOptions.Otro', 'Otro')}</MenuItem>
              </TextField>
            </Grid>
            {form.fiscalInfo.tipoId === 'RNC' && (
              <Grid item xs={12} sm={6}>
                <TextField
                  label={t('guests.fiscalInfo.rnc', 'RNC')}
                  value={form.fiscalInfo.rnc}
                  onChange={e => setForm(f => ({ ...f, fiscalInfo: { ...f.fiscalInfo, rnc: e.target.value } }))}
                  helperText={t('guests.fiscalInfo.rncHelp', '9 dígitos')}
                  fullWidth
                  size="small"
                  inputProps={{ maxLength: 9, pattern: '\\d*' }}
                />
              </Grid>
            )}
            {form.fiscalInfo.tipoId === 'Cedula' && (
              <Grid item xs={12} sm={6}>
                <TextField
                  label={t('guests.fiscalInfo.cedula', 'Cédula')}
                  value={form.fiscalInfo.cedula}
                  onChange={e => setForm(f => ({ ...f, fiscalInfo: { ...f.fiscalInfo, cedula: e.target.value } }))}
                  helperText={t('guests.fiscalInfo.cedulaHelp', '11 dígitos')}
                  fullWidth
                  size="small"
                  inputProps={{ maxLength: 11, pattern: '\\d*' }}
                />
              </Grid>
            )}
            {(form.fiscalInfo.tipoId === 'RNC') && (
              <Grid item xs={12}>
                <TextField
                  label={t('guests.fiscalInfo.razonSocial', 'Razón social')}
                  value={form.fiscalInfo.razonSocial}
                  onChange={e => setForm(f => ({ ...f, fiscalInfo: { ...f.fiscalInfo, razonSocial: e.target.value } }))}
                  fullWidth
                  size="small"
                />
              </Grid>
            )}

            {/* Company Links section */}
            <Grid item xs={12}>
              <Divider sx={{ mb: 1.5 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2">{t('guests.linkedCompanies', 'Linked Companies')}</Typography>
                <Button size="small" startIcon={<Business />} onClick={openLinkDialog}>
                  {t('guests.linkCompany', 'Link Company')}
                </Button>
              </Box>
              {dialogCompanyLinks.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('guests.noCompanyLinks', 'No companies linked yet')}
                </Typography>
              ) : (
                <List dense disablePadding>
                  {dialogCompanyLinks.map(l => (
                    <ListItem key={l.companyId} disableGutters sx={{ py: 0.25 }}>
                      <ListItemText
                        primary={l.companyName}
                        secondary={
                          <FormControlLabel
                            control={
                              <Switch
                                size="small"
                                checked={l.autoApproveCorporateRate}
                                onChange={(_, v) => handleToggleAutoApprove(l.companyId, v)}
                              />
                            }
                            label={<Typography variant="caption">{t('guests.autoApproveCorporateRate', 'Auto-Approve Corporate Rate')}</Typography>}
                            sx={{ ml: 0 }}
                          />
                        }
                      />
                      <ListItemSecondaryAction>
                        <Tooltip title={t('guests.removeLink', 'Remove link')}>
                          <IconButton size="small" edge="end" onClick={() => handleRemoveLink(l.companyId)}>
                            <LinkOff fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              )}
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

      {/* Link Company sub-dialog */}
      <Dialog open={linkDialogOpen} onClose={() => setLinkDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('guests.linkCompany', 'Link Company')}</DialogTitle>
        <DialogContent>
          {linkError && <Alert severity="error" sx={{ mb: 2 }}>{linkError}</Alert>}
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Autocomplete
              options={linkCompanyOptions}
              getOptionLabel={(o: Company) => o.name}
              value={linkCompany}
              onChange={(_, newVal: Company | null) => {
                setLinkCompany(newVal);
                setLinkError(null);
              }}
              onInputChange={(_, v) => setLinkCompanySearch(v)}
              isOptionEqualToValue={(o, v) => o._id === v._id}
              renderInput={params => (
                <TextField {...params} label={t('guests.company', 'Company')} required />
              )}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={linkAutoApprove}
                  onChange={(_, v) => setLinkAutoApprove(v)}
                />
              }
              label={t('guests.autoApproveCorporateRate', 'Auto-Approve Corporate Rate')}
            />
            <Typography variant="caption" color="text.secondary">
              {t('guests.autoApproveHint', 'When enabled, reservations requesting a corporate rate for this company will be automatically approved for this guest.')}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkDialogOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleAddLink}>{t('common.add', 'Add')}</Button>
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
    </Container>
    </AdminLayout>
  );
};

export default GuestsManagement;
