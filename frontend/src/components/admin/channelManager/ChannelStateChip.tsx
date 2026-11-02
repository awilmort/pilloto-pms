/** A channel's state as a coloured chip, in words (plan Phase 8.1). */
import React from 'react';
import { Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ChannelState } from '../../../services/api';

const COLOR: Record<ChannelState, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  active: 'success', attention: 'error', waiting_ota: 'info', needs_mapping: 'warning', ready_to_activate: 'info',
  inactive: 'default', removal_scheduled: 'warning', removed: 'default',
};

const ChannelStateChip: React.FC<{ state: ChannelState }> = ({ state }) => {
  const { t } = useTranslation();
  return <Chip size="small" color={COLOR[state] ?? 'default'} label={t(`admin.channelManager.channels.state.${state}`)} />;
};

export default ChannelStateChip;
