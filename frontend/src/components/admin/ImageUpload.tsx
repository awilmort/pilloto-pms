import React, { useState } from 'react';
import {
  Box,
  Button,
  Typography,
  Alert,
  LinearProgress,
  IconButton,
  Grid,
  Card,
  CardMedia,
  CardActions,
  Chip,
} from '@mui/material';
import {
  CloudUpload,
  Delete,
  Image,
  Star,
  StarBorder,
  ArrowUpward,
  ArrowDownward,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { mediaService, resolveMediaUrl } from '../../services/api';

interface ImageUploadProps {
  images: string[];
  onImagesChange: (images: string[]) => void;
  maxImages?: number;
}

const ImageUpload: React.FC<ImageUploadProps> = ({
  images,
  onImagesChange,
  maxImages = 5
}) => {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (images.length + files.length > maxImages) {
      setError(t('admin.imageUpload.maxImages', { count: maxImages }));
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', t('admin.imageUpload.photoTitle', { name: file.name }));
        formData.append('category', 'rooms');
        formData.append('isPublic', 'true');

        const response = await mediaService.uploadMedia(formData);
        if (response.data.success && response.data.data) {
          return response.data.data.url || '/api/placeholder/400/300';
        }
        throw new Error(t('admin.imageUpload.uploadFailed'));
      });

      const uploadedUrls = await Promise.all(uploadPromises);
      onImagesChange([...images, ...uploadedUrls]);
    } catch (error: any) {
      console.error('Upload error:', error);
      setError(t('admin.imageUpload.uploadFailedRetry'));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    onImagesChange(newImages);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newImages = [...images];
    [newImages[index - 1], newImages[index]] = [newImages[index], newImages[index - 1]];
    onImagesChange(newImages);
  };

  const handleMoveDown = (index: number) => {
    if (index === images.length - 1) return;
    const newImages = [...images];
    [newImages[index], newImages[index + 1]] = [newImages[index + 1], newImages[index]];
    onImagesChange(newImages);
  };

  const handleSetPrimary = (index: number) => {
    if (index === 0) return;
    const newImages = [...images];
    const [selectedImage] = newImages.splice(index, 1);
    newImages.unshift(selectedImage);
    onImagesChange(newImages);
  };

  const handleUrlAdd = () => {
    const url = prompt(t('admin.imageUpload.enterUrl'));
    if (url && url.trim()) {
      if (images.length >= maxImages) {
        setError(t('admin.imageUpload.maxImages', { count: maxImages }));
        return;
      }
      onImagesChange([...images, url.trim()]);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom>
        {t('admin.imageUpload.title', { max: maxImages })}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {uploading && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('admin.imageUpload.uploading')}
          </Typography>
          <LinearProgress variant="indeterminate" />
        </Box>
      )}

      {/* Upload Controls */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          component="label"
          startIcon={<CloudUpload />}
          disabled={uploading || images.length >= maxImages}
        >
          {t('admin.imageUpload.upload')}
          <input
            type="file"
            hidden
            multiple
            accept="image/*"
            onChange={handleFileSelect}
          />
        </Button>

        <Button
          variant="outlined"
          startIcon={<Image />}
          onClick={handleUrlAdd}
          disabled={images.length >= maxImages}
        >
          {t('admin.imageUpload.addUrl')}
        </Button>
      </Box>

      {/* Image Preview Grid */}
      {images.length > 0 && (
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('admin.imageUpload.primaryHint')}
          </Typography>
          <Grid container spacing={2}>
            {images.map((image, index) => (
              <Grid item xs={12} sm={6} md={4} key={index}>
                <Card sx={{ position: 'relative' }}>
                  {index === 0 && (
                    <Chip
                      label={t('admin.imageUpload.primary')}
                      color="primary"
                      size="small"
                      icon={<Star />}
                      sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        zIndex: 1,
                      }}
                    />
                  )}
                  <CardMedia
                    component="img"
                    height="150"
                    image={resolveMediaUrl(image)}
                    alt={t('admin.imageUpload.imageAlt', { n: index + 1 })}
                    sx={{
                      objectFit: 'cover',
                      backgroundColor: 'grey.100'
                    }}
                    onError={(e) => {
                      // Fallback to placeholder if image fails to load
                      (e.target as HTMLImageElement).src = '/api/placeholder/300/150';
                    }}
                  />
                  <CardActions sx={{ justifyContent: 'space-between', p: 1 }}>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {index !== 0 && (
                        <IconButton
                          size="small"
                          onClick={() => handleSetPrimary(index)}
                          title={t('admin.imageUpload.setPrimary')}
                        >
                          <StarBorder />
                        </IconButton>
                      )}
                      {index > 0 && (
                        <IconButton
                          size="small"
                          onClick={() => handleMoveUp(index)}
                          title={t('admin.imageUpload.moveUp')}
                        >
                          <ArrowUpward />
                        </IconButton>
                      )}
                      {index < images.length - 1 && (
                        <IconButton
                          size="small"
                          onClick={() => handleMoveDown(index)}
                          title={t('admin.imageUpload.moveDown')}
                        >
                          <ArrowDownward />
                        </IconButton>
                      )}
                    </Box>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => handleRemoveImage(index)}
                      title={t('admin.imageUpload.removeImage')}
                    >
                      <Delete />
                    </IconButton>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {images.length === 0 && (
        <Box
          sx={{
            border: '2px dashed',
            borderColor: 'divider',
            borderRadius: 2,
            p: 4,
            textAlign: 'center',
            backgroundColor: 'grey.50'
          }}
        >
          <Image sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="body1" color="text.secondary" gutterBottom>
            {t('admin.imageUpload.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('admin.imageUpload.emptyHint')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('admin.imageUpload.emptyPrimary')}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default ImageUpload;
