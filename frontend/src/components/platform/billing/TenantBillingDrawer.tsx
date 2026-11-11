import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Divider, Drawer, FormControlLabel, IconButton, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { Close } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingCharge, BillingTenantDetail } from '../../../types/billing';
import { ChargeStatusChip } from './ChargeDrawer';
import EcfCell from './EcfCell';
import DiscountDialog from './DiscountDialog';
import GenerateChargeDialog from './GenerateChargeDialog';
import PaymentActions from './PaymentActions';
import PriceChangeDialog from './PriceChangeDialog';
import { billingErrorMessage, errorFields, formatDate, formatDop, periodLabel } from './billingUi';

interface Props {
  tenantId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenCharge: (charge: BillingCharge) => void;
}

/** One tenant's billing: what it pays and since when, price changes, who to bill, and its history. */
const TenantBillingDrawer: React.FC<Props> = ({ tenantId, onClose, onChanged, onOpenCharge }) => {
  const { t, i18n } = useTranslation();
  const [tenant, setTenant] = useState<BillingTenantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pricing, setPricing] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = (await platformBillingService.tenant(tenantId)).data.data ?? null;
      setTenant(data);
      setEmail(data?.billingEmail ?? '');
      setError(null);
    } catch (err) {
      setError(billingErrorMessage(err, t));
    }
  }, [tenantId, t]);

  useEffect(() => { setTenant(null); setNotice(null); load(); }, [load]);

  const changed = (message?: string) => { if (message) setNotice(message); load(); onChanged(); };

  const saveEmail = async () => {
    if (!tenant) return;
    setEmailError(null);
    try {
      await platformBillingService.updateTenant(tenant.id, { billingEmail: email.trim() });
      changed(t('platformBilling.tenants.saved', 'Saved.'));
    } catch (err) {
      setEmailError(errorFields(err).billingEmail ?? billingErrorMessage(err, t));
    }
  };

  const setPaused = async (paused: boolean) => {
    if (!tenant) return;
    try {
      await platformBillingService.updateTenant(tenant.id, { paused });
      changed();
    } catch (err) {
      setError(billingErrorMessage(err, t));
    }
  };

  const cancelChange = async (changeId: string) => {
    if (!tenant) return;
    try {
      await platformBillingService.cancelPriceChange(tenant.id, changeId);
      changed();
    } catch (err) {
      setError(billingErrorMessage(err, t));
    }
  };

  const endDiscount = async (discountId: string) => {
    if (!tenant) return;
    try {
      await platformBillingService.endDiscount(tenant.id, discountId);
      changed();
    } catch (err) {
      setError(billingErrorMessage(err, t));
    }
  };

  return (
    <Drawer anchor="right" open={Boolean(tenantId)} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 620 }, p: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">{t('platformBilling.tenants.billing', 'Billing')}</Typography>
          <Typography variant="h6" fontWeight={700}>{tenant?.name ?? '…'}</Typography>
          {tenant && <Typography variant="body2" color="text.secondary">{tenant.legalName || '—'} · RNC {tenant.rnc || t('platformBilling.tenants.noRnc', 'missing')}</Typography>}
        </Box>
        <IconButton onClick={onClose} aria-label={t('platformBilling.common.close', 'Close')}><Close /></IconButton>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {!tenant && !error && <CircularProgress size={24} />}

      {tenant && (
        <>
          {!tenant.rnc && <Alert severity="warning" sx={{ mb: 2 }}>{t('platformBilling.tenants.rncWarning', 'This tenant has no RNC in its company profile: its payments are recorded but no e-CF can be issued until it has one.')}</Alert>}

          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{t('platformBilling.tenants.contract', 'Contracted price')}</Typography>
          <Table size="small" aria-label={t('platformBilling.tenants.contract', 'Contracted price')}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ pl: 0 }}>{t('platformBilling.priceChange.product', 'Product')}</TableCell>
                <TableCell align="right">{t('platformBilling.tenants.contractPrice', 'Pays')}</TableCell>
                <TableCell align="right">{t('platformBilling.tenants.listPrice', 'List price')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tenant.products.map((p) => (
                <TableRow key={p.product}>
                  <TableCell sx={{ pl: 0 }}>{t(`platformBilling.products.${p.product}`, p.product)} — {p.plan}</TableCell>
                  <TableCell align="right">
                    {p.contractPrice != null ? formatDop(p.contractPrice) : '—'}
                    {p.contractSource === 'override' && <Chip size="small" color="info" label={t('platformBilling.tenants.custom', 'Custom')} sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell align="right">{p.listPrice != null ? formatDop(p.listPrice) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button sx={{ mt: 1 }} size="small" onClick={() => setPricing(true)} disabled={tenant.products.length === 0}>{t('platformBilling.priceChange.title', 'Change the contracted price')}</Button>

          {tenant.priceChanges.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('platformBilling.tenants.priceChanges', 'Price changes')}</Typography>
              {tenant.priceChanges.map((c) => (
                <Box key={c.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5, mb: 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2">
                      <strong>{formatDop(c.price)}</strong> · {t(`platformBilling.products.${c.product}`, c.product)} · <span style={{ textTransform: 'capitalize' }}>{periodLabel(c.effectiveFrom, i18n.language)}</span>
                    </Typography>
                    {c.appliedAt ? <Chip size="small" color="success" label={t('platformBilling.tenants.applied', 'Applied')} /> : <Button size="small" color="error" onClick={() => cancelChange(c.id)}>{t('platformBilling.common.cancel', 'Cancel')}</Button>}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block">{c.reason}</Typography>
                  <Typography variant="caption" color="text.secondary">{c.createdByEmail} · {formatDate(c.createdAt)}{c.notifiedAt ? ` · ${t('platformBilling.tenants.notified', 'tenant emailed')}` : ''}</Typography>
                </Box>
              ))}
            </Box>
          )}

          <Divider sx={{ my: 2 }} />
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>{t('platformBilling.discount.section', 'Discounts')}</Typography>
            <Button size="small" onClick={() => setDiscounting(true)} disabled={tenant.products.length === 0}>{t('platformBilling.discount.title', 'Grant a discount')}</Button>
          </Stack>
          {tenant.discounts.length === 0 ? <Typography variant="body2" color="text.secondary">{t('platformBilling.discount.none', 'No discounts.')}</Typography> : tenant.discounts.map((d) => (
            <Box key={d.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5, mb: 1 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2">
                  <strong>{d.type === 'percent' ? `${d.value}%` : formatDop(d.value)}</strong> · {t(`platformBilling.products.${d.product}`, d.product)} ·{' '}
                  <span style={{ textTransform: 'capitalize' }}>{t('platformBilling.discount.fromText', 'from {{month}}', { month: periodLabel(d.effectiveFrom, i18n.language) })}</span>
                  {', '}{d.effectiveUntil ? t('platformBilling.discount.untilText', 'until {{month}}', { month: periodLabel(d.effectiveUntil, i18n.language) }) : t('platformBilling.discount.noEnd', 'no end date')}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" color={d.status === 'active' ? 'success' : d.status === 'scheduled' ? 'info' : 'default'} label={t(`platformBilling.discount.status.${d.status}`, d.status)} />
                  {d.status !== 'ended' && <Button size="small" color="error" onClick={() => endDiscount(d.id)}>{t('platformBilling.discount.end', 'End')}</Button>}
                </Stack>
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block">{d.reason}</Typography>
              <Typography variant="caption" color="text.secondary">{d.createdByEmail} · {formatDate(d.createdAt)}</Typography>
            </Box>
          ))}

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{t('platformBilling.tenants.billTo', 'Who is billed')}</Typography>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              size="small" fullWidth type="email" label={t('platformBilling.tenants.billingEmail', 'Billing email')} value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={tenant.ownerEmail} error={Boolean(emailError)} helperText={emailError ?? t('platformBilling.tenants.billingEmailHelp', 'Charges and e-CF go here. Empty: the owner ({{email}}).', { email: tenant.ownerEmail })}
            />
            <Button variant="outlined" onClick={saveEmail} disabled={email.trim() === tenant.billingEmail}>{t('platformBilling.common.save', 'Save')}</Button>
          </Stack>
          <FormControlLabel sx={{ mt: 1 }} control={<Switch checked={tenant.paused} onChange={(e) => setPaused(e.target.checked)} />} label={t('platformBilling.tenants.paused', 'Do not charge this tenant (complimentary)')} />

          <Divider sx={{ my: 2 }} />
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>{t('platformBilling.tenants.charges', 'Charges')}</Typography>
            <Button size="small" onClick={() => setGenerating(true)}>{t('platformBilling.generate.title', 'Generate a charge')}</Button>
          </Stack>
          {tenant.charges.length === 0 ? <Typography variant="body2" color="text.secondary">{t('platformBilling.charges.empty', 'No charges match.')}</Typography> : (
            <Table size="small" aria-label={t('platformBilling.tenants.charges', 'Charges')}>
              <TableBody>
                {tenant.charges.map((c) => (
                  <TableRow key={c.id} hover sx={{ cursor: 'pointer' }} onClick={() => onOpenCharge(c)}>
                    <TableCell sx={{ pl: 0, textTransform: 'capitalize' }}>{periodLabel(c.period, i18n.language)}<Typography variant="caption" display="block" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{c.number}</Typography></TableCell>
                    <TableCell align="right">{formatDop(c.total)}</TableCell>
                    <TableCell align="right" sx={{ pr: 0 }}><ChargeStatusChip charge={c} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 3, mb: 1 }}>{t('platformBilling.tabs.payments', 'Payments')}</Typography>
          {tenant.payments.length === 0 ? <Typography variant="body2" color="text.secondary">{t('platformBilling.charges.noPayments', 'No payments recorded.')}</Typography> : (
            <Table size="small" aria-label={t('platformBilling.tabs.payments', 'Payments')}>
              <TableBody>
                {tenant.payments.map((p) => (
                  <TableRow key={p.id} sx={p.status === 'reversed' ? { opacity: 0.6 } : undefined}>
                    <TableCell sx={{ pl: 0 }}>{formatDate(p.paidAt)}<Typography variant="caption" display="block" color="text.secondary">{p.chargeNumber}</Typography></TableCell>
                    <TableCell align="right">{formatDop(p.amount)}</TableCell>
                    <TableCell><EcfCell payment={p} /></TableCell>
                    <TableCell align="right" sx={{ pr: 0 }}><PaymentActions payment={p} onChanged={changed} onError={setError} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <PriceChangeDialog tenant={pricing ? tenant : null} onClose={() => setPricing(false)} onSaved={() => { setPricing(false); changed(t('platformBilling.priceChange.saved', 'Price scheduled. The tenant was emailed.')); }} />
      <DiscountDialog tenant={discounting ? tenant : null} onClose={() => setDiscounting(false)} onSaved={() => { setDiscounting(false); changed(t('platformBilling.discount.saved', 'Discount granted.')); }} />
      <GenerateChargeDialog
        open={generating} tenantId={tenantId ?? undefined} onClose={() => setGenerating(false)}
        onGenerated={(charge) => { setGenerating(false); changed(); onOpenCharge(charge); }}
      />
    </Drawer>
  );
};

export default TenantBillingDrawer;
