import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Button, TextField, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Alert, Tooltip, FormControlLabel, Switch, InputAdornment, Divider, Autocomplete,
} from '@mui/material';
import { Add, Edit, Archive, Search, Link as LinkIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../../../lib/permissions';
import { accountingCustomersService, companiesService } from '../../../services/api';
import { Customer, Company } from '../../../types';

const emptyForm: Partial<Customer> = {
  name: '', contactName: '', email: '', phone: '', address: '', notes: '', isActive: true, rnc: '', razonSocial: '',
};

/**
 * `/accounting/customers` — AR customer management, per PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md
 * Phase 5.2, re-pointed at the dedicated `Customer` model by the Phase 10.3 / architecture §11
 * split. `linkedCompanyId` optionally bridges a customer to a real PMS `Company` — the
 * pre-approved direct-bill account case — searched here via the PMS `companiesService`, but the
 * two remain separate records/collections everywhere else.
 */
const CustomersContent: React.FC = () => {
  const { t } = useTranslation();
  const canManage = usePermission('accounting.customers.manage');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Customer>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [linkedCompany, setLinkedCompany] = useState<Company | null>(null);
  const [companyOptions, setCompanyOptions] = useState<Company[]>([]);
  const [companySearchLoading, setCompanySearchLoading] = useState(false);

  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { limit: 200 };
      if (search) params.search = search;
      params.active = activeFilter === undefined ? 'all' : activeFilter;
      const res = await accountingCustomersService.getCustomers(params);
      setCustomers(res.data.data || []);
    } catch {
      setError(t('accounting.customers.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [search, activeFilter, t]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const companyLabel = (c?: string | Company | null): string | null => {
    if (!c) return null;
    return typeof c === 'string' ? null : c.name;
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setLinkedCompany(null);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditingId(c._id);
    setForm({ name: c.name, contactName: c.contactName, email: c.email, phone: c.phone, address: c.address, notes: c.notes, isActive: c.isActive, rnc: c.rnc || '', razonSocial: c.razonSocial || '' });
    setLinkedCompany(typeof c.linkedCompanyId === 'object' && c.linkedCompanyId ? c.linkedCompanyId : null);
    setFormError(null);
    setDialogOpen(true);
  };

  const searchCompanies = useCallback(async (query: string) => {
    setCompanySearchLoading(true);
    try {
      const res = await companiesService.getCompanies({ search: query || undefined, limit: 20, active: true });
      setCompanyOptions(res.data.data || []);
    } catch {
      // non-critical — leave options as-is
    } finally {
      setCompanySearchLoading(false);
    }
  }, []);

  const handleSave = async () => {
    if (!form.name?.trim()) { setFormError(t('accounting.customers.nameRequired')); return; }
    setSaving(true);
    setFormError(null);
    try {
      const { linkedCompanyId: _omit, ...formFields } = form;
      const payload = { ...formFields, linkedCompanyId: linkedCompany?._id || null };
      if (editingId) {
        await accountingCustomersService.updateCustomer(editingId, payload);
      } else {
        await accountingCustomersService.createCustomer(payload);
      }
      setDialogOpen(false);
      fetchCustomers();
    } catch (err: any) {
      setFormError(err?.response?.data?.message || t('accounting.customers.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!archiveId) return;
    setArchiving(true);
    try {
      await accountingCustomersService.archiveCustomer(archiveId);
      setArchiveId(null);
      fetchCustomers();
    } catch {
      setError(t('accounting.customers.messages.archiveFailed'));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <Box>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder={t('common.search', 'Search...')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: 220 }}
          />
          <Button size="small" variant={activeFilter === undefined ? 'contained' : 'outlined'} onClick={() => setActiveFilter(undefined)}>{t('common.all', 'All')}</Button>
          <Button size="small" variant={activeFilter === true ? 'contained' : 'outlined'} color="success" onClick={() => setActiveFilter(true)}>{t('common.active', 'Active')}</Button>
          <Button size="small" variant={activeFilter === false ? 'contained' : 'outlined'} color="inherit" onClick={() => setActiveFilter(false)}>{t('common.inactive', 'Inactive')}</Button>
          {canManage && (
            <Button variant="contained" startIcon={<Add />} onClick={openCreate} sx={{ ml: 'auto' }}>
              {t('accounting.customers.actions.create')}
            </Button>
          )}
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.customers.table.name')}</TableCell>
                <TableCell>{t('accounting.customers.table.contact')}</TableCell>
                <TableCell>{t('common.email', 'Email')}</TableCell>
                <TableCell>{t('accounting.customers.table.rnc')}</TableCell>
                <TableCell>{t('common.status', 'Status')}</TableCell>
                {canManage && <TableCell align="right">{t('accounting.customers.table.actions')}</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={24} /></TableCell></TableRow>
              ) : customers.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center">{t('accounting.customers.empty')}</TableCell></TableRow>
              ) : customers.map(c => (
                <TableRow key={c._id} hover>
                  <TableCell>
                    <Typography fontWeight={600}>{c.name}</Typography>
                    {c.linkedCompanyId && (
                      <Tooltip title={companyLabel(c.linkedCompanyId) ? t('accounting.customers.linkedToCompany', { name: companyLabel(c.linkedCompanyId) }) : t('accounting.customers.linkedToCompanyGeneric')}>
                        <Chip size="small" variant="outlined" icon={<LinkIcon fontSize="small" />} label={t('accounting.customers.linked')} sx={{ mt: 0.5 }} />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>{c.contactName || '—'}</TableCell>
                  <TableCell>{c.email || '—'}</TableCell>
                  <TableCell>{c.rnc || '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={c.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')} color={c.isActive ? 'success' : 'default'} />
                  </TableCell>
                  {canManage && (
                    <TableCell align="right">
                      <Tooltip title={t('common.edit', 'Edit')}>
                        <IconButton size="small" onClick={() => openEdit(c)}><Edit fontSize="small" /></IconButton>
                      </Tooltip>
                      {c.isActive && (
                        <Tooltip title={t('accounting.customers.actions.archive')}>
                          <IconButton size="small" color="error" onClick={() => setArchiveId(c._id)}><Archive fontSize="small" /></IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? t('accounting.customers.actions.edit') : t('accounting.customers.actions.create')}</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField label={t('accounting.customers.form.name')} value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} fullWidth required />
            <TextField label={t('accounting.customers.form.contactName')} value={form.contactName || ''} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} fullWidth />
            <TextField label={t('common.email', 'Email')} value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} fullWidth />
            <TextField label={t('common.phone', 'Phone')} value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} fullWidth />
            <TextField label={t('accounting.customers.form.address')} value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} fullWidth />
            <TextField label={t('common.notes', 'Notes')} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} fullWidth multiline rows={2} />
            <Divider />
            <Typography variant="subtitle2" color="text.secondary">{t('accounting.customers.form.fiscalInfoTitle')}</Typography>
            <TextField label={t('accounting.customers.form.rnc')} value={form.rnc || ''} onChange={e => setForm(f => ({ ...f, rnc: e.target.value }))} fullWidth inputProps={{ maxLength: 11 }} helperText={t('accounting.customers.form.rncHelp')} />
            <TextField label={t('accounting.customers.form.razonSocial')} value={form.razonSocial || ''} onChange={e => setForm(f => ({ ...f, razonSocial: e.target.value }))} fullWidth />
            <Divider />
            <Typography variant="subtitle2" color="text.secondary">{t('accounting.customers.form.linkTitle')}</Typography>
            <Autocomplete
              options={companyOptions}
              value={linkedCompany}
              loading={companySearchLoading}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(o, v) => o._id === v._id}
              onOpen={() => searchCompanies('')}
              onInputChange={(_e, value) => searchCompanies(value)}
              onChange={(_e, value) => setLinkedCompany(value)}
              renderInput={(params) => (
                <TextField {...params} label={t('accounting.customers.form.linkCompany')} helperText={t('accounting.customers.form.linkCompanyHelp')} />
              )}
            />
            {editingId && (
              <FormControlLabel
                control={<Switch checked={!!form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />}
                label={t('common.active', 'Active')}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={18} /> : t('common.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!archiveId} onClose={() => setArchiveId(null)} maxWidth="xs">
        <DialogTitle>{t('accounting.customers.archiveConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('accounting.customers.archiveConfirmBody')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveId(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleArchive} disabled={archiving}>
            {archiving ? <CircularProgress size={18} /> : t('accounting.customers.actions.archive')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CustomersContent;
