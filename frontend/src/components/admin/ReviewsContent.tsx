import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
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
  Switch,
  CircularProgress,
  Alert,
  Rating,
  Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { reviewsService, ReviewData } from '../../services/api';
import NumberField from '../common/NumberField';

const SOURCES = ['Google', 'TripAdvisor', 'Booking.com', 'Expedia', 'Direct', 'Other'];

interface ReviewForm {
  _id?: string;
  guestName: string;
  rating: number;
  comment: string;
  source: string;
  isActive: boolean;
  displayOrder: number;
}

const emptyForm: ReviewForm = {
  guestName: '',
  rating: 5,
  comment: '',
  source: 'Direct',
  isActive: true,
  displayOrder: 0,
};

const ReviewsContent: React.FC = () => {
  const { t } = useTranslation();
  const [reviews, setReviews] = useState<ReviewData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ReviewForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await reviewsService.getReviews();
      setReviews(res.data?.data || []);
    } catch {
      setError(t('admin.reviews.messages.loadFailed', 'Failed to load reviews.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (r: ReviewData) => {
    setForm({
      _id: r._id,
      guestName: r.guestName,
      rating: r.rating,
      comment: r.comment,
      source: r.source,
      isActive: r.isActive,
      displayOrder: r.displayOrder,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (form._id) {
        await reviewsService.updateReview(form._id, form);
      } else {
        await reviewsService.createReview(form);
      }
      setDialogOpen(false);
      load();
    } catch {
      setError(t('admin.reviews.messages.saveFailed', 'Failed to save review.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await reviewsService.deleteReview(id);
      load();
    } catch {
      setError(t('admin.reviews.messages.deleteFailed', 'Failed to delete review.'));
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        {t('admin.reviews.heading', 'Guest Reviews')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('admin.reviews.description', 'Manage customer reviews displayed on your public booking page. Active reviews appear in the Trust & Credibility bar.')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
          {t('admin.reviews.actions.add', 'Add Review')}
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.reviews.table.guest', 'Guest')}</TableCell>
              <TableCell>{t('admin.reviews.table.rating', 'Rating')}</TableCell>
              <TableCell>{t('admin.reviews.table.comment', 'Comment')}</TableCell>
              <TableCell>{t('admin.reviews.table.source', 'Source')}</TableCell>
              <TableCell>{t('admin.reviews.table.status', 'Status')}</TableCell>
              <TableCell>{t('admin.reviews.table.actions', 'Actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reviews.map(r => (
              <TableRow key={r._id}>
                <TableCell>{r.guestName}</TableCell>
                <TableCell>
                  <Rating value={r.rating} readOnly size="small" />
                </TableCell>
                <TableCell sx={{ maxWidth: 300 }}>
                  <Typography variant="body2" noWrap>
                    {r.comment}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={r.source} size="small" variant="outlined" />
                </TableCell>
                <TableCell>
                  <Chip
                    label={r.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
                    color={r.isActive ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <IconButton size="small" onClick={() => openEdit(r)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(r._id!)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {reviews.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  {t('admin.reviews.empty', 'No reviews yet. Add your first customer review.')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Review Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {form._id
            ? t('admin.reviews.dialog.editTitle', 'Edit Review')
            : t('admin.reviews.dialog.newTitle', 'New Review')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField
              label={t('admin.reviews.form.guestName', 'Guest Name')}
              value={form.guestName}
              onChange={e => setForm(f => ({ ...f, guestName: e.target.value.slice(0, 120) }))}
              required
              fullWidth
              inputProps={{ maxLength: 120 }}
            />
            <Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {t('admin.reviews.form.rating', 'Rating')}
              </Typography>
              <Rating
                value={form.rating}
                onChange={(_, val) => setForm(f => ({ ...f, rating: val || 1 }))}
              />
            </Box>
            <TextField
              label={t('admin.reviews.form.comment', 'Comment')}
              value={form.comment}
              onChange={e => setForm(f => ({ ...f, comment: e.target.value.slice(0, 500) }))}
              required
              fullWidth
              multiline
              rows={3}
              inputProps={{ maxLength: 500 }}
              helperText={`${form.comment.length}/500`}
            />
            <FormControl fullWidth>
              <InputLabel>{t('admin.reviews.form.source', 'Source')}</InputLabel>
              <Select
                value={form.source}
                label={t('admin.reviews.form.source', 'Source')}
                onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
              >
                {SOURCES.map(s => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <NumberField
              label={t('admin.reviews.form.displayOrder', 'Display Order')}
              value={form.displayOrder}
              onChange={val => setForm(f => ({ ...f, displayOrder: val ?? 0 }))}
              min={0}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.isActive}
                  onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                />
              }
              label={t('admin.reviews.form.active', 'Active (visible on booking page)')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>
            {t('admin.pricing.actions.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !form.guestName.trim() || !form.comment.trim()}
          >
            {saving ? t('common.saving', 'Saving…') : t('admin.pricing.actions.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ReviewsContent;
