import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
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
  ToggleButton,
  ToggleButtonGroup,
  Popover,
  Checkbox,
  FormControlLabel,
  IconButton,
  Tooltip,
  Menu,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import TuneIcon from '@mui/icons-material/Tune';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../../../lib/permissions';
import { productsService, warehousesService } from '../../../services/api';
import { Product, InventoryTransaction, InventoryAdjustmentReason, Warehouse } from '../../../types';
import { UNIT_OF_MEASURE_CODES } from '../../../lib/unitsOfMeasure';
import { formatMoney } from '../../../utils/currency';

interface ProductFormState {
  name: string;
  sku: string;
  category: string;
  unitOfMeasure: string;
  defaultUnitPrice: string;
  reorderPoint: string;
  description: string;
  isSellable: boolean;
  isPurchasable: boolean;
  notes: string;
}

const emptyForm: ProductFormState = {
  name: '', sku: '', category: '', unitOfMeasure: '', defaultUnitPrice: '', reorderPoint: '', description: '', isSellable: false, isPurchasable: false, notes: '',
};

const emptyInitialStock = { quantity: '', unitCost: '', warehouseId: '' };

type AdjustMode = 'amount' | 'count';
type AdjustDirection = 'increase' | 'decrease';

// Mirrors how enterprise inventory systems bind a reason to a fixed direction —
// damage/loss/theft can only ever remove stock, so the user enters a magnitude
// and never has to know to type a minus sign. Only genuinely ambiguous reasons
// let the user pick a direction explicitly.
const REASON_DIRECTION: Record<InventoryAdjustmentReason, AdjustDirection | 'variable'> = {
  'count-correction': 'variable',
  damaged: 'decrease',
  lost: 'decrease',
  theft: 'decrease',
  other: 'variable',
};

const warehouseName = (w?: string | Warehouse) => (w && typeof w === 'object' ? w.name : '');
const warehouseIdOf = (w?: string | Warehouse) => (w && typeof w === 'object' ? w._id : (w || ''));

const stockAtWarehouse = (product: Product | null, warehouseId: string): number => {
  if (!product || !warehouseId) return 0;
  const entry = (product.stockByWarehouse || []).find(s => warehouseIdOf(s.warehouse) === warehouseId);
  return entry?.onHandQty || 0;
};

const ProductsContent: React.FC = () => {
  const { t } = useTranslation();
  const canManage = usePermission('accounting.inventory.manage');

  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState<boolean>(false);
  const [lowStockOnly, setLowStockOnly] = useState<boolean>(false);

  const [editDialog, setEditDialog] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [editForm, setEditForm] = useState<ProductFormState>(emptyForm);
  const [createDialog, setCreateDialog] = useState<boolean>(false);
  const [createForm, setCreateForm] = useState<ProductFormState>(emptyForm);
  const [initialStock, setInitialStock] = useState<{ quantity: string; unitCost: string; warehouseId: string }>(emptyInitialStock);

  const [purchaseDialog, setPurchaseDialog] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [purchaseForm, setPurchaseForm] = useState({ quantity: '', unitCost: '', notes: '', warehouseId: '' });

  const [adjustDialog, setAdjustDialog] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [adjustMode, setAdjustMode] = useState<AdjustMode>('amount');
  const [adjustForm, setAdjustForm] = useState<{ quantityDelta: string; countedQuantity: string; reason: InventoryAdjustmentReason; direction: AdjustDirection; notes: string; warehouseId: string }>({ quantityDelta: '', countedQuantity: '', reason: 'count-correction', direction: 'increase', notes: '', warehouseId: '' });

  const [historyDialog, setHistoryDialog] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [history, setHistory] = useState<InventoryTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  const [stockPopover, setStockPopover] = useState<{ anchorEl: HTMLElement | null; product: Product | null }>({ anchorEl: null, product: null });
  const [actionMenu, setActionMenu] = useState<{ anchorEl: HTMLElement | null; product: Product | null }>({ anchorEl: null, product: null });

  const defaultWarehouseId = warehouses.find(w => w.isDefault)?._id || warehouses[0]?._id || '';

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [productsRes, warehousesRes] = await Promise.all([
        productsService.getProducts({ active: showInactive ? 'all' : true, lowStock: lowStockOnly || undefined }),
        warehousesService.getWarehouses({ active: true }),
      ]);
      setProducts(Array.isArray(productsRes.data.data) ? productsRes.data.data : []);
      setWarehouses(Array.isArray(warehousesRes.data.data) ? warehousesRes.data.data : []);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.inventory.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [showInactive, lowStockOnly, t]);

  useEffect(() => { load(); }, [load]);

  const isLowStock = (p: Product) => p.reorderPoint > 0 && p.onHandQty <= p.reorderPoint;

  const startEdit = (product: Product) => {
    setEditDialog({ open: true, product });
    setEditForm({
      name: product.name,
      sku: product.sku,
      category: product.category || '',
      unitOfMeasure: product.unitOfMeasure,
      defaultUnitPrice: String(product.defaultUnitPrice ?? 0),
      reorderPoint: String(product.reorderPoint ?? 0),
      description: product.description || '',
      isSellable: !!product.isSellable,
      isPurchasable: !!product.isPurchasable,
      notes: product.notes || '',
    });
  };

  const openPurchase = (product: Product) => {
    setPurchaseDialog({ open: true, product });
    setPurchaseForm({ quantity: '', unitCost: '', notes: '', warehouseId: defaultWarehouseId });
  };

  const openAdjust = (product: Product) => {
    setAdjustDialog({ open: true, product });
    setAdjustMode('amount');
    setAdjustForm({ quantityDelta: '', countedQuantity: '', reason: 'count-correction', direction: 'increase', notes: '', warehouseId: defaultWarehouseId });
  };

  const openStockPopover = (event: React.MouseEvent<HTMLElement>, product: Product) => {
    setStockPopover({ anchorEl: event.currentTarget, product });
  };
  const closeStockPopover = () => setStockPopover({ anchorEl: null, product: null });

  const openHistory = async (product: Product) => {
    setHistoryDialog({ open: true, product });
    setHistoryLoading(true);
    try {
      const res = await productsService.getProductTransactions(product._id, { limit: 50 });
      setHistory(Array.isArray(res.data.data) ? res.data.data : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const uomOptions = UNIT_OF_MEASURE_CODES.map(code => (
    <MenuItem key={code} value={code}>{t(`accounting.inventory.uom.${code}`)}</MenuItem>
  ));

  const warehouseOptions = warehouses.map(w => (
    <MenuItem key={w._id} value={w._id}>{w.name}{w.isDefault ? ` (${t('accounting.warehouses.status.default')})` : ''}</MenuItem>
  ));

  const adjustReasonDirection = REASON_DIRECTION[adjustForm.reason];
  const adjustEffectiveDirection: AdjustDirection = adjustReasonDirection === 'variable' ? adjustForm.direction : adjustReasonDirection;

  if (loading && products.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>{t('accounting.inventory.loading')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="small" onClick={() => setShowInactive(v => !v)}>
            {showInactive ? t('accounting.inventory.actions.hideArchived') : t('accounting.inventory.actions.showArchived')}
          </Button>
          <Button size="small" onClick={() => setLowStockOnly(v => !v)} color={lowStockOnly ? 'warning' : 'inherit'}>
            {lowStockOnly ? t('accounting.inventory.actions.showAll') : t('accounting.inventory.actions.lowStockOnly')}
          </Button>
          {canManage && (
            <Button variant="contained" onClick={() => { setCreateForm(emptyForm); setInitialStock({ ...emptyInitialStock, warehouseId: defaultWarehouseId }); setCreateDialog(true); }} sx={{ ml: 'auto' }}>
              {t('accounting.inventory.actions.createProduct')}
            </Button>
          )}
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.inventory.table.name')}</TableCell>
                <TableCell>{t('accounting.inventory.table.sku')}</TableCell>
                <TableCell align="right">{t('accounting.inventory.table.onHand')}</TableCell>
                <TableCell align="right">{t('accounting.inventory.table.cost')}</TableCell>
                <TableCell align="right">{t('accounting.inventory.table.price')}</TableCell>
                <TableCell align="right">{t('accounting.inventory.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {products.map(product => (
                <TableRow key={product._id} sx={isLowStock(product) ? { bgcolor: 'warning.main', '& .MuiTableCell-root': { color: 'warning.contrastText' } } : undefined}>
                  <TableCell>{product.name}</TableCell>
                  <TableCell>{product.sku}</TableCell>
                  <TableCell align="right">
                    <Box
                      component="span"
                      onClick={(e) => openStockPopover(e, product)}
                      sx={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                    >
                      {product.onHandQty} {product.unitOfMeasure}
                    </Box>
                    {isLowStock(product) && (
                      <Chip size="small" label={t('accounting.inventory.status.lowStock')} color="error" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell align="right">{formatMoney(product.cost)}</TableCell>
                  <TableCell align="right">{formatMoney(product.defaultUnitPrice)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('accounting.inventory.actions.history')}>
                      <IconButton size="small" onClick={() => openHistory(product)}>
                        <HistoryIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {canManage && (
                      <>
                        <Tooltip title={t('accounting.inventory.actions.receive')}>
                          <IconButton size="small" onClick={() => openPurchase(product)}>
                            <MoveToInboxIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <IconButton size="small" onClick={(e) => setActionMenu({ anchorEl: e.currentTarget, product })}>
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {products.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="body1" color="text.secondary">{t('accounting.inventory.empty')}</Typography>
          </Box>
        )}
      </Paper>

      {/* Per-warehouse stock breakdown popover */}
      <Popover
        open={Boolean(stockPopover.anchorEl)}
        anchorEl={stockPopover.anchorEl}
        onClose={closeStockPopover}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, minWidth: 220 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('accounting.inventory.stockByWarehouse.title')}</Typography>
          {(stockPopover.product?.stockByWarehouse || []).length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t('accounting.inventory.stockByWarehouse.empty')}</Typography>
          ) : (
            <Box sx={{ display: 'grid', gap: 0.5 }}>
              {(stockPopover.product?.stockByWarehouse || []).map((entry, i) => (
                <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', gap: 3 }}>
                  <Typography variant="body2">{warehouseName(entry.warehouse)}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{entry.onHandQty} {stockPopover.product?.unitOfMeasure}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Popover>

      {/* Row action overflow menu */}
      <Menu
        anchorEl={actionMenu.anchorEl}
        open={Boolean(actionMenu.anchorEl)}
        onClose={() => setActionMenu({ anchorEl: null, product: null })}
      >
        <MenuItem onClick={() => { const p = actionMenu.product; setActionMenu({ anchorEl: null, product: null }); if (p) openAdjust(p); }}>
          <ListItemIcon><TuneIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('accounting.inventory.actions.adjust')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { const p = actionMenu.product; setActionMenu({ anchorEl: null, product: null }); if (p) startEdit(p); }}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('accounting.inventory.actions.edit')}</ListItemText>
        </MenuItem>
        {actionMenu.product?.isActive && [
          <Divider key="divider" />,
          <MenuItem
            key="archive"
            onClick={async () => {
              const p = actionMenu.product;
              setActionMenu({ anchorEl: null, product: null });
              if (!p) return;
              try {
                await productsService.archiveProduct(p._id);
                setProducts(prev => prev.map(item => item._id === p._id ? { ...item, isActive: false } : item));
              } catch (e: any) {
                setError(e.response?.data?.message || t('accounting.inventory.messages.archiveFailed'));
              }
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon><ArchiveIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>{t('accounting.inventory.actions.archive')}</ListItemText>
          </MenuItem>,
        ]}
      </Menu>

      {/* Edit Product Dialog */}
      <Dialog open={editDialog.open} onClose={() => setEditDialog({ open: false, product: null })} maxWidth="sm" fullWidth>
        <DialogTitle>{t('accounting.inventory.dialog.editTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            {editDialog.product && (
              <Typography variant="body2" color="text.secondary">
                {t('accounting.inventory.form.currentCost')}: {formatMoney(editDialog.product.cost)} · {t('accounting.inventory.form.currentOnHand')}: {editDialog.product.onHandQty} {editDialog.product.unitOfMeasure}
              </Typography>
            )}
            <TextField label={t('accounting.inventory.form.name')} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            <TextField label={t('accounting.inventory.form.sku')} value={editForm.sku} onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })} required />
            <TextField label={t('accounting.inventory.form.category')} value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
            <FormControl fullWidth required>
              <InputLabel>{t('accounting.inventory.form.unitOfMeasure')}</InputLabel>
              <Select value={editForm.unitOfMeasure} label={t('accounting.inventory.form.unitOfMeasure')} onChange={(e) => setEditForm({ ...editForm, unitOfMeasure: e.target.value })}>
                {uomOptions}
              </Select>
            </FormControl>
            <TextField label={t('accounting.inventory.form.defaultUnitPrice')} type="number" value={editForm.defaultUnitPrice} onChange={(e) => setEditForm({ ...editForm, defaultUnitPrice: e.target.value })} />
            <TextField label={t('accounting.inventory.form.reorderPoint')} type="number" value={editForm.reorderPoint} onChange={(e) => setEditForm({ ...editForm, reorderPoint: e.target.value })} helperText={t('accounting.inventory.form.reorderPointHelp')} />
            <TextField label={t('accounting.inventory.form.description')} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} multiline minRows={2} />
            <FormControlLabel
              control={<Checkbox checked={editForm.isSellable} onChange={(e) => setEditForm({ ...editForm, isSellable: e.target.checked })} />}
              label={t('accounting.inventory.form.isSellable')}
            />
            <FormControlLabel
              control={<Checkbox checked={editForm.isPurchasable} onChange={(e) => setEditForm({ ...editForm, isPurchasable: e.target.checked })} />}
              label={t('accounting.inventory.form.isPurchasable')}
            />
            <TextField label={t('accounting.inventory.form.notes')} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} multiline minRows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog({ open: false, product: null })}>{t('accounting.inventory.actions.cancel')}</Button>
          <Button variant="contained" onClick={async () => {
            if (!editDialog.product) return;
            try {
              const res = await productsService.updateProduct(editDialog.product._id, {
                name: editForm.name,
                sku: editForm.sku,
                category: editForm.category,
                unitOfMeasure: editForm.unitOfMeasure,
                defaultUnitPrice: Number(editForm.defaultUnitPrice) || 0,
                reorderPoint: Number(editForm.reorderPoint) || 0,
                description: editForm.description,
                isSellable: editForm.isSellable,
                isPurchasable: editForm.isPurchasable,
                notes: editForm.notes,
              });
              const updated = res.data.data as Product;
              setProducts(prev => prev.map(p => p._id === updated._id ? updated : p));
              setEditDialog({ open: false, product: null });
            } catch (e: any) {
              setError(e.response?.data?.message || t('accounting.inventory.messages.updateFailed'));
            }
          }}>{t('accounting.inventory.actions.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Create Product Dialog */}
      <Dialog open={createDialog} onClose={() => setCreateDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('accounting.inventory.dialog.createTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField label={t('accounting.inventory.form.name')} value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} required />
            <TextField label={t('accounting.inventory.form.sku')} value={createForm.sku} onChange={(e) => setCreateForm({ ...createForm, sku: e.target.value })} required />
            <TextField label={t('accounting.inventory.form.category')} value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })} />
            <FormControl fullWidth required>
              <InputLabel>{t('accounting.inventory.form.unitOfMeasure')}</InputLabel>
              <Select value={createForm.unitOfMeasure} label={t('accounting.inventory.form.unitOfMeasure')} onChange={(e) => setCreateForm({ ...createForm, unitOfMeasure: e.target.value })}>
                {uomOptions}
              </Select>
            </FormControl>
            <TextField label={t('accounting.inventory.form.defaultUnitPrice')} type="number" value={createForm.defaultUnitPrice} onChange={(e) => setCreateForm({ ...createForm, defaultUnitPrice: e.target.value })} />
            <TextField label={t('accounting.inventory.form.reorderPoint')} type="number" value={createForm.reorderPoint} onChange={(e) => setCreateForm({ ...createForm, reorderPoint: e.target.value })} helperText={t('accounting.inventory.form.reorderPointHelp')} />
            <TextField label={t('accounting.inventory.form.description')} value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} multiline minRows={2} />
            <FormControlLabel
              control={<Checkbox checked={createForm.isSellable} onChange={(e) => setCreateForm({ ...createForm, isSellable: e.target.checked })} />}
              label={t('accounting.inventory.form.isSellable')}
            />
            <FormControlLabel
              control={<Checkbox checked={createForm.isPurchasable} onChange={(e) => setCreateForm({ ...createForm, isPurchasable: e.target.checked })} />}
              label={t('accounting.inventory.form.isPurchasable')}
            />
            <TextField label={t('accounting.inventory.form.notes')} value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} multiline minRows={2} />
            <Typography variant="subtitle2" sx={{ mt: 1 }}>{t('accounting.inventory.form.initialStockSection')}</Typography>
            <Typography variant="body2" color="text.secondary">{t('accounting.inventory.form.initialStockHelp')}</Typography>
            <TextField label={t('accounting.inventory.form.initialQuantity')} type="number" value={initialStock.quantity} onChange={(e) => setInitialStock({ ...initialStock, quantity: e.target.value })} />
            <TextField
              label={t('accounting.inventory.form.initialUnitCost')}
              type="number"
              value={initialStock.unitCost}
              onChange={(e) => setInitialStock({ ...initialStock, unitCost: e.target.value })}
              required={!!Number(initialStock.quantity)}
              disabled={!Number(initialStock.quantity)}
            />
            <FormControl fullWidth disabled={!Number(initialStock.quantity)}>
              <InputLabel>{t('accounting.inventory.form.warehouse')}</InputLabel>
              <Select value={initialStock.warehouseId} label={t('accounting.inventory.form.warehouse')} onChange={(e) => setInitialStock({ ...initialStock, warehouseId: e.target.value })}>
                {warehouseOptions}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialog(false)}>{t('accounting.inventory.actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!createForm.name || !createForm.sku || !createForm.unitOfMeasure || (!!Number(initialStock.quantity) && !initialStock.unitCost)}
            onClick={async () => {
              try {
                const quantity = Number(initialStock.quantity) || 0;
                const res = await productsService.createProduct({
                  name: createForm.name,
                  sku: createForm.sku,
                  category: createForm.category,
                  unitOfMeasure: createForm.unitOfMeasure,
                  defaultUnitPrice: Number(createForm.defaultUnitPrice) || 0,
                  reorderPoint: Number(createForm.reorderPoint) || 0,
                  description: createForm.description,
                  isSellable: createForm.isSellable,
                  isPurchasable: createForm.isPurchasable,
                  notes: createForm.notes,
                  initialQuantity: quantity || undefined,
                  initialUnitCost: quantity ? Number(initialStock.unitCost) : undefined,
                  warehouseId: quantity ? (initialStock.warehouseId || defaultWarehouseId || undefined) : undefined,
                });
                const created = res.data.data as Product;
                setProducts(prev => [created, ...prev]);
                setCreateDialog(false);
                setCreateForm(emptyForm);
                setInitialStock(emptyInitialStock);
              } catch (e: any) {
                setError(e.response?.data?.message || t('accounting.inventory.messages.createFailed'));
              }
            }}
          >{t('accounting.inventory.actions.create')}</Button>
        </DialogActions>
      </Dialog>

      {/* Receive Stock (Purchase) Dialog */}
      <Dialog open={purchaseDialog.open} onClose={() => setPurchaseDialog({ open: false, product: null })} maxWidth="sm" fullWidth>
        <DialogTitle>{t('accounting.inventory.dialog.receiveTitle', { name: purchaseDialog.product?.name })}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <FormControl fullWidth required>
              <InputLabel>{t('accounting.inventory.form.warehouse')}</InputLabel>
              <Select value={purchaseForm.warehouseId} label={t('accounting.inventory.form.warehouse')} onChange={(e) => setPurchaseForm({ ...purchaseForm, warehouseId: e.target.value })}>
                {warehouseOptions}
              </Select>
            </FormControl>
            <TextField label={t('accounting.inventory.form.quantity')} type="number" value={purchaseForm.quantity} onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity: e.target.value })} required />
            <TextField label={t('accounting.inventory.form.unitCost')} type="number" value={purchaseForm.unitCost} onChange={(e) => setPurchaseForm({ ...purchaseForm, unitCost: e.target.value })} required />
            <TextField label={t('accounting.inventory.form.notes')} value={purchaseForm.notes} onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })} multiline minRows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPurchaseDialog({ open: false, product: null })}>{t('accounting.inventory.actions.cancel')}</Button>
          <Button variant="contained" disabled={!purchaseForm.quantity || !purchaseForm.unitCost || !purchaseForm.warehouseId} onClick={async () => {
            if (!purchaseDialog.product) return;
            try {
              const res = await productsService.purchaseProduct(purchaseDialog.product._id, {
                quantity: Number(purchaseForm.quantity),
                unitCost: Number(purchaseForm.unitCost),
                notes: purchaseForm.notes,
                warehouseId: purchaseForm.warehouseId,
              });
              const updated = (res.data.data as { product: Product }).product;
              setProducts(prev => prev.map(p => p._id === updated._id ? updated : p));
              setPurchaseDialog({ open: false, product: null });
            } catch (e: any) {
              setError(e.response?.data?.message || t('accounting.inventory.messages.purchaseFailed'));
            }
          }}>{t('accounting.inventory.actions.receive')}</Button>
        </DialogActions>
      </Dialog>

      {/* Adjust Stock Dialog */}
      <Dialog open={adjustDialog.open} onClose={() => setAdjustDialog({ open: false, product: null })} maxWidth="sm" fullWidth>
        <DialogTitle>{t('accounting.inventory.dialog.adjustTitle', { name: adjustDialog.product?.name })}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <FormControl fullWidth required>
              <InputLabel>{t('accounting.inventory.form.warehouse')}</InputLabel>
              <Select value={adjustForm.warehouseId} label={t('accounting.inventory.form.warehouse')} onChange={(e) => setAdjustForm({ ...adjustForm, warehouseId: e.target.value })}>
                {warehouseOptions}
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              {t('accounting.inventory.form.currentOnHand')}: {stockAtWarehouse(adjustDialog.product, adjustForm.warehouseId)} {adjustDialog.product?.unitOfMeasure}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={adjustMode}
              onChange={(_, val) => { if (val) setAdjustMode(val); }}
            >
              <ToggleButton value="amount">{t('accounting.inventory.form.adjustModeAmount')}</ToggleButton>
              <ToggleButton value="count">{t('accounting.inventory.form.adjustModeCount')}</ToggleButton>
            </ToggleButtonGroup>
            {adjustMode === 'amount' ? (
              <>
                {adjustReasonDirection === 'variable' && (
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={adjustForm.direction}
                    onChange={(_, val) => { if (val) setAdjustForm({ ...adjustForm, direction: val }); }}
                  >
                    <ToggleButton value="increase">{t('accounting.inventory.form.directionIncrease')}</ToggleButton>
                    <ToggleButton value="decrease">{t('accounting.inventory.form.directionDecrease')}</ToggleButton>
                  </ToggleButtonGroup>
                )}
                <TextField
                  label={t(adjustEffectiveDirection === 'decrease' ? 'accounting.inventory.form.quantityToRemove' : 'accounting.inventory.form.quantityToAdd')}
                  type="number"
                  value={adjustForm.quantityDelta}
                  onChange={(e) => setAdjustForm({ ...adjustForm, quantityDelta: e.target.value })}
                  inputProps={{ min: 0 }}
                  required
                />
              </>
            ) : (
              <TextField
                label={t('accounting.inventory.form.countedQuantity')}
                type="number"
                value={adjustForm.countedQuantity}
                onChange={(e) => setAdjustForm({ ...adjustForm, countedQuantity: e.target.value })}
                helperText={
                  adjustForm.countedQuantity !== '' && adjustDialog.product
                    ? t('accounting.inventory.form.countedQuantityDeltaPreview', { delta: Number(adjustForm.countedQuantity) - stockAtWarehouse(adjustDialog.product, adjustForm.warehouseId) })
                    : t('accounting.inventory.form.countedQuantityHelp')
                }
                required
              />
            )}
            <FormControl fullWidth>
              <InputLabel>{t('accounting.inventory.form.reason')}</InputLabel>
              <Select value={adjustForm.reason} label={t('accounting.inventory.form.reason')} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value as InventoryAdjustmentReason })}>
                <MenuItem value="count-correction">{t('accounting.inventory.reason.countCorrection')}</MenuItem>
                <MenuItem value="damaged">{t('accounting.inventory.reason.damaged')}</MenuItem>
                <MenuItem value="lost">{t('accounting.inventory.reason.lost')}</MenuItem>
                <MenuItem value="theft">{t('accounting.inventory.reason.theft')}</MenuItem>
                <MenuItem value="other">{t('accounting.inventory.reason.other')}</MenuItem>
              </Select>
            </FormControl>
            <TextField label={t('accounting.inventory.form.notes')} value={adjustForm.notes} onChange={(e) => setAdjustForm({ ...adjustForm, notes: e.target.value })} multiline minRows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdjustDialog({ open: false, product: null })}>{t('accounting.inventory.actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={(adjustMode === 'amount' ? !adjustForm.quantityDelta : !adjustForm.countedQuantity) || !adjustForm.warehouseId}
            onClick={async () => {
              if (!adjustDialog.product) return;
              try {
                const res = await productsService.adjustProduct(adjustDialog.product._id, {
                  ...(adjustMode === 'amount'
                    ? { quantityDelta: adjustEffectiveDirection === 'decrease' ? -Math.abs(Number(adjustForm.quantityDelta)) : Math.abs(Number(adjustForm.quantityDelta)) }
                    : { countedQuantity: Number(adjustForm.countedQuantity) }),
                  reason: adjustForm.reason,
                  notes: adjustForm.notes,
                  warehouseId: adjustForm.warehouseId,
                });
                const updated = (res.data.data as { product: Product }).product;
                setProducts(prev => prev.map(p => p._id === updated._id ? updated : p));
                setAdjustDialog({ open: false, product: null });
              } catch (e: any) {
                setError(e.response?.data?.message || t('accounting.inventory.messages.adjustFailed'));
              }
            }}
          >{t('accounting.inventory.actions.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Transaction History Dialog */}
      <Dialog open={historyDialog.open} onClose={() => setHistoryDialog({ open: false, product: null })} maxWidth="md" fullWidth>
        <DialogTitle>{t('accounting.inventory.dialog.historyTitle', { name: historyDialog.product?.name })}</DialogTitle>
        <DialogContent>
          {historyLoading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('accounting.inventory.history.date')}</TableCell>
                    <TableCell>{t('accounting.inventory.history.type')}</TableCell>
                    <TableCell>{t('accounting.inventory.history.warehouse')}</TableCell>
                    <TableCell align="right">{t('accounting.inventory.history.delta')}</TableCell>
                    <TableCell align="right">{t('accounting.inventory.history.balance')}</TableCell>
                    <TableCell align="right">{t('accounting.inventory.history.unitCost')}</TableCell>
                    <TableCell>{t('accounting.inventory.history.notes')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.map(tx => (
                    <TableRow key={tx._id}>
                      <TableCell>{new Date(tx.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        {t(`accounting.inventory.history.types.${tx.type}`)}
                        {tx.reason ? ` (${t(`accounting.inventory.reason.${tx.reason === 'count-correction' ? 'countCorrection' : tx.reason}`)})` : ''}
                      </TableCell>
                      <TableCell>{warehouseName(tx.warehouse)}</TableCell>
                      <TableCell align="right" sx={{ color: tx.quantityDelta < 0 ? 'error.main' : 'success.main' }}>
                        {tx.quantityDelta > 0 ? '+' : ''}{tx.quantityDelta}
                      </TableCell>
                      <TableCell align="right">{tx.balanceAfter}</TableCell>
                      <TableCell align="right">{tx.unitCost !== undefined ? formatMoney(tx.unitCost) : '-'}</TableCell>
                      <TableCell>{tx.notes || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {history.length === 0 && (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body2" color="text.secondary">{t('accounting.inventory.history.empty')}</Typography>
                </Box>
              )}
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryDialog({ open: false, product: null })}>{t('accounting.inventory.actions.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProductsContent;
