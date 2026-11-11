import React, { useState } from 'react';
import { Box, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ElectronicInvoice } from '../../types';
import EcfStatusBadge from './EcfStatusBadge';
import FiscalDocumentDrawer from '../fiscal/FiscalDocumentDrawer';
import { formatDateTime } from '../fiscal/fiscalUi';
import { useFiscalStatus } from '../fiscal/useFiscalStatus';
import { useFiscalAccess } from '../fiscal/useFiscalAccess';
import i18n from '../../i18n';

interface EcfInvoicesSectionProps {
  invoices: ElectronicInvoice[];
  onRefresh: () => void;
  formatCurrency: (val?: number) => string;
}

/**
 * The e-CF documents of one reservation's folio. Each opens in the shared document drawer, which
 * carries everything that can be done with it: the official PDF and XML, email, the state with DGII,
 * sending it again, and credit and debit notes.
 */
const EcfInvoicesSection: React.FC<EcfInvoicesSectionProps> = ({ invoices, onRefresh, formatCurrency }) => {
  const { t } = useTranslation();
  const { status } = useFiscalStatus();
  const { canIssue } = useFiscalAccess();
  const [selected, setSelected] = useState<ElectronicInvoice | null>(null);

  if (invoices.length === 0) {
    return (
      <Box sx={{ mt: 2, textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">{t('fiscal.folio.none', 'No electronic invoices for this reservation yet.')}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 1 }}>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label={t('fiscal.folio.tableLabel', 'Electronic invoices of this reservation')}>
          <TableHead>
            <TableRow>
              <TableCell>{t('fiscal.documents.encf', 'e-NCF')}</TableCell>
              <TableCell>{t('fiscal.documents.type', 'Type')}</TableCell>
              <TableCell>{t('fiscal.documents.date', 'Date')}</TableCell>
              <TableCell>{t('fiscal.documents.buyer', 'Buyer')}</TableCell>
              <TableCell align="right">{t('fiscal.documents.total', 'Total')}</TableCell>
              <TableCell>{t('fiscal.documents.status', 'Status')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invoices.map((inv) => (
              <TableRow
                key={inv._id} hover tabIndex={0} sx={{ cursor: 'pointer' }} onClick={() => setSelected(inv)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(inv); } }}
              >
                <TableCell><Typography variant="body2" fontFamily="monospace" fontSize="0.8rem">{inv.eNCF ?? <em>{t('fiscal.documents.noEncf', 'Number pending')}</em>}</Typography></TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" label={inv.tipo} />
                  {inv.environment && inv.environment !== 'ecf' && <Chip size="small" color="warning" label={t('fiscal.documents.test', 'TEST')} sx={{ ml: 0.5 }} />}
                </TableCell>
                <TableCell>{formatDateTime(inv.issuedAt, i18n.language)}</TableCell>
                <TableCell>{inv.buyerName || inv.buyerRnc || '—'}</TableCell>
                <TableCell align="right">{formatCurrency(inv.totalFactura)}</TableCell>
                <TableCell><EcfStatusBadge status={inv.estadoECF} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <FiscalDocumentDrawer
        document={selected}
        canIssue={canIssue && Boolean(status?.canIssue)}
        onClose={() => setSelected(null)}
        onChanged={() => onRefresh()}
      />
    </Box>
  );
};

export default EcfInvoicesSection;
