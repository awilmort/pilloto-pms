import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Chip,
  IconButton, Tooltip, CircularProgress, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BarChartIcon from '@mui/icons-material/BarChart';
import EditIcon from '@mui/icons-material/Edit';
import { platformService, TenantRecord, ProvisionTenantPayload } from '../../services/api';
import PlatformLayout from './PlatformLayout';
import { toast } from 'react-toastify';

const PLAN_COLORS: Record<string, 'default' | 'primary' | 'secondary'> = {
  basic: 'default',
  pro: 'primary',
  enterprise: 'secondary',
};

const defaultForm: ProvisionTenantPayload = {
  name: '', slug: '', plan: 'basic',
  ownerEmail: '', adminFirstName: '', adminLastName: '', adminPassword: '',
};

const TenantsPage: React.FC = () => {
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<ProvisionTenantPayload>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');

  // Stats dialog
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState<{ tenant: TenantRecord; stats: any } | null>(null);

  // Edit plan dialog
  const [editPlanOpen, setEditPlanOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantRecord | null>(null);
  const [editPlanValue, setEditPlanValue] = useState('basic');
  const [editPlanSaving, setEditPlanSaving] = useState(false);

  const handleOpenEditPlan = (t: TenantRecord) => {
    setEditingTenant(t);
    setEditPlanValue(t.plan);
    setEditPlanOpen(true);
  };

  const handleSavePlan = async () => {
    if (!editingTenant) return;
    setEditPlanSaving(true);
    try {
      await platformService.updateTenant(editingTenant._id, { plan: editPlanValue });
      toast.success(`Plan updated to "${editPlanValue}" for ${editingTenant.name}`);
      setEditPlanOpen(false);
      setEditingTenant(null);
      load();
    } catch {
      toast.error('Failed to update plan');
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
      toast.error('Failed to load tenants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (t: TenantRecord) => {
    try {
      await platformService.updateTenant(t._id, { isActive: !t.isActive });
      toast.success(`Tenant ${t.isActive ? 'deactivated' : 'activated'}`);
      load();
    } catch {
      toast.error('Update failed');
    }
  };

  const handleStats = async (t: TenantRecord) => {
    try {
      const res = await platformService.getTenantStats(t._id);
      setStats(res.data.data!);
      setStatsOpen(true);
    } catch {
      toast.error('Failed to fetch stats');
    }
  };

  const handleCreate = async () => {
    setCreateError('');
    setSubmitting(true);
    try {
      const res = await platformService.createTenant(form);
      toast.success(`Tenant "${form.name}" created! Login URL: ${res.data.data?.loginUrl}`);
      setCreateOpen(false);
      setForm(defaultForm);
      load();
    } catch (err: any) {
      setCreateError(err.response?.data?.message || 'Failed to create tenant');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldChange = (key: keyof ProvisionTenantPayload) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value }));

  return (
    <PlatformLayout>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5" fontWeight={700}>Tenants</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          New Tenant
        </Button>
      </Box>

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Slug</TableCell>
                <TableCell>Plan</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="center">Actions</TableCell>
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
                    <Chip label={t.plan} color={PLAN_COLORS[t.plan] ?? 'default'} size="small" />
                  </TableCell>
                  <TableCell>{t.ownerEmail}</TableCell>
                  <TableCell>
                    <Chip
                      label={t.isActive ? 'Active' : 'Inactive'}
                      color={t.isActive ? 'success' : 'error'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell align="center">
                    <Tooltip title="Edit plan">
                      <IconButton size="small" onClick={() => handleOpenEditPlan(t)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="View stats">
                      <IconButton size="small" onClick={() => handleStats(t)}>
                        <BarChartIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t.isActive ? 'Deactivate' : 'Activate'}>
                      <IconButton size="small" onClick={() => handleToggle(t)}>
                        {t.isActive ? <BlockIcon fontSize="small" color="error" /> : <CheckCircleIcon fontSize="small" color="success" />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Open tenant app">
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
                  <TableCell colSpan={7} align="center">No tenants yet. Create your first one!</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create Tenant Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Tenant</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          {createError && <Alert severity="error">{createError}</Alert>}
          <TextField label="Hotel / Property Name" value={form.name} onChange={fieldChange('name')} required fullWidth />
          <TextField
            label="Slug (subdomain)"
            value={form.slug}
            onChange={fieldChange('slug')}
            helperText="Used as subdomain: {slug}.pilloto.com — lowercase letters, numbers, hyphens only"
            required fullWidth
          />
          <TextField select label="Plan" value={form.plan} onChange={fieldChange('plan')} fullWidth>
            {['basic', 'pro', 'enterprise'].map(p => (
              <MenuItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</MenuItem>
            ))}
          </TextField>
          <TextField label="Owner Email" type="email" value={form.ownerEmail} onChange={fieldChange('ownerEmail')} required fullWidth />
          <Box display="flex" gap={2}>
            <TextField label="Admin First Name" value={form.adminFirstName} onChange={fieldChange('adminFirstName')} required fullWidth />
            <TextField label="Admin Last Name" value={form.adminLastName} onChange={fieldChange('adminLastName')} required fullWidth />
          </Box>
          <TextField
            label="Initial Admin Password"
            type="password"
            value={form.adminPassword}
            onChange={fieldChange('adminPassword')}
            helperText="The tenant admin will use this to log in for the first time"
            required fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={16} /> : undefined}
          >
            Create & Provision
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Plan Dialog */}
      <Dialog open={editPlanOpen} onClose={() => setEditPlanOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Change Plan — {editingTenant?.name}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            select
            label="Plan"
            value={editPlanValue}
            onChange={(e) => setEditPlanValue(e.target.value)}
            fullWidth
          >
            {['basic', 'pro', 'enterprise'].map(p => (
              <MenuItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditPlanOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSavePlan}
            disabled={editPlanSaving}
            startIcon={editPlanSaving ? <CircularProgress size={16} /> : undefined}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Stats Dialog */}
      <Dialog open={statsOpen} onClose={() => setStatsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{stats?.tenant.name} — Stats</DialogTitle>
        <DialogContent>
          {stats && (
            <Box display="flex" flexDirection="column" gap={1} pt={1}>
              <Typography>Users: <strong>{stats.stats.users}</strong></Typography>
              <Typography>Reservations: <strong>{stats.stats.reservations}</strong></Typography>
              <Typography>Rooms: <strong>{stats.stats.rooms}</strong></Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </PlatformLayout>
  );
};

export default TenantsPage;
