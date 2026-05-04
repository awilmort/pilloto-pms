import React from 'react';
import { IconButton, Typography, Menu, MenuItem } from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import { useTranslation } from 'react-i18next';

const LanguageSwitcher: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = React.useState<null | HTMLElement>(null);

  const handleChange = (lang: string) => {
    i18n.changeLanguage(lang);
    setAnchor(null);
  };

  return (
    <>
      <IconButton
        size="small"
        onClick={e => setAnchor(e.currentTarget)}
        aria-label="select language"
        sx={{
          border: '1px solid #EBEBEB',
          borderRadius: '9999px',
          px: 1.5,
          py: 0.5,
          color: '#222222',
          transition: 'all 0.2s ease-out',
          '&:hover': { bgcolor: '#F7F7F7', borderColor: '#222222' },
        }}
      >
        <LanguageIcon sx={{ fontSize: 18, mr: 0.5 }} />
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', lineHeight: 1 }}>
          {i18n.language?.substring(0, 2) || 'es'}
        </Typography>
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        PaperProps={{
          sx: {
            borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            mt: 1,
            minWidth: 140,
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <MenuItem
          onClick={() => handleChange('es')}
          selected={i18n.language === 'es'}
          sx={{ fontSize: '0.9rem', borderRadius: '8px', mx: 0.5 }}
        >
          {t('common.spanish')}
        </MenuItem>
        <MenuItem
          onClick={() => handleChange('en')}
          selected={i18n.language === 'en'}
          sx={{ fontSize: '0.9rem', borderRadius: '8px', mx: 0.5 }}
        >
          {t('common.english')}
        </MenuItem>
      </Menu>
    </>
  );
};

export default LanguageSwitcher;
