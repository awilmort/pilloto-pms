import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import { EcfEstadoECF } from '../../types';
import { useTranslation } from 'react-i18next';

interface EcfStatusBadgeProps {
  status: EcfEstadoECF;
  /** Optional size override */
  size?: 'small' | 'medium';
}

const STATUS_CONFIG: Record<
  EcfEstadoECF,
  { color: 'success' | 'warning' | 'error' | 'info' | 'default'; tooltipKey?: string }
> = {
  Aceptado: { color: 'success' },
  'Aceptado Condicional': {
    color: 'warning',
    tooltipKey: 'admin.settings.ecfInvoices.statusTooltip.aceptadoCondicional',
  },
  Rechazado: { color: 'error', tooltipKey: 'admin.settings.ecfInvoices.statusTooltip.rechazado' },
  Error: { color: 'error', tooltipKey: 'admin.settings.ecfInvoices.statusTooltip.errorInterno' },
  'En Proceso': { color: 'info', tooltipKey: 'admin.settings.ecfInvoices.statusTooltip.enProceso' },
  'Emitido Contingencia': {
    color: 'warning',
    tooltipKey: 'admin.settings.ecfInvoices.statusTooltip.contingencia',
  },
  Pendiente: { color: 'default' },
};

const EcfStatusBadge: React.FC<EcfStatusBadgeProps> = ({ status, size = 'small' }) => {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status] ?? { color: 'default' as const };
  const label = t(`admin.settings.ecfInvoices.status.${status.replace(' ', '_')}`, status);

  const chip = (
    <Chip
      label={label}
      color={config.color}
      size={size}
      sx={{ fontWeight: 500 }}
    />
  );

  if (config.tooltipKey) {
    return (
      <Tooltip title={t(config.tooltipKey, '')} arrow>
        <span>{chip}</span>
      </Tooltip>
    );
  }

  return chip;
};

export default EcfStatusBadge;
