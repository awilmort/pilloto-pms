/**
 * Plain-language explanations for Calendar and booking-rule terms (architecture §8.2):
 * `<Term>` shows a label with a one-line explanation on hover; `<GlossaryButton>` opens
 * every term at once.
 */
import React, { useState } from 'react';
import { Box, Button, Popover, Tooltip, Typography } from '@mui/material';
import { HelpOutline, MenuBook } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export const GLOSSARY_TERMS = [
  'availability', 'price', 'minStayArrival', 'maxStay', 'closedToArrival', 'closedToDeparture', 'stopSell',
  'calendarAdjustment', 'namedRule',
] as const;
export type GlossaryTerm = typeof GLOSSARY_TERMS[number];

/** A term's label with its explanation on hover (`children` overrides the label). */
export const Term: React.FC<{ term: GlossaryTerm; children?: React.ReactNode }> = ({ term, children }) => {
  const { t } = useTranslation();
  return (
    <Tooltip title={t(`admin.pricing.glossary.${term}.text`)} arrow>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, cursor: 'help' }}>
        {children ?? t(`admin.pricing.glossary.${term}.term`)}
        <HelpOutline sx={{ fontSize: 14, color: 'text.secondary' }} />
      </Box>
    </Tooltip>
  );
};

export const GlossaryButton: React.FC = () => {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button size="small" startIcon={<MenuBook />} onClick={(e) => setAnchor(e.currentTarget)}>
        {t('admin.pricing.glossary.button')}
      </Button>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ p: 2, maxWidth: 420 }}>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>{t('admin.pricing.glossary.title')}</Typography>
          {GLOSSARY_TERMS.map((term) => (
            <Box key={term} sx={{ mb: 1.25 }}>
              <Typography variant="body2" fontWeight={600}>{t(`admin.pricing.glossary.${term}.term`)}</Typography>
              <Typography variant="body2" color="text.secondary">{t(`admin.pricing.glossary.${term}.text`)}</Typography>
            </Box>
          ))}
        </Box>
      </Popover>
    </>
  );
};
