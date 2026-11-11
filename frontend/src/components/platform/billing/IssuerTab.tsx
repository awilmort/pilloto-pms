import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Link, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { CheckCircle, OpenInNew, RadioButtonUnchecked, Refresh } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { platformBillingService } from '../../../services/api';
import type { BillingIssuer, BillingIssuerReadiness } from '../../../types/billing';
import { chipTone, STATE_TONE } from '../../fiscal/fiscalUi';
import IssuerSetupGuide from './IssuerSetupGuide';
import { billingErrorMessage, errorFields, formatDate, formatInt } from './billingUi';

const TYPES = ['31', '32', '33', '34'];

/**
 * Pilloto's own e-invoicing: the e-CF it issues for the payments it receives. It is a BillingSoft
 * Organization like a tenant's, with its own certificate, DGII certification and e-NCF ranges.
 */
const IssuerTab: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const { t } = useTranslation();
  const [issuer, setIssuer] = useState<BillingIssuer | null>(null);
  const [readiness, setReadiness] = useState<BillingIssuerReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState({ documentType: '31', rangeStart: '', rangeEnd: '', expiresOn: '' });
  const [rangeFields, setRangeFields] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const status = (await platformBillingService.issuer()).data.data!;
      setIssuer(status);
      setError(null);
      if (status.linked) {
        try {
          setReadiness((await platformBillingService.issuerReadiness()).data.data ?? null);
        } catch {
          setReadiness(null);
        }
      } else {
        setReadiness(null);
      }
    } catch (err) {
      setError(billingErrorMessage(err, t));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      onChanged();
    } catch (err) {
      setError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const saveRange = async () => {
    setRangeFields({});
    setBusy(true);
    try {
      await platformBillingService.recordSequence({ documentType: range.documentType, rangeStart: Number(range.rangeStart), rangeEnd: Number(range.rangeEnd), ...(range.expiresOn ? { expiresOn: range.expiresOn } : {}) });
      setRange({ ...range, rangeStart: '', rangeEnd: '', expiresOn: '' });
      setNotice(t('platformBilling.issuer.rangeSaved', 'Range recorded.'));
      await load();
    } catch (err) {
      setRangeFields(errorFields(err));
      setError(billingErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (!issuer) return error ? <Alert severity="error">{error}</Alert> : <CircularProgress size={22} />;

  return (
    <Box sx={{ display: 'grid', gap: 3, maxWidth: 900 }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}
      {!issuer.configured && <Alert severity="warning">{t('platformBilling.issuer.notConfigured', 'This server has no BillingSoft credential, so no e-CF can be issued. Follow steps 1 to 5 in the guide below.')}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6" fontWeight={700}>{t('platformBilling.issuer.title', 'Pilloto’s own e-invoicing')}</Typography>
          <Chip size="small" {...chipTone(STATE_TONE[issuer.state])} label={t(`fiscal.state.${issuer.state}`, issuer.state)} />
          {issuer.environment && issuer.environment !== 'ecf' && <Chip size="small" variant="outlined" label={t('platformBilling.issuer.testEnv', 'Test environment')} />}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('platformBilling.issuer.intro', 'Pilloto issues a credit-fiscal e-CF to a tenant when you record its payment. That needs Pilloto’s own account in BillingSoft, with its digital certificate, DGII’s certification and e-NCF ranges.')}
        </Typography>

        {!issuer.linked ? (
          <Button variant="contained" onClick={() => run(async () => { await platformBillingService.linkIssuer(); setNotice(t('platformBilling.issuer.linked', 'Linked to BillingSoft.')); })} disabled={busy || !issuer.configured}>
            {t('platformBilling.issuer.link', 'Link Pilloto’s e-invoicing')}
          </Button>
        ) : (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" startIcon={<Refresh />} onClick={() => run(async () => { await platformBillingService.syncIssuer(); })} disabled={busy}>{t('platformBilling.issuer.refresh', 'Refresh status')}</Button>
            <Button variant="outlined" component={Link} href={issuer.appUrl} target="_blank" rel="noopener" endIcon={<OpenInNew />}>{t('platformBilling.issuer.openBillingSoft', 'Open BillingSoft')}</Button>
          </Stack>
        )}
        {issuer.linked && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
            {issuer.rnc ? `RNC ${issuer.rnc} · ` : ''}{t('platformBilling.issuer.synced', 'Checked {{date}}', { date: formatDate(issuer.lastSyncedAt) })}
            {!issuer.webhookRegistered && ` · ${t('platformBilling.issuer.noWebhook', 'webhook not registered: DGII answers are read by polling')}`}
          </Typography>
        )}
        {issuer.allowUncertified && <Alert severity="warning" sx={{ mt: 2 }}>{t('platformBilling.issuer.allowUncertified', 'This server issues even when DGII has not certified Pilloto (development/QA only). Those documents have no fiscal value.')}</Alert>}
      </Paper>

      <IssuerSetupGuide issuer={issuer} />

      {readiness && (
        <>
          <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{t('platformBilling.issuer.steps', 'DGII setup')}</Typography>
            {readiness.steps.map((s) => (
              <Stack key={s.step} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
                {s.done ? <CheckCircle color="success" fontSize="small" /> : <RadioButtonUnchecked color="disabled" fontSize="small" />}
                <Typography variant="body2">{t(`platformBilling.issuer.step.${s.step}`, s.step)}</Typography>
              </Stack>
            ))}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              {t('platformBilling.issuer.certificate', 'Certificate')}: {t(`platformBilling.issuer.cert.${readiness.certificate}`, readiness.certificate)}
              {readiness.usableTypes.length > 0 && ` · ${t('platformBilling.issuer.usable', 'Can issue')}: ${readiness.usableTypes.map((x) => `E${x}`).join(', ')}`}
            </Typography>
          </Paper>

          <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 3 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>{t('platformBilling.issuer.ranges', 'e-NCF ranges')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('platformBilling.issuer.rangesHelp', 'The numbers DGII authorized Pilloto to issue. E31 is used for payments, E34 for reversals.')}</Typography>
            {readiness.sequences.length > 0 && (
              <Table size="small" sx={{ mb: 2 }} aria-label={t('platformBilling.issuer.ranges', 'e-NCF ranges')}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('platformBilling.issuer.type', 'Type')}</TableCell>
                    <TableCell>{t('platformBilling.issuer.range', 'Range')}</TableCell>
                    <TableCell align="right">{t('platformBilling.issuer.remaining', 'Remaining')}</TableCell>
                    <TableCell>{t('platformBilling.issuer.expires', 'Expires')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {readiness.sequences.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>E{s.documentType}</TableCell>
                      <TableCell>{formatInt(s.rangeStart)} – {formatInt(s.rangeEnd)}</TableCell>
                      <TableCell align="right">{s.usable ? formatInt(s.remaining) : <Chip size="small" color="error" variant="outlined" label={t('platformBilling.issuer.unusable', 'Unusable')} />}</TableCell>
                      <TableCell>{s.expiresOn ? formatDate(`${s.expiresOn}T12:00:00Z`) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'flex-start' }}>
              <TextField select size="small" sx={{ minWidth: 110 }} label={t('platformBilling.issuer.type', 'Type')} value={range.documentType} onChange={(e) => setRange({ ...range, documentType: e.target.value })}>
                {TYPES.map((x) => <MenuItem key={x} value={x}>E{x}</MenuItem>)}
              </TextField>
              <TextField size="small" type="number" label={t('platformBilling.issuer.from', 'From')} value={range.rangeStart} onChange={(e) => setRange({ ...range, rangeStart: e.target.value })} error={Boolean(rangeFields.rangeStart)} helperText={rangeFields.rangeStart} inputProps={{ 'aria-label': 'range start' }} />
              <TextField size="small" type="number" label={t('platformBilling.issuer.to', 'To')} value={range.rangeEnd} onChange={(e) => setRange({ ...range, rangeEnd: e.target.value })} error={Boolean(rangeFields.rangeEnd)} helperText={rangeFields.rangeEnd} inputProps={{ 'aria-label': 'range end' }} />
              <TextField size="small" type="date" label={t('platformBilling.issuer.expires', 'Expires')} value={range.expiresOn} onChange={(e) => setRange({ ...range, expiresOn: e.target.value })} InputLabelProps={{ shrink: true }} />
              <Button variant="outlined" sx={{ whiteSpace: 'nowrap', flexShrink: 0 }} onClick={saveRange} disabled={busy || !range.rangeStart || !range.rangeEnd}>{t('platformBilling.issuer.record', 'Record range')}</Button>
            </Stack>
          </Paper>
        </>
      )}
    </Box>
  );
};

export default IssuerTab;
