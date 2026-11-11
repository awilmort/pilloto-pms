import React from 'react';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import EcfStatusBadge from '../../admin/EcfStatusBadge';
import type { BillingPayment } from '../../../types/billing';
import { ecfState } from './billingUi';

/** The e-CF of a payment at a glance: its number and DGII's state, or why there is none yet. */
const EcfCell: React.FC<{ payment: BillingPayment }> = ({ payment }) => {
  const { t } = useTranslation();
  const state = ecfState(payment);

  if (state === 'reversed') {
    return <Chip size="small" variant="outlined" label={t('platformBilling.payments.reversedChip', 'Reversed')} />;
  }
  if (!payment.ecf) {
    return (
      <Tooltip title={payment.ecfError ?? t('platformBilling.payments.noEcfYet', 'The e-CF has not been issued yet.')} arrow>
        <Chip size="small" color="error" variant="outlined" label={t('platformBilling.payments.noEcf', 'No e-CF')} />
      </Tooltip>
    );
  }
  return (
    <Box>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 0.25 }}>{payment.ecf.eNCF ?? '—'}</Typography>
      <EcfStatusBadge status={payment.ecf.estado} />
      {payment.ecf.environment && payment.ecf.environment !== 'ecf' && (
        <Chip size="small" variant="outlined" sx={{ ml: 0.5 }} label={t('platformBilling.payments.testEnv', 'TEST')} />
      )}
    </Box>
  );
};

export default EcfCell;
