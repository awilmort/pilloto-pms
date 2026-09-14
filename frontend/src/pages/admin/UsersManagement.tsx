import React, { useCallback, useEffect, useState } from 'react';
import {
  Container,
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import { useLocation } from 'react-router-dom';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminService, rolesService } from '../../services/api';
import { User, AppCode } from '../../types';
import { useTranslation } from 'react-i18next';
import { APP_METADATA, useAccessibleApps } from '../../lib/apps';
import { getAppFromPath } from '../../lib/permissions';

interface RoleOption {
  _id: string;
  name: string;
  description?: string;
}

interface AppRoleRowState {
  enabled: boolean;
  roleId: string;
}

type AppRolesFormState = Partial<Record<AppCode, AppRoleRowState>>;

function buildEmptyAppRolesForm(apps: AppCode[]): AppRolesFormState {
  const state: AppRolesFormState = {};
  for (const app of apps) state[app] = { enabled: false, roleId: '' };
  return state;
}

/**
 * Unwrapped users-management content — app-aware via `selectedApp`, defaulting to
 * whichever app the current route belongs to (`getAppFromPath`) so it opens on the
 * right scope whether rendered at `/admin/users` or embedded in `/accounting/settings`.
 * Exported separately from `UsersManagement` (below) so it can be embedded without
 * pulling in the pms-branded `AdminLayout`.
 */
export const UsersContent: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const accessibleApps = useAccessibleApps();
  const [selectedApp, setSelectedApp] = useState<AppCode>(() => getAppFromPath(location.pathname));

  // Keep the selection valid as accessibleApps resolves (starts empty before Auth/Tenant context load).
  useEffect(() => {
    if (accessibleApps.length && !accessibleApps.includes(selectedApp)) {
      setSelectedApp(accessibleApps[0]);
    }
  }, [accessibleApps, selectedApp]);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rolesByApp, setRolesByApp] = useState<Partial<Record<AppCode, RoleOption[]>>>({});

  const [editDialog, setEditDialog] = useState<{ open: boolean; user: User | null }>({ open: false, user: null });
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [editAppRoles, setEditAppRoles] = useState<AppRolesFormState>({});
  const [saving, setSaving] = useState<boolean>(false);

  const [createDialog, setCreateDialog] = useState<{ open: boolean }>({ open: false });
  const [createForm, setCreateForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [createAppRoles, setCreateAppRoles] = useState<AppRolesFormState>({});

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; user: User | null }>({ open: false, user: null });

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await adminService.getAllUsers({ limit: 50, app: selectedApp });
      const payload = response?.data?.data;
      if (payload && Array.isArray((payload as any).users)) {
        setUsers((payload as any).users as User[]);
      } else if (Array.isArray(payload)) {
        // Fallback if backend returns array directly
        setUsers(payload as unknown as User[]);
      } else {
        setUsers([]);
      }
    } catch (err: any) {
      console.error('Error loading users:', err);
      setError(err.response?.data?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [selectedApp]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Load role catalogs for every accessible app up front, so the Create/Edit dialogs
  // can render one row per app without an extra round trip on open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(accessibleApps.map(async (app) => {
        try {
          const res = await rolesService.getRoles(app);
          const data = res.data.data;
          const options: RoleOption[] = Array.isArray(data)
            ? data.map((r: any) => ({ _id: r._id, name: r.name, description: r.description }))
            : [];
          return [app, options] as const;
        } catch (e) {
          console.warn(`Failed to load ${app} roles`, e);
          return [app, [] as RoleOption[]] as const;
        }
      }));
      if (!cancelled) {
        setRolesByApp(Object.fromEntries(entries) as Partial<Record<AppCode, RoleOption[]>>);
      }
    })();
    return () => { cancelled = true; };
  }, [accessibleApps]);

  const roleNameForApp = (user: User, app: AppCode): string => {
    const assignment = user.appRoles?.find(ar => ar.app === app);
    if (assignment) {
      const role = (rolesByApp[app] || []).find(r => r._id === assignment.role);
      if (role) return role.name;
    }
    if (app === 'pms' && !assignment) return user.role;
    return '-';
  };

  const openEdit = (user: User) => {
    setEditDialog({ open: true, user });
    setProfileForm({ firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone || '' });
    const state: AppRolesFormState = {};
    for (const app of accessibleApps) {
      const assignment = user.appRoles?.find(ar => ar.app === app);
      state[app] = { enabled: !!assignment, roleId: assignment?.role || '' };
    }
    setEditAppRoles(state);
  };

  const toggleAppRow = (
    setter: React.Dispatch<React.SetStateAction<AppRolesFormState>>,
    app: AppCode,
    enabled: boolean
  ) => {
    setter(prev => ({ ...prev, [app]: { enabled, roleId: enabled ? (prev[app]?.roleId || '') : '' } }));
  };

  const setAppRoleId = (
    setter: React.Dispatch<React.SetStateAction<AppRolesFormState>>,
    app: AppCode,
    roleId: string
  ) => {
    setter(prev => ({ ...prev, [app]: { enabled: true, roleId } }));
  };

  const renderAppRoleRows = (
    formState: AppRolesFormState,
    setter: React.Dispatch<React.SetStateAction<AppRolesFormState>>
  ) => (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography variant="subtitle2" color="text.secondary">{t('admin.users.form.appAccess', 'App Access')}</Typography>
      {accessibleApps.map(app => {
        const row = formState[app] || { enabled: false, roleId: '' };
        const options = rolesByApp[app] || [];
        return (
          <Box key={app} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControlLabel
              sx={{ minWidth: 170, flexShrink: 0 }}
              control={<Checkbox checked={row.enabled} onChange={(e) => toggleAppRow(setter, app, e.target.checked)} />}
              label={APP_METADATA[app].name}
            />
            <FormControl size="small" fullWidth disabled={!row.enabled}>
              <InputLabel>{t('admin.users.form.role')}</InputLabel>
              <Select
                value={row.roleId}
                label={t('admin.users.form.role')}
                onChange={(e) => setAppRoleId(setter, app, String(e.target.value))}
              >
                {options.map(r => (
                  <MenuItem key={r._id} value={r._id}>{r.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        );
      })}
    </Box>
  );

  const validateAppRoles = (formState: AppRolesFormState): boolean => {
    for (const app of accessibleApps) {
      const row = formState[app];
      if (row?.enabled && !row.roleId) {
        setError(t('admin.users.messages.roleRequiredForApp', 'Select a role for every checked app.'));
        return false;
      }
    }
    return true;
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>
            {t('admin.users.loading')}
        </Typography>
      </Container>
    );
  }

  return (
      <Container maxWidth="xl" sx={{ pt: 0, pb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="body1" color="text.secondary">
              {t('admin.users.subtitle')}
          </Typography>
          <Button variant="contained" onClick={() => {
            setCreateForm({ firstName: '', lastName: '', email: '', phone: '', password: '' });
            setCreateAppRoles(buildEmptyAppRolesForm(accessibleApps));
            setCreateDialog({ open: true });
          }}>{t('admin.users.actions.createUser')}</Button>
        </Box>

        {accessibleApps.length > 1 && (
          <FormControl size="small" sx={{ mb: 3, minWidth: 220 }}>
            <InputLabel>{t('admin.users.form.app', 'App')}</InputLabel>
            <Select
              value={selectedApp}
              label={t('admin.users.form.app', 'App')}
              onChange={(e) => setSelectedApp(e.target.value as AppCode)}
            >
              {accessibleApps.map(app => (
                <MenuItem key={app} value={app}>{APP_METADATA[app].name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Paper sx={{ p: 3 }}>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                    <TableCell>{t('admin.users.table.name')}</TableCell>
                    <TableCell>{t('admin.users.table.email')}</TableCell>
                    <TableCell>{t('admin.users.table.phone')}</TableCell>
                    <TableCell>{t('admin.users.table.role')}</TableCell>
                    <TableCell align="right">{t('admin.users.table.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map(user => {
                  const roleName = roleNameForApp(user, selectedApp);
                  return (
                  <TableRow key={user._id}>
                    <TableCell>
                      {user.firstName} {user.lastName}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.phone || '-'}</TableCell>
                    <TableCell>
                      <Chip
                        label={roleName}
                        size="small"
                        color={roleName === 'admin' ? 'secondary' : roleName === 'staff' ? 'info' : roleName === 'maintenance' ? 'warning' : 'default'}
                        sx={{ textTransform: 'capitalize' }}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">
                        <Button size="small" onClick={() => openEdit(user)}>{t('admin.users.actions.edit')}</Button>
                        <Button size="small" color="error" onClick={() => setDeleteDialog({ open: true, user })}>{t('admin.users.actions.delete')}</Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          {users.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="body1" color="text.secondary">
                  {t('admin.users.messages.noUsers')}
              </Typography>
            </Box>
          )}
        </Paper>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, user: null })} maxWidth="xs" fullWidth>
            <DialogTitle>{t('admin.users.dialog.deleteConfirmTitle')}</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
                {t('admin.users.dialog.deleteConfirmPrompt', { name: deleteDialog.user ? `${deleteDialog.user.firstName} ${deleteDialog.user.lastName}` : t('admin.users.table.name') })}
            </Typography>
          </DialogContent>
          <DialogActions>
              <Button onClick={() => setDeleteDialog({ open: false, user: null })}>{t('admin.users.actions.cancel')}</Button>
            <Button
              variant="contained"
              color="error"
              onClick={async () => {
                if (!deleteDialog.user) return;
                try {
                  await adminService.deleteUser(deleteDialog.user._id);
                  setUsers(prev => prev.filter(u => u._id !== deleteDialog.user!._id));
                  setDeleteDialog({ open: false, user: null });
                } catch (e: any) {
                    setError(e.response?.data?.message || t('admin.users.messages.deleteFailed'));
                }
              }}
            >
                {t('admin.users.actions.delete')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Edit User Dialog */}
        <Dialog open={editDialog.open} onClose={() => setEditDialog({ open: false, user: null })} maxWidth="sm" fullWidth>
            <DialogTitle>{t('admin.users.dialog.editTitle')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
                <TextField label={t('admin.users.form.firstName')} value={profileForm.firstName} onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })} />
                <TextField label={t('admin.users.form.lastName')} value={profileForm.lastName} onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })} />
                <TextField label={t('admin.users.form.email')} value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} />
                <TextField label={t('admin.users.form.phone')} value={profileForm.phone || ''} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} />
              {renderAppRoleRows(editAppRoles, setEditAppRoles)}
            </Box>
          </DialogContent>
          <DialogActions>
              <Button onClick={() => setEditDialog({ open: false, user: null })}>{t('admin.users.actions.cancel')}</Button>
            <Button variant="contained" disabled={saving} onClick={async () => {
              if (!editDialog.user) return;
              if (!validateAppRoles(editAppRoles)) return;
              const targetUser = editDialog.user;
              try {
                setSaving(true);
                const profileRes = await adminService.updateUser(targetUser._id, {
                  firstName: profileForm.firstName,
                  lastName: profileForm.lastName,
                  email: profileForm.email,
                  phone: profileForm.phone,
                });
                let latest = profileRes.data.data as User;

                for (const app of accessibleApps) {
                  const row = editAppRoles[app] || { enabled: false, roleId: '' };
                  const original = targetUser.appRoles?.find(ar => ar.app === app);
                  const changed = row.enabled ? row.roleId !== (original?.role || '') : !!original;
                  if (!changed) continue;
                  const res = await adminService.updateUserRole(targetUser._id, row.enabled ? row.roleId : null, app);
                  latest = res.data.data as User;
                }

                setUsers(prev => prev.map(u => u._id === latest._id ? latest : u));
                setEditDialog({ open: false, user: null });
                setSaving(false);
              } catch (e: any) {
                  setError(e.response?.data?.message || t('admin.users.messages.updateFailed'));
                setSaving(false);
              }
            }}>{t('admin.users.actions.save')}</Button>
          </DialogActions>
        </Dialog>

        {/* Create User Dialog */}
        <Dialog open={createDialog.open} onClose={() => setCreateDialog({ open: false })} maxWidth="sm" fullWidth>
            <DialogTitle>{t('admin.users.dialog.createTitle')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
                <TextField label={t('admin.users.form.firstName')} value={createForm.firstName} onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })} />
                <TextField label={t('admin.users.form.lastName')} value={createForm.lastName} onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })} />
                <TextField label={t('admin.users.form.email')} value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
                <TextField label={t('admin.users.form.phone')} value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} />
                <TextField label={t('admin.users.form.password')} type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
              {renderAppRoleRows(createAppRoles, setCreateAppRoles)}
            </Box>
          </DialogContent>
          <DialogActions>
              <Button onClick={() => setCreateDialog({ open: false })}>{t('admin.users.actions.cancel')}</Button>
              <Button variant="contained" onClick={async () => {
              if (!validateAppRoles(createAppRoles)) return;
              try {
                const res = await adminService.createUser({
                  firstName: createForm.firstName,
                  lastName: createForm.lastName,
                  email: createForm.email,
                  phone: createForm.phone,
                  password: createForm.password,
                });
                let created = res.data.data as User;

                for (const app of accessibleApps) {
                  const row = createAppRoles[app];
                  if (row?.enabled && row.roleId) {
                    const roleRes = await adminService.updateUserRole(created._id, row.roleId, app);
                    created = roleRes.data.data as User;
                  }
                }

                setUsers(prev => [created, ...prev]);
                setCreateDialog({ open: false });
                setCreateForm({ firstName: '', lastName: '', email: '', phone: '', password: '' });
                setCreateAppRoles(buildEmptyAppRolesForm(accessibleApps));
              } catch (e: any) {
                  setError(e.response?.data?.message || t('admin.users.messages.createFailed'));
              }
              }}>{t('admin.users.actions.createUser')}</Button>
          </DialogActions>
        </Dialog>
      </Container>
  );
};

const UsersManagement: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AdminLayout title={t('admin.users.title')}>
      <UsersContent />
    </AdminLayout>
  );
};

export default UsersManagement;
