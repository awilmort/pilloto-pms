import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { AccountBalance } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';

/**
 * Placeholder dashboard for Phase 2.1 — the Accounting app shell has real
 * nav/auth/branding but no modules yet (those start at Phase 3+).
 */
const AccountingDashboard: React.FC = () => {
  const { t } = useTranslation();

  return (
    <AccountingLayout title={t('accounting.dashboard.title', 'Accounting Dashboard')}>
      <Paper
        elevation={0}
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          py: 10,
          px: 4,
          textAlign: 'center',
        }}
      >
        <AccountBalance sx={{ fontSize: 56, color: 'primary.main', mb: 2 }} />
        <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
          {t('accounting.dashboard.welcomeTitle', 'Welcome to Pilloto Accounting')}
        </Typography>
        <Box sx={{ maxWidth: 480, mx: 'auto' }}>
          <Typography variant="body1" color="text.secondary">
            {t(
              'accounting.dashboard.comingSoon',
              "This app is being built out module by module. Invoices, bills, inventory, and the general ledger are coming soon — for now, use Settings to manage Accounting roles and users."
            )}
          </Typography>
        </Box>
      </Paper>
    </AccountingLayout>
  );
};

export default AccountingDashboard;
