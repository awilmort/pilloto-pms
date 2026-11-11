import React, { useEffect, useState } from 'react';
import { Alert, Box, Chip, CircularProgress, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { FiscalStatement } from '../../types';
import { fiscalErrorMessage, formatDop, periodLabel, STATEMENT_TONE, formatInt } from './fiscalUi';
import i18n from '../../i18n';

/**
 * Past months' charges: one statement per month, final once closed on the 1st. What a company is
 * billed for electronic invoicing is exactly what is listed here.
 */
const FiscalStatementsCard: React.FC<{ refreshKey?: string }> = ({ refreshKey }) => {
  const { t } = useTranslation();
  const [statements, setStatements] = useState<FiscalStatement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fiscalService
      .getStatements()
      .then((res) => alive && setStatements((res.data.data as FiscalStatement[]) ?? []))
      .catch((err) => alive && setError(fiscalErrorMessage(err, t)));
    return () => { alive = false; };
  }, [refreshKey, t]);

  return (
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: { xs: 2, md: 3 } }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>{t('fiscal.statements.title', 'Statements')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('fiscal.statements.intro', 'Each month is closed on the 1st. A closed statement does not change.')}
      </Typography>

      {error && <Alert severity="warning">{error}</Alert>}
      {!statements && !error && <Box sx={{ py: 2 }}><CircularProgress size={20} /></Box>}
      {statements && statements.length === 0 && (
        <Typography variant="body2" color="text.secondary">{t('fiscal.statements.empty', 'No statements yet. The first appears with this month’s usage.')}</Typography>
      )}

      {statements && statements.length > 0 && (
        <TableContainer>
          <Table size="small" aria-label={t('fiscal.statements.title', 'Statements')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('fiscal.statements.period', 'Month')}</TableCell>
                <TableCell>{t('fiscal.statements.plan', 'Plan')}</TableCell>
                <TableCell align="right">{t('fiscal.statements.used', 'Documents')}</TableCell>
                <TableCell align="right">{t('fiscal.statements.planCharge', 'Plan')}</TableCell>
                <TableCell align="right">{t('fiscal.statements.overage', 'Extra')}</TableCell>
                <TableCell align="right">{t('fiscal.statements.total', 'Total')}</TableCell>
                <TableCell>{t('fiscal.statements.status', 'Status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {statements.map((s) => (
                <TableRow key={s._id} hover>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{periodLabel(s.period, i18n.language)}</TableCell>
                  <TableCell>
                    {t(`fiscal.plan.${s.plan}`, s.plan)}
                    {s.planChanges.length > 0 && (
                      <Tooltip title={s.planChanges.map((c) => `${t(`fiscal.plan.${c.from}`, c.from)} → ${t(`fiscal.plan.${c.to}`, c.to)}`).join(', ')}>
                        <Chip size="small" variant="outlined" label={t('fiscal.statements.changed', 'changed')} sx={{ ml: 1 }} />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {formatInt(s.transactions.used)}
                    {s.transactions.included != null && <Typography component="span" variant="caption" color="text.secondary"> / {formatInt(s.transactions.included)}</Typography>}
                  </TableCell>
                  <TableCell align="right">{formatDop(s.planCharge, i18n.language)}</TableCell>
                  <TableCell align="right">
                    {s.overageAmount > 0 ? (
                      <Tooltip title={t('fiscal.statements.extraDetail', { count: s.transactions.extra, unit: formatDop(s.overageUnitPrice, i18n.language), defaultValue: '{{count}} × {{unit}}' })}>
                        <span>{formatDop(s.overageAmount, i18n.language)}</span>
                      </Tooltip>
                    ) : '—'}
                  </TableCell>
                  <TableCell align="right"><strong>{formatDop(s.total, i18n.language)}</strong></TableCell>
                  <TableCell><Chip size="small" color={STATEMENT_TONE[s.status]} variant={s.status === 'void' ? 'outlined' : 'filled'} label={t(`fiscal.statements.state.${s.status}`, s.status)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

export default FiscalStatementsCard;
