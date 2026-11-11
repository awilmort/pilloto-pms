import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel,
  MenuItem, Paper, Select, Skeleton, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { AddOutlined, ArrowBack, DeleteOutline, InfoOutlined, LinkOff, PersonAddAlt1, SendOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import i18n from '../../../i18n';
import { accountingCustomersService, invoicesService, productsService, InvoiceLineItemInput } from '../../../services/api';
import type { Customer, Invoice, InvoiceFormMeta, Product } from '../../../types';
import { usePermission } from '../../../lib/permissions';
import { formatAccountingMoneyExact as formatMoney } from '../../../utils/currency';
import InvoiceLetterhead from './InvoiceLetterhead';
import QuickCustomerDialog from './QuickCustomerDialog';
import {
  DEFAULT_TERMS, DraftLine, PaymentTerms, TAX_RATES, TERMS_OPTIONS, addDaysIso, documentTotals, ecfKindFor, isBlankLine, lineAmounts, newDraftLine,
  termsDays, termsFromDates, toIsoDate, todayIso, validateInvoice,
} from './invoiceMath';
import { customerOf } from './invoiceUi';

interface Props {
  /** `create` starts empty (or prefilled from `source` when duplicating); `edit` loads a draft. */
  mode: 'create' | 'edit';
  invoiceId?: string;
  /** Invoice to copy customer, lines, notes and reference from (create mode). */
  duplicateOf?: string;
}

interface FormState {
  isIndividual: boolean;
  customer: Customer | null;
  individualName: string;
  individualEmail: string;
  individualPhone: string;
  terms: PaymentTerms;
  customDue: string;
  reference: string;
  notes: string;
  lines: DraftLine[];
}

const NEW_CUSTOMER = { __new: true } as const;
type CustomerOption = Customer | typeof NEW_CUSTOMER;

const COLS = 'minmax(220px, 1fr) 76px 110px 72px 104px 118px 40px';

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(i18n.language);
};

/**
 * The invoice editor: a page that looks like the invoice it produces. Letterhead from the company
 * profile, customer and payment terms at the top, a line table with live amounts, ITBIS grouped by
 * rate, and the e-CF type the document will be issued as, derived from the customer. Used for new
 * invoices, for copies of an existing invoice, and for editing a draft.
 */
const InvoiceEditor: React.FC<Props> = ({ mode, invoiceId, duplicateOf }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canCreateCustomers = usePermission('accounting.customers.manage');
  const isXs = useMediaQuery(useTheme().breakpoints.down('sm'));

  const [meta, setMeta] = useState<InvoiceFormMeta | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Invoice | null>(null);

  const [form, setForm] = useState<FormState>(() => ({
    isIndividual: false, customer: null, individualName: '', individualEmail: '', individualPhone: '',
    terms: DEFAULT_TERMS, customDue: '', reference: '', notes: '', lines: [newDraftLine()],
  }));
  const [issueIso, setIssueIso] = useState(todayIso());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<null | 'draft' | 'issue'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const customerQueryRef = useRef('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const update = useCallback((patch: Partial<FormState>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); }, []);
  const updateLine = (key: string, patch: Partial<DraftLine>) => update({ lines: form.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  // ── Load reference data, and the invoice being edited / copied ────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sourceId = mode === 'edit' ? invoiceId : duplicateOf;
        const [metaRes, prodRes, custRes, srcRes] = await Promise.all([
          invoicesService.getFormMeta(),
          productsService.getProducts({ active: true, sellable: true }).catch(() => null),
          accountingCustomersService.getCustomers({ active: true, limit: 25 }).catch(() => null),
          sourceId ? invoicesService.getInvoice(sourceId) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const m = metaRes.data.data!;
        setMeta(m);
        setProducts(prodRes && Array.isArray(prodRes.data.data) ? prodRes.data.data : []);
        setCustomerOptions(custRes && Array.isArray(custRes.data.data) ? custRes.data.data : []);

        const src = srcRes?.data.data as Invoice | undefined;
        if (src) {
          if (mode === 'edit') {
            setLoaded(src);
            setIssueIso(toIsoDate(new Date(src.issueDate)));
          }
          const issue = mode === 'edit' ? toIsoDate(new Date(src.issueDate)) : todayIso();
          const dueIso = src.dueDate ? toIsoDate(new Date(src.dueDate)) : undefined;
          const terms = mode === 'edit' ? termsFromDates(issue, dueIso) : DEFAULT_TERMS;
          setForm({
            isIndividual: src.isIndividual,
            customer: customerOf(src),
            individualName: src.individualCustomer?.name || '',
            individualEmail: src.individualCustomer?.email || '',
            individualPhone: src.individualCustomer?.phone || '',
            terms,
            customDue: terms === 'custom' && dueIso ? dueIso : '',
            reference: src.reference || '',
            notes: src.notes || '',
            lines: src.lineItems.map((l) => newDraftLine({
              description: l.description,
              productId: l.product ? (typeof l.product === 'object' ? l.product._id : l.product) : '',
              quantity: String(l.quantity),
              unitPrice: String(l.unitPrice),
              discountPercent: String(l.discountPercent || 0),
              taxRate: String(l.taxRate),
            })),
          });
        } else {
          setForm((f) => ({ ...f, lines: [newDraftLine({}, m.defaultItbisRate)] }));
        }
      } catch (e: any) {
        if (!cancelled) setLoadError(e.response?.data?.message || t('accounting.invoices.messages.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, invoiceId, duplicateOf, t]);

  // Warn before the tab is closed with unsaved work
  useEffect(() => {
    if (!dirty || saving) return undefined;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, saving]);

  // Move focus to the description of a row that was just added
  useEffect(() => {
    if (!focusKey) return;
    document.getElementById(`desc-${focusKey}`)?.focus();
    setFocusKey(null);
  }, [focusKey, form.lines.length]);

  // ── Customer search (server side, debounced) ──────────────────────────────
  const searchCustomers = (query: string) => {
    customerQueryRef.current = query;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await accountingCustomersService.getCustomers({ active: true, search: query || undefined, limit: 25 });
        if (customerQueryRef.current === query) setCustomerOptions(Array.isArray(res.data.data) ? res.data.data : []);
      } catch { /* keep the previous options */ }
    }, 250);
  };
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const totals = useMemo(() => documentTotals(form.lines), [form.lines]);
  const ecfKind = ecfKindFor(form.customer, form.isIndividual);
  const dueIso = form.terms === 'custom' ? form.customDue : addDaysIso(issueIso, termsDays(form.terms) ?? 0);
  const productById = useMemo(() => new Map(products.map((p) => [p._id, p])), [products]);
  const hasRealLine = form.lines.some((l) => !isBlankLine(l));

  const taxOptionsFor = (line: DraftLine): number[] => {
    const rate = Number(line.taxRate);
    return (TAX_RATES as readonly number[]).includes(rate) ? [...TAX_RATES] : [...TAX_RATES, rate];
  };

  // ── Lines ───────────────────────────────────────────────────────────────────
  const addLine = () => {
    const line = newDraftLine({}, meta?.defaultItbisRate ?? 18);
    update({ lines: [...form.lines, line] });
    setFocusKey(line.key);
  };
  const removeLine = (key: string) => update({ lines: form.lines.length > 1 ? form.lines.filter((l) => l.key !== key) : [newDraftLine({}, meta?.defaultItbisRate ?? 18)] });

  const pickProduct = (line: DraftLine, product: Product) =>
    updateLine(line.key, { productId: product._id, description: product.name, unitPrice: String(product.defaultUnitPrice) });

  // ── Saving ──────────────────────────────────────────────────────────────────
  const buildPayload = () => {
    const lines = form.lines.filter((l) => !isBlankLine(l));
    const lineItems: InvoiceLineItemInput[] = lines.map((l) => ({
      description: l.description.trim(),
      product: l.productId || undefined,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountPercent: Number(l.discountPercent) || 0,
      taxRate: Number(l.taxRate) || 0,
    }));
    return {
      customer: form.isIndividual ? undefined : form.customer?._id,
      isIndividual: form.isIndividual,
      individualCustomer: form.isIndividual
        ? { name: form.individualName.trim(), email: form.individualEmail.trim() || undefined, phone: form.individualPhone.trim() || undefined }
        : undefined,
      dueDate: dueIso || undefined,
      notes: form.notes.trim(),
      reference: form.reference.trim(),
      lineItems,
    };
  };

  const validate = (): string | null => {
    const problem = validateInvoice({
      isIndividual: form.isIndividual, customerId: form.customer?._id || '', individualName: form.individualName,
      lines: form.lines.filter((l) => !isBlankLine(l)), issueIso, dueIso: form.customDue, terms: form.terms,
    });
    if (problem) return t(`accounting.invoices.form.${problem}`, t(`accounting.invoices.page.errors.${problem}`));
    if (!hasRealLine) return t('accounting.invoices.page.errors.noLines');
    return null;
  };

  const save = async (andIssue: boolean) => {
    setConfirmIssue(false);
    const problem = validate();
    if (problem) { setError(problem); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setError(null);
    setSaving(andIssue ? 'issue' : 'draft');
    let saved: Invoice;
    try {
      const payload = buildPayload();
      const res = mode === 'edit' ? await invoicesService.updateInvoice(invoiceId!, payload) : await invoicesService.createInvoice(payload);
      saved = res.data.data as Invoice;
    } catch (e: any) {
      setError(e.response?.data?.message || t('accounting.invoices.messages.saveFailed'));
      setSaving(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setDirty(false);
    if (!andIssue) {
      toast.success(t('accounting.invoices.page.savedDraft', { number: saved.invoiceNumber }));
      navigate(`/accounting/invoices/${saved._id}`, { replace: true });
      return;
    }
    try {
      await invoicesService.sendInvoice(saved._id);
      toast.success(t('accounting.invoices.page.issued', { number: saved.invoiceNumber }));
      navigate(`/accounting/invoices/${saved._id}`, { replace: true });
    } catch (e: any) {
      // The draft is saved; the details page shows what stopped the issue so it can be fixed and retried.
      navigate(`/accounting/invoices/${saved._id}`, { replace: true, state: { sendError: e.response?.data?.message || t('accounting.invoices.messages.sendFailed') } });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return <Box sx={{ maxWidth: 1000, mx: 'auto' }}><Skeleton variant="rounded" height={64} sx={{ mb: 2 }} /><Skeleton variant="rounded" height={640} /></Box>;
  }
  if (loadError) {
    return <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => navigate('/accounting/invoices')}>{t('accounting.invoices.page.back')}</Button>}>{loadError}</Alert>;
  }
  if (mode === 'edit' && loaded && loaded.status !== 'draft') {
    return (
      <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => navigate(`/accounting/invoices/${loaded._id}`)}>{t('accounting.invoices.page.viewInvoice')}</Button>}>
        {t('accounting.invoices.page.draftLocked')}
      </Alert>
    );
  }

  const title = mode === 'edit' && loaded ? t('accounting.invoices.page.editTitle', { number: loaded.invoiceNumber }) : t('accounting.invoices.page.newTitle');
  const busy = saving !== null;
  // Why this company cannot issue right now (not set up, being certified, suspended), so the page says it.
  const issueDisabledReason = meta?.ecfActive ? '' : t(`fiscal.cannotIssue.${meta?.fiscalState ?? 'inactive'}`, t('accounting.invoices.page.ecfInactive'));
  const fieldSx = { '& .MuiInputBase-input': { fontSize: '0.9rem' } };

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto', pb: 6 }}>
      {/* Action bar — outside the paper, so it is never part of the document */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 2, py: 1, position: { xs: 'static', md: 'sticky' }, top: 68, zIndex: 5, bgcolor: 'background.default' }}>
        <Button startIcon={<ArrowBack />} onClick={() => navigate(mode === 'edit' && loaded ? `/accounting/invoices/${loaded._id}` : '/accounting/invoices')} disabled={busy}>
          {t('accounting.invoices.page.back')}
        </Button>
        <Typography variant="h6" fontWeight={700} noWrap sx={{ flexGrow: 1, minWidth: 0 }}>{title}</Typography>
        <Box sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 'auto' } }}>
        <Button variant="outlined" onClick={() => save(false)} disabled={busy} sx={{ flex: { xs: 1, sm: 'none' } }}>
          {saving === 'draft' ? <CircularProgress size={18} /> : t('accounting.invoices.page.saveDraft')}
        </Button>
        <Tooltip title={issueDisabledReason} disableHoverListener={!issueDisabledReason}>
          <span style={{ flex: isXs ? 1 : undefined, display: 'flex' }}>
            <Button variant="contained" fullWidth startIcon={<SendOutlined />} onClick={() => { const p = validate(); if (p) { setError(p); window.scrollTo({ top: 0, behavior: 'smooth' }); } else { setError(null); setConfirmIssue(true); } }}
              disabled={busy || !meta?.ecfActive}>
              {saving === 'issue' ? <CircularProgress size={18} color="inherit" /> : t('accounting.invoices.page.saveAndIssue')}
            </Button>
          </span>
        </Tooltip>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {mode === 'create' && duplicateOf && <Alert severity="info" sx={{ mb: 2 }}>{t('accounting.invoices.page.duplicateHint')}</Alert>}
      {meta && !meta.ecfActive && (
        <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => navigate('/accounting/settings?tab=fiscal')}>{t('fiscal.center.seeSetup', 'See setup')}</Button>}>
          {issueDisabledReason}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 5 }, borderTop: 4, borderTopColor: 'primary.main', boxShadow: '0 4px 24px rgba(18,26,51,0.06)' }}>
        <InvoiceLetterhead issuer={meta?.issuer ?? null}>
          <Typography variant="h4" fontWeight={800} color="primary.main" sx={{ letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {t('accounting.invoices.page.documentTitle')}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            <strong>No.</strong> {mode === 'edit' && loaded ? loaded.invoiceNumber : <Box component="span" sx={{ color: 'text.secondary' }}>{t('accounting.invoices.page.numberPending')}</Box>}
          </Typography>
          <Typography variant="body2" color="text.secondary">e-NCF: {t('accounting.invoices.page.ecfNumberPending')}</Typography>
          <Tooltip title={t(`accounting.invoices.page.ecfTypeHelp.${ecfKind}`)} arrow placement="bottom-end">
            <Chip size="small" color={ecfKind === 'E31' ? 'primary' : 'default'} variant={ecfKind === 'E31' ? 'filled' : 'outlined'} icon={<InfoOutlined />}
              label={t(`accounting.invoices.page.ecfType.${ecfKind}`)} sx={{ mt: 1, fontWeight: 600 }} />
          </Tooltip>
        </InvoiceLetterhead>

        {/* Bill-to and terms */}
        <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { xs: '1fr', md: '1.15fr 1fr' }, mt: 4 }}>
          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap gap={1} sx={{ mb: 1 }}>
              <Typography variant="overline" color="text.secondary" fontWeight={700} noWrap>{t('accounting.invoices.page.billTo')}</Typography>
              <ToggleButtonGroup size="small" exclusive value={form.isIndividual ? 'consumer' : 'registered'}
                onChange={(_e, v) => { if (v) update({ isIndividual: v === 'consumer' }); }}>
                <ToggleButton value="registered" sx={{ textTransform: 'none', px: 1.5, py: 0.25 }}>{t('accounting.invoices.page.customerModeRegistered')}</ToggleButton>
                <ToggleButton value="consumer" sx={{ textTransform: 'none', px: 1.5, py: 0.25 }}>{t('accounting.invoices.page.customerModeConsumer')}</ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            {!form.isIndividual ? (
              <>
                <Autocomplete<CustomerOption, false, false, false>
                  value={form.customer}
                  options={[...customerOptions, ...(canCreateCustomers ? [NEW_CUSTOMER] : [])]}
                  filterOptions={(opts) => opts}
                  getOptionLabel={(o) => ('__new' in o ? '' : o.razonSocial || o.name)}
                  isOptionEqualToValue={(o, v) => !('__new' in o) && !('__new' in v) && o._id === v._id}
                  onInputChange={(_e, v, reason) => { if (reason === 'input') searchCustomers(v); }}
                  onOpen={() => searchCustomers('')}
                  onChange={(_e, v) => {
                    if (v && '__new' in v) { setNewCustomerName(customerQueryRef.current); return; }
                    update({ customer: v });
                  }}
                  noOptionsText={t('accounting.invoices.page.noCustomers')}
                  renderOption={(props, o) => (
                    <li {...props} key={'__new' in o ? 'new' : o._id}>
                      {'__new' in o ? (
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'primary.main', fontWeight: 600 }}><PersonAddAlt1 fontSize="small" /><span>{t('accounting.invoices.page.newCustomer')}</span></Stack>
                      ) : (
                        <Box>
                          <Typography variant="body2" fontWeight={600}>{o.razonSocial || o.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{o.rnc ? `RNC ${o.rnc}` : t('accounting.invoices.page.customerNoRnc')}{o.email ? ` · ${o.email}` : ''}</Typography>
                        </Box>
                      )}
                    </li>
                  )}
                  renderInput={(params) => <TextField {...params} size="small" label={t('accounting.invoices.page.customerSearch')} required />}
                />
                {form.customer && (
                  <Box sx={{ mt: 1.25, color: 'text.secondary' }}>
                    <Typography variant="body2" fontWeight={600} color="text.primary">{form.customer.razonSocial || form.customer.name}</Typography>
                    <Typography variant="body2">{form.customer.rnc ? `RNC / Cédula: ${form.customer.rnc}` : t('accounting.invoices.page.customerNoRnc')}</Typography>
                    {form.customer.address && <Typography variant="body2">{form.customer.address}</Typography>}
                    {(form.customer.email || form.customer.phone) && <Typography variant="body2">{[form.customer.email, form.customer.phone].filter(Boolean).join('  ·  ')}</Typography>}
                  </Box>
                )}
              </>
            ) : (
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { sm: '1fr 1fr' } }}>
                <TextField size="small" label={t('accounting.invoices.page.consumerName')} value={form.individualName} onChange={(e) => update({ individualName: e.target.value })} required sx={{ gridColumn: { sm: '1 / -1' } }} />
                <TextField size="small" label={t('common.email', 'Email')} value={form.individualEmail} onChange={(e) => update({ individualEmail: e.target.value })} />
                <TextField size="small" label={t('common.phone', 'Phone')} value={form.individualPhone} onChange={(e) => update({ individualPhone: e.target.value })} />
              </Box>
            )}
          </Box>

          <Box sx={{ display: 'grid', gap: 1.75, alignContent: 'start' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline">
              <Typography variant="body2" color="text.secondary">
                {t('accounting.invoices.page.issueDate')}
                <Tooltip title={t('accounting.invoices.page.issueDateHelp')} arrow><InfoOutlined sx={{ fontSize: 15, ml: 0.5, verticalAlign: 'text-bottom', cursor: 'help' }} /></Tooltip>
              </Typography>
              <Typography variant="body2" fontWeight={600}>{fmtDate(issueIso)}</Typography>
            </Stack>
            <FormControl size="small" fullWidth sx={fieldSx}>
              <InputLabel>{t('accounting.invoices.page.terms')}</InputLabel>
              <Select value={form.terms} label={t('accounting.invoices.page.terms')} onChange={(e) => update({ terms: e.target.value as PaymentTerms })}>
                {TERMS_OPTIONS.map((o) => <MenuItem key={o} value={o}>{t(`accounting.invoices.page.termsOption.${o}`)}</MenuItem>)}
              </Select>
            </FormControl>
            {form.terms === 'custom' ? (
              <TextField size="small" type="date" label={t('accounting.invoices.page.dueDate')} InputLabelProps={{ shrink: true }} value={form.customDue}
                inputProps={{ min: issueIso }} onChange={(e) => update({ customDue: e.target.value })} required />
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: -0.75 }}>{t('accounting.invoices.page.dueOn', { date: fmtDate(dueIso) })}</Typography>
            )}
            <TextField size="small" label={t('accounting.invoices.page.reference')} value={form.reference} onChange={(e) => update({ reference: e.target.value })}
              helperText={t('accounting.invoices.page.referenceHelp')} inputProps={{ maxLength: 100 }} />
          </Box>
        </Box>

        {/* Lines */}
        <Box sx={{ mt: 5, overflowX: { md: 'auto' } }}>
          <Box sx={{ minWidth: { md: 760 } }}>
            <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: COLS, gap: 1, px: 1, py: 1, bgcolor: 'action.hover', borderRadius: 1, alignItems: 'center' }}>
              {['item', 'qty', 'price', 'discount', 'tax', 'amount'].map((k, i) => (
                <Typography key={k} variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: i === 0 ? 'left' : 'right' }}>
                  {t(`accounting.invoices.page.cols.${k}`)}
                </Typography>
              ))}
              <span />
            </Box>

            {form.lines.map((line) => {
              const a = lineAmounts(line);
              const product = line.productId ? productById.get(line.productId) : undefined;
              const short = product && Number(line.quantity) > product.onHandQty;
              return (
                <Box key={line.key} sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(6, minmax(0, 1fr))', md: COLS }, gap: 1, px: { md: 1 }, py: 1.5, alignItems: 'start', borderBottom: 1, borderColor: 'divider' }}>
                  <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}>
                    <Autocomplete<Product, false, false, true>
                      freeSolo
                      options={products}
                      filterOptions={(opts, state) => {
                        const q = state.inputValue.trim().toLowerCase();
                        return q ? opts.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(q)).slice(0, 30) : opts.slice(0, 30);
                      }}
                      inputValue={line.description}
                      onInputChange={(_e, v, reason) => { if (reason === 'input') updateLine(line.key, { description: v }); if (reason === 'clear') updateLine(line.key, { description: '', productId: '' }); }}
                      onChange={(_e, v) => { if (v && typeof v === 'object') pickProduct(line, v); }}
                      getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
                      renderOption={(props, p) => (
                        <li {...props} key={p._id}>
                          <Box sx={{ width: '100%' }}>
                            <Stack direction="row" justifyContent="space-between" spacing={2}>
                              <Typography variant="body2" fontWeight={600}>{p.name}</Typography>
                              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.defaultUnitPrice)}</Typography>
                            </Stack>
                            <Typography variant="caption" color="text.secondary">{p.sku} · {t('accounting.invoices.page.stockAvailable', { qty: p.onHandQty, unit: p.unitOfMeasure })}</Typography>
                          </Box>
                        </li>
                      )}
                      renderInput={(params) => (
                        <TextField {...params} size="small" multiline placeholder={t('accounting.invoices.page.itemPlaceholder')} inputProps={{ ...params.inputProps, id: `desc-${line.key}`, 'aria-label': t('accounting.invoices.page.cols.item') }} sx={fieldSx} />
                      )}
                    />
                    {product && (
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color={short ? 'warning.dark' : 'text.secondary'} fontWeight={short ? 600 : 400}>
                          {product.sku} · {short ? t('accounting.invoices.page.stockShort', { qty: product.onHandQty }) : t('accounting.invoices.page.stockAvailable', { qty: product.onHandQty, unit: product.unitOfMeasure })}
                        </Typography>
                        <Tooltip title={t('accounting.invoices.page.unlinkProduct')}>
                          <IconButton size="small" onClick={() => updateLine(line.key, { productId: '' })} aria-label={t('accounting.invoices.page.unlinkProduct')} sx={{ p: 0.25 }}><LinkOff sx={{ fontSize: 14 }} /></IconButton>
                        </Tooltip>
                      </Stack>
                    )}
                  </Box>
                  <Box sx={{ gridColumn: { xs: 'span 2', md: 'auto' } }}><FieldLabel>{t('accounting.invoices.page.cols.qty')}</FieldLabel>
                  <TextField size="small" type="number" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} inputProps={{ min: 0, step: 'any', style: { textAlign: 'right' }, 'aria-label': t('accounting.invoices.page.cols.qty') }} sx={fieldSx} fullWidth /></Box>
                  <Box sx={{ gridColumn: { xs: 'span 2', md: 'auto' } }}><FieldLabel>{t('accounting.invoices.page.cols.price')}</FieldLabel>
                  <TextField size="small" type="number" value={line.unitPrice} onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })} placeholder="0.00"
                    onKeyDown={(e) => { if (e.key === 'Enter' && line.key === form.lines[form.lines.length - 1].key && !isBlankLine(line)) { e.preventDefault(); addLine(); } }}
                    inputProps={{ min: 0, step: 'any', style: { textAlign: 'right' }, 'aria-label': t('accounting.invoices.page.cols.price') }} sx={fieldSx} fullWidth /></Box>
                  <Box sx={{ gridColumn: { xs: 'span 2', md: 'auto' } }}><FieldLabel>{t('accounting.invoices.page.cols.discount')}</FieldLabel>
                  <TextField size="small" type="number" value={line.discountPercent} onChange={(e) => updateLine(line.key, { discountPercent: e.target.value })} inputProps={{ min: 0, max: 100, step: 'any', style: { textAlign: 'right' }, 'aria-label': t('accounting.invoices.page.cols.discount') }} sx={fieldSx} fullWidth /></Box>
                  <Box sx={{ gridColumn: { xs: 'span 3', md: 'auto' } }}><FieldLabel>{t('accounting.invoices.page.cols.tax')}</FieldLabel>
                  <Select size="small" fullWidth value={line.taxRate} onChange={(e) => updateLine(line.key, { taxRate: String(e.target.value) })} inputProps={{ 'aria-label': t('accounting.invoices.page.cols.tax') }} sx={fieldSx}>
                    {taxOptionsFor(line).map((r) => <MenuItem key={r} value={String(r)}>{r > 0 ? `${r}%` : t('accounting.invoices.page.exempt')}</MenuItem>)}
                  </Select></Box>
                  <Box sx={{ gridColumn: { xs: 'span 2', md: 'auto' } }}><FieldLabel>{t('accounting.invoices.page.cols.amount')}</FieldLabel>
                  <Typography variant="body2" fontWeight={600} sx={{ textAlign: 'right', pt: { md: 1 }, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(a.lineTotal)}</Typography></Box>
                  <Box sx={{ gridColumn: { xs: 'span 1', md: 'auto' }, display: 'flex', justifyContent: 'flex-end', alignSelf: { xs: 'end', md: 'start' } }}>
                    <Tooltip title={t('accounting.invoices.page.removeLine')}>
                      <IconButton size="small" onClick={() => removeLine(line.key)} aria-label={t('accounting.invoices.page.removeLine')} sx={{ mt: { md: 0.25 } }}><DeleteOutline fontSize="small" /></IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              );
            })}
          </Box>
          <Button startIcon={<AddOutlined />} onClick={addLine} sx={{ mt: 1.5 }}>{t('accounting.invoices.page.addLine')}</Button>
        </Box>

        {/* Notes and totals */}
        <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { xs: '1fr', md: '1fr 320px' }, mt: 4, alignItems: 'start' }}>
          <TextField label={t('accounting.invoices.page.notes')} helperText={t('accounting.invoices.page.notesHelp')} value={form.notes} onChange={(e) => update({ notes: e.target.value })}
            multiline minRows={3} inputProps={{ maxLength: 1000 }} />
          <Box>
            <TotalRow label={t('accounting.invoices.page.totals.gross')} value={formatMoney(totals.gross)} />
            {totals.discount > 0 && <TotalRow label={t('accounting.invoices.page.totals.discount')} value={`- ${formatMoney(totals.discount)}`} />}
            {totals.byRate.length === 0
              ? <TotalRow label="ITBIS" value={formatMoney(0)} />
              : totals.byRate.map((r) => <TotalRow key={r.rate} label={t('accounting.invoices.page.totals.itbis', { rate: r.rate })} value={formatMoney(r.tax)} />)}
            <Box sx={{ mt: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Typography fontWeight={800} color="primary.main">{t('accounting.invoices.page.totals.total')}</Typography>
              <Typography variant="h6" fontWeight={800} color="primary.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(totals.total)}</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, textAlign: 'right' }}>{t('accounting.invoices.page.currencyNote')}</Typography>
          </Box>
        </Box>
      </Paper>

      <QuickCustomerDialog
        open={newCustomerName !== null}
        initialName={newCustomerName ?? ''}
        onClose={() => setNewCustomerName(null)}
        onCreated={(c) => { setNewCustomerName(null); setCustomerOptions((o) => [c, ...o]); update({ customer: c, isIndividual: false }); }}
      />

      <Dialog open={confirmIssue} onClose={() => setConfirmIssue(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('accounting.invoices.page.confirmIssue.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {t('accounting.invoices.page.confirmIssue.body', { type: t(`accounting.invoices.page.ecfType.${ecfKind}`), total: formatMoney(totals.total) })}
          </Typography>
          <Typography variant="body2" color="text.secondary">{t('accounting.invoices.dialog.sendConsequences')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmIssue(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" startIcon={<SendOutlined />} onClick={() => save(true)}>{t('accounting.invoices.actions.send')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

/** Field caption shown only on phones, where the column headers are hidden. */
const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'block', md: 'none' }, mb: 0.25 }}>{children}</Typography>
);

const TotalRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
  </Box>
);

export default InvoiceEditor;
