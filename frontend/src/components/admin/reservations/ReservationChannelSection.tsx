/**
 * "Channel" section of the reservation details (plan Phase 7.4): which OTA sent the booking,
 * its codes, who collects the payment, commission, currency, the masked card the OTA passed
 * on, and every change the OTA sent (new / modified / cancelled).
 */
import React, { useEffect, useState } from 'react';
import { Box, Chip, Grid, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ChannelSource } from '../../../types';
import { ChannelHistoryRow, reservationsService } from '../../../services/api';
import { otaLabel } from '../../../utils/channels';

interface Props {
  reservationId: string;
  source: ChannelSource;
  formatCurrency: (value?: number) => string;
}

const STATE_COLOR = { waiting: 'info', imported: 'success', outdated: 'default', failed: 'error' } as const;

const ReservationChannelSection: React.FC<Props> = ({ reservationId, source, formatCurrency }) => {
  const { t, i18n } = useTranslation();
  const [history, setHistory] = useState<ChannelHistoryRow[] | null>(null);
  const k = (key: string) => `admin.reservations.channel.${key}`;

  useEffect(() => {
    let alive = true;
    reservationsService.getChannelHistory(reservationId)
      .then((r) => { if (alive) setHistory(r.data.data ?? []); })
      .catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, [reservationId]);

  const card = source.guaranteeSummary;
  const collect = source.paymentCollect ?? 'unknown';
  const line = (label: string, value?: React.ReactNode) => (value === undefined || value === null || value === ''
    ? null
    : <Typography variant="body2"><strong>{label}:</strong> {value}</Typography>);

  return (
    <Grid item xs={12}>
      <Typography variant="subtitle2" gutterBottom>{t(k('title'))}</Typography>
      <Box sx={{ pl: 1 }}>
        {line(t(k('ota')), otaLabel(source.otaName))}
        {line(t(k('otaCode')), source.otaReservationCode)}
        {line(t(k('paymentCollect')), t(k(`collect.${collect}`)))}
        {source.paymentType && line(t(k('paymentType')), t(k(`paymentTypes.${source.paymentType}`), source.paymentType))}
        {source.otaCommission !== undefined && line(t(k('commission')), formatCurrency(source.otaCommission))}
        {line(t(k('currency')), source.currency)}
        {card && line(t(k('card')), [
          card.cardType,
          card.last4 ? `•••• ${card.last4}` : undefined,
          card.expirationDate ? t(k('expires'), { date: card.expirationDate }) : undefined,
          card.isVirtual ? t(k('virtualCard')) : undefined,
          card.virtualCardBalance !== undefined ? t(k('virtualBalance'), { amount: `${card.virtualCardBalance.toFixed(2)} ${card.virtualCardCurrency ?? ''}`.trim() }) : undefined,
          card.virtualCardActivationDate ? t(k('virtualFrom'), { date: card.virtualCardActivationDate }) : undefined,
        ].filter(Boolean).join(' · '))}
        {card?.isVirtual && <Typography variant="caption" color="text.secondary" display="block">{t(k('virtualCardHint'))}</Typography>}

        <Typography variant="body2" sx={{ mt: 1.5, mb: 0.5 }}><strong>{t(k('history'))}</strong></Typography>
        {history && history.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{t(k('historyEmpty'))}</Typography>
        ) : (
          <Table size="small" sx={{ maxWidth: 640 }}>
            <TableHead><TableRow>
              <TableCell>{t(k('columns.received'))}</TableCell>
              <TableCell>{t(k('columns.change'))}</TableCell>
              <TableCell>{t(k('columns.state'))}</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {(history ?? []).map((h) => (
                <TableRow key={h._id}>
                  <TableCell>{new Date(h.receivedAt).toLocaleString(i18n.language)}</TableCell>
                  <TableCell>{h.status ? t(`admin.channelManager.home.bookingInbox.status.${h.status}`) : '—'}</TableCell>
                  <TableCell><Chip size="small" color={STATE_COLOR[h.state]} label={t(`admin.channelManager.home.bookingInbox.state.${h.state}`)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>
    </Grid>
  );
};

export default ReservationChannelSection;
