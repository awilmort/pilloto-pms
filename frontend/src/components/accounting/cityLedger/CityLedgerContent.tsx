import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Pagination, Paper, Snackbar, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../../../lib/permissions';
import { cityLedgerService } from '../../../services/api';
import { Invoice } from '../../../types';
import { formatMoney } from '../../../utils/currency';

/**
 * City Ledger pending-authorization queue (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md
 * Phase 10.4). Every row here was created automatically at checkout by an ad hoc
 * (non-pre-approved) unpaid guest departure — this page never creates a transfer,
 * it only lets a manager authorize or decline one. Modeled on `OtaConflictQueue.tsx`'s
 * pending-badge/table/dialog pattern.
 */
interface SnackbarState { open: boolean; message: string; severity: 'success' | 'error' }

const CityLedgerContent: React.FC = () => {
  const { t } = useTranslation();
  const canAuthorize = usePermission('accounting.cityLedger.authorize');

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const LIMIT = 20;

  const [declineDialog, setDeclineDialog] = useState<{ open: boolean; invoice: Invoice | null }>({ open: false, invoice: null });
  const [declineReason, setDeclineReason] = useState('');
  const [saving, setSaving] = useState(false);

  const [snackbar, setSnackbar] = useState<SnackbarState>({ open: false, message: '', severity: 'success' });
  const showSnackbar = (message: string, severity: SnackbarState['severity'] = 'success') =>
    setSnackbar({ open: true, message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cityLedgerService.getPending({ page, limit: LIMIT });
      setInvoices(res.data.data ?? []);
      setTotalPages(res.data.meta?.pages ?? 1);
    } catch {
      showSnackbar(t('accounting.cityLedger.loadFailed', 'Failed to load the City Ledger queue'), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, t]);

  const loadCount = useCallback(async () => {
    try {
      const res = await cityLedgerService.getPendingCount();
      setPendingCount(res.data.data?.count ?? 0);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => { load(); loadCount(); }, [load, loadCount]);

  const handleAuthorize = async (invoice: Invoice) => {
    setSaving(true);
    try {
      await cityLedgerService.authorize(invoice._id);
      showSnackbar(t('accounting.cityLedger.authorized', 'City Ledger transfer authorized'));
      await Promise.all([load(), loadCount()]);
    } catch (e: any) {
      showSnackbar(e?.response?.data?.message || t('accounting.cityLedger.authorizeFailed', 'Failed to authorize'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openDecline = (invoice: Invoice) => {
    setDeclineReason('');
    setDeclineDialog({ open: true, invoice });
  };
  const closeDecline = () => setDeclineDialog({ open: false, invoice: null });

  const submitDecline = async () => {
    if (!declineDialog.invoice || !declineReason.trim()) return;
    setSaving(true);
    try {
      await cityLedgerService.decline(declineDialog.invoice._id, declineReason.trim());
      showSnackbar(t('accounting.cityLedger.declined', 'City Ledger transfer declined'));
      closeDecline();
      await Promise.all([load(), loadCount()]);
    } catch (e: any) {
      showSnackbar(e?.response?.data?.message || t('accounting.cityLedger.declineFailed', 'Failed to decline'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const customerName = (inv: Invoice) => (typeof inv.customer === 'object' && inv.customer ? inv.customer.name : '—');
  const reservationLabel = (inv: Invoice) => {
    const ref = inv.cityLedger?.sourceReservationId;
    if (ref && typeof ref === 'object') return ref.reservationCode || ref._id;
    return ref || '—';
  };

  return (
    <Box>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">
            {t('accounting.cityLedger.intro', 'Unpaid balances transferred automatically at checkout. Each one needs a manager to authorize or decline it before it appears on AR aging and customer statements.')}
          </Typography>
          {pendingCount !== null && pendingCount > 0 && (
            <Chip
              label={t('accounting.cityLedger.pendingBadge', '{{count}} pending', { count: pendingCount })}
              color="warning"
              size="small"
            />
          )}
        </Box>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('accounting.cityLedger.table.invoice', 'Invoice')}</TableCell>
                  <TableCell>{t('accounting.cityLedger.table.customer', 'Customer')}</TableCell>
                  <TableCell>{t('accounting.cityLedger.table.reservation', 'Reservation')}</TableCell>
                  <TableCell align="right">{t('accounting.cityLedger.table.amount', 'Amount')}</TableCell>
                  <TableCell>{t('accounting.cityLedger.table.date', 'Date')}</TableCell>
                  <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                        {t('accounting.cityLedger.empty', 'No pending City Ledger transfers.')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map(inv => (
                    <TableRow key={inv._id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>{inv.invoiceNumber}</Typography>
                      </TableCell>
                      <TableCell>{customerName(inv)}</TableCell>
                      <TableCell>{reservationLabel(inv)}</TableCell>
                      <TableCell align="right">{formatMoney(inv.total)}</TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {new Date(inv.issueDate).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {canAuthorize && (
                          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                            <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => openDecline(inv)}>
                              {t('accounting.cityLedger.decline', 'Decline')}
                            </Button>
                            <Button size="small" variant="contained" disabled={saving} onClick={() => handleAuthorize(inv)}>
                              {t('accounting.cityLedger.authorize', 'Authorize')}
                            </Button>
                          </Box>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination count={totalPages} page={page} onChange={(_e, v) => setPage(v)} color="primary" />
            </Box>
          )}
        </>
      )}

      <Dialog open={declineDialog.open} onClose={closeDecline} maxWidth="sm" fullWidth>
        <DialogTitle>{t('accounting.cityLedger.declineTitle', 'Decline City Ledger Transfer')}</DialogTitle>
        <DialogContent>
          {declineDialog.invoice && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <Alert severity="warning">
                {t('accounting.cityLedger.declineWarning', 'Declining voids this invoice. It does not reopen the folio — the guest has already checked out. The balance becomes a manual write-off matter.')}
              </Alert>
              <TextField
                label={t('accounting.cityLedger.declineReason', 'Reason')}
                multiline
                rows={3}
                required
                value={declineReason}
                onChange={e => setDeclineReason(e.target.value)}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDecline} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="error" onClick={submitDecline} disabled={saving || !declineReason.trim()}>
            {saving ? t('common.saving', 'Saving…') : t('accounting.cityLedger.decline', 'Decline')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default CityLedgerContent;
