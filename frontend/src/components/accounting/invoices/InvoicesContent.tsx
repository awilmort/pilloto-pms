import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, IconButton, InputLabel, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Select, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SendIcon from '@mui/icons-material/Send';
import PaymentIcon from '@mui/icons-material/Payment';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import PostAddIcon from '@mui/icons-material/PostAdd';
import BlockIcon from '@mui/icons-material/Block';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import FileCopyOutlinedIcon from '@mui/icons-material/FileCopyOutlined';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePermission } from '../../../lib/permissions';
import { invoicesService, accountingCustomersService } from '../../../services/api';
import { Invoice, InvoiceStatus, Customer } from '../../../types';
import { formatAccountingMoneyExact as formatMoney } from '../../../utils/currency';
import i18n from '../../../i18n';
import { useInvoiceActions } from './useInvoiceActions';
import { customerLabel, isOverdueInvoice, STATUS_COLOR } from './invoiceUi';

/**
 * `/accounting/invoices` — the AR invoice list. Creating and editing happen on their own page
 * (`/new`, `/:id/edit`), reading on the details page (`/:id`); the issue / payment / void
 * confirmations and the PDF preview are shared with that page through `useInvoiceActions`.
 */
const InvoicesContent: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const canManage = usePermission('accounting.invoices.manage');
  const canVoid = usePermission('accounting.invoices.void');

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  // Seeded from Reports' AR Aging tab ("click a row to view its invoices")
  const [customerFilter, setCustomerFilter] = useState<string | undefined>((location.state as { customerId?: string } | null)?.customerId);
  const [actionMenu, setActionMenu] = useState<{ anchorEl: HTMLElement | null; invoice: Invoice | null }>({ anchorEl: null, invoice: null });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [invRes, custRes] = await Promise.all([
        invoicesService.getInvoices({ status: statusFilter === 'all' ? undefined : statusFilter, customer: customerFilter, limit: 200 }),
        accountingCustomersService.getCustomers({ active: true, limit: 200 }).catch(() => null),
      ]);
      setInvoices(Array.isArray(invRes.data.data) ? invRes.data.data : []);
      setCustomers(custRes && Array.isArray(custRes.data.data) ? custRes.data.data : []);
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.invoices.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, customerFilter, t]);

  useEffect(() => { load(); }, [load]);

  // Clear the nav-carried customerId out of history state once read (the local filter stays in effect).
  useEffect(() => {
    if ((location.state as { customerId?: string } | null)?.customerId) navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);

  const actions = useInvoiceActions(() => load());

  const closeMenu = () => setActionMenu({ anchorEl: null, invoice: null });
  const menuInv = actionMenu.invoice;
  const pick = (fn: (inv: Invoice) => void) => () => { const inv = menuInv!; closeMenu(); fn(inv); };

  if (loading && invoices.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>{t('accounting.invoices.loading')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('accounting.invoices.table.status')}</InputLabel>
            <Select value={statusFilter} label={t('accounting.invoices.table.status')} onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'all')}>
              <MenuItem value="all">{t('common.all', 'All')}</MenuItem>
              {(['draft', 'sent', 'partial', 'paid', 'void'] as const).map((s) => <MenuItem key={s} value={s}>{t(`accounting.invoices.status.${s}`)}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>{t('accounting.reports.aging.customer', 'Customer')}</InputLabel>
            <Select value={customerFilter || ''} label={t('accounting.reports.aging.customer', 'Customer')} onChange={(e) => setCustomerFilter(e.target.value || undefined)}>
              <MenuItem value="">{t('common.all', 'All')}</MenuItem>
              {customers.map((c) => <MenuItem key={c._id} value={c._id}>{c.razonSocial || c.name}</MenuItem>)}
            </Select>
          </FormControl>
          {canManage && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/accounting/invoices/new')} sx={{ ml: 'auto' }}>
              {t('accounting.invoices.actions.create')}
            </Button>
          )}
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('accounting.invoices.table.number')}</TableCell>
                <TableCell>{t('accounting.invoices.table.customer')}</TableCell>
                <TableCell>{t('accounting.invoices.table.issueDate')}</TableCell>
                <TableCell>{t('accounting.invoices.form.dueDate')}</TableCell>
                <TableCell align="right">{t('accounting.invoices.table.total')}</TableCell>
                <TableCell align="right">{t('accounting.invoices.table.balanceDue')}</TableCell>
                <TableCell>{t('accounting.invoices.table.status')}</TableCell>
                <TableCell align="right">{t('accounting.invoices.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center">{t('accounting.invoices.empty')}</TableCell></TableRow>
              ) : invoices.map((inv) => (
                <TableRow key={inv._id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/accounting/invoices/${inv._id}`)}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography component="span" fontWeight={600} color="primary.main">{inv.invoiceNumber}</Typography></TableCell>
                  <TableCell>{customerLabel(inv)}</TableCell>
                  <TableCell>{new Date(inv.issueDate).toLocaleDateString(i18n.language)}</TableCell>
                  <TableCell>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString(i18n.language) : '—'}</TableCell>
                  <TableCell align="right">{formatMoney(inv.total)}</TableCell>
                  <TableCell align="right">{formatMoney(inv.balanceDue)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={t(`accounting.invoices.status.${inv.status}`)} color={STATUS_COLOR[inv.status]} />
                    {isOverdueInvoice(inv) && <Chip size="small" label={t('accounting.invoices.status.overdue')} color="error" variant="outlined" sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title={t('accounting.invoices.actions.view')}>
                      <IconButton size="small" onClick={() => navigate(`/accounting/invoices/${inv._id}`)}><VisibilityIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <IconButton size="small" onClick={(e) => setActionMenu({ anchorEl: e.currentTarget, invoice: inv })} aria-label={t('accounting.invoices.table.actions')}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Menu anchorEl={actionMenu.anchorEl} open={Boolean(actionMenu.anchorEl)} onClose={closeMenu}>
        <MenuItem onClick={pick((inv) => actions.openPdf(inv))}>
          <ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>{t('accounting.invoices.page.pdf')}</ListItemText>
        </MenuItem>
        {canManage && menuInv?.status === 'draft' && (
          <MenuItem onClick={pick((inv) => navigate(`/accounting/invoices/${inv._id}/edit`))}>
            <ListItemIcon><EditOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.edit')}</ListItemText>
          </MenuItem>
        )}
        {canManage && menuInv?.status === 'draft' && (
          <MenuItem onClick={pick((inv) => actions.openSend(inv))}>
            <ListItemIcon><SendIcon fontSize="small" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.send')}</ListItemText>
          </MenuItem>
        )}
        {canManage && (menuInv?.status === 'sent' || menuInv?.status === 'partial') && (
          <MenuItem onClick={pick((inv) => actions.openPayment(inv))}>
            <ListItemIcon><PaymentIcon fontSize="small" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.recordPayment')}</ListItemText>
          </MenuItem>
        )}
        {canManage && (
          <MenuItem onClick={pick((inv) => navigate(`/accounting/invoices/new?duplicate=${inv._id}`))}>
            <ListItemIcon><FileCopyOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.duplicate')}</ListItemText>
          </MenuItem>
        )}
        {menuInv && ['sent', 'partial', 'paid'].includes(menuInv.status) && (
          <MenuItem onClick={pick((inv) => navigate('/accounting/credit-notes', { state: { invoiceId: inv._id } }))}>
            <ListItemIcon><AssignmentReturnIcon fontSize="small" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.issueCreditNote')}</ListItemText>
          </MenuItem>
        )}
        {menuInv && ['sent', 'partial', 'paid'].includes(menuInv.status) && (
          <MenuItem onClick={pick((inv) => navigate('/accounting/debit-notes', { state: { debitNoteInvoiceId: inv._id } }))}>
            <ListItemIcon><PostAddIcon fontSize="small" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.issueDebitNote')}</ListItemText>
          </MenuItem>
        )}
        {canVoid && menuInv && menuInv.status !== 'void' && menuInv.amountPaid === 0 && (
          <MenuItem onClick={pick((inv) => actions.openVoid(inv))} sx={{ color: 'error.main' }}>
            <ListItemIcon><BlockIcon fontSize="small" color="error" /></ListItemIcon><ListItemText>{t('accounting.invoices.actions.void')}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {actions.dialogs}
    </Box>
  );
};

export default InvoicesContent;
