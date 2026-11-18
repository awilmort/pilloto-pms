import React, { useEffect, useState } from 'react';
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAccountingFeature } from '../../../contexts/TenantContext';
import { BankAccountView, bankService } from '../../../services/bankApi';

interface Props {
  /** Payment method: cash never goes through a bank. */
  method: string;
  value: string;
  onChange: (bankAccountId: string) => void;
  size?: 'small' | 'medium';
}

/**
 * Which bank account a non-cash payment goes through. Only with the bank module (Esencial+) and
 * more than one account; otherwise nothing is shown and the default account is used.
 */
const BankAccountSelect: React.FC<Props> = ({ method, value, onChange, size }) => {
  const { t } = useTranslation();
  const enabled = useAccountingFeature('bankReconciliation');
  const [accounts, setAccounts] = useState<BankAccountView[]>([]);

  useEffect(() => {
    if (!enabled) return;
    bankService.list().then((r) => {
      const active = r.data.data.filter((a) => a.isActive);
      setAccounts(active);
      if (!value) onChange(active.find((a) => a.isDefault)?._id ?? '');
    }).catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled || method === 'cash' || accounts.length < 2) return null;
  return (
    <FormControl fullWidth size={size}>
      <InputLabel>{t('accounting.banks.paymentAccount', 'Bank account')}</InputLabel>
      <Select label={t('accounting.banks.paymentAccount', 'Bank account')} value={value} onChange={(e) => onChange(e.target.value)}>
        {accounts.map((a) => <MenuItem key={a._id} value={a._id}>{a.name}{a.accountNumberLast4 ? ` ···${a.accountNumberLast4}` : ''}</MenuItem>)}
      </Select>
    </FormControl>
  );
};

export default BankAccountSelect;
