import React, { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { LockOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { hasPermission } from '../../lib/permissions';
import { PLAN_PROMPT_EVENT, PlanDenialDetail } from '../../lib/planPrompt';
import { ACCOUNTING_PLANS } from '../../config/accountingPlans';
import { PLANS } from '../../config/plans';
import { featureLabel, PRODUCT_LABEL } from './subscriptionUi';

const planName = (product: 'pms' | 'accounting', slug?: string) =>
  slug ? (product === 'pms' ? (PLANS as any)[slug]?.name : (ACCOUNTING_PLANS as any)[slug]?.name) ?? slug : undefined;

/**
 * Listens for plan prompts (a refused action, a locked nav item) and explains which plan unlocks
 * it, with a link to "Plan & billing" for whoever manages the subscription. Mounted once by the
 * app shell.
 */
const UpgradePromptHost: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, resolvedAppRoles } = useAuth();
  const [detail, setDetail] = useState<PlanDenialDetail | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => setDetail((e as CustomEvent<PlanDenialDetail>).detail);
    window.addEventListener(PLAN_PROMPT_EVENT, onPrompt);
    return () => window.removeEventListener(PLAN_PROMPT_EVENT, onPrompt);
  }, []);

  if (!detail) return null;
  const { product, feature, limit, max, requiredPlan } = detail.plan;
  const inAccounting = location.pathname.startsWith('/accounting');
  const subscriptionPath = inAccounting ? '/accounting/subscription' : '/admin/subscription';
  const canManage = !!user?.isSuperAdmin || hasPermission(resolvedAppRoles, inAccounting ? 'accounting' : 'pms', inAccounting ? 'accounting.subscription' : 'admin.subscription');
  const required = planName(product, requiredPlan);

  const what = detail.code === 'PLAN_FEATURE'
    ? t('subscription.prompt.feature', '{{feature}} is not included in your {{product}} plan.', { feature: featureLabel(t, product, feature ?? ''), product: PRODUCT_LABEL[product] })
    : t(`subscription.prompt.limit.${limit}`, 'Your plan allows up to {{max}}.', { max });

  return (
    <Dialog open onClose={() => setDetail(null)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LockOutlined color="primary" /> {t('subscription.prompt.title', 'Available on a higher plan')}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          {what}{' '}
          {required
            ? t('subscription.prompt.required', 'It is included from the {{plan}} plan.', { plan: required })
            : t('subscription.prompt.contact', 'Contact Pilloto to go beyond it.')}
        </DialogContentText>
        {!canManage && (
          <DialogContentText sx={{ mt: 1.5 }}>{t('subscription.prompt.askOwner', 'Ask your account owner to change the plan.')}</DialogContentText>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDetail(null)}>{t('common.close', 'Close')}</Button>
        {canManage && (
          <Button variant="contained" onClick={() => { setDetail(null); navigate(subscriptionPath); }}>
            {t('subscription.prompt.cta', 'See plans')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default UpgradePromptHost;
