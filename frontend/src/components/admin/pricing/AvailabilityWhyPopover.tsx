/**
 * "Why?" for one availability number in the Calendar: the room type's rooms (free, booked,
 * out of service) and the bookings still waiting for a room on that night.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Chip, CircularProgress, Divider, Popover, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { rateCalendarService, NightDetails } from '../../../services/api';

interface Props {
  anchor: HTMLElement | null;
  roomTypeId: string;
  roomTypeName: string;
  date: string;
  dateLabel: string;
  onClose: () => void;
}

const AvailabilityWhyPopover: React.FC<Props> = ({ anchor, roomTypeId, roomTypeName, date, dateLabel, onClose }) => {
  const { t } = useTranslation();
  const [details, setDetails] = useState<NightDetails | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!anchor) return;
    setDetails(null);
    setFailed(false);
    rateCalendarService.availability(roomTypeId, date)
      .then((res) => setDetails(res.data.data ?? null))
      .catch(() => setFailed(true));
  }, [anchor, roomTypeId, date]);

  const stay = (r: { checkIn: string; checkOut: string }) => `${r.checkIn.slice(5)} → ${r.checkOut.slice(5)}`;

  return (
    <Popover open={!!anchor} anchorEl={anchor} onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}>
      <Box sx={{ p: 2, width: 340 }}>
        <Typography variant="subtitle2" fontWeight={700}>{roomTypeName} · {dateLabel}</Typography>
        {failed && <Alert severity="error" sx={{ mt: 1 }}>{t('admin.pricing.calendar.loadFailed')}</Alert>}
        {!details && !failed && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <CircularProgress size={14} /><Typography variant="body2">{t('admin.pricing.calendar.why.loading')}</Typography>
          </Box>
        )}
        {details && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('admin.pricing.calendar.why.summary', { available: details.counts.available, total: details.counts.total })}
            </Typography>
            {details.counts.overbooked > 0 && (
              <Alert severity="error" sx={{ mb: 1, py: 0 }}>{t('admin.pricing.calendar.why.overbooked', { count: details.counts.overbooked })}</Alert>
            )}
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase' }}>
              {t('admin.pricing.calendar.why.rooms')}
            </Typography>
            {details.rooms.length === 0 && <Typography variant="body2">{t('admin.pricing.calendar.why.noRooms')}</Typography>}
            {details.rooms.map((room) => (
              <Box key={room._id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                <Typography variant="body2" fontWeight={600} sx={{ minWidth: 56 }}>{room.name}</Typography>
                {room.state === 'free' && <Chip size="small" color="success" variant="outlined" label={t('admin.pricing.calendar.why.free')} />}
                {room.state === 'assigned' && (
                  <>
                    <Chip size="small" color="primary" variant="outlined" label={t('admin.pricing.calendar.why.assigned')} />
                    {room.reservation && (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {room.reservation.code} · {room.reservation.guestName} · {stay(room.reservation)}
                      </Typography>
                    )}
                  </>
                )}
                {room.state === 'blocked' && room.block && (
                  <Chip size="small" color="warning" variant="outlined"
                    label={`${t('admin.pricing.calendar.why.blocked', { until: room.block.until })} (${t(`admin.roomBlocks.reasons.${room.block.reason}`, room.block.reason)})`} />
                )}
              </Box>
            ))}
            {details.unassigned.length > 0 && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                  {t('admin.pricing.calendar.why.unassignedTitle')}
                </Typography>
                {details.unassigned.map((r) => (
                  <Typography key={r._id} variant="body2" sx={{ py: 0.25 }}>
                    {r.code} · {r.guestName} · {stay(r)} — {t('admin.pricing.calendar.why.unassignedRooms', { count: r.count })}
                  </Typography>
                ))}
              </>
            )}
          </>
        )}
      </Box>
    </Popover>
  );
};

export default AvailabilityWhyPopover;
