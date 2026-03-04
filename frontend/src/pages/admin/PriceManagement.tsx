import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Container, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControl, InputLabel, Select, MenuItem,
  Switch, FormControlLabel, Alert, Typography, Autocomplete
} from '@mui/material';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import NumberField from '../../components/common/NumberField';
import { pricingService, settingsService, companiesService } from '../../services/api';
import { Company } from '../../types';
import { useTranslation } from 'react-i18next';

interface PricingRule {
  _id?: string;
  service: 'daypass' | 'pasatarde' | 'hospedaje';
  category: 'standard' | 'special' | 'guest' | 'company';
  validity: 'everyday' | 'weekdays' | 'weekend' | 'custom';
  startDate?: string;
  endDate?: string;
  guestEmail?: string;
  companyId?: string;
  companyName?: string; // display only
  adultPrice: number;
  childrenPrice: number;
  roomPrice?: number;
  isActive: boolean;
  createdAt?: string;
}

const PriceManagement: React.FC = () => {
  const { t } = useTranslation();
  const tr = useCallback((key: string, fallback?: string) => {
    const val = t(key);
    if (val === key && fallback) return t(fallback);
    return val;
  }, [t]);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pricingModel, setPricingModel] = useState<'perGuest' | 'perRoom'>('perGuest');
  const [services, setServices] = useState({ daypass: true, accommodation: true, pasatarde: true });
  const [companyOptions, setCompanyOptions] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [form, setForm] = useState<PricingRule>({
    service: 'daypass',
    category: 'standard',
    validity: 'everyday',
    adultPrice: 0,
    childrenPrice: 0,
    isActive: true,
  });

  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await pricingService.getPricing();
      setRules(res.data.data || []);
    } catch (e: any) {
      setError(e.response?.data?.message || tr('admin.pricing.messages.loadFailed', 'pricing.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  useEffect(() => {
    settingsService.getSettings()
      .then(res => {
        setPricingModel(res.data.data?.accommodationPricingModel ?? 'perGuest');
        if (res.data.data?.services) setServices(s => ({ ...s, ...res.data.data!.services }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (companySearch.length >= 1) {
      companiesService.getCompanies({ search: companySearch, limit: 20 })
        .then(res => setCompanyOptions(res.data.data || []))
        .catch(() => {});
    }
  }, [companySearch]);

  const openNew = () => {
    const defaultService: PricingRule['service'] = services.daypass ? 'daypass' : services.pasatarde ? 'pasatarde' : 'hospedaje';
    setForm({ service: defaultService, category: 'standard', validity: 'everyday', adultPrice: 0, childrenPrice: 0, roomPrice: 0, isActive: true });
    setDialogOpen(true);
  };

  const toInputDate = (value?: string) => {
    if (!value) return '';
    const d = new Date(value);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayInput = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  const serviceLabels = useMemo(() => ({
    daypass: tr('admin.pricing.serviceLabels.daypass', 'pricing.serviceLabels.daypass'),
    pasatarde: tr('admin.pricing.serviceLabels.pasatarde', 'pricing.serviceLabels.pasatarde'),
    hospedaje: tr('admin.pricing.serviceLabels.hospedaje', 'pricing.serviceLabels.hospedaje'),
  }), [tr]);

  const categoryLabels: Record<string, string> = useMemo(() => ({
    standard: tr('admin.pricing.categoryLabels.standard', 'pricing.categoryLabels.standard'),
    special: tr('admin.pricing.categoryLabels.special', 'pricing.categoryLabels.special'),
    guest: tr('admin.pricing.categoryLabels.guest', 'Guest'),
    company: tr('admin.pricing.categoryLabels.company', 'Company'),
  }), [tr]);

  const validityLabels = useMemo(() => ({
    everyday: tr('admin.pricing.validityLabels.everyday', 'pricing.validityLabels.everyday'),
    weekdays: tr('admin.pricing.validityLabels.weekdays', 'pricing.validityLabels.weekdays'),
    weekend: tr('admin.pricing.validityLabels.weekend', 'pricing.validityLabels.weekend'),
    custom: tr('admin.pricing.validityLabels.custom', 'pricing.validityLabels.custom'),
  }), [tr]);

  const openEdit = (rule: PricingRule) => {
    setSelectedCompany(rule.companyId ? ({ _id: rule.companyId, name: rule.companyName || rule.companyId } as Company) : null);
    setForm({ ...rule, startDate: rule.startDate ? toInputDate(rule.startDate) : undefined, endDate: rule.endDate ? toInputDate(rule.endDate) : undefined });
    setDialogOpen(true);
  };

  const saveRule = async () => {
    try {
      if (form.category === 'special') {
        if (form.validity !== 'custom') {
          setError(tr('admin.pricing.errors.specialRequiresCustom', 'pricing.errors.specialRequiresCustom'));
          return;
        }
        if (!form.startDate || !form.endDate) {
          setError(tr('admin.pricing.errors.specialRequiresRange', 'pricing.errors.specialRequiresRange'));
          return;
        }
      }
      if (form.category === 'guest') {
        if (!form.guestEmail?.trim()) {
          setError(tr('admin.pricing.errors.guestRequiresEmail', 'Guest pricing requires a guest email.'));
          return;
        }
        if (!form.startDate || !form.endDate) {
          setError(tr('admin.pricing.errors.guestRequiresRange', 'Guest pricing requires a date range.'));
          return;
        }
      }
      if (form.category === 'company') {
        if (!form.companyId) {
          setError(tr('admin.pricing.errors.companyRequired', 'Company pricing requires a company.'));
          return;
        }
        if (!form.startDate || !form.endDate) {
          setError(tr('admin.pricing.errors.companyRequiresRange', 'Company pricing requires a date range.'));
          return;
        }
      }
      setError(null);
      // Prepare payload with mid-day timestamps to avoid timezone day-shift
      const payload: any = { ...form };
      if (form.startDate) payload.startDate = new Date(`${form.startDate}T12:00:00`).toISOString();
      if (form.endDate) payload.endDate = new Date(`${form.endDate}T12:00:00`).toISOString();
      if (form._id) {
        await pricingService.updatePricing(form._id, payload);
      } else {
        await pricingService.createPricing(payload);
      }
      setDialogOpen(false);
      await fetchRules();
    } catch (e: any) {
      setError(e.response?.data?.message || tr('admin.pricing.messages.saveFailed', 'pricing.messages.saveFailed'));
    }
  };

  const deleteRule = async (id: string) => {
    if (!window.confirm(tr('admin.pricing.dialog.deletePrompt', 'pricing.dialog.deletePrompt'))) return;
    await pricingService.deletePricing(id);
    await fetchRules();
  };

  const categoryChanged = (val: 'standard' | 'special' | 'guest' | 'company') => {
    if (val === 'special' || val === 'guest' || val === 'company') {
      setForm(prev => ({ ...prev, category: val, validity: 'custom' }));
    } else {
      setForm(prev => ({ ...prev, category: val }));
    }
    if (val !== 'company') setSelectedCompany(null);
  };

  return (
    <AdminLayout>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <SectionTitle
          title={tr('admin.pricing.title', 'pricing.title')}
          right={<Button variant="contained" onClick={openNew}>{tr('admin.pricing.actions.newRule', 'pricing.actions.newRule')}</Button>}
        />
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{tr('admin.pricing.table.service', 'pricing.table.service')}</TableCell>
                <TableCell>{tr('admin.pricing.table.category', 'pricing.table.category')}</TableCell>
                <TableCell>{tr('admin.pricing.table.validity', 'pricing.table.validity')}</TableCell>
                <TableCell>{tr('admin.pricing.table.dateRange', 'pricing.table.dateRange')}</TableCell>
                <TableCell>{tr('admin.pricing.table.adult', 'pricing.table.adult')}</TableCell>
                <TableCell>{tr('admin.pricing.table.children', 'pricing.table.children')}</TableCell>
                <TableCell>{tr('admin.pricing.table.active', 'pricing.table.active')}</TableCell>
                <TableCell>{tr('admin.pricing.table.actions', 'pricing.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.filter(rule =>
                (rule.service === 'daypass' && services.daypass) ||
                (rule.service === 'pasatarde' && services.pasatarde) ||
                (rule.service === 'hospedaje' && services.accommodation)
              ).map(rule => (
                <TableRow key={rule._id}>
                  <TableCell>{serviceLabels[rule.service] || rule.service}</TableCell>
                  <TableCell>
                    <Box>
                      <Box>{categoryLabels[rule.category] || rule.category}</Box>
                      {rule.category === 'guest' && rule.guestEmail && (
                        <Typography variant="caption" color="text.secondary">{rule.guestEmail}</Typography>
                      )}
                      {rule.category === 'company' && (rule as any).companyId && (
                        <Typography variant="caption" color="text.secondary">{(rule as any).companyName || (rule as any).companyId?.name || 'Company'}</Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>{validityLabels[rule.validity] || rule.validity}</TableCell>
                  <TableCell>{rule.startDate ? `${rule.startDate.substring(0,10)} - ${rule.endDate?.substring(0,10)}` : '—'}</TableCell>
                  <TableCell>{rule.service === 'hospedaje' && pricingModel === 'perRoom' ? `$${rule.roomPrice ?? 0} (${tr('admin.pricing.table.roomPrice', 'pricing.table.roomPrice')})` : `$${rule.adultPrice}`}</TableCell>
                  <TableCell>{rule.service === 'hospedaje' && pricingModel === 'perRoom' ? '—' : `$${rule.childrenPrice}`}</TableCell>
                  <TableCell>{rule.isActive ? t('common.yes') : t('common.no')}</TableCell>
                  <TableCell>
                    <Button size="small" onClick={() => openEdit(rule)}>{tr('admin.pricing.actions.edit', 'pricing.actions.edit')}</Button>
                    <Button size="small" color="error" onClick={() => deleteRule(rule._id!)}>{tr('admin.pricing.actions.delete', 'pricing.actions.delete')}</Button>
                  </TableCell>
                </TableRow>
              ))}
              {rules.length === 0 && !loading && (
                <TableRow><TableCell colSpan={8} align="center">{tr('admin.pricing.empty', 'pricing.empty')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{form._id ? tr('admin.pricing.dialog.editTitle', 'pricing.dialog.editTitle') : tr('admin.pricing.dialog.newTitle', 'pricing.dialog.newTitle')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              <FormControl fullWidth>
                <InputLabel>{tr('admin.pricing.form.service', 'pricing.form.service')}</InputLabel>
                <Select value={form.service} label={tr('admin.pricing.form.service', 'pricing.form.service')} onChange={(e) => setForm({ ...form, service: e.target.value as any })}>
                  {services.daypass && <MenuItem value="daypass">{serviceLabels.daypass}</MenuItem>}
                  {services.pasatarde && <MenuItem value="pasatarde">{serviceLabels.pasatarde}</MenuItem>}
                  {services.accommodation && <MenuItem value="hospedaje">{serviceLabels.hospedaje}</MenuItem>}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>{tr('admin.pricing.form.category', 'pricing.form.category')}</InputLabel>
                <Select value={form.category} label={tr('admin.pricing.form.category', 'pricing.form.category')} onChange={(e) => categoryChanged(e.target.value as any)}>
                  <MenuItem value="standard">{categoryLabels.standard}</MenuItem>
                  <MenuItem value="special">{categoryLabels.special}</MenuItem>
                  <MenuItem value="guest">{categoryLabels.guest}</MenuItem>
                  <MenuItem value="company">{categoryLabels.company}</MenuItem>
                </Select>
              </FormControl>
              {form.category === 'company' && (
                <Autocomplete
                  options={companyOptions}
                  getOptionLabel={(o) => o.name}
                  value={selectedCompany}
                  onChange={(_, newVal) => {
                    setSelectedCompany(newVal);
                    setForm(f => ({ ...f, companyId: newVal?._id || '' }));
                  }}
                  onInputChange={(_, v) => setCompanySearch(v)}
                  renderInput={(params) => (
                    <TextField {...params} label={tr('admin.pricing.form.company', 'Company')} required />
                  )}
                />
              )}
              {form.category === 'guest' && (
                <TextField
                  fullWidth
                  type="email"
                  label={tr('admin.pricing.form.guestEmail', 'Guest Email')}
                  value={form.guestEmail || ''}
                  onChange={(e) => setForm({ ...form, guestEmail: e.target.value })}
                  required
                />
              )}
              <FormControl fullWidth>
                <InputLabel>{tr('admin.pricing.form.validity', 'pricing.form.validity')}</InputLabel>
                <Select value={form.validity} label={tr('admin.pricing.form.validity', 'pricing.form.validity')} onChange={(e) => setForm({ ...form, validity: e.target.value as any })} disabled={form.category === 'special' || form.category === 'guest' || form.category === 'company'}>
                  <MenuItem value="everyday">{validityLabels.everyday}</MenuItem>
                  <MenuItem value="weekdays">{validityLabels.weekdays}</MenuItem>
                  <MenuItem value="weekend">{validityLabels.weekend}</MenuItem>
                  <MenuItem value="custom">{validityLabels.custom}</MenuItem>
                </Select>
              </FormControl>
              {(form.category === 'special' || form.category === 'guest' || form.category === 'company' || form.validity === 'custom') && (
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <TextField
                    type="date"
                    label={tr('admin.pricing.form.startDate', 'pricing.form.startDate')}
                    value={form.startDate || ''}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ min: todayInput }}
                  />
                  <TextField
                    type="date"
                    label={tr('admin.pricing.form.endDate', 'pricing.form.endDate')}
                    value={form.endDate || ''}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ min: todayInput }}
                  />
                </Box>
              )}
              {form.service === 'hospedaje' && pricingModel === 'perRoom' ? (
                <NumberField label={tr('admin.pricing.form.roomPrice', 'pricing.form.roomPrice')} value={form.roomPrice ?? 0} onChange={(val) => setForm({ ...form, roomPrice: val ?? 0, adultPrice: 0, childrenPrice: 0 })} min={0} />
              ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <NumberField label={tr('admin.pricing.form.adultPrice', 'pricing.form.adultPrice')} value={form.adultPrice} onChange={(val) => setForm({ ...form, adultPrice: val ?? 0 })} min={0} />
                  <NumberField label={tr('admin.pricing.form.childrenPrice', 'pricing.form.childrenPrice')} value={form.childrenPrice} onChange={(val) => setForm({ ...form, childrenPrice: val ?? 0 })} min={0} />
                </Box>
              )}
              <FormControlLabel control={<Switch checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />} label={tr('admin.pricing.form.active', 'pricing.form.active')} />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)}>{tr('admin.pricing.actions.cancel', 'pricing.actions.cancel')}</Button>
            <Button variant="contained" onClick={saveRule}>{tr('admin.pricing.actions.save', 'pricing.actions.save')}</Button>
          </DialogActions>
        </Dialog>
      </Container>
    </AdminLayout>
  );
};

export default PriceManagement;
