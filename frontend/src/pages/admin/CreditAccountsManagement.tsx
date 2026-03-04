import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Paper,
  IconButton,
  Tooltip,
  InputAdornment,
} from '@mui/material';
import { Add, Delete, Edit, Search } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import { companiesService, creditAccountsService, guestsService } from '../../services/api';
import { Company, CreditAccount, Guest } from '../../types';

type Scope = 'guest' | 'company';
type CreditStatus = 'active' | 'suspended';

interface CreditAccountForm {
  scope: Scope;
  referenceId: string;
  creditLimit: number;
  currentExposure: number;
  status: CreditStatus;
}

const emptyForm: CreditAccountForm = {
  scope: 'guest',
  referenceId: '',
  creditLimit: 0,
  currentExposure: 0,
  status: 'active',
};

const CreditAccountsManagement: React.FC = () => {
  const { t } = useTranslation();

  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scopeFilter, setScopeFilter] = useState<'all' | Scope>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | CreditStatus>('all');
  const [search, setSearch] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreditAccountForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchBaseReferences = useCallback(async () => {
    try {
      const [guestsRes, companiesRes] = await Promise.all([
        guestsService.getGuests({ limit: 200 }),
        companiesService.getCompanies({ limit: 200 }),
      ]);
      setGuests(guestsRes.data.data || []);
      setCompanies(companiesRes.data.data || []);
    } catch {
      // reference options are optional for listing; form will show error on save if invalid
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { scope?: Scope; status?: CreditStatus; limit: number } = { limit: 200 };
      if (scopeFilter !== 'all') params.scope = scopeFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await creditAccountsService.getCreditAccounts(params);
      setAccounts(res.data.data || []);
      setTotal((res.data as any).total || 0);
    } catch (err: any) {
      setError(err?.response?.data?.message || t('common.errorLoading', 'Error loading records'));
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, statusFilter, t]);

  useEffect(() => {
    fetchBaseReferences();
  }, [fetchBaseReferences]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const getReferenceLabel = (account: CreditAccount): string => {
    const ref = account.reference;
    if (!ref) return account.referenceId;
    if (account.scope === 'guest') {
      const fullName = `${ref.firstName || ''} ${ref.lastName || ''}`.trim();
      return ref.email ? `${fullName} (${ref.email})` : fullName || ref.email || account.referenceId;
    }
    return ref.email ? `${ref.name || ''} (${ref.email})` : ref.name || ref.email || account.referenceId;
  };

  const filteredAccounts = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.trim().toLowerCase();
    return accounts.filter(a => {
      const reference = getReferenceLabel(a).toLowerCase();
      return (
        reference.includes(q)
        || a.scope.toLowerCase().includes(q)
        || a.status.toLowerCase().includes(q)
      );
    });
  }, [accounts, search]);

  const currentReferenceOptions = form.scope === 'guest' ? guests : companies;

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (account: CreditAccount) => {
    setEditingId(account._id);
    setForm({
      scope: account.scope,
      referenceId: account.referenceId,
      creditLimit: Number(account.creditLimit || 0),
      currentExposure: Number(account.currentExposure || 0),
      status: account.status,
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.referenceId) {
      setFormError(t('creditAccounts.referenceRequired', 'Reference is required'));
      return;
    }
    if (form.creditLimit < 0 || form.currentExposure < 0) {
      setFormError(t('creditAccounts.invalidAmounts', 'Amounts must be zero or greater'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await creditAccountsService.updateCreditAccount(editingId, {
          creditLimit: form.creditLimit,
          currentExposure: form.currentExposure,
          status: form.status,
        });
      } else {
        await creditAccountsService.createCreditAccount({
          scope: form.scope,
          referenceId: form.referenceId,
          creditLimit: form.creditLimit,
          currentExposure: form.currentExposure,
          status: form.status,
        });
      }
      setDialogOpen(false);
      fetchAccounts();
    } catch (err: any) {
      setFormError(err?.response?.data?.message || t('common.errorSaving', 'Error saving record'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await creditAccountsService.deleteCreditAccount(deleteId);
      setDeleteId(null);
      fetchAccounts();
    } catch (err: any) {
      setError(err?.response?.data?.message || t('common.errorDeleting', 'Error deleting record'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminLayout>
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
          <SectionTitle title={t('admin.nav.creditAccounts', 'Credit Accounts')} />
          <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
            {t('creditAccounts.addAccount', 'Add Credit Account')}
          </Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder={t('common.search', 'Search...')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              )
            }}
            sx={{ minWidth: 250 }}
          />

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>{t('creditAccounts.scope', 'Scope')}</InputLabel>
            <Select
              label={t('creditAccounts.scope', 'Scope')}
              value={scopeFilter}
              onChange={e => setScopeFilter(e.target.value as 'all' | Scope)}
            >
              <MenuItem value="all">{t('common.all', 'All')}</MenuItem>
              <MenuItem value="guest">{t('creditAccounts.scopeGuest', 'Guest')}</MenuItem>
              <MenuItem value="company">{t('creditAccounts.scopeCompany', 'Company')}</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 170 }}>
            <InputLabel>{t('common.status', 'Status')}</InputLabel>
            <Select
              label={t('common.status', 'Status')}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as 'all' | CreditStatus)}
            >
              <MenuItem value="all">{t('common.all', 'All')}</MenuItem>
              <MenuItem value="active">{t('common.active', 'Active')}</MenuItem>
              <MenuItem value="suspended">{t('common.inactive', 'Suspended')}</MenuItem>
            </Select>
          </FormControl>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('creditAccounts.scope', 'Scope')}</TableCell>
                <TableCell>{t('creditAccounts.reference', 'Reference')}</TableCell>
                <TableCell align="right">{t('creditAccounts.creditLimit', 'Credit Limit')}</TableCell>
                <TableCell align="right">{t('creditAccounts.currentExposure', 'Current Exposure')}</TableCell>
                <TableCell align="right">{t('creditAccounts.available', 'Available')}</TableCell>
                <TableCell>{t('common.status', 'Status')}</TableCell>
                <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} align="center"><CircularProgress size={24} /></TableCell>
                </TableRow>
              ) : filteredAccounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">{t('common.noData', 'No records found')}</TableCell>
                </TableRow>
              ) : filteredAccounts.map(account => {
                const available = Number(account.creditLimit || 0) - Number(account.currentExposure || 0);
                return (
                  <TableRow key={account._id}>
                    <TableCell>
                      <Chip
                        size="small"
                        label={account.scope === 'guest' ? t('creditAccounts.scopeGuest', 'Guest') : t('creditAccounts.scopeCompany', 'Company')}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight={600}>{getReferenceLabel(account)}</Typography>
                    </TableCell>
                    <TableCell align="right">${Number(account.creditLimit || 0).toFixed(2)}</TableCell>
                    <TableCell align="right">${Number(account.currentExposure || 0).toFixed(2)}</TableCell>
                    <TableCell align="right">${available.toFixed(2)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={account.status === 'active' ? t('common.active', 'Active') : t('common.inactive', 'Suspended')}
                        color={account.status === 'active' ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={t('common.edit', 'Edit')}>
                        <IconButton size="small" onClick={() => openEdit(account)}><Edit fontSize="small" /></IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.delete', 'Delete')}>
                        <IconButton size="small" color="error" onClick={() => setDeleteId(account._id)}><Delete fontSize="small" /></IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {total} {t('creditAccounts.total', 'credit accounts')}
        </Typography>

        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>
            {editingId ? t('creditAccounts.editAccount', 'Edit Credit Account') : t('creditAccounts.addAccount', 'Add Credit Account')}
          </DialogTitle>
          <DialogContent>
            {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              <FormControl fullWidth>
                <InputLabel>{t('creditAccounts.scope', 'Scope')}</InputLabel>
                <Select
                  label={t('creditAccounts.scope', 'Scope')}
                  value={form.scope}
                  disabled={!!editingId}
                  onChange={e => setForm(prev => ({ ...prev, scope: e.target.value as Scope, referenceId: '' }))}
                >
                  <MenuItem value="guest">{t('creditAccounts.scopeGuest', 'Guest')}</MenuItem>
                  <MenuItem value="company">{t('creditAccounts.scopeCompany', 'Company')}</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>{t('creditAccounts.reference', 'Reference')}</InputLabel>
                <Select
                  label={t('creditAccounts.reference', 'Reference')}
                  value={form.referenceId}
                  disabled={!!editingId}
                  onChange={e => setForm(prev => ({ ...prev, referenceId: e.target.value }))}
                >
                  {currentReferenceOptions.map(ref => (
                    <MenuItem key={ref._id} value={ref._id}>
                      {'firstName' in ref
                        ? `${ref.firstName} ${ref.lastName}${ref.email ? ` (${ref.email})` : ''}`
                        : `${ref.name}${ref.email ? ` (${ref.email})` : ''}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label={t('creditAccounts.creditLimit', 'Credit Limit')}
                type="number"
                value={form.creditLimit}
                onChange={e => setForm(prev => ({ ...prev, creditLimit: Number(e.target.value) }))}
                inputProps={{ min: 0, step: 0.01 }}
                fullWidth
              />

              <TextField
                label={t('creditAccounts.currentExposure', 'Current Exposure')}
                type="number"
                value={form.currentExposure}
                onChange={e => setForm(prev => ({ ...prev, currentExposure: Number(e.target.value) }))}
                inputProps={{ min: 0, step: 0.01 }}
                fullWidth
              />

              <FormControl fullWidth>
                <InputLabel>{t('common.status', 'Status')}</InputLabel>
                <Select
                  label={t('common.status', 'Status')}
                  value={form.status}
                  onChange={e => setForm(prev => ({ ...prev, status: e.target.value as CreditStatus }))}
                >
                  <MenuItem value="active">{t('common.active', 'Active')}</MenuItem>
                  <MenuItem value="suspended">{t('common.inactive', 'Suspended')}</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button variant="contained" onClick={handleSave} disabled={saving}>
              {saving ? <CircularProgress size={18} /> : t('common.save', 'Save')}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={!!deleteId} onClose={() => setDeleteId(null)} maxWidth="xs" fullWidth>
          <DialogTitle>{t('common.confirmDelete', 'Confirm Delete')}</DialogTitle>
          <DialogContent>
            <Typography>{t('creditAccounts.deleteConfirm', 'Are you sure you want to delete this credit account?')}</Typography>
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

export default CreditAccountsManagement;
