import React, { useEffect, useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  Card,
  CardActionArea,
  CardMedia,
  CardContent,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
  Tabs,
  Tab,
} from '@mui/material';
import { mediaService, resolveMediaUrl } from '../../services/api';
import { MediaItem } from '../../types';
import { ILLUSTRATION_CATALOG } from '../illustrations/catalog';

interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (urls: string[]) => void;
  multiple?: boolean;
  categoryFilter?: string;
}

const MediaPicker: React.FC<MediaPickerProps> = ({ open, onClose, onSelect, multiple = true, categoryFilter }) => {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>(categoryFilter || 'all');
  const [tab, setTab] = useState(0);

  const loadMedia = useCallback(async () => {
    const params: any = { type: 'image', limit: 100 };
    if (category !== 'all') params.category = category;
    const res = await mediaService.getMedia(params);
    setMedia(res.data.data || []);
  }, [category]);

  useEffect(() => {
    if (open) {
      loadMedia();
      setSelected([]);
      setTab(0);
    }
  }, [open, category, loadMedia]);

  const toggleSelect = (url: string) => {
    if (multiple) {
      setSelected((prev) => prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url]);
    } else {
      setSelected([url]);
    }
  };

  const filtered = media.filter(m =>
    (m.title || '').toLowerCase().includes(search.toLowerCase())
  );

  const filteredIllustrations = ILLUSTRATION_CATALOG.filter(entry =>
    entry.label.toLowerCase().includes(search.toLowerCase())
  );

  const getUrl = (url: string) => resolveMediaUrl(url);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Select Media</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setSelected([]); }} sx={{ mb: 2 }}>
          <Tab label="Uploaded Images" />
          <Tab label="Illustrations" />
        </Tabs>

        {tab === 0 && (
          <>
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <TextField
                fullWidth
                label="Search by title"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <FormControl sx={{ minWidth: 160 }}>
                <InputLabel>Category</InputLabel>
                <Select value={category} label="Category" onChange={(e) => setCategory(e.target.value)}>
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="rooms">Rooms</MenuItem>
                  <MenuItem value="aquapark">Aquapark</MenuItem>
                  <MenuItem value="facilities">Facilities</MenuItem>
                  <MenuItem value="dining">Dining</MenuItem>
                  <MenuItem value="activities">Activities</MenuItem>
                  <MenuItem value="general">General</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Grid container spacing={2}>
              {filtered.map((item) => {
                const isSelected = selected.includes(item.url);
                return (
                  <Grid item xs={12} sm={6} md={4} key={item._id}>
                    <Card variant={isSelected ? 'outlined' : undefined} sx={{ borderColor: isSelected ? 'primary.main' : undefined }}>
                      <CardActionArea onClick={() => toggleSelect(item.url)}>
                        <CardMedia component="img" height="140" image={getUrl(item.url)} alt={item.title} />
                        <CardContent>
                          <Typography variant="subtitle2" noWrap>{item.title}</Typography>
                          <Typography variant="caption" color="text.secondary">{item.category}</Typography>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </>
        )}

        {tab === 1 && (
          <>
            <Box sx={{ mb: 2 }}>
              <TextField
                fullWidth
                label="Search illustrations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Box>
            <Grid container spacing={2}>
              {filteredIllustrations.map((entry) => {
                const illustrationUrl = `illustration:${entry.key}`;
                const isSelected = selected.includes(illustrationUrl);
                const Comp = entry.component;
                return (
                  <Grid item xs={6} sm={4} md={3} key={entry.key}>
                    <Card
                      variant={isSelected ? 'outlined' : undefined}
                      sx={{ borderColor: isSelected ? 'primary.main' : undefined, borderWidth: isSelected ? 2 : undefined }}
                    >
                      <CardActionArea onClick={() => toggleSelect(illustrationUrl)}>
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 120, bgcolor: '#F9FAFB' }}>
                          <Comp width={100} height={80} />
                        </Box>
                        <CardContent sx={{ py: 1 }}>
                          <Typography variant="subtitle2" align="center" noWrap>{entry.label}</Typography>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => { onSelect(selected); onClose(); }} disabled={selected.length === 0}>Select</Button>
      </DialogActions>
    </Dialog>
  );
};

export default MediaPicker;