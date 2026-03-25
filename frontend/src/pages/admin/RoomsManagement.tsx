import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Grid,
  Paper,
  Button,
  Card,
  CardContent,
  CardMedia,
  CardActions,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Snackbar,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  FormControlLabel,
  Checkbox,
  FormGroup,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  Search,
  Hotel,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { roomsService, adminService, roomTypeService } from '../../services/api';
import { Room, RoomType } from '../../types';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import MediaPicker from '../../components/admin/MediaPicker';
import { resolveMediaUrl } from '../../services/api';
import { useTranslation } from 'react-i18next';
import Autocomplete from '@mui/material/Autocomplete';

interface RoomFormData {
  name: string;
  description: string;
  status: 'active' | 'inactive';
  condition: 'pending_cleanup' | 'clean';
  comment: string;
  bedConfiguration: string;
  amenities: string[];
  images: string[];
  roomTypeId?: string;
  features: {
    wifi: boolean;
    airConditioning: boolean;
    miniBar: boolean;
    balcony: boolean;
    oceanView: boolean;
    kitchenette: boolean;
    jacuzzi: boolean;
  };
}

const initialFormData: RoomFormData = {
  name: '',
  description: '',
  status: 'active',
  condition: 'clean',
  comment: '',
  bedConfiguration: '',
  amenities: [],
  images: [],
  roomTypeId: undefined,
  features: {
    wifi: true,
    airConditioning: true,
    miniBar: false,
    balcony: false,
    oceanView: false,
    kitchenette: false,
    jacuzzi: false,
  },
};

const RoomsManagement: React.FC = () => {
  const { user, permissions } = useAuth();
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [formDialog, setFormDialog] = useState({ open: false, mode: 'create', room: null as Room | null });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, room: null as Room | null });
  const [formData, setFormData] = useState<RoomFormData>(initialFormData);
  const [formLoading, setFormLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [newAmenity, setNewAmenity] = useState('');
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [selectedRoomType, setSelectedRoomType] = useState<RoomType | null>(null);

  useEffect(() => {
    if (user) {
      const isAdmin = String(user.role).toLowerCase() === 'admin';
      const canFullEdit = isAdmin || (permissions || []).includes('admin.rooms');
      const canOpsOnly = !canFullEdit && (permissions || []).includes('admin.accommodations');
      if (canFullEdit || canOpsOnly) {
        loadRooms();
      }
    }
  }, [user, permissions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    roomTypeService.getRoomTypes()
      .then(res => setRoomTypes(res.data.data || []))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRooms = async () => {
    try {
      setLoading(true);
      const response = await roomsService.getRooms({ limit: 100 });
      if (response.data.success) {
        // Handle different response structures
        const roomsData = response.data.data;
        if (Array.isArray(roomsData)) {
          setRooms(roomsData);
        } else if (roomsData?.rooms) {
          setRooms(roomsData.rooms);
        } else {
          setRooms([]);
        }
      }
    } catch (error) {
      console.error('Error loading rooms:', error);
      showSnackbar(t('admin.rooms.messages.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCreateRoom = () => {
    setFormData(initialFormData);
    setSelectedRoomType(null);
    setFormDialog({ open: true, mode: 'create', room: null });
  };

  const handleEditRoom = (room: Room) => {
    const rtId = typeof room.roomTypeId === 'object' ? (room.roomTypeId as any)?._id : room.roomTypeId;
    const rtObj = typeof room.roomTypeId === 'object'
      ? room.roomTypeId as any
      : roomTypes.find(rt => rt._id === room.roomTypeId) || null;
    setSelectedRoomType(rtObj ? { _id: rtObj._id || '', name: rtObj.name || '', capacity: rtObj.capacity || 0, isActive: true, createdAt: '', updatedAt: '' } : null);
    setFormData({
      name: room.name,
      description: room.description,
      status: room.status as any,
      condition: room.condition as any,
      comment: room.comment as any,
      bedConfiguration: room.bedConfiguration,
      amenities: room.amenities || [],
      images: room.images || [],
      roomTypeId: rtId,
      features: room.features || {
        wifi: true,
        airConditioning: true,
        miniBar: false,
        balcony: false,
        oceanView: false,
        kitchenette: false,
        jacuzzi: false,
      },
    });
    setFormDialog({ open: true, mode: 'edit', room });
  };

  const handleDeleteRoom = (room: Room) => {
    setDeleteDialog({ open: true, room });
  };

  const handleFormSubmit = async () => {
    try {
      setFormLoading(true);

      const roomData = {
        name: formData.name,
        description: formData.description,
        status: formData.status,
        condition: formData.condition,
        comment: formData.comment,
        bedConfiguration: formData.bedConfiguration,
        amenities: formData.amenities,
        images: formData.images.length > 0 ? formData.images : ['/api/placeholder/400/300'],
        features: formData.features,
        ...(formData.roomTypeId ? { roomTypeId: formData.roomTypeId } : {}),
      };

      if (formDialog.mode === 'create') {
        // Only full-edit users can create rooms
        await adminService.createRoom(roomData);
        showSnackbar(t('admin.rooms.messages.roomCreated'), 'success');
      } else if (formDialog.room) {
        // Ops-only users update status/condition/comment; full-edit users perform full update
        const isAdminLocal = String(user?.role || '').toLowerCase() === 'admin';
        const canFullEditLocal = isAdminLocal || (permissions || []).includes('admin.rooms');
        if (canFullEditLocal) {
          await adminService.updateRoom(formDialog.room._id, roomData);
          showSnackbar(t('admin.rooms.messages.roomUpdated'), 'success');
        } else {
          await adminService.updateRoomOps(formDialog.room._id, {
            status: formData.status as any,
            condition: formData.condition as any,
            comment: formData.comment,
          });
          showSnackbar(t('admin.rooms.messages.roomUpdated'), 'success');
        }
      }

      setFormDialog({ open: false, mode: 'create', room: null });
      loadRooms();
    } catch (error: any) {
      console.error('Error saving room:', error);
      showSnackbar(error.response?.data?.message || t('admin.rooms.messages.saveFailed'), 'error');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDialog.room) return;

    try {
      await adminService.deleteRoom(deleteDialog.room._id);
      showSnackbar(t('admin.rooms.messages.roomDeleted'), 'success');
      setDeleteDialog({ open: false, room: null });
      loadRooms();
    } catch (error: any) {
      console.error('Error deleting room:', error);
      showSnackbar(error.response?.data?.message || t('admin.rooms.messages.deleteFailed'), 'error');
    }
  };

  const handleAddAmenity = () => {
    if (newAmenity.trim() && !formData.amenities.includes(newAmenity.trim())) {
      setFormData({
        ...formData,
        amenities: [...formData.amenities, newAmenity.trim()],
      });
      setNewAmenity('');
    }
  };

  const handleRemoveAmenity = (amenity: string) => {
    setFormData({
      ...formData,
      amenities: formData.amenities.filter(a => a !== amenity),
    });
  };

  const filteredRooms = rooms.filter(room => {
    const matchesType = true; // Room type filtering removed
    const matchesSearch = room.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      room.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesType && matchesSearch;
  });

  const paginatedRooms = filteredRooms.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  // Room type fields removed

  const getImageUrl = (imagePath: string | undefined) => {
    if (!imagePath) return '/api/placeholder/400/300';
    return resolveMediaUrl(imagePath);
  };

  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const canFullEdit = isAdmin || (permissions || []).includes('admin.rooms');
  const canOpsOnly = !canFullEdit && (permissions || []).includes('admin.accommodations');
  if (!user || (!canFullEdit && !canOpsOnly)) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">
          {t('admin.common.accessDenied')}
        </Alert>
      </Container>
    );
  }

  return (
    <AdminLayout>
      <Container maxWidth="xl" sx={{ py: 0 }}>
        {/* Header */}
        <Box sx={{ mb: 2 }}>
          <SectionTitle
            title={t('admin.rooms.title')}
            right={canFullEdit ? (
              <Button variant="contained" startIcon={<Add />} onClick={handleCreateRoom} size="large">
                {t('admin.rooms.actions.addNewRoom')}
              </Button>
            ) : undefined}
          />
          <Typography variant="h6" color="text.secondary">
            {t('admin.rooms.subtitle')}
          </Typography>
        </Box>

        {/* Filters and Search */}
        <Paper sx={{ p: 3, mb: 4 }}>
          <Grid container spacing={3} alignItems="center">
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label={t('admin.rooms.searchRooms')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant={viewMode === 'cards' ? 'contained' : 'outlined'}
                  onClick={() => setViewMode('cards')}
                >
                  {t('admin.rooms.view.cards')}
                </Button>
                <Button
                  variant={viewMode === 'table' ? 'contained' : 'outlined'}
                  onClick={() => setViewMode('table')}
                >
                  {t('admin.rooms.view.table')}
                </Button>
              </Box>
            </Grid>
            <Grid item xs={12} md={2}>
              <Typography variant="body2" color="text.secondary">
                {t('admin.rooms.roomsFound', { count: filteredRooms.length })}
              </Typography>
            </Grid>
          </Grid>
        </Paper>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress size={60} />
          </Box>
        ) : (
          <>
            {/* Cards View */}
            {viewMode === 'cards' && (
              <Grid container spacing={3}>
                {paginatedRooms.map((room) => (
                  <Grid item xs={12} md={6} lg={4} key={room._id}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                      <CardMedia
                        component="img"
                        height="200"
                        image={getImageUrl(room.images?.[0])}
                        alt={room.name}
                      />
                      <CardContent sx={{ flexGrow: 1 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                          <Typography variant="h6" component="h3">
                            {room.name}
                          </Typography>
                          {/* Room type chip removed */}
                        </Box>

                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                          {room.description.length > 100
                            ? `${room.description.substring(0, 100)}...`
                            : room.description}
                        </Typography>

                        {/* Capacity, size, and price per night removed */}

                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                          {room.status && (
                            <Chip
                              label={t(`admin.accommodations.statusLabels.${room.status}`)}
                              color={room.status === 'active' ? 'success' : 'default'}
                              size="small"
                            />
                          )}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          </Box>
                        </Box>
                      </CardContent>
                      <CardActions sx={{ p: 2, pt: 0 }}>
                        <Box sx={{ display: 'flex', gap: 1, width: '100%' }}>
                          <Button
                            size="small"
                            startIcon={<Edit />}
                            onClick={() => handleEditRoom(room)}
                          >
                            {t('admin.rooms.actions.edit')}
                          </Button>
                          {canFullEdit && (
                          <Button
                            size="small"
                            color="error"
                            startIcon={<Delete />}
                            onClick={() => handleDeleteRoom(room)}
                          >
                            {t('admin.rooms.actions.delete')}
                          </Button>
                          )}
                        </Box>
                      </CardActions>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            )}

            {/* Table View */}
            {viewMode === 'table' && (
              <Paper sx={{ width: '100%', overflow: 'hidden' }}>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('admin.rooms.table.name')}</TableCell>
                        <TableCell>{t('admin.rooms.table.type')}</TableCell>
                        <TableCell>{t('admin.rooms.table.condition')}</TableCell>
                        <TableCell>{t('admin.rooms.table.status')}</TableCell>
                        <TableCell>{t('admin.rooms.table.actions')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {paginatedRooms.map((room) => (
                        <TableRow key={room._id} hover>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <img
                                src={getImageUrl(room.images?.[0])}
                                alt={room.name}
                                style={{ width: 50, height: 50, borderRadius: 8, objectFit: 'cover' }}
                              />
                              <Box>
                                <Typography variant="subtitle2">{room.name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {room.bedConfiguration}
                                </Typography>
                              </Box>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {typeof room.roomTypeId === 'object' ? (room.roomTypeId as any).name : room.type}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={t(`admin.rooms.condition.${room.condition}`, room.condition)}
                              color={room.condition === 'clean' ? 'success' : 'warning'}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>
                            {room.status && (
                              <Chip
                                label={t(`admin.accommodations.statusLabels.${room.status}`)}
                                color={room.status === 'active' ? 'success' : 'default'}
                                size="small"
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Tooltip title={t('admin.rooms.actions.edit')}>
                                <IconButton size="small" onClick={() => handleEditRoom(room)}>
                                  <Edit />
                                </IconButton>
                              </Tooltip>
                              {canFullEdit && (
                                <Tooltip title={t('admin.rooms.actions.delete')}>
                                  <IconButton size="small" color="error" onClick={() => handleDeleteRoom(room)}>
                                    <Delete />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  rowsPerPageOptions={[5, 10, 25]}
                  component="div"
                  count={filteredRooms.length}
                  rowsPerPage={rowsPerPage}
                  page={page}
                  onPageChange={(_, newPage) => setPage(newPage)}
                  onRowsPerPageChange={(e) => {
                    setRowsPerPage(parseInt(e.target.value, 10));
                    setPage(0);
                  }}
                />
              </Paper>
            )}

            {filteredRooms.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <Hotel sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  {t('admin.rooms.empty.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {searchTerm
                    ? t('admin.rooms.empty.adjustFilters')
                    : t('admin.rooms.empty.getStarted')}
                </Typography>
              </Box>
            )}
          </>
        )}

        {/* Room Form Dialog */}
        <Dialog
          open={formDialog.open}
          onClose={() => setFormDialog({ open: false, mode: 'create', room: null })}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            {formDialog.mode === 'create' ? t('admin.rooms.dialog.createTitle') : t('admin.rooms.dialog.editTitle')}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={3}>
                {canFullEdit && (
                  <>
                    {/* Basic Information */}
                    <Grid item xs={12}>
                      <Typography variant="h6" gutterBottom>{t('admin.rooms.sections.basicInfo')}</Typography>
                      <Divider sx={{ mb: 2 }} />
                    </Grid>

                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label={t('admin.rooms.form.roomName')}
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </Grid>

                    {/* Room Type selector */}
                    <Grid item xs={12} md={6}>
                      <Autocomplete
                        options={roomTypes}
                        getOptionLabel={(o) => o.name}
                        value={selectedRoomType}
                        onChange={(_, val) => {
                          setSelectedRoomType(val);
                          setFormData(fd => ({ ...fd, roomTypeId: val?._id || undefined }));
                        }}
                        renderInput={(params) => (
                          <TextField {...params} label={t('admin.rooms.form.roomType', 'Room Type')} fullWidth />
                        )}
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        label={t('admin.rooms.form.description')}
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        multiline
                        rows={3}
                        required
                      />
                    </Grid>
                  </>
                )}

                {/* Capacity, Price per Night, and Size fields removed */}

                {/* Operations */}
                <Grid item xs={12}>
                  <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{t('admin.rooms.sections.statusCondition')}</Typography>
                  <Divider sx={{ mb: 2 }} />
                </Grid>

                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>{t('admin.rooms.form.status')}</InputLabel>
                    <Select
                      value={formData.status}
                      label={t('admin.rooms.form.status')}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    >
                      <MenuItem value="active">{t('admin.accommodations.statusLabels.active')}</MenuItem>
                      <MenuItem value="inactive">{t('admin.accommodations.statusLabels.inactive')}</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>{t('admin.rooms.form.condition')}</InputLabel>
                    <Select
                      value={formData.condition}
                      label={t('admin.rooms.form.condition')}
                      onChange={(e) => setFormData({ ...formData, condition: e.target.value as any })}
                    >
                      <MenuItem value="clean">{t('admin.rooms.condition.clean')}</MenuItem>
                      <MenuItem value="pending_cleanup">{t('admin.rooms.condition.pending_cleanup')}</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label={t('admin.rooms.form.comment')}
                    value={formData.comment}
                    onChange={(e) => setFormData({ ...formData, comment: e.target.value.slice(0, 500) })}
                    placeholder={t('admin.rooms.form.commentPlaceholder')}
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label={t('admin.rooms.form.bedConfiguration')}
                    value={formData.bedConfiguration}
                    onChange={(e) => setFormData({ ...formData, bedConfiguration: e.target.value })}
                    placeholder={t('admin.rooms.form.bedPlaceholder')}
                    required
                  />
                </Grid>

                {canFullEdit && (
                  <>
                    {/* Features */}
                    <Grid item xs={12}>
                      <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{t('admin.rooms.sections.features')}</Typography>
                      <Divider sx={{ mb: 2 }} />
                    </Grid>

                    <Grid item xs={12}>
                      <FormGroup row>
                        {Object.entries(formData.features).map(([feature, enabled]) => (
                          <FormControlLabel
                            key={feature}
                            control={
                              <Checkbox
                                checked={enabled}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  features: { ...formData.features, [feature]: e.target.checked }
                                })}
                              />
                            }
                            label={t(`admin.rooms.features.${feature}`)}
                          />
                        ))}
                      </FormGroup>
                    </Grid>
                  </>
                )}

                {canFullEdit && (
                  <>
                    {/* Amenities */}
                    <Grid item xs={12}>
                      <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{t('admin.rooms.sections.amenities')}</Typography>
                      <Divider sx={{ mb: 2 }} />
                    </Grid>

                    <Grid item xs={12}>
                      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                        <TextField
                          label={t('admin.rooms.form.addAmenity')}
                          value={newAmenity}
                          onChange={(e) => setNewAmenity(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && handleAddAmenity()}
                          size="small"
                        />
                        <Button
                          variant="outlined"
                          onClick={handleAddAmenity}
                          disabled={!newAmenity.trim()}
                        >
                          {t('admin.rooms.actions.add')}
                        </Button>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {formData.amenities.map((amenity, index) => (
                          <Chip
                            key={index}
                            label={amenity}
                            onDelete={() => handleRemoveAmenity(amenity)}
                            size="small"
                          />
                        ))}                </Box>
                    </Grid>
                  </>
                )}

                {canFullEdit && (
                  <>
                    {/* Images */}
                    <Grid item xs={12}>
                      <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{t('admin.rooms.sections.images')}</Typography>
                      <Divider sx={{ mb: 2 }} />
                    </Grid>

                    <Grid item xs={12}>
                      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                        <Button variant="outlined" onClick={() => setMediaPickerOpen(true)}>{t('admin.rooms.actions.selectFromMedia')}</Button>
                      </Box>
                      {/* Selected Images Preview (no upload) */}
                      {formData.images.length === 0 ? (
                        <Alert severity="info">{t('admin.rooms.images.noneSelected')} {t('admin.rooms.images.useSelectFromMedia')}</Alert>
                      ) : (
                        <Grid container spacing={2}>
                          {formData.images.map((img, idx) => (
                            <Grid item xs={12} sm={6} md={4} key={idx}>
                              <Card>
                                <CardMedia
                                  component="img"
                                  height="160"
                                  image={getImageUrl(img)}
                                  alt={`Room image ${idx + 1}`}
                                />
                                <CardActions>
                                  <Button color="error" onClick={() => {
                                    const next = [...formData.images];
                                    next.splice(idx, 1);
                                    setFormData({ ...formData, images: next });
                                  }}>{t('admin.rooms.actions.remove')}</Button>
                                </CardActions>
                              </Card>
                            </Grid>
                          ))}
                        </Grid>
                      )}
                    </Grid>
                  </>
                )}

                {/* Availability toggle removed; status managed via Room Ops */}
              </Grid>
            </Box>
          </DialogContent>
          <DialogActions sx={{ p: 3 }}>
            <Button
              onClick={() => setFormDialog({ open: false, mode: 'create', room: null })}
              disabled={formLoading}
            >
              {t('admin.rooms.actions.cancel')}
            </Button>
            <Button
              variant="contained"
              onClick={handleFormSubmit}
              disabled={formLoading || !formData.name || !formData.description}
            >
              {formLoading ? <CircularProgress size={20} /> : (
                formDialog.mode === 'create'
                  ? t('admin.rooms.actions.createRoom')
                  : (canFullEdit ? t('admin.rooms.actions.updateRoom') : t('admin.rooms.actions.updateRoom'))
              )}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Media Picker Dialog */}
        <MediaPicker
          open={mediaPickerOpen}
          onClose={() => setMediaPickerOpen(false)}
          multiple
          categoryFilter="rooms"
          onSelect={(urls) => {
            setFormData({ ...formData, images: [...formData.images, ...urls] });
          }}
        />

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={deleteDialog.open}
          onClose={() => setDeleteDialog({ open: false, room: null })}
        >
          <DialogTitle>{t('admin.rooms.dialog.deleteTitle')}</DialogTitle>
          <DialogContent>
            <Typography>
              {t('admin.rooms.dialog.deletePrompt', { name: deleteDialog.room?.name })}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteDialog({ open: false, room: null })}>
              {t('admin.rooms.actions.cancel')}
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={handleDeleteConfirm}
            >
              {t('admin.rooms.actions.delete')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Snackbar */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={6000}
          onClose={() => setSnackbar({ ...snackbar, open: false })}
        >
          <Alert
            onClose={() => setSnackbar({ ...snackbar, open: false })}
            severity={snackbar.severity}
            sx={{ width: '100%' }}
          >
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Container>
    </AdminLayout>
  );
};

export default RoomsManagement;
