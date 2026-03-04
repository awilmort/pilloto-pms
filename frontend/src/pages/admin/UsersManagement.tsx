import React, { useEffect, useState } from 'react';
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
} from '@mui/material';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import { adminService, rolesService } from '../../services/api';
import { User } from '../../types';
  import { useTranslation } from 'react-i18next';

const UsersManagement: React.FC = () => {
    const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<{ _id: string; name: string; description?: string }[]>([]);
  const [editDialog, setEditDialog] = useState<{ open: boolean; user: User | null }>({ open: false, user: null });
  const [editForm, setEditForm] = useState<{ firstName: string; lastName: string; email: string; phone?: string; role: string }>({ firstName: '', lastName: '', email: '', phone: '', role: 'customer' });
  const [saving, setSaving] = useState<boolean>(false);
  const [createDialog, setCreateDialog] = useState<{ open: boolean }>({ open: false });
  const [createForm, setCreateForm] = useState({ firstName: '', lastName: '', email: '', phone: '', role: 'customer', password: '' });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; user: User | null }>({ open: false, user: null });

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await adminService.getAllUsers({ limit: 50 });
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
  };

  useEffect(() => {
    loadUsers();
    (async () => {
      try {
        const res = await rolesService.getRoles();
        const data = res.data.data;
        if (Array.isArray(data)) setRoles(data.map((r: any) => ({ _id: r._id, name: r.name, description: r.description })));
      } catch (e) {
        console.warn('Failed to load roles', e);
      }
    })();
  }, []);

  if (loading) {
    return (
      <AdminLayout>
        <Container maxWidth="lg" sx={{ py: 8, textAlign: 'center' }}>
          <CircularProgress size={60} />
          <Typography variant="h6" sx={{ mt: 2 }}>
              {t('admin.users.loading')}
          </Typography>
        </Container>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box sx={{ mb: 2 }}>
          <SectionTitle
            title={t('admin.users.title')}
            right={<Button variant="contained" onClick={() => setCreateDialog({ open: true })}>{t('admin.users.actions.createUser')}</Button>}
          />
          <Typography variant="body1" color="text.secondary">
              {t('admin.users.subtitle')}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
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
                  {/* Status column intentionally omitted (not in User type) */}
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map(user => (
                  <TableRow key={user._id}>
                    <TableCell>
                      {user.firstName} {user.lastName}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.phone || '-'}</TableCell>
                    <TableCell>
                      <Chip
                        label={user.role}
                        size="small"
                        color={user.role === 'admin' ? 'secondary' : user.role === 'staff' ? 'info' : user.role === 'maintenance' ? 'warning' : 'default'}
                        sx={{ textTransform: 'capitalize' }}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">
                        <Button size="small" onClick={() => { setEditDialog({ open: true, user }); setEditForm({ firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone || '', role: user.role }); }}>{t('admin.users.actions.edit')}</Button>
                        <Button size="small" color="error" onClick={() => setDeleteDialog({ open: true, user })}>{t('admin.users.actions.delete')}</Button>
                    </TableCell>
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
                    {/* No explicit status in User type; omit for now */}
                  </TableRow>
                ))}
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

        {/* Edit Role Dialog */}
        <Dialog open={editDialog.open} onClose={() => setEditDialog({ open: false, user: null })} maxWidth="sm" fullWidth>
            <DialogTitle>{t('admin.users.dialog.editTitle')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
                <TextField label={t('admin.users.form.firstName')} value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                <TextField label={t('admin.users.form.lastName')} value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
                <TextField label={t('admin.users.form.email')} value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                <TextField label={t('admin.users.form.phone')} value={editForm.phone || ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              <FormControl fullWidth>
                  <InputLabel>{t('admin.users.form.role')}</InputLabel>
                  <Select value={editForm.role} label={t('admin.users.form.role')} onChange={(e) => setEditForm({ ...editForm, role: String(e.target.value) })}>
                  {roles.map(r => (
                    <MenuItem key={r._id} value={r.name}>{r.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </DialogContent>
          <DialogActions>
              <Button onClick={() => setEditDialog({ open: false, user: null })}>{t('admin.users.actions.cancel')}</Button>
            <Button variant="contained" disabled={saving} onClick={async () => {
              if (!editDialog.user) return;
              try {
                setSaving(true);
                const targetRole = String(editForm.role).toLowerCase();
                const valid = roles.some(r => r.name.toLowerCase() === targetRole);
                if (!valid) {
                    setError(`${t('admin.users.form.role')}: ${editForm.role}`);
                  setSaving(false);
                  return;
                }
                const payload = { ...editForm, role: targetRole };
                const res = await adminService.updateUser(editDialog.user._id, payload);
                const updated = res.data.data as User;
                setUsers(prev => prev.map(u => u._id === updated._id ? updated : u));
                setEditDialog({ open: false, user: null });
                setSaving(false);
              } catch (e: any) {
                  setError(e.response?.data?.message || t('admin.users.messages.updateFailed'));
                setSaving(false);
              }
            }}>Save</Button>
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
              <FormControl fullWidth>
                  <InputLabel>{t('admin.users.form.role')}</InputLabel>
                  <Select value={createForm.role} label={t('admin.users.form.role')} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}>
                  {roles.map(r => (
                    <MenuItem key={r._id} value={r.name}>{r.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
                <TextField label={t('admin.users.form.password')} type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
            </Box>
          </DialogContent>
          <DialogActions>
              <Button onClick={() => setCreateDialog({ open: false })}>{t('admin.users.actions.cancel')}</Button>
              <Button variant="contained" onClick={async () => {
              try {
                const res = await adminService.createUser(createForm as any);
                const created = res.data.data as User;
                setUsers(prev => [created, ...prev]);
                setCreateDialog({ open: false });
                setCreateForm({ firstName: '', lastName: '', email: '', phone: '', role: 'customer', password: '' });
              } catch (e: any) {
                  setError(e.response?.data?.message || t('admin.users.messages.createFailed'));
              }
              }}>{t('admin.users.actions.createUser')}</Button>
          </DialogActions>
        </Dialog>
      </Container>
    </AdminLayout>
  );
};

export default UsersManagement;
