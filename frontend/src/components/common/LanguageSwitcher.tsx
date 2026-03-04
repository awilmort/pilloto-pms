import React from 'react';
import { FormControl, Select, MenuItem, InputLabel } from '@mui/material';
import { useTranslation } from 'react-i18next';

const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();
  const currentLang = i18n.language || 'es';

  const handleChange = (event: React.ChangeEvent<{ value: unknown }>) => {
    const lang = event.target.value as string;
    i18n.changeLanguage(lang);
  };

  return (
    <FormControl size="small" sx={{ minWidth: 140 }}>
      <InputLabel>{t('common.language')}</InputLabel>
      <Select
        value={currentLang}
        label={t('common.language')}
        onChange={handleChange as any}
      >
        <MenuItem value="es">{t('common.spanish')}</MenuItem>
        <MenuItem value="en">{t('common.english')}</MenuItem>
      </Select>
    </FormControl>
  );
};

export default LanguageSwitcher;
