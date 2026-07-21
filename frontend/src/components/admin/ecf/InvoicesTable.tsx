import React from 'react';
import {
  Box,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { ElectronicInvoice, EcfTipo } from '../../../types';
import EcfStatusBadge from '../EcfStatusBadge';

type SortField = 'issuedAt' | 'totalFactura' | 'totalImpuestos' | 'tipo' | 'estadoECF';
type SortOrder = 'asc' | 'desc';

const TIPO_COLORS: Record<string, 'primary' | 'secondary' | 'default' | 'warning' | 'error' | 'info' | 'success'> = {
  E31: 'primary',
  E32: 'info',
  E33: 'warning',
  E34: 'error',
};

interface InvoicesTableProps {
  invoices: ElectronicInvoice[];
  total: number;
  page: number;
  rowsPerPage: number;
  sortField: SortField;
  sortOrder: SortOrder;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rows: number) => void;
  onSortChange: (field: SortField) => void;
  onRowClick: (invoice: ElectronicInvoice) => void;
  onRefreshSingle?: (invoice: ElectronicInvoice) => void;
  formatCurrency: (val?: number) => string;
}

const InvoicesTable: React.FC<InvoicesTableProps> = ({
  invoices,
  total,
  page,
  rowsPerPage,
  sortField,
  sortOrder,
  loading,
  onPageChange,
  onRowsPerPageChange,
  onSortChange,
  onRowClick,
  onRefreshSingle,
  formatCurrency,
}) => {
  const { t } = useTranslation();

  const handleSort = (field: SortField) => {
    onSortChange(field);
  };

  const SortCell: React.FC<{ field: SortField; label: string }> = ({ field, label }) => (
    <TableCell sortDirection={sortField === field ? sortOrder : false}>
      <TableSortLabel
        active={sortField === field}
        direction={sortField === field ? sortOrder : 'asc'}
        onClick={() => handleSort(field)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <Box>
      <TableContainer>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.ecfInvoices.table.eNCF')}</TableCell>
              <SortCell field="tipo" label={t('admin.ecfInvoices.table.tipo')} />
              <SortCell field="issuedAt" label={t('admin.ecfInvoices.table.issuedAt')} />
              <TableCell>{t('admin.ecfInvoices.table.buyer')}</TableCell>
              <SortCell field="totalFactura" label={t('admin.ecfInvoices.table.total')} />
              <SortCell field="totalImpuestos" label="ITBIS" />
              <SortCell field="estadoECF" label={t('admin.ecfInvoices.table.status')} />
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography variant="body2" color="text.secondary" py={3}>
                    {t('common.loading')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {!loading && invoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography variant="body2" color="text.secondary" py={3}>
                    {t('admin.ecfInvoices.table.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              invoices.map((inv) => (
                <TableRow
                  key={inv._id}
                  hover
                  onClick={() => onRowClick(inv)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem">
                      {inv.eNCF}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={inv.tipo}
                      color={TIPO_COLORS[inv.tipo as EcfTipo] ?? 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {dayjs(inv.issuedAt).format('DD/MM/YY HH:mm')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" noWrap maxWidth={160}>
                      {inv.buyerName || inv.buyerRnc || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={500}>
                      {formatCurrency(inv.totalFactura)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">{formatCurrency(inv.totalImpuestos)}</Typography>
                  </TableCell>
                  <TableCell>
                    <EcfStatusBadge status={inv.estadoECF} />
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Stack direction="row" spacing={0} justifyContent="flex-end">
                      {onRefreshSingle && (
                        <Tooltip title={t('admin.settings.ecfInvoices.actions.refreshStatus')}>
                          <IconButton size="small" onClick={() => onRefreshSingle(inv)}>
                            <RefreshIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title={t('admin.ecfInvoices.table.viewDetail')}>
                        <IconButton size="small" onClick={() => onRowClick(inv)}>
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[25, 50, 100]}
        onPageChange={(_, p) => onPageChange(p)}
        onRowsPerPageChange={(e) => onRowsPerPageChange(parseInt(e.target.value, 10))}
        labelRowsPerPage={t('common.rowsPerPage')}
      />
    </Box>
  );
};

export default InvoicesTable;
