import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Button, TextField, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Alert, Tooltip, FormControlLabel, Switch, InputAdornment, Divider,
} from '@mui/material';
import { Add, Edit, Archive, Search } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../../../lib/permissions';
import { suppliersService } from '../../../services/api';
import { Supplier } from '../../../types';

const emptyForm: Partial<Supplier> = {
  name: '', contactName: '', email: '', phone: '', address: '', notes: '', isActive: true, taxId: '', paymentTermsDays: undefined,
};

/**
 * `/accounting/suppliers` — AP supplier management, per
 * PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 6.2. Mirrors CustomersContent.tsx's
 * layout/lifecycle (search/filter, create/edit dialog, archive-not-delete), but against
 * the real new `Supplier` model (locked-in decision #5 — never merged with `Company`).
 */
const SuppliersContent: React.FC = () => {
  const { t } = useTranslation();
  const canManage = usePermission('accounting.suppliers.manage');

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Supplier>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { limit: 200 };
      if (search) params.search = search;
      params.active = activeFilter === undefined ? 'all' : activeFilter;
      const res = await suppliersService.getSuppliers(params);
      setSuppliers(res.data.data || []);
    } catch {
      setError(t('accounting.suppliers.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [search, activeFilter, t]);

  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingId(s._id);
    setForm({
      name: s.name, contactName: s.contactName, email: s.email, phone: s.phone, address: s.address,
      notes: s.notes, isActive: s.isActive, taxId: s.taxId || '', paymentTermsDays: s.paymentTermsDays,
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) { setFormError(t('accounting.suppliers.nameRequired')); return; }
    if (form.paymentTermsDays !== undefined && form.paymentTermsDays !== null && Number(form.paymentTermsDays) < 0) {
      setFormError(t('accounting.suppliers.paymentTermsInvalid')); return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await suppliersService.updateSupplier(editingId, form);
      } else {
        await suppliersService.createSupplier(form);
      }
      setDialogOpen(false);
      fetchSuppliers();
    } catch (err: any) {
      setFormError(err?.response?.data?.message || t('accounting.suppliers.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!archiveId) return;
    setArchiving(true);
    try {
      await suppliersService.archiveSupplier(archiveId);
      setArchiveId(null);
      fetchSuppliers();
    } catch {
      setError(t('accounting.suppliers.messages.archiveFailed'));
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
              {t('accounting.suppliers.actions.create')}
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
                <TableCell>{t('accounting.suppliers.table.name')}</TableCell>
                <TableCell>{t('accounting.suppliers.table.contact')}</TableCell>
                <TableCell>{t('common.email', 'Email')}</TableCell>
                <TableCell>{t('accounting.suppliers.table.taxId')}</TableCell>
                <TableCell>{t('accounting.suppliers.table.paymentTerms')}</TableCell>
                <TableCell>{t('common.status', 'Status')}</TableCell>
                {canManage && <TableCell align="right">{t('accounting.suppliers.table.actions')}</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={24} /></TableCell></TableRow>
              ) : suppliers.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center">{t('accounting.suppliers.empty')}</TableCell></TableRow>
              ) : suppliers.map(s => (
                <TableRow key={s._id} hover>
                  <TableCell><Typography fontWeight={600}>{s.name}</Typography></TableCell>
                  <TableCell>{s.contactName || '—'}</TableCell>
                  <TableCell>{s.email || '—'}</TableCell>
                  <TableCell>{s.taxId || '—'}</TableCell>
                  <TableCell>{s.paymentTermsDays !== undefined && s.paymentTermsDays !== null ? t('accounting.suppliers.table.netDays', { days: s.paymentTermsDays }) : '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={s.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')} color={s.isActive ? 'success' : 'default'} />
                  </TableCell>
                  {canManage && (
                    <TableCell align="right">
                      <Tooltip title={t('common.edit', 'Edit')}>
                        <IconButton size="small" onClick={() => openEdit(s)}><Edit fontSize="small" /></IconButton>
                      </Tooltip>
                      {s.isActive && (
                        <Tooltip title={t('accounting.suppliers.actions.archive')}>
                          <IconButton size="small" color="error" onClick={() => setArchiveId(s._id)}><Archive fontSize="small" /></IconButton>
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
        <DialogTitle>{editingId ? t('accounting.suppliers.actions.edit') : t('accounting.suppliers.actions.create')}</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField label={t('accounting.suppliers.form.name')} value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} fullWidth required />
            <TextField label={t('accounting.suppliers.form.contactName')} value={form.contactName || ''} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} fullWidth />
            <TextField label={t('common.email', 'Email')} value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} fullWidth />
            <TextField label={t('common.phone', 'Phone')} value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} fullWidth />
            <TextField label={t('accounting.suppliers.form.address')} value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} fullWidth />
            <TextField label={t('common.notes', 'Notes')} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} fullWidth multiline rows={2} />
            <Divider />
            <Typography variant="subtitle2" color="text.secondary">{t('accounting.suppliers.form.billingInfoTitle')}</Typography>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
              <TextField label={t('accounting.suppliers.form.taxId')} value={form.taxId || ''} onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} fullWidth />
              <TextField
                label={t('accounting.suppliers.form.paymentTermsDays')}
                type="number"
                value={form.paymentTermsDays ?? ''}
                onChange={e => setForm(f => ({ ...f, paymentTermsDays: e.target.value === '' ? undefined : Number(e.target.value) }))}
                fullWidth
                inputProps={{ min: 0 }}
                helperText={t('accounting.suppliers.form.paymentTermsHelp')}
              />
            </Box>
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
        <DialogTitle>{t('accounting.suppliers.archiveConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('accounting.suppliers.archiveConfirmBody')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveId(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleArchive} disabled={archiving}>
            {archiving ? <CircularProgress size={18} /> : t('accounting.suppliers.actions.archive')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SuppliersContent;
