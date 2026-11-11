import React from 'react';
import { Box, Typography } from '@mui/material';
import type { InvoiceFormMeta } from '../../../types';
import { resolveMediaUrl } from '../../../services/api';

interface Props {
  issuer: InvoiceFormMeta['issuer'] | null;
  /** Right-hand block: document title, number, e-NCF. */
  children: React.ReactNode;
}

/** Top of the invoice "paper": the issuing company on the left, the document title block on the right. */
const InvoiceLetterhead: React.FC<Props> = ({ issuer, children }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 3, flexWrap: 'wrap' }}>
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', minWidth: 0, flex: '1 1 260px' }}>
      {issuer?.logoUrl && (
        <Box component="img" src={resolveMediaUrl(issuer.logoUrl)} alt="" sx={{ maxWidth: 96, maxHeight: 60, objectFit: 'contain', flexShrink: 0 }}
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none'; }} />
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.25 }}>{issuer?.name || ' '}</Typography>
        {issuer?.legalName && issuer.legalName !== issuer.name && <Typography variant="body2" color="text.secondary">{issuer.legalName}</Typography>}
        {issuer?.rnc && <Typography variant="body2" color="text.secondary">RNC {issuer.rnc}</Typography>}
        {issuer?.address && <Typography variant="body2" color="text.secondary">{issuer.address}</Typography>}
        {(issuer?.phone || issuer?.email) && (
          <Typography variant="body2" color="text.secondary">{[issuer.phone, issuer.email].filter(Boolean).join('  ·  ')}</Typography>
        )}
      </Box>
    </Box>
    <Box sx={{ textAlign: { xs: 'left', sm: 'right' }, flex: '0 1 auto', minWidth: 220 }}>{children}</Box>
  </Box>
);

export default InvoiceLetterhead;
