import React, { useEffect, useState, useCallback } from 'react';
import {
  Container,
  Typography,
  Box,
  Grid,
  Card,
  CardMedia,
  CardContent,
  CardActions,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  IconButton,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Add, Edit, Delete } from '@mui/icons-material';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import { mediaService, resolveMediaUrl } from '../../services/api';
import { MediaItem } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

const MediaManagement: React.FC = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [snackbar, setSnackbar] = useState<{open: boolean; message: string; severity: 'success'|'error'}>({ open: false, message: '', severity: 'success' });
  const [loading, setLoading] = useState(false);

  // Upload form state
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [filename, setFilename] = useState('');
  const [category, setCategory] = useState('general');
  const [isFeatured, setIsFeatured] = useState(false);
  const [isPublic, setIsPublic] = useState(true);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [editTags, setEditTags] = useState('');
  const [editFeatured, setEditFeatured] = useState(false);
  const [editPublic, setEditPublic] = useState(true);

  const loadMedia = useCallback(async () => {
    try {
      setLoading(true);
      const res = await mediaService.getMedia({ limit: 200 });
      setItems(res.data.data || []);
    } catch (e: any) {
      console.error('Failed to load media', e);
      setSnackbar({ open: true, message: t('admin.media.messages.loadFailed'), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  const handleUpload = async () => {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);
      if (filename) formData.append('filename', filename);
      formData.append('category', category);
      formData.append('isFeatured', String(isFeatured));
      formData.append('isPublic', String(isPublic));
      const res = await mediaService.uploadMedia(formData);
      if (res.data.success) {
        setSnackbar({ open: true, message: t('admin.media.messages.uploaded'), severity: 'success' });
        setUploadOpen(false);
        setFile(null); setTitle(''); setFilename(''); setCategory('general'); setIsFeatured(false); setIsPublic(true);
        loadMedia();
      }
    } catch (e: any) {
      console.error('Upload failed', e);
      setSnackbar({ open: true, message: e.response?.data?.message || t('admin.media.messages.uploadFailed'), severity: 'error' });
    }
  };

  const openEdit = (item: MediaItem) => {
    setSelectedItem(item);
    setEditTitle(item.title);
    setEditDescription(item.description || '');
    setEditCategory(item.category);
    setEditTags(item.tags?.join(', ') || '');
    setEditFeatured(item.isFeatured);
    setEditPublic(item.isPublic);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!selectedItem) return;
    try {
      const res = await mediaService.updateMedia(selectedItem._id, {
        title: editTitle,
        description: editDescription,
        category: editCategory,
        tags: editTags,
        isFeatured: editFeatured,
        isPublic: editPublic,
      });
      if (res.data.success) {
        setSnackbar({ open: true, message: t('admin.media.messages.updated'), severity: 'success' });
        setEditOpen(false);
        loadMedia();
      }
    } catch (e: any) {
      console.error('Update failed', e);
      setSnackbar({ open: true, message: e.response?.data?.message || t('admin.media.messages.updateFailed'), severity: 'error' });
    }
  };

  const deleteItem = async (item: MediaItem) => {
    if (!window.confirm(t('admin.media.confirm.deleteItem'))) return;
    try {
      const res = await mediaService.deleteMedia(item._id);
      if (res.data.success) {
        setSnackbar({ open: true, message: t('admin.media.messages.deleted'), severity: 'success' });
        loadMedia();
      }
    } catch (e: any) {
      console.error('Delete failed', e);
      setSnackbar({ open: true, message: e.response?.data?.message || t('admin.media.messages.deleteFailed'), severity: 'error' });
    }
  };

  const getUrl = (url: string) => resolveMediaUrl(url);

  if (!user || user.role !== 'admin') {
    return (
      <AdminLayout>
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Alert severity="error">{t('admin.common.accessDenied')}</Alert>
        </Container>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <SectionTitle
          title={t('admin.media.title')}
          right={
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button startIcon={<Add />} variant="contained" onClick={() => setUploadOpen(true)}>{t('admin.media.buttons.upload')}</Button>
              <Button variant="outlined" onClick={async () => {
                try {
                  setLoading(true);
                  const res = await mediaService.syncUploads();
                  setSnackbar({ open: true, message: res.data.message || t('admin.media.messages.syncComplete'), severity: 'success' });
                  await loadMedia();
                } catch (e: any) {
                  setSnackbar({ open: true, message: e.response?.data?.message || t('admin.media.messages.syncFailed'), severity: 'error' });
                } finally {
                  setLoading(false);
                }
              }}>{t('admin.media.buttons.syncUploads')}</Button>
            </Box>
          }
        />

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress size={48} />
          </Box>
        ) : items.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" color="text.secondary">{t('admin.media.empty.title')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('admin.media.empty.subtitle')}</Typography>
            <Button startIcon={<Add />} variant="contained" onClick={() => setUploadOpen(true)}>{t('admin.media.empty.ctaUpload')}</Button>
          </Box>
        ) : (
        <Grid container spacing={3}>
          {items.map(item => (
            <Grid item xs={12} sm={6} md={4} key={item._id}>
              <Card>
                <CardMedia
                  component="img"
                  height="160"
                  image={getUrl(item.url)}
                  alt={item.title}
                  onError={(e) => { (e.target as HTMLImageElement).src = '/api/placeholder/400/300'; }}
                />
                <CardContent>
                  <Typography variant="subtitle1" noWrap>{item.title}</Typography>
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    <Chip size="small" label={item.category} />
                    {item.isFeatured && <Chip size="small" color="warning" label={t('admin.media.labels.featured')} />}
                    {!item.isPublic && <Chip size="small" color="error" label={t('admin.media.labels.private')} />}
                  </Box>
                </CardContent>
                <CardActions>
                  <IconButton onClick={() => openEdit(item)}><Edit /></IconButton>
                  <IconButton color="error" onClick={() => deleteItem(item)}><Delete /></IconButton>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
        )}

        {/* Upload Dialog */}
        <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{t('admin.media.dialog.uploadTitle')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <Button variant="outlined" component="label">
                {file ? file.name : 'Choose file'}
                <input type="file" hidden accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </Button>
              <TextField label={t('admin.media.labels.title')} value={title} onChange={(e) => setTitle(e.target.value)} />
              <TextField
                label={t('admin.media.labels.filename')}
                helperText={t('admin.media.labels.filenameHelper')}
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
              />
              <FormControl>
                <InputLabel>{t('admin.media.labels.category')}</InputLabel>
                <Select value={category} label={t('admin.media.labels.category')} onChange={(e) => setCategory(e.target.value)}>
                  <MenuItem value="general">{t('admin.media.categories.general')}</MenuItem>
                  <MenuItem value="rooms">{t('admin.media.categories.rooms')}</MenuItem>
                  <MenuItem value="aquapark">{t('admin.media.categories.aquapark')}</MenuItem>
                  <MenuItem value="facilities">{t('admin.media.categories.facilities')}</MenuItem>
                  <MenuItem value="dining">{t('admin.media.categories.dining')}</MenuItem>
                  <MenuItem value="activities">{t('admin.media.categories.activities')}</MenuItem>
                </Select>
              </FormControl>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button variant={isFeatured ? 'contained' : 'outlined'} onClick={() => setIsFeatured(v => !v)}>{t('admin.media.labels.featured')}</Button>
                <Button variant={isPublic ? 'contained' : 'outlined'} onClick={() => setIsPublic(v => !v)}>{isPublic ? t('admin.media.labels.public') : t('admin.media.labels.private')}</Button>
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setUploadOpen(false)}>{t('admin.media.buttons.cancel')}</Button>
            <Button variant="contained" onClick={handleUpload} disabled={!file}>{t('admin.media.buttons.upload')}</Button>
          </DialogActions>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{t('admin.media.dialog.editTitle')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <TextField label={t('admin.media.labels.title')} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              <TextField label={t('admin.media.labels.description')} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} multiline rows={3} />
              <FormControl>
                <InputLabel>{t('admin.media.labels.category')}</InputLabel>
                <Select value={editCategory} label={t('admin.media.labels.category')} onChange={(e) => setEditCategory(e.target.value)}>
                  <MenuItem value="general">{t('admin.media.categories.general')}</MenuItem>
                  <MenuItem value="rooms">{t('admin.media.categories.rooms')}</MenuItem>
                  <MenuItem value="aquapark">{t('admin.media.categories.aquapark')}</MenuItem>
                  <MenuItem value="facilities">{t('admin.media.categories.facilities')}</MenuItem>
                  <MenuItem value="dining">{t('admin.media.categories.dining')}</MenuItem>
                  <MenuItem value="activities">{t('admin.media.categories.activities')}</MenuItem>
                </Select>
              </FormControl>
              <TextField label={t('admin.media.labels.tags')} value={editTags} onChange={(e) => setEditTags(e.target.value)} />
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button variant={editFeatured ? 'contained' : 'outlined'} onClick={() => setEditFeatured(v => !v)}>{t('admin.media.labels.featured')}</Button>
                <Button variant={editPublic ? 'contained' : 'outlined'} onClick={() => setEditPublic(v => !v)}>{editPublic ? t('admin.media.labels.public') : t('admin.media.labels.private')}</Button>
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditOpen(false)}>{t('admin.media.buttons.cancel')}</Button>
            <Button variant="contained" onClick={saveEdit} disabled={!selectedItem}>{t('admin.media.buttons.save')}</Button>
          </DialogActions>
        </Dialog>

        <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>{snackbar.message}</Alert>
        </Snackbar>
      </Container>
    </AdminLayout>
  );
};

export default MediaManagement;