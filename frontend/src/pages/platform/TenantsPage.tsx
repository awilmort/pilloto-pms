import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Chip,
  IconButton, Tooltip, CircularProgress, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Alert,
  FormGroup, FormControlLabel, Checkbox, Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BarChartIcon from '@mui/icons-material/BarChart';
import EditIcon from '@mui/icons-material/Edit';
import ForwardToInboxIcon from '@mui/icons-material/ForwardToInbox';
import { platformService, TenantRecord, ProvisionTenantPayload, TenantProduct, AccountingPlanSlug } from '../../services/api';
import PlatformLayout from './PlatformLayout';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

const PLAN_COLORS: Record<string, 'default' | 'primary' | 'secondary'> = {
  basic: 'default',
  pro: 'primary',
  enterprise: 'secondary',
};

const ACCOUNTING_PLAN_COLORS: Record<string, 'default' | 'primary' | 'secondary'> = {
  starter: 'default',
  pro: 'primary',
  plus: 'secondary',
};

const INVITATION_CHIP: Record<string, { color: 'default' | 'success' | 'warning' | 'error' }> = {
  pending: { color: 'warning' },
  expired: { color: 'error' },
  accepted: { color: 'success' },
};

const defaultForm: ProvisionTenantPayload = {
  name: '', slug: '', plan: 'basic',
  ownerEmail: '', adminFirstName: '', adminLastName: '',
  products: ['pms'],
};

const TenantsPage: React.FC = () => {
  const { t: tr, i18n } = useTranslation();
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<ProvisionTenantPayload>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');

  // Stats dialog
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState<{ tenant: TenantRecord; stats: any } | null>(null);

  // Edit plan/products dialog
  const [editPlanOpen, setEditPlanOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantRecord | null>(null);
  const [editPlanValue, setEditPlanValue] = useState('basic');
  const [editProducts, setEditProducts] = useState<TenantProduct[]>(['pms']);
  const [editAccountingPlan, setEditAccountingPlan] = useState<AccountingPlanSlug>('starter');
  const [editPlanSaving, setEditPlanSaving] = useState(false);

  const handleOpenEditPlan = (t: TenantRecord) => {
    setEditingTenant(t);
    setEditPlanValue(t.plan);
    setEditProducts(t.products?.length ? t.products : ['pms']);
    setEditAccountingPlan(t.plans?.accounting ?? 'starter');
    setEditPlanOpen(true);
  };

  const toggleEditProduct = (product: TenantProduct) => {
    setEditProducts((prev) =>
      prev.includes(product) ? prev.filter((p) => p !== product) : [...prev, product]
    );
  };

  const handleSavePlan = async () => {
    if (!editingTenant) return;
    setEditPlanSaving(true);
    try {
      const addingAccounting = editProducts.includes('accounting') && !editingTenant.products?.includes('accounting');
      await platformService.updateTenant(editingTenant._id, {
        plan: editPlanValue,
        products: editProducts,
        plans: editProducts.includes('accounting') ? { accounting: editAccountingPlan } : {},
      });
      toast.success(
        addingAccounting
          ? tr('platform.tenants.accountingAdded', { plan: editAccountingPlan, name: editingTenant.name })
          : tr('platform.tenants.planUpdated', { name: editingTenant.name })
      );
      setEditPlanOpen(false);
      setEditingTenant(null);
      load();
    } catch {
      toast.error(tr('platform.tenants.planUpdateFailed'));
    } finally {
      setEditPlanSaving(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformService.listTenants();
      setTenants(res.data.data || []);
    } catch {
      toast.error(tr('platform.tenants.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (t: TenantRecord) => {
    try {
      await platformService.updateTenant(t._id, { isActive: !t.isActive });
      toast.success(tr(`platform.tenants.toggled.${t.isActive ? 'deactivated' : 'activated'}`));
      load();
    } catch {
      toast.error(tr('platform.tenants.updateFailed'));
    }
  };

  const handleStats = async (t: TenantRecord) => {
    try {
      const res = await platformService.getTenantStats(t._id);
      setStats(res.data.data!);
      setStatsOpen(true);
    } catch {
      toast.error(tr('platform.tenants.statsFailed'));
    }
  };

  const handleCreate = async () => {
    setCreateError('');
    if (!form.products?.length) {
      setCreateError(tr('platform.tenants.selectProduct'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await platformService.createTenant(form);
      if (res.data.data?.invitation?.sent) toast.success(tr('platform.tenants.created', { name: form.name, email: form.ownerEmail }));
      else toast.warning(res.data.message || tr('platform.tenants.createdNoEmail', { name: form.name }));
      setCreateOpen(false);
      setForm(defaultForm);
      load();
    } catch (err: any) {
      setCreateError(err.response?.data?.message || tr('platform.tenants.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendInvitation = async (t: TenantRecord) => {
    try {
      const res = await platformService.resendInvitation(t._id);
      toast.success(res.data.message || tr('platform.tenants.invitationSent', { email: t.ownerEmail }));
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.message || tr('platform.tenants.resendFailed'));
    }
  };

  const fieldChange = (key: keyof ProvisionTenantPayload) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value }));

  return (
    <PlatformLayout>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5" fontWeight={700}>{tr('platform.tenants.title')}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          {tr('platform.tenants.newTenant')}
        </Button>
      </Box>

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{tr('platform.tenants.cols.name')}</TableCell>
                <TableCell>{tr('platform.tenants.cols.slug')}</TableCell>
                <TableCell>{tr('platform.tenants.cols.plan')}</TableCell>
                <TableCell>{tr('platform.tenants.cols.products')}</TableCell>
                <TableCell>{tr('platform.tenants.cols.owner')}</TableCell>
                <TableCell>{tr('platform.tenants.cols.status')}</TableCell>
                <TableCell>{tr('platform.tenants.cols.created')}</TableCell>
                <TableCell align="center">{tr('platform.tenants.cols.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tenants.map(t => (
                <TableRow key={t._id} hover>
                  <TableCell>{t.name}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace">{t.slug}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={tr(`platform.tenants.plans.${t.plan}`, t.plan)} color={PLAN_COLORS[t.plan] ?? 'default'} size="small" />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      {(t.products?.length ? t.products : ['pms']).map((p) => (
                        <Tooltip key={p} title={p === 'accounting' && t.plans?.accounting ? tr('platform.tenants.accountingTooltip', { plan: tr(`platform.tenants.plans.${t.plans.accounting}`) }) : undefined}>
                          <Chip
                            label={p === 'accounting' ? tr('platform.tenants.accountingChip', { plan: tr(`platform.tenants.plans.${t.plans?.accounting ?? 'starter'}`) }) : tr('platform.tenants.create.pms')}
                            color={p === 'accounting' ? (ACCOUNTING_PLAN_COLORS[t.plans?.accounting ?? 'starter'] ?? 'default') : 'default'}
                            size="small"
                            variant={p === 'accounting' ? 'filled' : 'outlined'}
                          />
                        </Tooltip>
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {t.ownerEmail}
                    {t.ownerInvitation && INVITATION_CHIP[t.ownerInvitation.status] && (
                      <Box mt={0.5}>
                        <Chip size="small" variant="outlined" label={tr(`platform.tenants.invitation.${t.ownerInvitation.status}`)} color={INVITATION_CHIP[t.ownerInvitation.status].color} />
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={t.isActive ? tr('platform.tenants.active') : tr('platform.tenants.inactive')}
                      color={t.isActive ? 'success' : 'error'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{new Date(t.createdAt).toLocaleDateString(i18n.language)}</TableCell>
                  <TableCell align="center">
                    <Tooltip title={tr('platform.tenants.actions.editPlan')}>
                      <IconButton size="small" onClick={() => handleOpenEditPlan(t)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {(t.ownerInvitation?.status === 'pending' || t.ownerInvitation?.status === 'expired') && (
                      <Tooltip title={tr('platform.tenants.actions.resend')}>
                        <IconButton size="small" onClick={() => handleResendInvitation(t)}>
                          <ForwardToInboxIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={tr('platform.tenants.actions.stats')}>
                      <IconButton size="small" onClick={() => handleStats(t)}>
                        <BarChartIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t.isActive ? tr('platform.tenants.actions.deactivate') : tr('platform.tenants.actions.activate')}>
                      <IconButton size="small" onClick={() => handleToggle(t)}>
                        {t.isActive ? <BlockIcon fontSize="small" color="error" /> : <CheckCircleIcon fontSize="small" color="success" />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={tr('platform.tenants.actions.open')}>
                      <IconButton
                        size="small"
                        onClick={() => window.open(`https://${t.slug}.pilloto.com`, '_blank')}
                      >
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {tenants.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center">{tr('platform.tenants.empty')}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create Tenant Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('platform.tenants.create.title')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          {createError && <Alert severity="error">{createError}</Alert>}
          <TextField label={tr('platform.tenants.create.name')} value={form.name} onChange={fieldChange('name')} required fullWidth />
          <TextField
            label={tr('platform.tenants.create.slug')}
            value={form.slug}
            onChange={fieldChange('slug')}
            helperText={tr('platform.tenants.create.slugHelp')}
            required fullWidth
          />
          <TextField select label={tr('platform.tenants.create.pmsPlan')} value={form.plan} onChange={fieldChange('plan')} fullWidth>
            {['basic', 'pro', 'enterprise'].map(p => (
              <MenuItem key={p} value={p}>{tr(`platform.tenants.plans.${p}`)}</MenuItem>
            ))}
          </TextField>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>{tr('platform.tenants.create.products')}</Typography>
            <FormGroup row>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!form.products?.includes('pms')}
                    onChange={() => setForm(f => ({
                      ...f,
                      products: f.products?.includes('pms')
                        ? f.products.filter(p => p !== 'pms')
                        : [...(f.products ?? []), 'pms'],
                    }))}
                  />
                }
                label={tr('platform.tenants.create.pms')}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!form.products?.includes('accounting')}
                    onChange={() => setForm(f => ({
                      ...f,
                      products: f.products?.includes('accounting')
                        ? f.products.filter(p => p !== 'accounting')
                        : [...(f.products ?? []), 'accounting'],
                    }))}
                  />
                }
                label={tr('platform.tenants.create.accounting')}
              />
            </FormGroup>
          </Box>
          {form.products?.includes('accounting') && (
            <TextField
              select
              label={tr('platform.tenants.create.accountingPlan')}
              value={form.plans?.accounting ?? 'starter'}
              onChange={(e) => setForm(f => ({ ...f, plans: { ...f.plans, accounting: e.target.value as AccountingPlanSlug } }))}
              fullWidth
            >
              {['starter', 'pro', 'plus'].map(p => (
                <MenuItem key={p} value={p}>{tr(`platform.tenants.plans.${p}`)}</MenuItem>
              ))}
            </TextField>
          )}
          <TextField label={tr('platform.tenants.create.ownerEmail')} type="email" value={form.ownerEmail} onChange={fieldChange('ownerEmail')} required fullWidth />
          <Box display="flex" gap={2}>
            <TextField label={tr('platform.tenants.create.adminFirstName')} value={form.adminFirstName} onChange={fieldChange('adminFirstName')} required fullWidth />
            <TextField label={tr('platform.tenants.create.adminLastName')} value={form.adminLastName} onChange={fieldChange('adminLastName')} required fullWidth />
          </Box>
          <Alert severity="info">{tr('platform.tenants.create.invitationInfo')}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>{tr('platform.tenants.create.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={16} /> : undefined}
          >
            {tr('platform.tenants.create.submit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Plan & Products Dialog */}
      <Dialog open={editPlanOpen} onClose={() => setEditPlanOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr('platform.tenants.edit.title', { name: editingTenant?.name ?? '' })}</DialogTitle>
        <DialogContent sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            select
            label={tr('platform.tenants.create.pmsPlan')}
            value={editPlanValue}
            onChange={(e) => setEditPlanValue(e.target.value)}
            fullWidth
          >
            {['basic', 'pro', 'enterprise'].map(p => (
              <MenuItem key={p} value={p}>{tr(`platform.tenants.plans.${p}`)}</MenuItem>
            ))}
          </TextField>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>{tr('platform.tenants.create.products')}</Typography>
            <FormGroup row>
              <FormControlLabel
                control={<Checkbox checked={editProducts.includes('pms')} onChange={() => toggleEditProduct('pms')} />}
                label={tr('platform.tenants.create.pms')}
              />
              <FormControlLabel
                control={<Checkbox checked={editProducts.includes('accounting')} onChange={() => toggleEditProduct('accounting')} />}
                label={tr('platform.tenants.create.accounting')}
              />
            </FormGroup>
          </Box>
          {editProducts.includes('accounting') && (
            <>
              <TextField
                select
                label={tr('platform.tenants.create.accountingPlan')}
                value={editAccountingPlan}
                onChange={(e) => setEditAccountingPlan(e.target.value as AccountingPlanSlug)}
                fullWidth
              >
                {['starter', 'pro', 'plus'].map(p => (
                  <MenuItem key={p} value={p}>{tr(`platform.tenants.plans.${p}`)}</MenuItem>
                ))}
              </TextField>
              {!editingTenant?.products?.includes('accounting') && (
                <Alert severity="info">
                  {tr('platform.tenants.edit.provisionInfo')}
                </Alert>
              )}
            </>
          )}
          {!editProducts.length && (
            <Alert severity="warning">{tr('platform.tenants.edit.needProduct')}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditPlanOpen(false)}>{tr('platform.tenants.create.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSavePlan}
            disabled={editPlanSaving || !editProducts.length}
            startIcon={editPlanSaving ? <CircularProgress size={16} /> : undefined}
          >
            {tr('platform.tenants.edit.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Stats Dialog */}
      <Dialog open={statsOpen} onClose={() => setStatsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr('platform.tenants.stats.title', { name: stats?.tenant.name ?? '' })}</DialogTitle>
        <DialogContent>
          {stats && (
            <Box display="flex" flexDirection="column" gap={1} pt={1}>
              <Typography>{tr('platform.tenants.stats.users')}: <strong>{stats.stats.users}</strong></Typography>
              <Typography>{tr('platform.tenants.stats.reservations')}: <strong>{stats.stats.reservations}</strong></Typography>
              <Typography>{tr('platform.tenants.stats.rooms')}: <strong>{stats.stats.rooms}</strong></Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatsOpen(false)}>{tr('platform.tenants.stats.close')}</Button>
        </DialogActions>
      </Dialog>
    </PlatformLayout>
  );
};

export default TenantsPage;
