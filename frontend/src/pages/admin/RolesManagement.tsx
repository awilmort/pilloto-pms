import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { useLocation } from 'react-router-dom';
import SectionTitle from '../../components/admin/SectionTitle';
import { rolesService, adminService } from '../../services/api';
import { getAppFromPath } from '../../lib/permissions';
import { useTranslation } from 'react-i18next';
import { AppCode } from '../../types';
import { APP_METADATA, useAccessibleApps } from '../../lib/apps';

/**
 * Curated translation-key lookup for pms permissions. Anything not listed
 * here — every accounting permission today, plus any pms permission added
 * to the backend catalog before a matching label is authored — falls back
 * to `humanizePermission` below, so the checkbox list always reflects the
 * live, canonical `PERMISSIONS_BY_APP` catalog even when a label lags it.
 */
const PMS_PERMISSION_LABEL_KEYS: Record<string, string> = {
  'admin.access': 'admin.roles.permissionLabels.adminAccess',
  'admin.dashboard': 'admin.nav.dashboard',
  'admin.schedule': 'admin.nav.schedule',
  'admin.accommodations': 'admin.nav.accommodations',
  'admin.rooms': 'admin.nav.rooms',
  'admin.amenities': 'admin.nav.amenities',
  'admin.eventTypes': 'admin.nav.eventTypes',
  'admin.pricing': 'admin.nav.pricing',
  'admin.reservations': 'admin.nav.reservations',
  'admin.reservations.assignRoom': 'admin.roles.permissionLabels.reservationsAssignRoom',
  'admin.reservations.managePayments': 'admin.roles.permissionLabels.reservationsManagePayments',
  'admin.reservations.priceUpdate': 'admin.roles.permissionLabels.reservationsPriceUpdate',
  'admin.reservations.amountUpdate': 'admin.roles.permissionLabels.reservationsAmountUpdate',
  'admin.reservations.discount': 'admin.roles.permissionLabels.reservationsDiscount',
  'admin.reservations.checkin': 'admin.roles.permissionLabels.reservationsCheckIn',
  'admin.reservations.cancel': 'admin.roles.permissionLabels.reservationsCancel',
  'admin.reservations.assignCorporatePrice': 'admin.roles.permissionLabels.reservationsAssignCorporatePrice',
  'admin.users': 'admin.nav.users',
  'admin.roles': 'admin.nav.roles',
  'admin.media': 'admin.nav.media',
  'admin.wristbands.view': 'admin.roles.permissionLabels.wristbandsView',
  'admin.wristbands.manage': 'admin.roles.permissionLabels.wristbandsManage',
  'admin.settings': 'admin.nav.settings',
  'admin.revenue': 'admin.nav.revenue',
  'admin.commissions': 'admin.nav.commissions',
  salesman: 'admin.roles.permissionLabels.salesman',
  'admin.companies': 'admin.nav.companies',
  'admin.guests': 'admin.nav.guests',
  'admin.creditAccounts': 'admin.nav.creditAccounts',
  cashier: 'admin.roles.permissionLabels.cashier',
  'admin.ota.view': 'admin.roles.permissionLabels.otaView',
  'admin.ota.manage': 'admin.roles.permissionLabels.otaManage',
  'admin.ota.resolve': 'admin.roles.permissionLabels.otaResolve',
  'admin.ecf.view': 'admin.nav.ecfInvoices',
};

function humanizeSegment(segment: string): string {
  const spaced = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Best-effort label for a permission with no curated entry above. */
function humanizePermission(perm: string, app: AppCode): string {
  let parts = perm.split('.');
  if (parts[0] === app) parts = parts.slice(1);
  if (parts.length <= 1) return humanizeSegment(parts[0] || perm);
  return `${humanizeSegment(parts[0])}: ${parts.slice(1).map(humanizeSegment).join(' ')}`;
}

const GENERAL_GROUP = '__general__';

/** Groups a permission catalog by its leading segment (after stripping the app prefix). Single-segment permissions (e.g. `accounting.access`, `cashier`) land in "General". */
function groupPermission(perm: string, app: AppCode): string {
  let parts = perm.split('.');
  if (parts[0] === app) parts = parts.slice(1);
  if (parts.length <= 1) return GENERAL_GROUP;
  return humanizeSegment(parts[0]);
}

interface RoleItem {
  _id: string;
  name: string;
  app?: AppCode;
  description?: string;
  permissions: string[];
  discountLimit?: number;
}

interface RoleFormState {
  name: string;
  description: string;
  permissions: string[];
  discountLimit: string;
}

const EMPTY_FORM: RoleFormState = { name: '', description: '', permissions: [], discountLimit: '' };

export const RolesContent: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const accessibleApps = useAccessibleApps();
  const [selectedApp, setSelectedApp] = useState<AppCode>(() => getAppFromPath(location.pathname));

  // Keep the selection valid as accessibleApps resolves (starts empty before AuthContext/TenantContext load).
  useEffect(() => {
    if (accessibleApps.length && !accessibleApps.includes(selectedApp)) {
      setSelectedApp(accessibleApps[0]);
    }
  }, [accessibleApps, selectedApp]);

  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [editDialog, setEditDialog] = useState<{ open: boolean; role: RoleItem | null }>({ open: false, role: null });
  const [editForm, setEditForm] = useState<RoleFormState>(EMPTY_FORM);

  const [createDialog, setCreateDialog] = useState<{ open: boolean }>({ open: false });
  const [createForm, setCreateForm] = useState<RoleFormState>(EMPTY_FORM);

  const loadRoles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [rolesRes, permsRes] = await Promise.all([
        rolesService.getRoles(selectedApp),
        adminService.getPermissions(selectedApp),
      ]);
      const data = rolesRes.data.data;
      if (Array.isArray(data)) setRoles(data);
      const perms = permsRes.data.data;
      if (Array.isArray(perms)) setCatalog(perms);
    } catch (e: any) {
      setError(e.response?.data?.message || t('admin.roles.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [selectedApp, t]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const perm of catalog) {
      const g = groupPermission(perm, selectedApp);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(perm);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === GENERAL_GROUP) return -1;
      if (b === GENERAL_GROUP) return 1;
      return a.localeCompare(b);
    });
  }, [catalog, selectedApp]);

  const permissionLabel = useCallback(
    (perm: string) => {
      const key = selectedApp === 'pms' ? PMS_PERMISSION_LABEL_KEYS[perm] : undefined;
      return key ? t(key) : humanizePermission(perm, selectedApp);
    },
    [selectedApp, t]
  );

  const startEdit = (role: RoleItem) => {
    setEditDialog({ open: true, role });
    setEditForm({ name: role.name, description: role.description || '', permissions: role.permissions || [], discountLimit: String(role.discountLimit ?? '') });
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

  const renderGroupedCheckboxes = (form: 'edit' | 'create', formState: RoleFormState) => (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {groupedCatalog.map(([group, perms]) => (
        <Box key={group}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            {group === GENERAL_GROUP ? t('admin.roles.permissionGroups.general', 'General') : group}
          </Typography>
          <Box sx={{ display: 'grid', gap: 0.5, pl: 1 }}>
            {perms.map(p => (
              <FormControlLabel
                key={p}
                control={<Checkbox checked={formState.permissions.includes(p)} onChange={() => togglePermission(form, p)} />}
                label={permissionLabel(p)}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );

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
            right={<Button variant="contained" onClick={() => { setCreateForm(EMPTY_FORM); setCreateDialog({ open: true }); }}>{t('admin.roles.actions.createRole')}</Button>}
          />
          <Typography variant="body1" color="text.secondary">{t('admin.roles.subtitle')}</Typography>
        </Box>

        {accessibleApps.length > 1 && (
          <FormControl size="small" sx={{ mb: 3, minWidth: 220 }}>
            <InputLabel>{t('admin.roles.form.app', 'App')}</InputLabel>
            <Select
              value={selectedApp}
              label={t('admin.roles.form.app', 'App')}
              onChange={(e) => setSelectedApp(e.target.value as AppCode)}
            >
              {accessibleApps.map(app => (
                <MenuItem key={app} value={app}>{APP_METADATA[app].name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

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
              {renderGroupedCheckboxes('edit', editForm)}
              {editForm.permissions.includes('admin.reservations.discount') && (
                <TextField
                  label={t('admin.roles.form.discountLimit', 'Max Discount (%)')}
                  type="number"
                  value={editForm.discountLimit}
                  onChange={(e) => setEditForm({ ...editForm, discountLimit: e.target.value })}
                  onBlur={() => {
                    const clamped = Math.min(100, Math.max(0, parseFloat(editForm.discountLimit) || 0));
                    setEditForm(prev => ({ ...prev, discountLimit: String(clamped) }));
                  }}
                  inputProps={{ min: 0, max: 100, step: 1 }}
                  helperText={t('admin.roles.form.discountLimitHint', 'Maximum percentage this role can discount (0–100)')}
                />
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditDialog({ open: false, role: null })}>{t('admin.roles.actions.cancel')}</Button>
            <Button variant="contained" onClick={async () => {
              if (!editDialog.role) return;
              try {
                const res = await rolesService.updateRole(editDialog.role._id, { name: editForm.name, description: editForm.description, permissions: editForm.permissions, discountLimit: parseFloat(editForm.discountLimit) || 0 });
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
              {renderGroupedCheckboxes('create', createForm)}
              {createForm.permissions.includes('admin.reservations.discount') && (
                <TextField
                  label={t('admin.roles.form.discountLimit', 'Max Discount (%)')}
                  type="number"
                  value={createForm.discountLimit}
                  onChange={(e) => setCreateForm({ ...createForm, discountLimit: e.target.value })}
                  onBlur={() => {
                    const clamped = Math.min(100, Math.max(0, parseFloat(createForm.discountLimit) || 0));
                    setCreateForm(prev => ({ ...prev, discountLimit: String(clamped) }));
                  }}
                  inputProps={{ min: 0, max: 100, step: 1 }}
                  helperText={t('admin.roles.form.discountLimitHint', 'Maximum percentage this role can discount (0–100)')}
                />
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDialog({ open: false })}>{t('admin.roles.actions.cancel')}</Button>
            <Button variant="contained" onClick={async () => {
              try {
                const res = await rolesService.createRole({ name: createForm.name, description: createForm.description, permissions: createForm.permissions, discountLimit: parseFloat(createForm.discountLimit) || 0, app: selectedApp });
                const created = res.data.data as RoleItem;
                setRoles(prev => [created, ...prev]);
                setCreateDialog({ open: false });
                setCreateForm(EMPTY_FORM);
              } catch (e: any) {
                setError(e.response?.data?.message || t('admin.roles.messages.createFailed'));
              }
            }}>{t('admin.roles.actions.create')}</Button>
          </DialogActions>
        </Dialog>
    </>
  );
};
