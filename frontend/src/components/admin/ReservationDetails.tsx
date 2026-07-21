import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, Container, Divider, Grid, Paper, Typography, TextField, MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Tooltip, Tabs, Tab, Alert } from '@mui/material';
import ReceiptIcon from '@mui/icons-material/Receipt';
import { Edit as EditIcon, Delete as DeleteIcon, Print as PrintIcon } from '@mui/icons-material';
import { Reservation, Payment, Charge, ElectronicInvoice } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { printConfirmation, printFolio, printPaymentReceipt, printPaymentSummary } from '../../utils/print';
import { reservationsService, ecfService } from '../../services/api';
import { useTranslation } from 'react-i18next';
import NumberField from '../../components/common/NumberField';
import InvoiceGenerationModal from './InvoiceGenerationModal';
import EcfInvoicesSection from './EcfInvoicesSection';
import EcfStatusBadge from './EcfStatusBadge';

type Props = {
  reservation: Reservation;
  onBack: () => void;
  onUpdated?: (updated: Reservation) => void;
};

const ReservationDetails: React.FC<Props> = ({ reservation, onBack, onUpdated }) => {
  const [current, setCurrent] = useState<Reservation>(reservation);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [folioStatus, setFolioStatus] = useState<'open' | 'in_ar' | 'closed'>('open');
  const [folioId, setFolioId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ stage: 'pre_arrival' | 'in_house' | 'checked_out'; estimatedTotal: number; totalCharges: number; totalPayments: number; depositTotal: number; balance: number; balanceOnArrival: number; creditAvailability: number }>({ stage: 'pre_arrival', estimatedTotal: 0, totalCharges: 0, totalPayments: 0, depositTotal: 0, balance: 0, balanceOnArrival: 0, creditAvailability: 0 });
  const [activeTab, setActiveTab] = useState(0);

  // ECF state
  const [ecfInvoices, setEcfInvoices] = useState<ElectronicInvoice[]>([]);
  const [ecfIsActive, setEcfIsActive] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | undefined>(undefined);

  const fetchEcfInvoices = useCallback((fId: string) => {
    ecfService.getInvoices({ folioId: fId }).then((res) => {
      setEcfInvoices(res.data.data ?? []);
    }).catch(() => {});
  }, []);

  // Fetch the fully-populated reservation (payments.createdBy, etc.) on mount and whenever the ID changes.
  // The list endpoint omits nested population for performance; the single-resource endpoint provides the full object.
  useEffect(() => {
    let cancelled = false;
    reservationsService.getReservation(reservation._id as string).then((res) => {
      if (!cancelled && res.data?.data) setCurrent(res.data.data);
    }).catch(() => {
      // Fall back to the prop data already in state
    });
    reservationsService.getReservationFinancial(reservation._id as string).then((res) => {
      if (!cancelled && res.data?.data) {
        setCharges(res.data.data.charges || []);
        setPayments(res.data.data.payments || []);
        setSummary(res.data.data.summary || { stage: 'pre_arrival' as const, estimatedTotal: 0, totalCharges: 0, totalPayments: 0, depositTotal: 0, balance: 0, balanceOnArrival: 0, creditAvailability: 0 });
        setFolioStatus(res.data.data.folio?.status || 'open');
        const fId = res.data.data.folio?._id ? String(res.data.data.folio._id) : null;
        setFolioId(fId);
        if (fId) fetchEcfInvoices(fId);
      }
    }).catch(() => {
      // keep defaults when financial endpoint fails
    });
    // Check if ECF is active for this tenant
    ecfService.getConfig().then((res) => {
      const cfg = res.data.data;
      if (!cancelled) setEcfIsActive(Boolean(cfg?.isActive && cfg?.hasToken));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [reservation._id, fetchEcfInvoices]);

  // Keep in sync with external updates from the parent (e.g. after a status change)
  useEffect(() => { setCurrent(reservation); }, [reservation]);
  const { user, permissions } = useAuth();
  const { tenant } = useTenant();
  const hotelInfo = { name: tenant?.name ?? 'Hotel', logoUrl: tenant?.settings?.logoUrl };
  const cashierName = [(user as any)?.firstName, (user as any)?.lastName].filter(Boolean).join(' ') || 'Front Desk';
  const isAdmin = String(user?.role).toLowerCase() === 'admin';
  const canManagePayments = isAdmin || (permissions || []).includes('admin.reservations.managePayments');
  const { t } = useTranslation();
  const paymentsDisabled = current.status === 'cancelled';

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return String(dateString);
    }
  };

  const formatDateTime = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return String(dateString);
    }
  };

  const formatCurrency = (value?: number) => {
    if (value == null) return t('admin.reservations.na');
    try {
      const { formatMoney } = require('../../utils/currency');
      return formatMoney(value);
    } catch {
      return `RD$${(value || 0).toFixed(0)}`;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'warning';
      case 'confirmed': return 'success';
      case 'cancelled': return 'error';
      case 'checked-in': return 'info';
      case 'checked-out': return 'default';
      default: return 'default';
    }
  };

  const linkedGuest = (current.guestRecord && typeof current.guestRecord === 'object') ? current.guestRecord : null;
  const guestName = linkedGuest
    ? `${linkedGuest.firstName || ''} ${linkedGuest.lastName || ''}`.trim() || 'Guest'
    : `${current.guestName?.firstName || ''} ${current.guestName?.lastName || ''}`.trim() || 'Guest';
  const guestEmail = linkedGuest?.email || current.contactInfo?.email || '-';
  const guestPhone = linkedGuest?.phone || current.contactInfo?.phone || '-';

  const isPreArrival = summary.stage === 'pre_arrival';
  const pendingBalance = useMemo(() => {
    if (isPreArrival) return summary.balanceOnArrival;
    return Math.max(0, summary.balance ?? ((current.estimatedTotal || current.totalPrice || 0) - (current.totalPayments || 0)));
  }, [summary, current, isPreArrival]);

  // Payment form state
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer' | 'credit' | 'check' | ''>('');
  const [note, setNote] = useState<string>('');
  const [paymentIsDeposit, setPaymentIsDeposit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<{ _id?: string; amount: number; method: 'cash' | 'card' | 'transfer' | 'credit' | 'check'; note?: string; reference?: string; status?: 'completed' | 'pending' | 'reversed' } | null>(null);

  // Charge form state
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [chargeDescription, setChargeDescription] = useState('');
  const [chargeAmount, setChargeAmount] = useState<number | null>(null);
  const [chargeCategory, setChargeCategory] = useState<string>('');
  const [chargeSubmitting, setChargeSubmitting] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);

  return (
    <>
    <Container maxWidth="lg" sx={{ py: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5">{t('admin.reservations.details.title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => printConfirmation(current, hotelInfo)}
          >
            {t('admin.printing.printConfirmation', 'Print Confirmation')}
          </Button>
          {isAdmin && (
            <Button
              variant="contained"
              color="error"
              onClick={async () => {
                const ok = window.confirm(t('admin.reservations.details.deleteConfirm'));
                if (!ok) return;
                try {
                  await reservationsService.deleteReservation(current._id);
                  if (onUpdated) onUpdated(current);
                  onBack();
                } catch (err: any) {
                  alert(err?.response?.data?.message || t('admin.reservations.details.errors.deleteReservationFailed'));
                }
              }}
            >
              {t('admin.reservations.details.delete')}
            </Button>
          )}
          <Button variant="outlined" onClick={onBack}>{t('admin.reservations.details.back')}</Button>
        </Box>
      </Box>

      <Paper elevation={2} sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6" gutterBottom>{guestName}</Typography>
            <Typography variant="body2" color="text.secondary">{guestEmail} • {guestPhone}</Typography>
          </Box>
          <Chip label={t(`admin.reservations.details.status.${current.status}`)} color={getStatusColor(current.status) as any} sx={{ textTransform: 'capitalize' }} />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" gutterBottom>{t('admin.reservations.details.section.reservation')}</Typography>
            <Box sx={{ pl: 1 }}>
              <Typography variant="body2"><strong>{t('admin.reservations.details.labels.type')}:</strong> {current.type}</Typography>
              <Typography variant="body2"><strong>{t('admin.reservations.details.labels.dates')}:</strong> {formatDate(current.checkInDate)} {current.checkOutDate ? `- ${formatDate(current.checkOutDate)}` : ''}</Typography>
              <Typography variant="body2"><strong>{t('admin.reservations.details.labels.guests')}:</strong> {current.guestDetails.adults} {t('admin.schedule.cards.adults')}, {current.guestDetails.children} {t('admin.schedule.cards.children')}, {current.guestDetails.infants} {t('admin.schedule.cards.infants')}</Typography>
              {current.reservationCode && (
                <Typography variant="body2"><strong>{t('admin.reservations.details.labels.reservationCode')}:</strong> {current.reservationCode}</Typography>
              )}
              <Typography variant="body2"><strong>{t('admin.reservations.details.labels.status')}:</strong> {t(`admin.reservations.details.status.${current.status}`)}</Typography>
            </Box>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" gutterBottom>{t('admin.reservations.details.section.payment')}</Typography>
            <Box sx={{ pl: 1 }}>
              {isPreArrival ? (
                <>
                  <Typography variant="body2"><strong>{t('admin.reservations.financial.estimatedTotal', 'Estimated Total')}:</strong> {formatCurrency(summary.estimatedTotal)}</Typography>
                  {summary.depositTotal > 0 && (
                    <Typography variant="body2"><strong>{t('admin.reservations.financial.depositReceived', 'Deposit Received')}:</strong> {formatCurrency(summary.depositTotal)}</Typography>
                  )}
                  <Typography variant="body2"><strong>{t('admin.reservations.financial.balanceOnArrival', 'Balance on Arrival')}:</strong> {formatCurrency(summary.balanceOnArrival)}</Typography>
                </>
              ) : (
                <>
                  <Typography variant="body2"><strong>{t('admin.reservations.details.labels.totalCharges', 'Total Charges')}:</strong> {formatCurrency(summary.totalCharges)}</Typography>
                  <Typography variant="body2"><strong>{t('admin.reservations.details.labels.totalPayments')}:</strong> {formatCurrency(summary.totalPayments)}</Typography>
                  <Typography variant="body2"><strong>{t('admin.reservations.details.labels.pendingBalance')}:</strong> {formatCurrency(pendingBalance)}</Typography>
                </>
              )}
              <Typography variant="body2"><strong>{t('admin.reservations.details.labels.creditAvailability', 'Credit Availability')}:</strong> {formatCurrency(summary.creditAvailability)}</Typography>
              <Typography variant="body2"><strong>{t('admin.reservations.details.labels.folioStatus', 'Folio Status')}:</strong> {folioStatus}</Typography>
              {paymentsDisabled && (
                <Typography variant="caption" color="error">{t('admin.reservations.details.paymentDialog.blockedForCancelled')}</Typography>
              )}
            </Box>
          </Grid>
          {current.type === 'room' && (
            <Grid item xs={12}>
              <Typography variant="subtitle2" gutterBottom>{t('admin.reservations.details.section.operational')}</Typography>
              <Box sx={{ pl: 1 }}>
                <Typography variant="body2"><strong>{t('admin.reservations.details.labels.actualCheckIn')}:</strong> {formatDateTime(current.actualCheckInAt)}</Typography>
                <Typography variant="body2"><strong>{t('admin.reservations.details.labels.actualCheckOut')}:</strong> {formatDateTime(current.actualCheckOutAt)}</Typography>
              </Box>
            </Grid>
          )}
          {current.type === 'event' && (
            <Grid item xs={12}>
              <Typography variant="subtitle2" gutterBottom>{t('admin.reservations.details.section.event')}</Typography>
              <Box sx={{ pl: 1 }}>
                <Typography variant="body2"><strong>{t('admin.reservations.details.labels.eventType')}:</strong> {current.eventType}</Typography>
                {current.eventDescription && (
                  <Typography variant="body2"><strong>{t('admin.reservations.details.labels.description')}:</strong> {current.eventDescription}</Typography>
                )}
              </Box>
            </Grid>
          )}
          {current.type === 'room' && (
            (() => {
              const names = Array.isArray(current.rooms)
                ? current.rooms.map((r: any) => (typeof r === 'object' && r?.name) ? r.name : String(r))
                : (current.room ? [(typeof current.room === 'object' && (current.room as any)?.name) ? (current.room as any).name : String(current.room)] : []);
              return (
                <Grid item xs={12}>
                  <Typography variant="subtitle2" gutterBottom>{t('admin.reservations.details.section.room')}</Typography>
                  <Box sx={{ pl: 1 }}>
                    <Typography variant="body2"><strong>{t('admin.reservations.details.labels.assignedRoom')}:</strong> {names.length > 0 ? names.join(', ') : t('admin.reservations.none')}</Typography>
                  </Box>
                </Grid>
              );
            })()
          )}
          {current.specialRequests && (
            <Grid item xs={12}>
              <Typography variant="subtitle2" gutterBottom>{t('admin.reservations.details.section.specialRequests')}</Typography>
              <Box sx={{ pl: 1 }}>
                <Typography variant="body2">{current.specialRequests}</Typography>
              </Box>
            </Grid>
          )}

          {/* Financial Section */}
          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="subtitle2">{t('admin.reservations.details.section.financial', 'Financial')}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2">{t('admin.reservations.details.paymentDialog.pendingBalance', { amount: formatCurrency(pendingBalance) })}</Typography>
                {activeTab === 0 && (
                  <Button
                    variant="outlined"
                    startIcon={<PrintIcon />}
                    onClick={() => printFolio(current, charges, payments, summary, hotelInfo)}
                  >
                    {t('admin.printing.printFolio', 'Print Folio')}
                  </Button>
                )}
                {activeTab === 1 && (
                  <Button
                    variant="outlined"
                    startIcon={<PrintIcon />}
                    onClick={() => printPaymentSummary(payments, current, charges, summary, cashierName, hotelInfo)}
                  >
                    {t('admin.printing.printPaymentSummary', 'Print Payment Summary')}
                  </Button>
                )}
                {canManagePayments && !paymentsDisabled && activeTab === 0 && folioStatus === 'open' && (
                  <Button variant="outlined" onClick={() => { setChargeDescription(''); setChargeAmount(null); setChargeCategory(''); setChargeError(null); setChargeDialogOpen(true); }}>
                    {t('admin.reservations.details.actions.addCharge', 'Add Charge')}
                  </Button>
                )}
                {canManagePayments && !paymentsDisabled && activeTab === 1 && (
                  <Button variant="contained" onClick={() => {
                    setSubmitError(null); setSubmitSuccess(null); setAmount(0); setMethod(''); setNote('');
                    setPaymentIsDeposit(isPreArrival);
                    setPaymentDialogOpen(true);
                  }}>
                    {isPreArrival
                      ? t('admin.reservations.financial.recordDeposit', 'Record Deposit')
                      : t('admin.reservations.details.actions.addPayment')}
                  </Button>
                )}
              </Box>
            </Box>

            {pendingBalance > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {t('admin.reservations.checkout.pendingBalance', 'Pending balance detected before checkout.')} {' '}
                {t('admin.reservations.checkout.creditAvailable', 'Available credit')}: {formatCurrency(summary.creditAvailability)}
              </Alert>
            )}

            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mt: 2 }}>
              <Tab label={t('admin.reservations.details.section.charges', 'Charges')} />
              <Tab label={t('admin.reservations.details.section.payments')} />
              {ecfIsActive && <Tab label={t('admin.settings.ecfInvoices.tabLabel')} />}
            </Tabs>

            {activeTab === 0 && (
            <TableContainer component={Paper} sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.reservations.details.table.date')}</TableCell>
                    <TableCell>{t('admin.reservations.details.table.description', 'Description')}</TableCell>
                    <TableCell>{t('admin.reservations.details.table.type', 'Type')}</TableCell>
                    <TableCell align="right">{t('admin.reservations.details.table.amount')}</TableCell>
                    {canManagePayments && <TableCell />}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {charges.length > 0 ? charges.map((c) => (
                    <TableRow key={c._id}>
                      <TableCell>{new Date(c.createdAt).toLocaleString()}</TableCell>
                      <TableCell>{c.description}</TableCell>
                      <TableCell>
                        <Chip size="small" label={c.type ?? 'base'} color={c.type === 'auto_rule' ? 'warning' : c.type === 'manual' ? 'info' : 'default'} />
                      </TableCell>
                      <TableCell align="right">{formatCurrency(c.amount)}</TableCell>
                      {canManagePayments && (
                        <TableCell align="right">
                          {c.type !== 'base' && !paymentsDisabled && folioStatus === 'open' ? (
                            <Tooltip title={t('admin.reservations.details.actions.delete')}>
                              <IconButton size="small" color="error" onClick={async () => {
                                const ok = window.confirm(t('admin.reservations.details.errors.deleteChargeConfirm', 'Delete this charge?'));
                                if (!ok) return;
                                try {
                                  await reservationsService.deleteReservationCharge(current._id, c._id);
                                  const f = await reservationsService.getReservationFinancial(current._id);
                                  setCharges(f.data.data?.charges || []);
                                  setSummary(f.data.data?.summary || summary);
                                } catch (err: any) {
                                  alert(err?.response?.data?.message || t('admin.reservations.details.errors.deleteChargeFailed', 'Delete failed'));
                                }
                              }}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          ) : <span />}
                        </TableCell>
                      )}
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={canManagePayments ? 5 : 4} align="center">{t('admin.reservations.details.table.noCharges', 'No charges')}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            )}

            {activeTab === 1 && (
            <TableContainer component={Paper} sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.reservations.details.table.date')}</TableCell>
                    <TableCell>{t('admin.reservations.details.table.method')}</TableCell>
                    <TableCell>{t('admin.reservations.details.table.status', 'Status')}</TableCell>
                    <TableCell align="right">{t('admin.reservations.details.table.amount')}</TableCell>
                    <TableCell>{t('admin.reservations.details.table.receptionist', 'Receptionist')}</TableCell>
                    <TableCell>{t('admin.reservations.details.table.note')}</TableCell>
                    {ecfIsActive && (
                      <TableCell>{t('admin.settings.ecfInvoices.table.comprobante')}</TableCell>
                    )}
                    {canManagePayments && (
                      <TableCell align="right">{t('admin.reservations.details.table.actions')}</TableCell>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Array.isArray(payments) && payments.length > 0 ? (
                    payments.map((p) => (
                      <TableRow key={(p as any)._id || `${p.createdAt}-${p.amount}`}>
                        <TableCell>{new Date(p.createdAt).toLocaleString()}</TableCell>
                        <TableCell sx={{ textTransform: 'capitalize' }}>{t(`admin.reservations.details.paymentDialog.method${p.method.charAt(0).toUpperCase() + p.method.slice(1)}`)}</TableCell>
                        <TableCell sx={{ textTransform: 'capitalize' }}>{p.status || 'completed'}</TableCell>
                        <TableCell align="right">{formatCurrency(p.amount)}</TableCell>
                        <TableCell>
                          {p.createdBy
                            ? (typeof p.createdBy === 'object'
                                ? `${p.createdBy.firstName} ${p.createdBy.lastName}`.trim()
                                : String(p.createdBy))
                            : '-'}
                        </TableCell>
                        <TableCell>{p.note || '-'}</TableCell>
                        {ecfIsActive && (
                          <TableCell>
                            {(() => {
                              const paymentInvoices = ecfInvoices
                                .filter((inv) => (inv as any).paymentId === (p as any)._id)
                                .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
                              const latestInvoice = paymentInvoices[0];
                              const hasBlockingInvoice = paymentInvoices.some((inv) =>
                                ['Aceptado', 'Aceptado Condicional', 'En Proceso', 'Emitido Contingencia']
                                  .includes(inv.estadoECF)
                              );

                              if (latestInvoice && hasBlockingInvoice) {
                                return <EcfStatusBadge status={latestInvoice.estadoECF} />;
                              }

                              if (latestInvoice && ['Rechazado', 'Error', 'Pendiente'].includes(latestInvoice.estadoECF)) {
                                return (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                    <EcfStatusBadge status={latestInvoice.estadoECF} />
                                    <Button
                                      variant="outlined"
                                      size="small"
                                      startIcon={<ReceiptIcon />}
                                      onClick={() => {
                                        setSelectedPaymentId((p as any)._id);
                                        setInvoiceModalOpen(true);
                                      }}
                                    >
                                      {t('admin.settings.ecfInvoices.actions.retryIssue')}
                                    </Button>
                                  </Box>
                                );
                              }

                              if ((p.status === 'completed' || !p.status) && folioId) {
                                return (
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    startIcon={<ReceiptIcon />}
                                    onClick={() => {
                                      setSelectedPaymentId((p as any)._id);
                                      setInvoiceModalOpen(true);
                                    }}
                                  >
                                    {t('admin.settings.ecfInvoices.emitirButton')}
                                  </Button>
                                );
                              }
                              return null;
                            })()}
                          </TableCell>
                        )}
                        {canManagePayments && (
                          <TableCell align="right">
                                <Tooltip title={t('admin.printing.printReceipt', 'Print Receipt')}>
                          <IconButton
                            size="small"
                            onClick={() => printPaymentReceipt(p, current, pendingBalance, cashierName, hotelInfo)}
                          >
                            <PrintIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {paymentsDisabled ? (
                                  <Tooltip title={t('admin.reservations.details.paymentDialog.blockedForCancelled')}>
                                    <span>
                                      <IconButton size="small" disabled>
                                        <EditIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                ) : (
                                  <Tooltip title={t('admin.reservations.details.actions.edit')}>
                                    <IconButton size="small" onClick={() => {
                                      setEditingPayment({ _id: (p as any)._id, amount: p.amount, method: p.method, note: p.note, reference: p.reference, status: p.status });
                                      setAmount(p.amount);
                                      setMethod(p.method);
                                      setNote(p.note || '');
                                      setSubmitError(null);
                                      setSubmitSuccess(null);
                                      setPaymentDialogOpen(true);
                                    }}>
                                      <EditIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                )}
                            <Tooltip title={t('admin.reservations.details.actions.delete')}>
                              <IconButton size="small" color="error" onClick={async () => {
                                const ok = window.confirm(t('admin.reservations.details.errors.deletePaymentConfirm'));
                                if (!ok) return;
                                try {
                                  const res = await reservationsService.deleteReservationPayment(current._id, (p as any)._id);
                                  const updated = res.data.data as Reservation;
                                  setCurrent(updated);
                                  const f = await reservationsService.getReservationFinancial(current._id);
                                  setPayments(f.data.data?.payments || []);
                                  setCharges(f.data.data?.charges || []);
                                  setSummary(f.data.data?.summary || summary);
                                  if (onUpdated) onUpdated(updated);
                                } catch (err: any) {
                                  setSubmitError(err?.response?.data?.message || t('admin.reservations.details.errors.deletePaymentFailed'));
                                }
                              }}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={canManagePayments && ecfIsActive ? 8 : canManagePayments || ecfIsActive ? 7 : 6} align="center">{t('admin.reservations.details.table.noPayments')}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            )}
            {activeTab === 2 && ecfIsActive && folioId && (
              <EcfInvoicesSection
                invoices={ecfInvoices}
                onRefresh={() => fetchEcfInvoices(folioId)}
                formatCurrency={formatCurrency}
              />
            )}
          </Grid>
        </Grid>
      </Paper>
    </Container>

    {/* Add Payment Dialog */}
    <Dialog open={paymentDialogOpen} onClose={() => setPaymentDialogOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>
        {editingPayment
          ? t('admin.reservations.details.paymentDialog.titleEdit')
          : paymentIsDeposit
            ? t('admin.reservations.financial.recordDeposit', 'Record Deposit')
            : t('admin.reservations.details.paymentDialog.titleAdd')}
      </DialogTitle>
      <DialogContent>
        {paymentIsDeposit && !editingPayment && (
          <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
            {t('admin.reservations.financial.depositInfo', 'This deposit will be applied against the balance when the guest checks in.')}
          </Alert>
        )}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, 1fr)', mt: 1 }}>
          <NumberField
            label={t('admin.reservations.details.paymentDialog.amount')}
            value={amount}
            onChange={(val) => setAmount(val == null ? 0 : val)}
            min={0}
            inputProps={{ step: 0.01 }}
          />
          <TextField
            select
            label={t('admin.reservations.details.paymentDialog.method')}
            value={method}
            onChange={(e) => setMethod(e.target.value as any)}
          >
            <MenuItem value="">{t('admin.reservations.details.paymentDialog.methodSelect')}</MenuItem>
            <MenuItem value="cash">{t('admin.reservations.details.paymentDialog.methodCash')}</MenuItem>
            <MenuItem value="card">{t('admin.reservations.details.paymentDialog.methodCard')}</MenuItem>
            <MenuItem value="transfer">{t('admin.reservations.details.paymentDialog.methodTransfer')}</MenuItem>
            <MenuItem value="check">{t('admin.reservations.details.paymentDialog.methodCheck', 'Check')}</MenuItem>
            {!paymentIsDeposit && (
              <MenuItem value="credit">{t('admin.reservations.details.paymentDialog.methodCredit', 'Credit')}</MenuItem>
            )}
          </TextField>
        </Box>
        <TextField
          fullWidth
          multiline
          rows={3}
          label={t('admin.reservations.details.paymentDialog.noteOptional')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          sx={{ mt: 2 }}
        />
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2">{t('admin.reservations.details.paymentDialog.pendingBalance', { amount: formatCurrency(pendingBalance) })}</Typography>
          {amount > 0 && (
            (() => {
              const original = editingPayment?.amount || 0;
              const delta = amount - original;
              const willExceed = delta > pendingBalance;
              const after = Math.max(0, pendingBalance - delta);
              return (
                <Typography variant="caption" color={willExceed ? 'error' : 'text.secondary'}>
                  {t('admin.reservations.details.paymentDialog.afterPayment', { amount: formatCurrency(after) })}
                </Typography>
              );
            })()
          )}
          {submitError && (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>{submitError}</Typography>
          )}
          {submitSuccess && (
            <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>{submitSuccess}</Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setPaymentDialogOpen(false)} disabled={submitting}>{t('admin.reservations.details.actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={(() => {
            if (submitting || amount <= 0 || !method) return true;
            const original = editingPayment?.amount || 0;
            const delta = amount - original;
            return delta > pendingBalance; // prevents exceeding total price on increase
          })()}
          onClick={async () => {
            try {
              setSubmitting(true);
              setSubmitError(null);
              setSubmitSuccess(null);
              let res;
              if (editingPayment && editingPayment._id) {
                res = await reservationsService.updateReservationPayment(current._id, editingPayment._id, { amount, method: method || undefined, note: note || undefined });
              } else {
                res = await reservationsService.addReservationPayment(current._id, { amount, method: method || undefined, note: note || undefined, paymentStage: paymentIsDeposit ? 'deposit' : 'in_house' });
              }
              const updated = res.data.data as Reservation;
              setCurrent(updated);
              const f = await reservationsService.getReservationFinancial(current._id);
              setPayments(f.data.data?.payments || []);
              setCharges(f.data.data?.charges || []);
              setSummary(f.data.data?.summary || summary);
              setAmount(0);
              setMethod('');
              setNote('');
              setEditingPayment(null);
              setSubmitSuccess(t('admin.reservations.details.paymentDialog.recorded'));
              setPaymentDialogOpen(false);
              if (onUpdated) onUpdated(updated);
            } catch (err: any) {
              setSubmitError(err?.response?.data?.message || t('admin.reservations.details.paymentDialog.failed'));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {editingPayment ? t('admin.reservations.details.actions.saveChanges') : t('admin.reservations.details.actions.addPayment')}
        </Button>
      </DialogActions>
    </Dialog>

    {/* Add Charge Dialog */}
    <Dialog open={chargeDialogOpen} onClose={() => setChargeDialogOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>{t('admin.reservations.details.chargeDialog.title', 'Add Charge')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
          <TextField
            fullWidth
            label={t('admin.reservations.details.chargeDialog.description', 'Description')}
            value={chargeDescription}
            onChange={(e) => setChargeDescription(e.target.value)}
            inputProps={{ maxLength: 300 }}
          />
          <NumberField
            label={t('admin.reservations.details.chargeDialog.amount', 'Amount')}
            value={chargeAmount ?? undefined}
            onChange={(val) => setChargeAmount(val == null ? null : val)}
            min={0.01}
            inputProps={{ step: 0.01 }}
          />
          <TextField
            select
            label={t('admin.reservations.details.chargeDialog.category', 'Category')}
            value={chargeCategory}
            onChange={(e) => setChargeCategory(e.target.value)}
          >
            <MenuItem value="">{t('admin.reservations.details.chargeDialog.categoryNone', '— None —')}</MenuItem>
            <MenuItem value="room">{t('admin.reservations.details.chargeDialog.categoryRoom', 'Room')}</MenuItem>
            <MenuItem value="late_fee">{t('admin.reservations.details.chargeDialog.categoryLateFee', 'Late Fee')}</MenuItem>
            <MenuItem value="service">{t('admin.reservations.details.chargeDialog.categoryService', 'Service')}</MenuItem>
            <MenuItem value="damage">{t('admin.reservations.details.chargeDialog.categoryDamage', 'Damage')}</MenuItem>
            <MenuItem value="adjustment">{t('admin.reservations.details.chargeDialog.categoryAdjustment', 'Adjustment')}</MenuItem>
          </TextField>
          {chargeError && <Typography variant="body2" color="error">{chargeError}</Typography>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setChargeDialogOpen(false)} disabled={chargeSubmitting}>{t('admin.reservations.details.actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={chargeSubmitting || !chargeDescription.trim() || !chargeAmount || chargeAmount <= 0}
          onClick={async () => {
            try {
              setChargeSubmitting(true);
              setChargeError(null);
              await reservationsService.addReservationCharge(current._id, {
                description: chargeDescription.trim(),
                amount: chargeAmount!,
                category: chargeCategory || undefined,
              });
              const f = await reservationsService.getReservationFinancial(current._id);
              setCharges(f.data.data?.charges || []);
              setSummary(f.data.data?.summary || summary);
              setChargeDialogOpen(false);
            } catch (err: any) {
              setChargeError(err?.response?.data?.message || t('admin.reservations.details.chargeDialog.failed', 'Failed to add charge'));
            } finally {
              setChargeSubmitting(false);
            }
          }}
        >
          {t('admin.reservations.details.chargeDialog.submit', 'Add Charge')}
        </Button>
      </DialogActions>
    </Dialog>

    {/* ECF Invoice Generation Modal */}
    {ecfIsActive && folioId && (
      <InvoiceGenerationModal
        open={invoiceModalOpen}
        onClose={() => { setInvoiceModalOpen(false); setSelectedPaymentId(undefined); }}
        folioId={folioId}
        paymentId={selectedPaymentId}
        totalAmount={summary.totalCharges}
        prefillBuyerName={guestName !== 'Guest' ? guestName : undefined}
        prefillBuyerEmail={guestEmail !== '-' ? guestEmail : undefined}
        prefillBuyerRnc={(linkedGuest as any)?.fiscalInfo?.rnc}
        prefillBuyerRazonSocial={(linkedGuest as any)?.fiscalInfo?.razonSocial}
        onInvoiceGenerated={() => { if (folioId) fetchEcfInvoices(folioId); }}
        formatCurrency={formatCurrency}
      />
    )}
    </>
  );
};

export default ReservationDetails;
