import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Box, Button, Chip, Skeleton, Stack, Tab, Tabs, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fiscalService } from '../../services/api';
import type { FiscalAlert } from '../../types';
import FiscalDocumentsTab from './FiscalDocumentsTab';
import FiscalOtherDocumentDialog from './FiscalOtherDocumentDialog';
import FiscalReceivedTab from './FiscalReceivedTab';
import FiscalSequencesTab from './FiscalSequencesTab';
import FiscalTaxReportTab from './FiscalTaxReportTab';
import { chipTone, STATE_TONE } from './fiscalUi';
import { FISCAL_PATHS, useFiscalAccess } from './useFiscalAccess';
import { useFiscalStatus } from './useFiscalStatus';

export const TABS = ['documents', 'received', 'sequences', 'report'] as const;
type TabKey = (typeof TABS)[number];

/**
 * The company's electronic invoices: issued, received, numbering, and the monthly figures. It is
 * hosted by PMS and by Accounting alike — the same company, the same documents — and only the
 * chrome around it differs. Which tab is open (`?tab=`) and which document (`?doc=`) live in the
 * URL, so any view can be linked to.
 */
const FiscalCenter: React.FC<{ showTitle?: boolean }> = ({ showTitle = true }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { app, canView, canIssue, canManage } = useFiscalAccess();
  const { status, loading } = useFiscalStatus();
  const [alerts, setAlerts] = useState<FiscalAlert[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const hasOrg = Boolean(status?.organization);
  const tabs = TABS.filter((k) => k === 'documents' || k === 'report' || hasOrg);
  const requested = params.get('tab') as TabKey | null;
  const tab: TabKey = requested && tabs.includes(requested) ? requested : 'documents';

  const loadAlerts = useCallback(async () => {
    try {
      setAlerts((await fiscalService.getAlerts()).data.data ?? []);
    } catch {
      /* alerts are a convenience: the tabs still work */
    }
  }, []);

  useEffect(() => { if (canView) void loadAlerts(); }, [canView, loadAlerts, status?.state]);

  // The Received tab's badge should be right before the tab is opened.
  useEffect(() => {
    if (!hasOrg || !canView) return;
    fiscalService.getReceived({ filter: 'undecided' }).then((res) => setPending(res.data.meta?.total ?? 0)).catch(() => undefined);
  }, [hasOrg, canView]);

  const select = (key: TabKey) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    next.delete('doc');
    setParams(next, { replace: true });
  };

  if (loading && !status) return <Stack spacing={2}><Skeleton variant="rounded" height={56} /><Skeleton variant="rounded" height={320} /></Stack>;
  if (!canView) return <Alert severity="warning">{t('fiscal.noAccess', 'You do not have access to electronic invoices.')}</Alert>;

  const state = status?.state ?? 'inactive';
  const settingsPath = FISCAL_PATHS[app].settings;
  const visibleAlerts = alerts.filter((a) => a.severity !== 'info');

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5} sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {showTitle && <Typography variant="h5" fontWeight={700}>{t('fiscal.center.title', 'Electronic invoices')}</Typography>}
          <Chip size="small" {...chipTone(STATE_TONE[state])} label={t(`fiscal.state.${state}`, state)} />
        </Stack>
        <Stack direction="row" spacing={1}>
          {canManage && (
            <Button size="small" variant="outlined" onClick={() => navigate(settingsPath)}>{t('fiscal.center.settings', 'Settings')}</Button>
          )}
          {canIssue && hasOrg && (
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setOtherOpen(true)} disabled={!status?.canIssue}>
              {t('fiscal.center.other', 'Other document')}
            </Button>
          )}
        </Stack>
      </Stack>

      {state === 'inactive' && (
        <Alert severity="info" sx={{ mb: 2 }} action={canManage ? <Button color="inherit" size="small" onClick={() => navigate(settingsPath)}>{t('fiscal.center.setUp', 'Set up')}</Button> : undefined}>
          {canManage
            ? t('fiscal.center.inactive', 'Electronic invoicing is not activated for this company yet.')
            : t('fiscal.center.inactiveAsk', 'Electronic invoicing is not activated for this company yet. Ask an administrator to set it up.')}
        </Alert>
      )}
      {(state === 'not_started' || state === 'in_progress') && (
        <Alert severity="warning" sx={{ mb: 2 }} action={canManage ? <Button color="inherit" size="small" onClick={() => navigate(settingsPath)}>{t('fiscal.center.seeProgress', 'See progress')}</Button> : undefined}>
          {status?.canIssue
            ? t('fiscal.center.testModeIssuing', 'DGII has not certified this company. This server allows issuing anyway (development only): these documents have no fiscal value.')
            : t('fiscal.center.notCertified', 'DGII has not certified this company yet, so fiscal e-CF cannot be issued. Setup is under way.')}
        </Alert>
      )}
      {state === 'suspended' && <Alert severity="error" sx={{ mb: 2 }}>{t('fiscal.suspendedNote', 'Electronic invoicing is suspended for your company, so nothing can be issued. Contact support to resume it.')}</Alert>}
      {visibleAlerts.map((a) => (
        <Alert key={a.type} severity={a.severity} sx={{ mb: 1 }}>
          {t(`fiscal.alerts.${a.type}`, { count: a.count ?? 0, defaultValue: a.type })}
        </Alert>
      ))}

      <Tabs value={tab} onChange={(_, v: TabKey) => select(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }} aria-label={t('fiscal.center.title', 'Electronic invoices')}>
        {tabs.map((k) => (
          <Tab
            key={k} value={k} id={`fiscal-tab-${k}`} aria-controls={`fiscal-panel-${k}`}
            label={k === 'received' && pending > 0
              ? <Badge color="warning" badgeContent={pending} max={99} sx={{ '& .MuiBadge-badge': { right: -14 } }}>{t(`fiscal.center.tab.${k}`, k)}</Badge>
              : t(`fiscal.center.tab.${k}`, k)}
          />
        ))}
      </Tabs>

      <Box role="tabpanel" id={`fiscal-panel-${tab}`} aria-labelledby={`fiscal-tab-${tab}`}>
        {tab === 'documents' && <FiscalDocumentsTab key={reloadKey} canIssue={canIssue && Boolean(status?.canIssue)} openId={params.get('doc') ?? undefined} onChanged={loadAlerts} />}
        {tab === 'received' && <FiscalReceivedTab canDecide={canManage} onPendingCount={setPending} />}
        {tab === 'sequences' && <FiscalSequencesTab canManage={canManage} />}
        {tab === 'report' && <FiscalTaxReportTab />}
      </Box>

      <FiscalOtherDocumentDialog
        open={otherOpen}
        onClose={() => setOtherOpen(false)}
        onIssued={() => { setReloadKey((k) => k + 1); void loadAlerts(); }}
      />
    </Box>
  );
};

export default FiscalCenter;
