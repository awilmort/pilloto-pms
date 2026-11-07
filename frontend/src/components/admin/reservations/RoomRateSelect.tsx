/**
 * Rate plan picker for one room of a new reservation.
 *
 * Lists every active plan of the room's type, priced for the stay (cheapest open plans first),
 * with what makes each one different: default plan, private, unlocked by the promo code,
 * negotiated (company / guest) price, or closed by a booking rule. Shows why the current plan
 * is selected and lets staff go back to the pre-selected plan after choosing another.
 */
import React from 'react';
import { Alert, Box, Button, Chip, IconButton, MenuItem, TextField, Typography } from '@mui/material';
import { Close } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { RateOption, RateSelectionReason, RoomRateOptions } from '../../../services/api';
import { formatMoney } from '../../../utils/currency';

interface Props {
  line: RoomRateOptions;
  /** ratePlanId currently selected */
  value: string;
  reason: RateSelectionReason | null;
  lang: 'es' | 'en';
  onChange: (ratePlanId: string) => void;
  /** Back to the pre-selected plan */
  onReset: () => void;
  /** Takes the room out of the reservation */
  onRemove?: () => void;
}

const REASON_COLOR: Record<RateSelectionReason, 'default' | 'primary' | 'secondary' | 'success' | 'info' | 'warning'> = {
  manual: 'default',
  contract: 'success',
  promo: 'secondary',
  default: 'primary',
  cheapest: 'info',
  restricted: 'warning',
};

function OptionBadges({ option }: { option: RateOption }) {
  const { t } = useTranslation();
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: 0.5, flexWrap: 'wrap' }}>
      {option.isDefault && <Chip size="small" label={t('admin.reservations.create.rates.badge.default')} color="primary" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />}
      {option.contract && (
        <Chip size="small" label={t(`admin.reservations.create.rates.badge.${option.contract}`)} color="success" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
      )}
      {option.promoMatch && <Chip size="small" label={t('admin.reservations.create.rates.badge.promo')} color="secondary" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />}
      {option.visibility === 'private' && !option.promoMatch && (
        <Chip size="small" label={t('admin.reservations.create.rates.badge.private')} variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
      )}
      {!option.bookable && <Chip size="small" label={t('admin.reservations.create.rates.badge.restricted')} color="warning" sx={{ height: 18, fontSize: '0.65rem' }} />}
    </Box>
  );
}

const RoomRateSelect: React.FC<Props> = ({ line, value, reason, lang, onChange, onReset, onRemove }) => {
  const { t } = useTranslation();
  const recommended = line.options.find(o => o.ratePlanId === line.recommended?.ratePlanId);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
          <strong>{line.roomName}</strong>{line.roomTypeName ? ` · ${line.roomTypeName}` : ''}
          {' · '}{t('admin.reservations.create.rates.guestsInRoom', { adults: line.assignedAdults, children: line.assignedChildren })}
        </Typography>
        {onRemove && (
          <IconButton
            size="small"
            onClick={onRemove}
            aria-label={t('admin.reservations.create.removeRoom', { name: line.roomName })}
            sx={{ p: 0.25, color: 'text.secondary' }}
          >
            <Close sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>

      {line.error ? (
        <Alert severity="error" sx={{ borderRadius: 1.5, py: 0.25 }}>
          {t(`admin.reservations.create.rates.error.${line.error}`)}
        </Alert>
      ) : (
        <>
          <TextField
            select
            size="small"
            fullWidth
            label={t('admin.reservations.create.rates.ratePlan')}
            value={value}
            onChange={e => onChange(e.target.value)}
            SelectProps={{
              renderValue: (selected) => {
                const option = line.options.find(o => o.ratePlanId === selected);
                return option ? `${option.name} · ${formatMoney(option.pricing.finalTotal)}` : '';
              },
            }}
          >
            {line.options.map(option => (
              <MenuItem key={option.ratePlanId} value={option.ratePlanId} sx={{ alignItems: 'flex-start' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 0.25 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                      <Typography variant="body2" fontWeight={600}>{option.name}</Typography>
                      <OptionBadges option={option} />
                    </Box>
                    <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>{formatMoney(option.pricing.finalTotal)}</Typography>
                  </Box>
                  <Typography variant="caption" color={option.bookable ? 'text.secondary' : 'warning.main'} sx={{ whiteSpace: 'normal' }}>
                    {!option.bookable
                      ? option.restrictionMessages.map(m => m[lang]).join(' ')
                      : [
                        t('admin.reservations.create.rates.perNight', { price: formatMoney(option.pricing.perNight) }),
                        option.description,
                      ].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </TextField>
          {reason && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                size="small"
                color={REASON_COLOR[reason]}
                variant={reason === 'manual' ? 'outlined' : 'filled'}
                label={t(`admin.reservations.create.rates.reason.${reason}`)}
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
              {reason === 'manual' && recommended && (
                <Button size="small" onClick={onReset} sx={{ textTransform: 'none', py: 0, minHeight: 0 }}>
                  {t('admin.reservations.create.rates.useRecommended', { name: recommended.name })}
                </Button>
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default RoomRateSelect;
