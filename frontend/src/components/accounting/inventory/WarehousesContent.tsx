import React, { useCallback, useEffect, useState } from 'react';
import {
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
  Tooltip,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import StarIcon from '@mui/icons-material/Star';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../../../lib/permissions';
import { warehousesService } from '../../../services/api';
import { Warehouse } from '../../../types';

interface WarehouseFormState {
  name: string;
  code: string;
  address: string;
  notes: string;
}

const emptyForm: WarehouseFormState = { name: '', code: '', address: '', notes: '' };

const WarehousesContent: React.FC = () => {
  const { t } = useTranslation();
  const canManage = usePermission('accounting.inventory.manage');

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState<boolean>(false);

  const [editDialog, setEditDialog] = useState<{ open: boolean; warehouse: Warehouse | null }>({ open: false, warehouse: null });
  const [editForm, setEditForm] = useState<WarehouseFormState>(emptyForm);
  const [createDialog, setCreateDialog] = useState<boolean>(false);
  const [createForm, setCreateForm] = useState<WarehouseFormState>(emptyForm);
  const [actionMenu, setActionMenu] = useState<{ anchorEl: HTMLElement | null; warehouse: Warehouse | null }>({ anchorEl: null, warehouse: null });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await warehousesService.getWarehouses({ active: showInactive ? 'all' : true });
      setWarehouses(Array.isArray(res.data.data) ? res.data.data : []);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.warehouses.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [showInactive, t]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (warehouse: Warehouse) => {
    setEditDialog({ open: true, warehouse });
    setEditForm({
      name: warehouse.name,
      code: warehouse.code,
      address: warehouse.address || '',
      notes: warehouse.notes || '',
    });
  };

  const setDefault = async (warehouse: Warehouse) => {
    try {
      const res = await warehousesService.updateWarehouse(warehouse._id, { isDefault: true });
      const updated = res.data.data as Warehouse;
      setWarehouses(prev => prev.map(w => (w._id === updated._id ? updated : { ...w, isDefault: false })));
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.warehouses.messages.setDefaultFailed'));
    }
  };

  if (loading && warehouses.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>{t('accounting.warehouses.loading')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="small" onClick={() => setShowInactive(v => !v)}>
            {showInactive ? t('accounting.warehouses.actions.hideArchived') : t('accounting.warehouses.actions.showArchived')}
          </Button>
          {canManage && (
            <Button variant="contained" onClick={() => { setCreateForm(emptyForm); setCreateDialog(true); }} sx={{ ml: 'auto' }}>
              {t('accounting.warehouses.actions.create')}
            </Button>
          )}
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.warehouses.table.name')}</TableCell>
                <TableCell>{t('accounting.warehouses.table.code')}</TableCell>
                <TableCell>{t('accounting.warehouses.table.address')}</TableCell>
                <TableCell>{t('accounting.warehouses.table.status')}</TableCell>
                {canManage && <TableCell align="right">{t('accounting.warehouses.table.actions')}</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {warehouses.map(warehouse => (
                <TableRow key={warehouse._id}>
                  <TableCell>
                    {warehouse.name}
                    {warehouse.isDefault && (
                      <Chip size="small" label={t('accounting.warehouses.status.default')} color="primary" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell>{warehouse.code}</TableCell>
                  <TableCell>{warehouse.address || '-'}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={warehouse.isActive ? t('accounting.warehouses.status.active') : t('accounting.warehouses.status.archived')}
                      color={warehouse.isActive ? 'success' : 'default'}
                    />
                  </TableCell>
                  {canManage && (
                    <TableCell align="right">
                      {!warehouse.isDefault && warehouse.isActive && (
                        <Tooltip title={t('accounting.warehouses.actions.setDefault')}>
                          <IconButton size="small" onClick={() => setDefault(warehouse)}>
                            <StarIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title={t('accounting.warehouses.actions.edit')}>
                        <IconButton size="small" onClick={() => startEdit(warehouse)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {warehouse.isActive && (
                        <IconButton size="small" onClick={(e) => setActionMenu({ anchorEl: e.currentTarget, warehouse })}>
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {warehouses.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="body1" color="text.secondary">{t('accounting.warehouses.empty')}</Typography>
          </Box>
        )}
      </Paper>

      {/* Row action overflow menu */}
      <Menu
        anchorEl={actionMenu.anchorEl}
        open={Boolean(actionMenu.anchorEl)}
        onClose={() => setActionMenu({ anchorEl: null, warehouse: null })}
      >
        <Tooltip title={actionMenu.warehouse?.isDefault ? t('accounting.warehouses.messages.cannotArchiveDefault') : ''} placement="left">
          <span>
            <MenuItem
              disabled={actionMenu.warehouse?.isDefault}
              sx={{ color: 'error.main' }}
              onClick={async () => {
                const w = actionMenu.warehouse;
                setActionMenu({ anchorEl: null, warehouse: null });
                if (!w) return;
                try {
                  await warehousesService.archiveWarehouse(w._id);
                  setWarehouses(prev => prev.map(item => item._id === w._id ? { ...item, isActive: false } : item));
                } catch (e: any) {
                  setError(e.response?.data?.message || t('accounting.warehouses.messages.archiveFailed'));
                }
              }}
            >
              <ListItemIcon><ArchiveIcon fontSize="small" color="error" /></ListItemIcon>
              <ListItemText>{t('accounting.warehouses.actions.archive')}</ListItemText>
            </MenuItem>
          </span>
        </Tooltip>
      </Menu>

      {/* Edit Warehouse Dialog */}
      <Dialog open={editDialog.open} onClose={() => setEditDialog({ open: false, warehouse: null })} maxWidth="sm" fullWidth>
        <DialogTitle>{t('accounting.warehouses.dialog.editTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField label={t('accounting.warehouses.form.name')} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            <TextField label={t('accounting.warehouses.form.code')} value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value.toUpperCase() })} required />
            <TextField label={t('accounting.warehouses.form.address')} value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            <TextField label={t('accounting.warehouses.form.notes')} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} multiline minRows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog({ open: false, warehouse: null })}>{t('accounting.warehouses.actions.cancel')}</Button>
          <Button variant="contained" disabled={!editForm.name || !editForm.code} onClick={async () => {
            if (!editDialog.warehouse) return;
            try {
              const res = await warehousesService.updateWarehouse(editDialog.warehouse._id, editForm);
              const updated = res.data.data as Warehouse;
              setWarehouses(prev => prev.map(w => w._id === updated._id ? updated : w));
              setEditDialog({ open: false, warehouse: null });
            } catch (e: any) {
              setError(e.response?.data?.message || t('accounting.warehouses.messages.updateFailed'));
            }
          }}>{t('accounting.warehouses.actions.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Create Warehouse Dialog */}
      <Dialog open={createDialog} onClose={() => setCreateDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('accounting.warehouses.dialog.createTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField label={t('accounting.warehouses.form.name')} value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} required />
            <TextField label={t('accounting.warehouses.form.code')} value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value.toUpperCase() })} required helperText={t('accounting.warehouses.form.codeHelp')} />
            <TextField label={t('accounting.warehouses.form.address')} value={createForm.address} onChange={(e) => setCreateForm({ ...createForm, address: e.target.value })} />
            <TextField label={t('accounting.warehouses.form.notes')} value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} multiline minRows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialog(false)}>{t('accounting.warehouses.actions.cancel')}</Button>
          <Button variant="contained" disabled={!createForm.name || !createForm.code} onClick={async () => {
            try {
              const res = await warehousesService.createWarehouse(createForm);
              const created = res.data.data as Warehouse;
              setWarehouses(prev => created.isDefault ? [created, ...prev.map(w => ({ ...w, isDefault: false }))] : [created, ...prev]);
              setCreateDialog(false);
              setCreateForm(emptyForm);
            } catch (e: any) {
              setError(e.response?.data?.message || t('accounting.warehouses.messages.createFailed'));
            }
          }}>{t('accounting.warehouses.actions.create')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WarehousesContent;
