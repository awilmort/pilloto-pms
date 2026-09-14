import React from 'react';
import { Box, Paper, Tab, Tabs, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import { RolesContent } from '../admin/RolesManagement';
import { UsersContent } from '../admin/UsersManagement';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => (
  <div role="tabpanel" hidden={value !== index} id={`accounting-settings-tabpanel-${index}`}>
    {value === index && <Box sx={{ pt: 3, px: 3, pb: 3 }}>{children}</Box>}
  </div>
);

/**
 * Accounting Settings — reuses the shared, app-aware Roles/Users management
 * from Phase 1.3 (`RolesContent`/`UsersContent`), scoped to `accounting` via
 * their route-based default (`getAppFromPath`). Mirrors the tabbed layout of
 * `pages/admin/Settings.tsx` but only carries the tabs relevant here.
 */
const AccountingSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = React.useState(0);

  return (
    <AccountingLayout title={t('accounting.settings.title', 'Settings')}>
      <Box sx={{ pb: 4 }}>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          {t('accounting.settings.subtitle', 'Manage Accounting roles and users.')}
        </Typography>

        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)} aria-label="accounting settings tabs">
              <Tab label={t('accounting.settings.tabs.roles', 'Roles')} id="accounting-settings-tab-0" />
              <Tab label={t('accounting.settings.tabs.users', 'Users')} id="accounting-settings-tab-1" />
            </Tabs>
          </Box>

          <TabPanel value={activeTab} index={0}>
            <RolesContent />
          </TabPanel>
          <TabPanel value={activeTab} index={1}>
            <UsersContent />
          </TabPanel>
        </Paper>
      </Box>
    </AccountingLayout>
  );
};

export default AccountingSettingsPage;
