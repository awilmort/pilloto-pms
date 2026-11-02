/**
 * Channel badge (plan Phase 7.4): marks a reservation that came from an OTA with the OTA's
 * name and its own reservation code, the code staff quote to the OTA.
 */
import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import { Public } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { ChannelSource } from '../../../types';
import { channelText } from '../../../utils/channels';

interface Props {
  source?: ChannelSource | null;
  size?: 'small' | 'medium';
}

const ChannelBadge: React.FC<Props> = ({ source, size = 'small' }) => {
  const { t } = useTranslation();
  if (!source) return null;
  return (
    <Tooltip title={t('admin.reservations.channel.badgeHint')}>
      <Chip
        size={size}
        icon={<Public fontSize="small" />}
        label={channelText(source)}
        color="secondary"
        variant="outlined"
        sx={{ maxWidth: '100%' }}
      />
    </Tooltip>
  );
};

export default ChannelBadge;
