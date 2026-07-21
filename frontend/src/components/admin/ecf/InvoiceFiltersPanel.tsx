import React from 'react';
import {
  Box,
  Button,
  Grid,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import FilterListOffIcon from '@mui/icons-material/FilterListOff';
import { useTranslation } from 'react-i18next';
import { EcfEstadoECF, EcfTipo } from '../../../types';

const ECF_TIPOS: EcfTipo[] = ['E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47'];
const ECF_ESTADOS: EcfEstadoECF[] = [
  'Aceptado',
  'Aceptado Condicional',
  'En Proceso',
  'Rechazado',
  'Error',
  'Emitido Contingencia',
];

export interface InvoiceFilters {
  dateFrom: string;
  dateTo: string;
  tipo: string;
  estadoECF: string;
  buyerSearch: string;
  encfSearch: string;
  amountMin: string;
  amountMax: string;
}

export const DEFAULT_FILTERS: InvoiceFilters = {
  dateFrom: '',
  dateTo: '',
  tipo: '',
  estadoECF: '',
  buyerSearch: '',
  encfSearch: '',
  amountMin: '',
  amountMax: '',
};

interface InvoiceFiltersPanelProps {
  filters: InvoiceFilters;
  onChange: (filters: InvoiceFilters) => void;
  onReset: () => void;
}

const InvoiceFiltersPanel: React.FC<InvoiceFiltersPanelProps> = ({
  filters,
  onChange,
  onReset,
}) => {
  const { t } = useTranslation();

  const set = (field: keyof InvoiceFilters) => (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...filters, [field]: e.target.value });
  };

  return (
    <Box component="form" noValidate onSubmit={(e) => e.preventDefault()}>
      <Grid container spacing={1.5} alignItems="flex-end">
        <Grid item xs={12} sm={6} md={2}>
          <TextField
            size="small"
            fullWidth
            label={t('admin.ecfInvoices.filters.dateFrom')}
            type="date"
            value={filters.dateFrom}
            onChange={set('dateFrom')}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <TextField
            size="small"
            fullWidth
            label={t('admin.ecfInvoices.filters.dateTo')}
            type="date"
            value={filters.dateTo}
            onChange={set('dateTo')}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={1.5}>
          <TextField
            size="small"
            fullWidth
            select
            label={t('admin.ecfInvoices.filters.tipo')}
            value={filters.tipo}
            onChange={set('tipo')}
          >
            <MenuItem value="">{t('common.all')}</MenuItem>
            {ECF_TIPOS.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <TextField
            size="small"
            fullWidth
            select
            label={t('admin.ecfInvoices.filters.status')}
            value={filters.estadoECF}
            onChange={set('estadoECF')}
          >
            <MenuItem value="">{t('common.all')}</MenuItem>
            {ECF_ESTADOS.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <TextField
            size="small"
            fullWidth
            label={t('admin.ecfInvoices.filters.buyerSearch')}
            value={filters.buyerSearch}
            onChange={set('buyerSearch')}
            placeholder="Nombre o RNC"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={1.5}>
          <TextField
            size="small"
            fullWidth
            label="e-NCF"
            value={filters.encfSearch}
            onChange={set('encfSearch')}
            placeholder="B**..."
            inputProps={{ style: { fontFamily: 'monospace' } }}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1.5}>
          <TextField
            size="small"
            fullWidth
            label={t('admin.ecfInvoices.filters.amountMin')}
            type="number"
            value={filters.amountMin}
            onChange={set('amountMin')}
            inputProps={{ min: 0 }}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1.5}>
          <TextField
            size="small"
            fullWidth
            label={t('admin.ecfInvoices.filters.amountMax')}
            type="number"
            value={filters.amountMax}
            onChange={set('amountMax')}
            inputProps={{ min: 0 }}
          />
        </Grid>
        <Grid item xs={12} sm="auto">
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<FilterListOffIcon />}
              onClick={onReset}
            >
              {t('common.reset')}
            </Button>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
};

export default InvoiceFiltersPanel;
