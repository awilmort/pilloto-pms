import React, { useEffect } from 'react';
import { Box, FormControl, InputLabel, MenuItem, Select, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAccountingFeature } from '../../../contexts/TenantContext';
import { fxService } from '../../../services/fxApi';

export type DocCurrency = 'DOP' | 'USD' | 'EUR';

interface Props {
  currency: DocCurrency;
  exchangeRate: string;
  onChange: (next: { currency: DocCurrency; exchangeRate: string }) => void;
  /** The document's date: the rate starts from the latest recorded on or before it. */
  date?: string;
  size?: 'small' | 'medium';
  disabled?: boolean;
}

/**
 * Currency and exchange rate of a document. Shown only with the multi-currency module (Pro+);
 * otherwise documents are in pesos and nothing is rendered.
 */
const CurrencyFields: React.FC<Props> = ({ currency, exchangeRate, onChange, date, size = 'small', disabled }) => {
  const { t } = useTranslation();
  const enabled = useAccountingFeature('multiCurrency');

  useEffect(() => {
    if (!enabled || currency === 'DOP' || exchangeRate) return;
    fxService.latest(currency, date).then((r) => {
      if (r.data.data.rate) onChange({ currency, exchangeRate: String(r.data.data.rate) });
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, currency, date]);

  if (!enabled) return null;
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: currency === 'DOP' ? '1fr' : '1fr 1fr' }}>
      <FormControl size={size} disabled={disabled}>
        <InputLabel>{t('accounting.fx.currency', 'Currency')}</InputLabel>
        <Select label={t('accounting.fx.currency', 'Currency')} value={currency} onChange={(e) => onChange({ currency: e.target.value as DocCurrency, exchangeRate: '' })}>
          <MenuItem value="DOP">DOP — Peso</MenuItem>
          <MenuItem value="USD">USD — Dólar</MenuItem>
          <MenuItem value="EUR">EUR — Euro</MenuItem>
        </Select>
      </FormControl>
      {currency !== 'DOP' && (
        <TextField
          size={size}
          type="number"
          disabled={disabled}
          label={t('accounting.fx.rate', 'Rate (RD$ per {{currency}} 1)', { currency })}
          value={exchangeRate}
          onChange={(e) => onChange({ currency, exchangeRate: e.target.value })}
          inputProps={{ min: 0, step: 0.0001 }}
          helperText={t('accounting.fx.rateHelp', 'The books and the e-CF are in pesos at this rate')}
        />
      )}
    </Box>
  );
};

export default CurrencyFields;

/** The request fields for a document's currency. */
export const currencyPayload = (c: { currency: DocCurrency; exchangeRate: string }) =>
  c.currency === 'DOP' ? { currency: 'DOP' as const } : { currency: c.currency, ...(Number(c.exchangeRate) > 0 ? { exchangeRate: Number(c.exchangeRate) } : {}) };
