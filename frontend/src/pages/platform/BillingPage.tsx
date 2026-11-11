/**
 * Platform console → Billing: how Pilloto charges its tenants. The price list, each tenant's
 * contract, the monthly charges, the payments recorded against them (recording one issues the
 * e-CF), and Pilloto's own e-invoicing setup. Superadmin only.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../services/api';
import type { BillingOverview } from '../../types/billing';
import ChargesTab from '../../components/platform/billing/ChargesTab';
import IssuerTab from '../../components/platform/billing/IssuerTab';
import OverviewCards from '../../components/platform/billing/OverviewCards';
import PaymentsTab from '../../components/platform/billing/PaymentsTab';
import PlansTab from '../../components/platform/billing/PlansTab';
import SettingsTab from '../../components/platform/billing/SettingsTab';
import TenantsTab from '../../components/platform/billing/TenantsTab';
import PlatformLayout from './PlatformLayout';

export const BILLING_TABS = ['charges', 'payments', 'tenants', 'plans', 'settings', 'ecf'] as const;
type BillingTab = (typeof BILLING_TABS)[number];

const BillingPage: React.FC = () => {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as BillingTab | null;
  const tab: BillingTab = requested && BILLING_TABS.includes(requested) ? requested : 'charges';
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [chargeId, setChargeId] = useState<string | null>(null);

  const loadOverview = useCallback(() => {
    platformBillingService.overview().then((r) => setOverview(r.data.data ?? null)).catch(() => setOverview(null));
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const go = (next: BillingTab) => setParams({ tab: next }, { replace: false });

  return (
    <PlatformLayout>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>{t('platformBilling.title', 'Billing')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('platformBilling.subtitle', 'What tenants owe Pilloto, what they paid, and the e-CF each payment issues.')}
      </Typography>

      <OverviewCards overview={overview} onNavigate={go} />

      <Tabs value={tab} onChange={(_, v) => go(v)} variant="scrollable" scrollButtons={false} sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
        {BILLING_TABS.map((k) => <Tab key={k} value={k} label={t(`platformBilling.tabs.${k}`, k)} />)}
      </Tabs>

      <Box>
        {tab === 'charges' && <ChargesTab issuerReady={overview?.issuer.state === 'ready'} onChanged={loadOverview} initialChargeId={chargeId} />}
        {tab === 'payments' && <PaymentsTab onChanged={loadOverview} />}
        {tab === 'tenants' && <TenantsTab onChanged={loadOverview} onOpenCharge={(c) => { setChargeId(c.id); go('charges'); }} />}
        {tab === 'plans' && <PlansTab />}
        {tab === 'settings' && <SettingsTab onSaved={loadOverview} />}
        {tab === 'ecf' && <IssuerTab onChanged={loadOverview} />}
      </Box>
    </PlatformLayout>
  );
};

export default BillingPage;
