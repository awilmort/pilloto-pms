/**
 * Plain-language glossary for the Channel Manager screens (architecture §8.2): a button that
 * opens a popover with every term, available on each screen.
 */
import React, { useState } from 'react';
import { Box, Button, Popover, Typography } from '@mui/material';
import { MenuBook } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export const CHANNEL_TERMS = ['channelManager', 'ota', 'channel', 'mapping', 'roomTypeRate', 'fullSync', 'availability', 'ratesIncludeTaxes', 'overbooking'] as const;

const ChannelGlossary: React.FC = () => {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button size="small" startIcon={<MenuBook />} onClick={(e) => setAnchor(e.currentTarget)}>{t('admin.channelManager.glossary.button')}</Button>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ p: 2, maxWidth: 420, maxHeight: 480, overflowY: 'auto' }}>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>{t('admin.channelManager.glossary.title')}</Typography>
          {CHANNEL_TERMS.map((term) => (
            <Box key={term} sx={{ mb: 1.25 }}>
              <Typography variant="body2" fontWeight={600}>{t(`admin.channelManager.glossary.${term}.term`)}</Typography>
              <Typography variant="body2" color="text.secondary">{t(`admin.channelManager.glossary.${term}.text`)}</Typography>
            </Box>
          ))}
        </Box>
      </Popover>
    </>
  );
};

export default ChannelGlossary;
