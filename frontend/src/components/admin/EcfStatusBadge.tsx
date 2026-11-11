import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { EcfEstadoECF } from '../../types';
import { chipTone, estadoKey, estadoMeta } from '../fiscal/fiscalUi';

interface EcfStatusBadgeProps {
  status: EcfEstadoECF;
  size?: 'small' | 'medium';
}

/** The state of an e-CF as a chip, with a tooltip saying what it means and what happens next. */
const EcfStatusBadge: React.FC<EcfStatusBadgeProps> = ({ status, size = 'small' }) => {
  const { t } = useTranslation();
  const { tone } = estadoMeta(status);
  const label = t(estadoKey(status), status);
  const hint = t(`${estadoKey(status)}_hint`, { defaultValue: '' });

  const { color, sx } = chipTone(tone);
  const chip = <Chip label={label} color={color} size={size} variant={tone === 'default' ? 'outlined' : 'filled'} sx={{ fontWeight: 500, ...sx }} />;
  return hint ? (
    <Tooltip title={hint} arrow>
      <span>{chip}</span>
    </Tooltip>
  ) : chip;
};

export default EcfStatusBadge;
