import React from 'react';
import { Box, Button, Checkbox, FormControl, FormControlLabel, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { EXPENSE_TYPES, isNcf, ISR_WITHHOLDING_TYPES, normalizeNcf, suggestedWithholdings } from '../../../config/dgii';

export interface BillFiscalState {
  ncf: string;
  expenseType: string;
  itbisToCost: boolean;
  itbisWithheld: string;
  isrWithheld: string;
  isrWithholdingType: string;
}

export const emptyFiscal = (expenseType = ''): BillFiscalState => ({
  ncf: '', expenseType, itbisToCost: false, itbisWithheld: '', isrWithheld: '', isrWithholdingType: '',
});

/** The request fields of a bill from the form state (undefined when empty). */
export function fiscalPayload(f: BillFiscalState) {
  return {
    ncf: normalizeNcf(f.ncf) || '',
    expenseType: f.expenseType || undefined,
    itbisToCost: f.itbisToCost,
    itbisWithheld: Number(f.itbisWithheld) || 0,
    isrWithheld: Number(f.isrWithheld) || 0,
    isrWithholdingType: Number(f.isrWithheld) > 0 ? f.isrWithholdingType || undefined : undefined,
  };
}

/** A message when the fiscal fields cannot be saved, else null. */
export function fiscalError(f: BillFiscalState, t: (k: string, d: string) => string): string | null {
  const ncf = normalizeNcf(f.ncf);
  if (ncf && !isNcf(ncf)) return t('accounting.bills.fiscal.ncfInvalid', 'The NCF must be B + 10 digits (B0100000123) or an e-CF E + 12 digits (E310000000123).');
  if (Number(f.isrWithheld) > 0 && !f.isrWithholdingType) return t('accounting.bills.fiscal.isrTypeRequired', 'Choose the type of ISR withholding.');
  return null;
}

interface Props {
  value: BillFiscalState;
  onChange: (next: BillFiscalState) => void;
  /** For the withholding suggestion: an individual (cédula) supplier selling services. */
  supplierTaxId?: string;
  subtotal: number;
  itbis: number;
}

/**
 * The DGII side of a purchase: the supplier's NCF, the 606 expense type, whether the ITBIS is
 * deductible, and what is withheld from the supplier (ITBIS, ISR and its type).
 */
const BillFiscalFields: React.FC<Props> = ({ value, onChange, supplierTaxId, subtotal, itbis }) => {
  const { t } = useTranslation();
  const set = (patch: Partial<BillFiscalState>) => onChange({ ...value, ...patch });
  const ncf = normalizeNcf(value.ncf);
  const suggestion = suggestedWithholdings(supplierTaxId, subtotal, itbis);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 2fr' } }}>
        <TextField
          label={t('accounting.bills.fiscal.ncf', 'Supplier NCF / e-CF')}
          value={value.ncf}
          onChange={(e) => set({ ncf: e.target.value })}
          error={!!ncf && !isNcf(ncf)}
          helperText={t('accounting.bills.fiscal.ncfHelp', 'B01… or E31… — required for the 606')}
          inputProps={{ maxLength: 20 }}
        />
        <FormControl fullWidth>
          <InputLabel>{t('accounting.bills.fiscal.expenseType', '606 expense type')}</InputLabel>
          <Select value={value.expenseType} label={t('accounting.bills.fiscal.expenseType', '606 expense type')} onChange={(e) => set({ expenseType: e.target.value })}>
            {Object.entries(EXPENSE_TYPES).map(([code, name]) => <MenuItem key={code} value={code}>{code} — {name}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>
      <FormControlLabel
        control={<Checkbox checked={value.itbisToCost} onChange={(e) => set({ itbisToCost: e.target.checked })} />}
        label={t('accounting.bills.fiscal.itbisToCost', 'The ITBIS is not deductible (take it to cost)')}
      />
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle2">{t('accounting.bills.fiscal.withholdings', 'Withholdings')}</Typography>
          {suggestion && (
            <Button size="small" onClick={() => set({ itbisWithheld: String(suggestion.itbisWithheld), isrWithheld: String(suggestion.isrWithheld), isrWithholdingType: suggestion.isrWithholdingType })}>
              {t('accounting.bills.fiscal.suggest', 'Individual supplier: suggest 100% ITBIS + 10% ISR')}
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr 1.5fr' } }}>
          <TextField type="number" size="small" label={t('accounting.bills.fiscal.itbisWithheld', 'ITBIS withheld')} value={value.itbisWithheld} onChange={(e) => set({ itbisWithheld: e.target.value })} inputProps={{ min: 0 }} />
          <TextField type="number" size="small" label={t('accounting.bills.fiscal.isrWithheld', 'ISR withheld')} value={value.isrWithheld} onChange={(e) => set({ isrWithheld: e.target.value })} inputProps={{ min: 0 }} />
          <FormControl size="small" disabled={!(Number(value.isrWithheld) > 0)}>
            <InputLabel>{t('accounting.bills.fiscal.isrType', 'ISR withholding type')}</InputLabel>
            <Select value={value.isrWithholdingType} label={t('accounting.bills.fiscal.isrType', 'ISR withholding type')} onChange={(e) => set({ isrWithholdingType: e.target.value })}>
              {Object.entries(ISR_WITHHOLDING_TYPES).map(([code, name]) => <MenuItem key={code} value={code}>{code} — {name}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {t('accounting.bills.fiscal.withholdingsHelp', 'What you keep from the supplier and pay to the DGII instead. The supplier is owed the total less these amounts.')}
        </Typography>
      </Box>
    </Box>
  );
};

export default BillFiscalFields;
