/**
 * "History" section of the reservation details: who did what and when — milestones, edits
 * (field: before → after), folio activity. Collapsed by default and loaded on first open, so
 * the details page costs no extra request unless someone looks.
 */
import React, { useEffect, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';
import { ReservationHistoryEntry, reservationsService } from '../../../services/api';

interface Props {
  reservationId: string;
  /** Changes when the reservation is saved, so an open history reloads */
  version?: string;
  formatCurrency: (value?: number) => string;
}

/** System-written notes that have a translation; anything else (reasons, descriptions) is shown as typed. */
const KNOWN_NOTES = new Set([
  'booking_engine', 'email_link', 'credit', 'deposit', 'confirmation', 'invoice',
  'cedula', 'pasaporte', 'rnc', 'cash', 'card', 'transfer', 'check',
]);
const MONEY_FIELDS = new Set(['estimatedTotal', 'amount']);

const ReservationHistorySection: React.FC<Props> = ({ reservationId, version, formatCurrency }) => {
  const { t, i18n } = useTranslation();
  const k = (key: string) => `admin.reservations.history.${key}`;
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ReservationHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFailed(false);
    reservationsService.getHistory(reservationId)
      .then((r) => { if (alive) setRows(r.data.data ?? []); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [open, reservationId, version]);

  const actor = (a: ReservationHistoryEntry['actor']) => {
    if (a.kind === 'user') return a.name || t(k('actor.staff'));
    if (a.kind === 'channel') {
      if (!a.name) return t(k('actor.channel'));
      // "Offline" is the source of bookings entered directly in the channel manager, not an OTA
      return a.name.trim().toLowerCase() === 'offline' ? t(k('actor.channelOffline')) : t(k('actor.channelNamed'), { name: a.name });
    }
    return t(k(`actor.${a.kind}`));
  };

  const value = (field: string, v: unknown): string => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return '—';
    if (Array.isArray(v)) return v.join(', ');
    if (field === 'status') return t(`admin.reservations.statusLabels.${v}`, String(v));
    if (field === 'corporatePriceStatus') return t(k(`corporate.${v}`), String(v));
    if (field === 'method') return KNOWN_NOTES.has(String(v)) ? t(k(`notes.${v}`)) : String(v);
    if (MONEY_FIELDS.has(field) && typeof v === 'number') return formatCurrency(v);
    return String(v);
  };

  const note = (n?: string) => (n ? (KNOWN_NOTES.has(n) ? t(k(`notes.${n}`)) : n) : null);

  const detail = (row: ReservationHistoryEntry) => {
    const lines = (row.changes ?? []).map((c) => `${t(k(`fields.${c.field}`), c.field)}: ${value(c.field, c.from)} → ${value(c.field, c.to)}`);
    const extra = [note(row.note), row.method ? note(row.method) : null].filter(Boolean).join(' · ');
    if (extra) lines.push(extra);
    return lines;
  };

  return (
    <Accordion expanded={open} onChange={(_, v) => setOpen(v)} disableGutters elevation={0} sx={{ mt: 2, '&:before': { display: 'none' }, border: 1, borderColor: 'divider' }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2">{t(k('title'))}</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0, overflowX: 'auto' }}>
        {failed ? (
          <Typography variant="body2" color="error" sx={{ p: 2 }}>{t(k('error'))}</Typography>
        ) : rows === null ? (
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}><CircularProgress size={20} /></Box>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>{t(k('empty'))}</Typography>
        ) : (
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>{t(k('columns.when'))}</TableCell>
              <TableCell>{t(k('columns.who'))}</TableCell>
              <TableCell>{t(k('columns.what'))}</TableCell>
              <TableCell align="right">{t(k('columns.amount'))}</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>{new Date(row.at).toLocaleString(i18n.language)}</TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>{actor(row.actor)}</TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Typography variant="body2" fontWeight={500}>
                      {t(k(`actions.${row.action}`), row.action)}
                      {row.inferred && (
                        <Tooltip title={t(k('inferredHint'))}>
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{t(k('inferred'))}</Typography>
                        </Tooltip>
                      )}
                    </Typography>
                    {detail(row).map((line, i) => (
                      <Typography key={i} variant="caption" color="text.secondary" display="block">{line}</Typography>
                    ))}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {row.amount !== undefined ? formatCurrency(row.amount) : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AccordionDetails>
    </Accordion>
  );
};

export default ReservationHistorySection;
