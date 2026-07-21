import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';
import { ecfService } from '../../../services/api';
import { ElectronicInvoice } from '../../../types';

// Invoice types available in this modal (the less-common ones; E31/E32 are generated from the folio)
const TIPOS = [
  { value: '41', labelKey: 'admin.ecf.otherInvoice.tipo41' },
  { value: '43', labelKey: 'admin.ecf.otherInvoice.tipo43' },
  { value: '44', labelKey: 'admin.ecf.otherInvoice.tipo44' },
  { value: '45', labelKey: 'admin.ecf.otherInvoice.tipo45' },
  { value: '46', labelKey: 'admin.ecf.otherInvoice.tipo46' },
  { value: '47', labelKey: 'admin.ecf.otherInvoice.tipo47' },
] as const;

type Tipo = '41' | '43' | '44' | '45' | '46' | '47';

// Types that require buyer RNC
const REQUIRES_RNC: Tipo[] = ['44', '45'];
// Types that require country (foreign buyer)
const REQUIRES_COUNTRY: Tipo[] = ['46', '47'];
// Types that require buyer info at all
const REQUIRES_BUYER: Tipo[] = ['41', '44', '45', '46', '47'];

interface InvoiceItem {
  description: string;
  amount: string;
  exempt: boolean;
}

const EMPTY_ITEM: InvoiceItem = { description: '', amount: '', exempt: false };

interface OtherInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (invoice: ElectronicInvoice) => void;
}

const OtherInvoiceModal: React.FC<OtherInvoiceModalProps> = ({ open, onClose, onSuccess }) => {
  const { t } = useTranslation();

  const [tipo, setTipo] = useState<Tipo>('41');
  const [items, setItems] = useState<InvoiceItem[]>([{ ...EMPTY_ITEM }]);
  const [tipoPago, setTipoPago] = useState<number>(1);
  const [refNumber, setRefNumber] = useState('');

  // Buyer fields
  const [buyerRnc, setBuyerRnc] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerRazonSocial, setBuyerRazonSocial] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerCountry, setBuyerCountry] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsBuyer = REQUIRES_BUYER.includes(tipo);
  const needsRnc = REQUIRES_RNC.includes(tipo);
  const needsCountry = REQUIRES_COUNTRY.includes(tipo);

  const resetForm = () => {
    setTipo('41');
    setItems([{ ...EMPTY_ITEM }]);
    setTipoPago(1);
    setRefNumber('');
    setBuyerRnc('');
    setBuyerName('');
    setBuyerRazonSocial('');
    setBuyerEmail('');
    setBuyerCountry('');
    setError(null);
  };

  const handleClose = () => {
    if (!submitting) {
      resetForm();
      onClose();
    }
  };

  const updateItem = (idx: number, field: keyof InvoiceItem, value: string | boolean) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };

  const addItem = () => setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const validate = (): string | null => {
    for (let i = 0; i < items.length; i++) {
      if (!items[i].description.trim()) return t('admin.ecf.otherInvoice.errorItemDesc', { n: i + 1 });
      const amt = parseFloat(items[i].amount);
      if (isNaN(amt) || amt <= 0) return t('admin.ecf.otherInvoice.errorItemAmount', { n: i + 1 });
    }
    if (needsRnc && !buyerRnc.trim()) return t('admin.ecf.otherInvoice.errorRncRequired');
    if (needsCountry && !buyerCountry.trim()) return t('admin.ecf.otherInvoice.errorCountryRequired');
    if (needsCountry && !buyerName.trim() && !buyerRazonSocial.trim()) {
      return t('admin.ecf.otherInvoice.errorNameRequired');
    }
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await ecfService.generateOtherInvoice({
        tipo,
        items: items.map((item) => ({
          description: item.description.trim(),
          amount: parseFloat(item.amount),
          exempt: item.exempt,
        })),
        buyer: needsBuyer
          ? {
              rnc: buyerRnc.trim() || undefined,
              razonSocial: buyerRazonSocial.trim() || undefined,
              name: buyerName.trim() || undefined,
              email: buyerEmail.trim() || undefined,
              country: buyerCountry.trim() || undefined,
            }
          : undefined,
        tipoPago,
        refNumber: refNumber.trim() || undefined,
      });

      resetForm();
      onClose();
      onSuccess?.(res.data.data!);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t('common.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  const totalAmount = items.reduce((s, item) => {
    const amt = parseFloat(item.amount);
    return s + (isNaN(amt) ? 0 : amt);
  }, 0);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('admin.ecf.otherInvoice.title')}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2}>
          {/* Invoice type selector */}
          <FormControl fullWidth size="small">
            <InputLabel>{t('admin.ecf.otherInvoice.tipoLabel')}</InputLabel>
            <Select
              value={tipo}
              label={t('admin.ecf.otherInvoice.tipoLabel')}
              onChange={(e) => { setTipo(e.target.value as Tipo); setError(null); }}
            >
              {TIPOS.map(({ value, labelKey }) => (
                <MenuItem key={value} value={value}>
                  {`E${value} — ${t(labelKey)}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Payment method */}
          <FormControl fullWidth size="small">
            <InputLabel>{t('admin.ecf.otherInvoice.tipoPagoLabel')}</InputLabel>
            <Select
              value={tipoPago}
              label={t('admin.ecf.otherInvoice.tipoPagoLabel')}
              onChange={(e) => setTipoPago(Number(e.target.value))}
            >
              <MenuItem value={1}>{t('admin.ecf.otherInvoice.tipoPago1')}</MenuItem>
              <MenuItem value={2}>{t('admin.ecf.otherInvoice.tipoPago2')}</MenuItem>
              <MenuItem value={3}>{t('admin.ecf.otherInvoice.tipoPago3')}</MenuItem>
              <MenuItem value={4}>{t('admin.ecf.otherInvoice.tipoPago4')}</MenuItem>
            </Select>
          </FormControl>

          {/* Internal reference */}
          <TextField
            label={t('admin.ecf.otherInvoice.refLabel')}
            size="small"
            fullWidth
            value={refNumber}
            onChange={(e) => setRefNumber(e.target.value)}
            helperText={t('admin.ecf.otherInvoice.refHelper')}
          />

          <Divider />

          {/* Buyer info (conditional) */}
          {needsBuyer && (
            <>
              <Typography variant="subtitle2">{t('admin.ecf.otherInvoice.buyerSection')}</Typography>
              {needsRnc && (
                <TextField
                  label={t('admin.ecf.otherInvoice.buyerRnc')}
                  size="small"
                  fullWidth
                  required
                  value={buyerRnc}
                  onChange={(e) => setBuyerRnc(e.target.value)}
                  placeholder="000-000000-0"
                />
              )}
              {!needsRnc && !needsCountry && (
                <TextField
                  label={t('admin.ecf.otherInvoice.buyerRnc')}
                  size="small"
                  fullWidth
                  value={buyerRnc}
                  onChange={(e) => setBuyerRnc(e.target.value)}
                  placeholder="000-000000-0"
                  helperText={t('admin.ecf.otherInvoice.buyerRncOptional')}
                />
              )}
              {needsCountry ? (
                <>
                  <TextField
                    label={t('admin.ecf.otherInvoice.buyerRazonSocial')}
                    size="small"
                    fullWidth
                    value={buyerRazonSocial}
                    onChange={(e) => setBuyerRazonSocial(e.target.value)}
                  />
                  <TextField
                    label={t('admin.ecf.otherInvoice.buyerCountry')}
                    size="small"
                    fullWidth
                    required
                    value={buyerCountry}
                    onChange={(e) => setBuyerCountry(e.target.value)}
                    placeholder="US"
                    helperText={t('admin.ecf.otherInvoice.buyerCountryHelper')}
                  />
                </>
              ) : (
                <>
                  <TextField
                    label={t('admin.ecf.otherInvoice.buyerRazonSocial')}
                    size="small"
                    fullWidth
                    value={buyerRazonSocial}
                    onChange={(e) => setBuyerRazonSocial(e.target.value)}
                  />
                  <TextField
                    label={t('admin.ecf.otherInvoice.buyerName')}
                    size="small"
                    fullWidth
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                  />
                  <TextField
                    label={t('admin.ecf.otherInvoice.buyerEmail')}
                    size="small"
                    fullWidth
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                  />
                </>
              )}
              <Divider />
            </>
          )}

          {/* Items */}
          <Typography variant="subtitle2">{t('admin.ecf.otherInvoice.itemsSection')}</Typography>
          {items.map((item, idx) => (
            <Stack key={idx} direction="row" spacing={1} alignItems="flex-start">
              <TextField
                label={t('admin.ecf.otherInvoice.itemDesc')}
                size="small"
                value={item.description}
                onChange={(e) => updateItem(idx, 'description', e.target.value)}
                sx={{ flex: 2 }}
              />
              <TextField
                label={t('admin.ecf.otherInvoice.itemAmount')}
                size="small"
                type="number"
                value={item.amount}
                onChange={(e) => updateItem(idx, 'amount', e.target.value)}
                inputProps={{ min: 0.01, step: 0.01 }}
                sx={{ flex: 1 }}
              />
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.5 }}>
                <FormControl>
                  <FormHelperText sx={{ mx: 0 }}>{t('admin.ecf.otherInvoice.itemExempt')}</FormHelperText>
                  <Select
                    size="small"
                    value={item.exempt ? '1' : '0'}
                    onChange={(e) => updateItem(idx, 'exempt', e.target.value === '1')}
                    sx={{ minWidth: 80 }}
                  >
                    <MenuItem value="0">{t('common.no')}</MenuItem>
                    <MenuItem value="1">{t('common.yes')}</MenuItem>
                  </Select>
                </FormControl>
              </Box>
              <Tooltip title={t('common.remove')}>
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                    sx={{ mt: 0.5 }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          ))}

          <Button startIcon={<AddIcon />} onClick={addItem} variant="outlined" size="small" sx={{ alignSelf: 'flex-start' }}>
            {t('admin.ecf.otherInvoice.addItem')}
          </Button>

          {totalAmount > 0 && (
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="body2" color="text.secondary">
                {t('admin.ecf.otherInvoice.total')}
              </Typography>
              <Typography variant="h6">
                {new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(totalAmount)}
              </Typography>
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={submitting}
          startIcon={submitting ? <CircularProgress size={16} /> : undefined}
        >
          {t('admin.ecf.otherInvoice.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default OtherInvoiceModal;
