import React, { useCallback, useEffect, useState } from 'react';
import {
  Typography,
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import SectionTitle from '../../components/admin/SectionTitle';
import { rolesService } from '../../services/api';
import { useTranslation } from 'react-i18next';

const buildAvailablePermissions = (t: (key: string) => string) => ([
  { key: 'admin.access', label: t('admin.roles.permissionLabels.adminAccess') },
  { key: 'admin.dashboard', label: t('admin.nav.dashboard') },
  { key: 'admin.schedule', label: t('admin.nav.schedule') },
  { key: 'admin.accommodations', label: t('admin.nav.accommodations') },
  { key: 'admin.rooms', label: t('admin.nav.rooms') },
  { key: 'admin.amenities', label: t('admin.nav.amenities') },
  { key: 'admin.eventTypes', label: t('admin.nav.eventTypes') },
  { key: 'admin.pricing', label: t('admin.nav.pricing') },
  { key: 'admin.reservations', label: t('admin.nav.reservations') },
  { key: 'admin.reservations.assignRoom', label: t('admin.roles.permissionLabels.reservationsAssignRoom') },
  { key: 'admin.reservations.managePayments', label: t('admin.roles.permissionLabels.reservationsManagePayments') },
  { key: 'admin.reservations.priceUpdate', label: t('admin.roles.permissionLabels.reservationsPriceUpdate') },
  { key: 'admin.reservations.amountUpdate', label: t('admin.roles.permissionLabels.reservationsAmountUpdate') },
  { key: 'admin.reservations.checkin', label: t('admin.roles.permissionLabels.reservationsCheckIn') },
  { key: 'admin.reservations.cancel', label: t('admin.roles.permissionLabels.reservationsCancel') },
  { key: 'admin.users', label: t('admin.nav.users') },
  { key: 'admin.roles', label: t('admin.nav.roles') },
  { key: 'admin.media', label: t('admin.nav.media') },
  { key: 'admin.wristbands.view', label: t('admin.roles.permissionLabels.wristbandsView') },
  { key: 'admin.wristbands.manage', label: t('admin.roles.permissionLabels.wristbandsManage') },
  { key: 'admin.settings', label: t('admin.nav.settings') },
  { key: 'admin.revenue', label: t('admin.nav.revenue') },
  { key: 'admin.commissions', label: t('admin.nav.commissions') },
  { key: 'salesman', label: t('admin.roles.permissionLabels.salesman') },
  { key: 'admin.companies', label: t('admin.nav.companies') },
  { key: 'admin.companies.create', label: `${t('admin.nav.companies')} - Create` },
  { key: 'admin.companies.edit', label: `${t('admin.nav.companies')} - Edit` },
  { key: 'admin.guests', label: t('admin.nav.guests') },
  { key: 'admin.guests.create', label: `${t('admin.nav.guests')} - Create` },
  { key: 'admin.guests.edit', label: `${t('admin.nav.guests')} - Edit` },
  { key: 'admin.creditAccounts', label: t('admin.nav.creditAccounts') },
  { key: 'admin.creditAccounts.create', label: t('admin.roles.permissionLabels.creditAccountsCreate') },
  { key: 'admin.creditAccounts.edit', label: t('admin.roles.permissionLabels.creditAccountsEdit') },
  { key: 'cashier', label: t('admin.roles.permissionLabels.cashier') },
]);

interface RoleItem {
  _id: string;
  name: string;
  description?: string;
  permissions: string[];
}

export const RolesContent: React.FC = () => {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [editDialog, setEditDialog] = useState<{ open: boolean; role: RoleItem | null }>({ open: false, role: null });
  const [editForm, setEditForm] = useState<{ name: string; description: string; permissions: string[] }>({ name: '', description: '', permissions: [] });

  const [createDialog, setCreateDialog] = useState<{ open: boolean }>({ open: false });
  const [createForm, setCreateForm] = useState<{ name: string; description: string; permissions: string[] }>({ name: '', description: '', permissions: [] });

  const loadRoles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await rolesService.getRoles();
      const data = res.data.data;
      if (Array.isArray(data)) setRoles(data);
    } catch (e: any) {
      setError(e.response?.data?.message || t('admin.roles.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const startEdit = (role: RoleItem) => {
    setEditDialog({ open: true, role });
    setEditForm({ name: role.name, description: role.description || '', permissions: role.permissions || [] });
  };

  const togglePermission = (form: 'edit' | 'create', key: string) => {
    if (form === 'edit') {
      setEditForm(prev => {
        const exists = prev.permissions.includes(key);
        return { ...prev, permissions: exists ? prev.permissions.filter(p => p !== key) : [...prev.permissions, key] };
      });
    } else {
      setCreateForm(prev => {
        const exists = prev.permissions.includes(key);
        return { ...prev, permissions: exists ? prev.permissions.filter(p => p !== key) : [...prev.permissions, key] };
      });
    }
  };

  if (loading) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>{t('admin.roles.loading')}</Typography>
      </Box>
    );
  }

  return (
    <>
        <Box sx={{ mb: 3 }}>
          <SectionTitle
            title={t('admin.roles.title')}
            right={<Button variant="contained" onClick={() => setCreateDialog({ open: true })}>{t('admin.roles.actions.createRole')}</Button>}
          />
          <Typography variant="body1" color="text.secondary">{t('admin.roles.subtitle')}</Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>
        )}

        <Paper sx={{ p: 3 }}>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('admin.roles.table.name')}</TableCell>
                  <TableCell>{t('admin.roles.table.description')}</TableCell>
                  <TableCell>{t('admin.roles.table.permissions')}</TableCell>
                  <TableCell align="right">{t('admin.roles.table.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {roles.map(role => (
                  <TableRow key={role._id}>
                    <TableCell sx={{ textTransform: 'capitalize' }}>{role.name}</TableCell>
                    <TableCell>{role.description || '-'}</TableCell>
                    <TableCell>
                      {(role.permissions || []).map(p => (
                        <Chip key={p} label={p} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                      ))}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => startEdit(role)}>{t('admin.roles.actions.edit')}</Button>
                      <Button size="small" color="error" onClick={async () => {
                        try {
                          await rolesService.deleteRole(role._id);
                          setRoles(prev => prev.filter(r => r._id !== role._id));
                        } catch (e: any) {
                          setError(e.response?.data?.message || t('admin.roles.messages.deleteFailed'));
                        }
                      }}>{t('admin.roles.actions.delete')}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {roles.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="body1" color="text.secondary">{t('admin.roles.empty')}</Typography>
            </Box>
          )}
        </Paper>

        {/* Edit Role Dialog */}
        <Dialog open={editDialog.open} onClose={() => setEditDialog({ open: false, role: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{t('admin.roles.dialog.editTitle')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              <TextField label={t('admin.roles.form.name')} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              <TextField label={t('admin.roles.form.description')} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              <Box sx={{ display: 'grid', gap: 1 }}>
                {buildAvailablePermissions(t).map(p => (
                  <FormControlLabel
                    key={p.key}
                    control={<Checkbox checked={editForm.permissions.includes(p.key)} onChange={() => togglePermission('edit', p.key)} />}
                    label={p.label}
                  />
                ))}
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditDialog({ open: false, role: null })}>{t('admin.roles.actions.cancel')}</Button>
            <Button variant="contained" onClick={async () => {
              if (!editDialog.role) return;
              try {
                const res = await rolesService.updateRole(editDialog.role._id, { name: editForm.name, description: editForm.description, permissions: editForm.permissions });
                const updated = res.data.data as RoleItem;
                setRoles(prev => prev.map(r => r._id === updated._id ? updated : r));
                setEditDialog({ open: false, role: null });
              } catch (e: any) {
                setError(e.response?.data?.message || t('admin.roles.messages.updateFailed'));
              }
            }}>{t('admin.roles.actions.save')}</Button>
          </DialogActions>
        </Dialog>

        {/* Create Role Dialog */}
        <Dialog open={createDialog.open} onClose={() => setCreateDialog({ open: false })} maxWidth="sm" fullWidth>
          <DialogTitle>{t('admin.roles.dialog.createTitle')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              <TextField label={t('admin.roles.form.name')} value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
              <TextField label={t('admin.roles.form.description')} value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} />
              <Box sx={{ display: 'grid', gap: 1 }}>
                {buildAvailablePermissions(t).map(p => (
                  <FormControlLabel
                    key={p.key}
                    control={<Checkbox checked={createForm.permissions.includes(p.key)} onChange={() => togglePermission('create', p.key)} />}
                    label={p.label}
                  />
                ))}
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDialog({ open: false })}>{t('admin.roles.actions.cancel')}</Button>
            <Button variant="contained" onClick={async () => {
              try {
                const res = await rolesService.createRole({ name: createForm.name, description: createForm.description, permissions: createForm.permissions });
                const created = res.data.data as RoleItem;
                setRoles(prev => [created, ...prev]);
                setCreateDialog({ open: false });
                setCreateForm({ name: '', description: '', permissions: [] });
              } catch (e: any) {
                setError(e.response?.data?.message || t('admin.roles.messages.createFailed'));
              }
            }}>{t('admin.roles.actions.create')}</Button>
          </DialogActions>
        </Dialog>
    </>
  );
};

