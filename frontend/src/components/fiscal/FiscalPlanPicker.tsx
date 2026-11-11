import React from 'react';
import { Box, Chip, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { FiscalPlanId, FiscalPlanOption } from '../../types';
import { formatDop } from './fiscalUi';
import i18n from '../../i18n';

interface Props {
  plans: FiscalPlanOption[];
  value: FiscalPlanId;
  onChange: (plan: FiscalPlanId) => void;
  /** The plan currently in force, marked as such. */
  currentPlan?: FiscalPlanId | null;
  disabled?: boolean;
  name?: string;
}

/**
 * The BillingSoft plans as choices. Each shows what the *company* pays for it — its price less
 * whatever its Pilloto plan includes — so "included" reads as RD$0 and a larger plan shows only the
 * difference. A plan below what the Pilloto plan includes cannot be chosen.
 */
const FiscalPlanPicker: React.FC<Props> = ({ plans, value, onChange, currentPlan, disabled, name = 'fiscal-plan' }) => {
  const { t } = useTranslation();
  return (
    <RadioGroup
      row
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value as FiscalPlanId)}
      aria-label={t('fiscal.plan.pickerLabel', 'Electronic invoicing plan')}
      sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}
    >
      {plans.map((plan) => {
        const selected = plan.id === value;
        const unavailable = !plan.selectable || disabled;
        return (
          <Box
            key={plan.id}
            component="label"
            htmlFor={`${name}-${plan.id}`}
            sx={{
              display: 'block',
              p: 2,
              borderRadius: 2,
              border: '2px solid',
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? 'action.selected' : 'background.paper',
              opacity: unavailable && !selected ? 0.55 : 1,
              cursor: unavailable ? 'not-allowed' : 'pointer',
              transition: 'border-color .15s, background-color .15s',
              '&:hover': unavailable ? undefined : { borderColor: 'primary.light' },
            }}
          >
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
              <Box>
                <Typography variant="subtitle1" fontWeight={700}>{t(`fiscal.plan.${plan.id}`, plan.id)}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('fiscal.plan.perMonth', { count: plan.transactions, defaultValue: '{{count}} documents per month' })}
                </Typography>
              </Box>
              <Radio
                id={`${name}-${plan.id}`}
                value={plan.id}
                disabled={unavailable}
                inputProps={{ 'aria-label': t(`fiscal.plan.${plan.id}`, plan.id) }}
                sx={{ mt: -0.5, mr: -1 }}
              />
            </Stack>

            <Typography variant="h6" fontWeight={700} sx={{ mt: 1.5 }}>
              {plan.monthlyCharge === 0
                ? t('fiscal.plan.noCharge', 'Included')
                : t('fiscal.plan.charge', { amount: formatDop(plan.monthlyCharge, i18n.language), defaultValue: '{{amount}} / month' })}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              {plan.included
                ? t('fiscal.plan.includedInYours', 'Included in your Pilloto plan')
                : plan.monthlyCharge > 0 && plan.monthlyCharge < plan.monthlyPrice
                  ? t('fiscal.plan.difference', { price: formatDop(plan.monthlyPrice, i18n.language), defaultValue: 'Difference from the {{price}} plan price' })
                  : t('fiscal.plan.fullPrice', { price: formatDop(plan.monthlyPrice, i18n.language), defaultValue: 'Plan price {{price}} / month' })}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
              {t('fiscal.plan.overage', { amount: formatDop(plan.overageUnitPrice, i18n.language), defaultValue: 'Beyond the allowance: {{amount}} each' })}
              {' · '}
              {t('fiscal.plan.users', { count: plan.users, defaultValue: '{{count}} user(s)' })}
            </Typography>

            <Stack direction="row" spacing={0.5} sx={{ mt: 1, minHeight: 24 }}>
              {currentPlan === plan.id && <Chip size="small" color="primary" label={t('fiscal.plan.current', 'Current plan')} />}
              {!plan.selectable && <Chip size="small" variant="outlined" label={t('fiscal.plan.belowIncluded', 'Below your included plan')} />}
            </Stack>
          </Box>
        );
      })}
    </RadioGroup>
  );
};

export default FiscalPlanPicker;
