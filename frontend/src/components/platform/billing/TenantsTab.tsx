import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Chip, CircularProgress, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingCharge, BillingTenant } from '../../../types/billing';
import TenantBillingDrawer from './TenantBillingDrawer';
import { billingErrorMessage, formatDate, formatDop } from './billingUi';

/** Every tenant with what it pays, what it owes and when it last paid. */
const TenantsTab: React.FC<{ onChanged: () => void; onOpenCharge: (charge: BillingCharge) => void }> = ({ onChanged, onOpenCharge }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BillingTenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await platformBillingService.tenants()).data.data ?? []);
      setError(null);
    } catch (err) {
      setError(billingErrorMessage(err, t));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" aria-label={t('platformBilling.tabs.tenants', 'Tenants')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('platformBilling.charges.tenant', 'Tenant')}</TableCell>
                <TableCell>{t('platformBilling.tenants.subscription', 'Subscription')}</TableCell>
                <TableCell align="right">{t('platformBilling.tenants.owes', 'Owes')}</TableCell>
                <TableCell>{t('platformBilling.tenants.lastPayment', 'Last payment')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {!rows && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={22} /></TableCell></TableRow>}
              {rows?.map((tn) => (
                <TableRow key={tn.id} hover sx={{ cursor: 'pointer' }} onClick={() => setOpenId(tn.id)}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{tn.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{tn.slug}</Typography>
                  </TableCell>
                  <TableCell>
                    {tn.products.length === 0 && '—'}
                    {tn.products.map((p) => (
                      <Typography key={p.product} variant="body2">
                        {t(`platformBilling.products.${p.product}`, p.product)} {p.plan} · {p.contractPrice != null ? formatDop(p.contractPrice) : '—'}
                        {p.contractSource === 'override' && <Chip size="small" color="info" label={t('platformBilling.tenants.custom', 'Custom')} sx={{ ml: 0.5 }} />}
                      </Typography>
                    ))}
                    {tn.paused && <Chip size="small" variant="outlined" label={t('platformBilling.tenants.pausedChip', 'Not charged')} />}
                    {!tn.rnc && <Chip size="small" color="error" variant="outlined" label={t('platformBilling.tenants.noRncChip', 'No RNC')} sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell align="right">{tn.outstanding > 0 ? <strong>{formatDop(tn.outstanding)}</strong> : '—'}</TableCell>
                  <TableCell>{tn.lastPayment ? `${formatDate(tn.lastPayment.paidAt)} · ${formatDop(tn.lastPayment.amount)}` : '—'}</TableCell>
                  <TableCell align="right">{!tn.isActive && <Chip size="small" variant="outlined" label={t('platformBilling.tenants.inactive', 'Inactive')} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <TenantBillingDrawer tenantId={openId} onClose={() => setOpenId(null)} onChanged={() => { load(); onChanged(); }} onOpenCharge={onOpenCharge} />
    </Box>
  );
};

export default TenantsTab;
