import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Grid,
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
  Switch,
  FormControlLabel,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  Tooltip,
  Snackbar,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  Star,
  Business,
  Restaurant,
  Pool,
  Spa,
  FitnessCenter,
  Category,
} from '@mui/icons-material';
import { Amenity } from '../../types';
import NumberField from '../../components/common/NumberField';
import { amenitiesService } from '../../services/api';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import MediaPicker from '../../components/admin/MediaPicker';
import { resolveMediaUrl } from '../../services/api';
import { useTranslation } from 'react-i18next';

interface AmenityFormData {
  name: string;
  description: string;
  imageUrl?: string;
  category: string;
  order: number;
  isActive: boolean;
}

const AmenitiesManagement: React.FC = () => {
  const { t } = useTranslation();
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formDialog, setFormDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    amenity: Amenity | null;
  }>({ open: false, mode: 'create', amenity: null });
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    amenity: Amenity | null;
  }>({ open: false, amenity: null });
  const [formLoading, setFormLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [formData, setFormData] = useState<AmenityFormData>({
    name: '',
    description: '',
    imageUrl: '',
    category: 'general',
    order: 0,
    isActive: true,
  });

  const categories = [
    { value: 'accommodation', label: t('admin.amenities.categories.accommodation'), icon: <Business /> },
    { value: 'dining', label: t('admin.amenities.categories.dining'), icon: <Restaurant /> },
    { value: 'recreation', label: t('admin.amenities.categories.recreation'), icon: <Pool /> },
    { value: 'wellness', label: t('admin.amenities.categories.wellness'), icon: <Spa /> },
    { value: 'business', label: t('admin.amenities.categories.business'), icon: <FitnessCenter /> },
    { value: 'general', label: t('admin.amenities.categories.general'), icon: <Category /> },
  ];

  useEffect(() => {
    fetchAmenities();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };

  const fetchAmenities = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await amenitiesService.getAmenities({ active: false }); // Get all amenities for admin
      setAmenities(response.data.data || []);
    } catch (error: any) {
      console.error('Error fetching amenities:', error);
      const msg = error.response?.data?.message || t('admin.amenities.messages.loadFailed');
      setError(msg);
      showSnackbar(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAmenity = () => {
    setFormData({
      name: '',
      description: '',
      imageUrl: '',
      category: 'general',
      order: amenities.length,
      isActive: true,
    });
    setImagePreview('');
    setFormDialog({ open: true, mode: 'create', amenity: null });
  };

  const handleEditAmenity = (amenity: Amenity) => {
    setFormData({
      name: amenity.name,
      description: amenity.description,
      imageUrl: amenity.image,
      category: amenity.category,
      order: amenity.order,
      isActive: amenity.isActive,
    });
    setImagePreview(resolveMediaUrl(amenity.image));
    setFormDialog({ open: true, mode: 'edit', amenity });
  };

  const handleDeleteAmenity = (amenity: Amenity) => {
    setDeleteDialog({ open: true, amenity });
  };

  // Image selection now occurs via MediaPicker only

  const handleFormSubmit = async () => {
    try {
      setFormLoading(true);

      if (!formData.name || !formData.description) {
        setError(t('admin.amenities.errors.nameDescriptionRequired'));
        return;
      }

      if (formDialog.mode === 'create' && !formData.imageUrl) {
        setError(t('admin.amenities.errors.imageRequired'));
        return;
      }
      const payloadBase = {
        name: formData.name,
        description: formData.description,
        category: formData.category,
        order: formData.order,
        isActive: formData.isActive,
      };

      if (formDialog.mode === 'create') {
        await amenitiesService.createAmenity({ ...payloadBase, imageUrl: formData.imageUrl as string });
        showSnackbar(t('admin.amenities.messages.created'), 'success');
      } else if (formDialog.amenity) {
        const updatePayload = formData.imageUrl ? { ...payloadBase, imageUrl: formData.imageUrl } : payloadBase;
        await amenitiesService.updateAmenity(formDialog.amenity._id, updatePayload);
        showSnackbar(t('admin.amenities.messages.updated'), 'success');
      }

      await fetchAmenities();
      setFormDialog({ open: false, mode: 'create', amenity: null });
      setError(null);
    } catch (error: any) {
      console.error('Error saving amenity:', error);
      const msg = error.response?.data?.message || t('admin.amenities.messages.saveFailed');
      setError(msg);
      showSnackbar(msg, 'error');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDialog.amenity) return;

    try {
      await amenitiesService.deleteAmenity(deleteDialog.amenity._id);
      await fetchAmenities();
      setDeleteDialog({ open: false, amenity: null });
      showSnackbar(t('admin.amenities.messages.deleted'), 'success');
    } catch (error: any) {
      console.error('Error deleting amenity:', error);
      const msg = error.response?.data?.message || t('admin.amenities.messages.deleteFailed');
      setError(msg);
      showSnackbar(msg, 'error');
    }
  };

  const getCategoryIcon = (category: string) => {
    const categoryData = categories.find(c => c.value === category);
    return categoryData?.icon || <Category />;
  };

  const getCategoryLabel = (category: string) => {
    const categoryData = categories.find(c => c.value === category);
    return categoryData?.label || category;
  };

  return (
    <AdminLayout>
      <Container maxWidth="xl" sx={{ py: 4 }}>
        {loading ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <CircularProgress size={60} />
            <Typography variant="h6" sx={{ mt: 2 }}>
              {t('admin.amenities.loading')}
            </Typography>
          </Box>
        ) : (
          <>
            {/* Header */}
            <Box sx={{ mb: 2 }}>
              <SectionTitle
                title={t('admin.amenities.title')}
                right={<Button variant="contained" startIcon={<Add />} onClick={handleCreateAmenity} size="large">{t('admin.amenities.actions.addNewAmenity')}</Button>}
              />
              <Typography variant="body1" color="text.secondary">
                {t('admin.amenities.subtitle')}
              </Typography>
            </Box>

            {error && (
              <Alert severity="error" sx={{ mb: 4 }}>
                {error}
              </Alert>
            )}

            {/* Amenities Grid */}
            <Grid container spacing={3} sx={{ mb: 4 }}>
              {amenities.map((amenity) => (
                <Grid item xs={12} sm={6} md={4} key={amenity._id}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ position: 'relative' }}>
                      <img
                        src={amenity.image?.startsWith('http') ? amenity.image : resolveMediaUrl(amenity.image)}
                        alt={amenity.name}
                        style={{
                          width: '100%',
                          height: 200,
                          objectFit: 'cover',
                        }}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = '/placeholder-image.jpg';
                        }}
                      />
                      <Chip
                        icon={getCategoryIcon(amenity.category)}
                        label={getCategoryLabel(amenity.category)}
                        size="small"
                        sx={{ position: 'absolute', top: 8, left: 8 }}
                      />
                      {!amenity.isActive && (
                        <Chip
                          label={t('admin.amenities.inactive')}
                          color="error"
                          size="small"
                          sx={{ position: 'absolute', top: 8, right: 8 }}
                        />
                      )}
                    </Box>
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" gutterBottom>
                        {amenity.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" paragraph>
                        {amenity.description}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('admin.amenities.order')}: {amenity.order}
                      </Typography>
                    </CardContent>
                    <Box sx={{ p: 2, pt: 0, display: 'flex', gap: 1 }}>
                      <Tooltip title={t('admin.amenities.actions.edit')}>
                        <IconButton size="small" onClick={() => handleEditAmenity(amenity)}>
                          <Edit />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('admin.amenities.actions.delete')}>
                        <IconButton size="small" color="error" onClick={() => handleDeleteAmenity(amenity)}>
                          <Delete />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Card>
                </Grid>
              ))}
            </Grid>

            {amenities.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <Star sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h5" gutterBottom>
                  {t('admin.amenities.empty.title')}
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                  {t('admin.amenities.empty.getStarted')}
                </Typography>
                <Button variant="contained" startIcon={<Add />} onClick={handleCreateAmenity}>
                  {t('admin.amenities.actions.addFirstAmenity')}
                </Button>
              </Box>
            )}

            {/* Amenity Form Dialog */}
            <Dialog
              open={formDialog.open}
              onClose={() => setFormDialog({ open: false, mode: 'create', amenity: null })}
              maxWidth="sm"
              fullWidth
            >
              <DialogTitle>
                {formDialog.mode === 'create' ? t('admin.amenities.dialog.createTitle') : t('admin.amenities.dialog.editTitle')}
              </DialogTitle>
              <DialogContent>
                <Box sx={{ mt: 2 }}>
                  <Grid container spacing={3}>
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        label={t('admin.amenities.form.name')}
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        label={t('admin.amenities.form.description')}
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        multiline
                        rows={3}
                        required
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Box>
                        <Typography variant="subtitle2" gutterBottom>
                          {t('admin.amenities.form.image')}
                        </Typography>
                        <Button variant="outlined" fullWidth sx={{ mb: 2 }} onClick={() => setMediaPickerOpen(true)}>
                          {t('admin.amenities.actions.selectFromMediaLibrary')}
                        </Button>
                        {imagePreview && (
                          <Box sx={{ mt: 2, textAlign: 'center' }}>
                            <img
                              src={imagePreview}
                              alt="Preview"
                              style={{
                                maxWidth: '100%',
                                maxHeight: '200px',
                                borderRadius: '8px',
                                border: '1px solid #ddd'
                              }}
                            />
                          </Box>
                        )}
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <FormControl fullWidth required>
                        <InputLabel>{t('admin.amenities.form.category')}</InputLabel>
                        <Select
                          value={formData.category}
                          label={t('admin.amenities.form.category')}
                          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        >
                          {categories.map((category) => (
                            <MenuItem key={category.value} value={category.value}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {category.icon}
                                {category.label}
                              </Box>
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <NumberField
                        fullWidth
                        label={t('admin.amenities.form.displayOrder')}
                        value={formData.order}
                        onChange={(val) => setFormData({ ...formData, order: val ?? 0 })}
                        min={0}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={formData.isActive}
                            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                          />
                        }
                        label={t('admin.amenities.form.active')}
                      />
                    </Grid>
                  </Grid>
                </Box>
              </DialogContent>
              <DialogActions sx={{ p: 3 }}>
                <Button
                  onClick={() => setFormDialog({ open: false, mode: 'create', amenity: null })}
                  disabled={formLoading}
                >
                  {t('admin.amenities.actions.cancel')}
                </Button>
                <Button
                  variant="contained"
                  onClick={handleFormSubmit}
                  disabled={formLoading || !formData.name || !formData.description}
                >
                  {formLoading ? <CircularProgress size={20} /> :
                    formDialog.mode === 'create' ? t('admin.amenities.actions.createAmenity') : t('admin.amenities.actions.updateAmenity')}
                </Button>
              </DialogActions>
            </Dialog>

            {/* Media Picker Dialog */}
            <MediaPicker
              open={mediaPickerOpen}
              onClose={() => setMediaPickerOpen(false)}
              multiple={false}
              categoryFilter="general"
              onSelect={(urls) => {
                const url = urls[0];
                setFormData(prev => ({ ...prev, imageUrl: url, imageFile: null }));
                setImagePreview(resolveMediaUrl(url));
              }}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog
              open={deleteDialog.open}
              onClose={() => setDeleteDialog({ open: false, amenity: null })}
            >
              <DialogTitle>{t('admin.amenities.dialog.deleteTitle')}</DialogTitle>
              <DialogContent>
                <Typography>
                  {t('admin.amenities.dialog.deletePrompt', { name: deleteDialog.amenity?.name })}
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setDeleteDialog({ open: false, amenity: null })}>
                  {t('admin.amenities.actions.cancel')}
                </Button>
                <Button onClick={handleDeleteConfirm} color="error" variant="contained">
                  {t('admin.amenities.actions.delete')}
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
          </>
        )}
      </Container>
    </AdminLayout>
  );
};

export default AmenitiesManagement;
