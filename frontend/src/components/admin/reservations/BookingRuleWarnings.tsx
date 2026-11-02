/**
 * Non-blocking warning when a stay breaks a booking rule (stop sell, no arrivals/departures,
 * minimum/maximum stay). Staff may still create the reservation; the booking engine and OTAs
 * would not allow it (plan Phase 4.5).
 */
import React, { useEffect, useState } from 'react';
import { Alert, AlertTitle, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { restrictionRulesService, StayWarning } from '../../../services/api';

interface Props {
  checkIn?: string;
  checkOut?: string;
  /** Rate plans the stay is priced on … */
  ratePlanIds?: string[];
  /** … or rooms (each priced on its room type's plan, as the reservation will be) */
  roomIds?: string[];
}

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

const BookingRuleWarnings: React.FC<Props> = ({ checkIn, checkOut, ratePlanIds = [], roomIds = [] }) => {
  const { t, i18n } = useTranslation();
  const lang: 'es' | 'en' = i18n.language?.startsWith('es') ? 'es' : 'en';
  const [warnings, setWarnings] = useState<StayWarning[]>([]);
  const planKey = ratePlanIds.join(',');
  const roomKey = roomIds.join(',');

  useEffect(() => {
    if (!isDate(checkIn) || !isDate(checkOut) || checkOut! <= checkIn! || (!planKey && !roomKey)) { setWarnings([]); return; }
    const timer = setTimeout(() => {
      restrictionRulesService.check({
        checkIn: checkIn!, checkOut: checkOut!,
        ...(planKey ? { ratePlanIds: planKey.split(',') } : {}),
        ...(roomKey ? { roomIds: roomKey.split(',') } : {}),
      })
        .then((res) => setWarnings(res.data.data?.warnings ?? []))
        .catch(() => setWarnings([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [checkIn, checkOut, planKey, roomKey]);

  if (!warnings.length) return null;
  return (
    <Alert severity="warning" sx={{ borderRadius: 1.5 }}>
      <AlertTitle sx={{ fontSize: 14 }}>{t('admin.reservations.bookingRuleWarnings.title')}</AlertTitle>
      {warnings.map((w, i) => (
        <Typography key={i} variant="body2">
          {[w.roomTypeName, w.ratePlanName].filter(Boolean).join(' · ')}: {w.message[lang]}
        </Typography>
      ))}
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        {t('admin.reservations.bookingRuleWarnings.hint')}
      </Typography>
    </Alert>
  );
};

export default BookingRuleWarnings;
