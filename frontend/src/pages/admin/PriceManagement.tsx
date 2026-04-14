import React, { useCallback, useEffect, useState } from 'react';
import {
  Container, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControl, InputLabel,
  Select, MenuItem, Switch, FormControlLabel, Alert, Typography, Tabs, Tab, Chip, IconButton,
  Autocomplete, Tooltip, Divider, CircularProgress, Stepper, Step, StepLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import NumberField from '../../components/common/NumberField';
import { pricingService, companiesService, roomTypeService, servicesService, servicePricesService, chargeTemplatesService, chargeRulesService, auditService, guestsService } from '../../services/api';
import type { ServiceRecord, ServicePriceRecord, ServiceKind, ChargeBasis, ReservationMode, ServicePriceCategory, ServicePriceValidity, AuditSummary } from '../../services/api';
import { Company, RoomType, ChargeTemplate, ChargeRule, ChargeRuleExecution, ChargeTrigger, CalculationMethod, ChargeCategory, AuditRun, Guest } from '../../types';
import { useTranslation } from 'react-i18next';
import type { OccupancyTier, RatePlan, PricingRule, RuleTarget, RuleModel, RuleDirection, RuleScope, PeriodPattern, IOccupancyTierOverride, IBlackoutRange, TaxConfig } from '../../utils/pricing';

// ─────────────────────────────────────────────────────────────
// Tab panel helper
// ─────────────────────────────────────────────────────────────
function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box sx={{ pt: 3 }}>{children}</Box> : null;
}

// ─────────────────────────────────────────────────────────────
// Default occupancy tier list helper
// ─────────────────────────────────────────────────────────────
function defaultTiers(): OccupancyTier[] {
  return [
    { guestType: 'adult', guestNumber: 1, price: 0 },
    { guestType: 'adult', guestNumber: 2, price: 0 },
    { guestType: 'child', guestNumber: 1, price: 0 },
  ];
}

// ─────────────────────────────────────────────────────────────
// Rule Wizard form type
// ─────────────────────────────────────────────────────────────
interface RuleWizardForm {
  _id?: string;
  name: string;
  ruleTarget: RuleTarget;
  companyId: string;
  guestEmail: string;
  ratePlanId: string;
  ruleModel: RuleModel;
  direction: RuleDirection;
  value: number;
  scope: RuleScope;
  customBasePrice: number;
  customOccupancyTiers: IOccupancyTierOverride[];
  periodPattern: PeriodPattern;
  specificDays: number[];
  dateStart: string;
  dateEnd: string;
  minimumNights: string;
  blackoutDates: IBlackoutRange[];
  isActive: boolean;
}

function defaultRuleWizardForm(): RuleWizardForm {
  return {
    name: '', ruleTarget: 'promotional',
    companyId: '', guestEmail: '', ratePlanId: '',
    ruleModel: 'percentage', direction: 'discount', value: 0, scope: 'both',
    customBasePrice: 0, customOccupancyTiers: defaultTiers().map(t => ({ ...t })),
    periodPattern: 'all_days', specificDays: [], dateStart: '', dateEnd: '',
    minimumNights: '', blackoutDates: [], isActive: true,
  };
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────
const PriceManagement: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ── Room Types state (data only — CRUD moved to Settings) ────
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);

  // ── Rate Plans state ──────────────────────────────────
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [ratePlanLoading, setRatePlanLoading] = useState(true);
  const [ratePlanDialog, setRatePlanDialog] = useState(false);
  const [ratePlanForm, setRatePlanForm] = useState<RatePlan>({
    name: '', roomTypeId: '', basePrice: 0, pricingMode: 'tiered', occupancyTiers: defaultTiers(), isActive: true,
  });
  const [selectedRatePlanRoomType, setSelectedRatePlanRoomType] = useState<RoomType | null>(null);

  // ── Pricing Rules state ───────────────────────────────────
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [ruleDialog, setRuleDialog] = useState(false);
  const [ruleWizardStep, setRuleWizardStep] = useState(0);
  const [ruleForm, setRuleForm] = useState<RuleWizardForm>(defaultRuleWizardForm());
  const [ruleCompanyOptions, setRuleCompanyOptions] = useState<Company[]>([]);
  const [ruleCompanySearch, setRuleCompanySearch] = useState('');
  const [selectedRuleCompany, setSelectedRuleCompany] = useState<Company | null>(null);
  const [ruleGuestOptions, setRuleGuestOptions] = useState<Guest[]>([]);
  const [ruleGuestSearch, setRuleGuestSearch] = useState('');
  const [selectedRuleGuest, setSelectedRuleGuest] = useState<Guest | null>(null);
  const [selectedRuleRatePlan, setSelectedRuleRatePlan] = useState<RatePlan | null>(null);

  // ── Taxes state ───────────────────────────────────────────
  const [taxes, setTaxes] = useState<TaxConfig[]>([]);
  const [taxesLoading, setTaxesLoading] = useState(true);
  const [taxDialog, setTaxDialog] = useState(false);
  const [taxForm, setTaxForm] = useState<TaxConfig>({
    name: '', type: 'percentage', value: 0, appliesTo: 'total', isInclusive: false, priority: 0, isActive: true,
  });

  // ── Services state ────────────────────────────────────────
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [serviceDialog, setServiceDialog] = useState(false);
  const [serviceForm, setServiceForm] = useState<Partial<ServiceRecord>>({
    code: '', name: '', kind: 'daypass', chargeBasis: 'perPerson', isActive: true, isOnlineBookable: false, isVisibleInPOS: true,
  });

  // ── Service Prices state ──────────────────────────────────
  const [servicePrices, setServicePrices] = useState<ServicePriceRecord[]>([]);
  const [servicePricesLoading, setServicePricesLoading] = useState(true);
  const [servicePriceDialog, setServicePriceDialog] = useState(false);
  const [servicePriceForm, setServicePriceForm] = useState<Partial<ServicePriceRecord>>({
    serviceId: '', category: 'standard', validity: 'everyday', adultPrice: 0, childrenPrice: 0, isActive: true,
  });
  const [servicePriceSelectedService, setServicePriceSelectedService] = useState<ServiceRecord | null>(null);
  const [servicePriceCompanyOptions, setServicePriceCompanyOptions] = useState<Company[]>([]);
  const [servicePriceCompanySearch, setServicePriceCompanySearch] = useState('');
  const [servicePriceSelectedCompany, setServicePriceSelectedCompany] = useState<Company | null>(null);

  // Charge Templates + Rules (internal data, not exposed directly)
  const [chargeTemplates, setChargeTemplates] = useState<ChargeTemplate[]>([]);
  const [chargeTemplatesLoading, setChargeTemplatesLoading] = useState(true);
  const [chargeRules, setChargeRules] = useState<ChargeRule[]>([]);
  const [chargeRulesLoading, setChargeRulesLoading] = useState(true);

  // Auto-Charge Policies (unified UI over templates + rules)
  const [chargePolicyDialog, setChargePolicyDialog] = useState(false);
  const [chargePolicyEditIds, setChargePolicyEditIds] = useState<{ ruleId: string | null; templateId: string | null }>({ ruleId: null, templateId: null });
  const [chargePolicyForm, setChargePolicyForm] = useState<{
    name: string;
    trigger: ChargeTrigger;
    calculationMethod: CalculationMethod;
    amount: number | string;
    taxApplicable: boolean;
    isActive: boolean;
    timeThresholdHours: number | undefined;
  }>({
    name: '',
    trigger: 'checkout_overdue' as ChargeTrigger,
    calculationMethod: 'fixed' as CalculationMethod,
    amount: 0,
    taxApplicable: false,
    isActive: true,
    timeThresholdHours: undefined as number | undefined,
  });

  // Audit Log
  const [auditExecutions, setAuditExecutions] = useState<ChargeRuleExecution[]>([]);
  const [auditRuns, setAuditRuns] = useState<AuditRun[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditLastSummary, setAuditLastSummary] = useState<AuditSummary[] | null>(null);

  // ── Data fetching ─────────────────────────────────────────
  const fetchRoomTypes = useCallback(async () => {
    try {
      const res = await roomTypeService.getRoomTypes();
      setRoomTypes(res.data.data || []);
    } catch {
      setError(t('admin.pricing.messages.loadFailed'));
    }
  }, [t]);
  const fetchRatePlans = useCallback(async () => {
    try {
      setRatePlanLoading(true);
      const res = await pricingService.getRatePlans();
      setRatePlans(res.data.data || []);
    } catch {
      setError(t('admin.pricing.messages.loadFailed'));
    } finally {
      setRatePlanLoading(false);
    }
  }, [t]);

  const fetchRules = useCallback(async () => {
    try {
      setRulesLoading(true);
      const res = await pricingService.getPricingRules();
      setRules(res.data.data || []);
    } catch {
      setError(t('admin.pricing.messages.loadFailed'));
    } finally {
      setRulesLoading(false);
    }
  }, [t]);

  const fetchTaxes = useCallback(async () => {
    try {
      setTaxesLoading(true);
      const res = await pricingService.getTaxes();
      setTaxes(res.data.data || []);
    } catch {
      setError(t('admin.pricing.messages.loadFailed'));
    } finally {
      setTaxesLoading(false);
    }
  }, [t]);

  const fetchServices = useCallback(async () => {
    try {
      setServicesLoading(true);
      const res = await servicesService.getServices();
      setServices(res.data.data || []);
    } catch {
      setError(t('admin.pricing.messages.loadFailed'));
    } finally {
      setServicesLoading(false);
    }
  }, [t]);

  const fetchServicePrices = useCallback(async () => {
    try {
      setServicePricesLoading(true);
      const res = await servicePricesService.getServicePrices();
      setServicePrices(res.data.data || []);
    } catch {
      setError(t('admin.pricing.messages.loadFailed'));
    } finally {
      setServicePricesLoading(false);
    }
  }, [t]);

  const fetchChargeTemplates = useCallback(async () => {
    try {
      setChargeTemplatesLoading(true);
      const res = await chargeTemplatesService.getChargeTemplates();
      setChargeTemplates(res.data.data || []);
    } catch {
      setError(t('admin.pricing.messages.loadFailed'));
    } finally {
      setChargeTemplatesLoading(false);
    }
  }, [t]);

  const fetchChargeRules = useCallback(async () => {
    try {
      setChargeRulesLoading(true);
      const res = await chargeRulesService.getChargeRules();
      setChargeRules(res.data.data || []);
    } catch {
      setError(t('admin.pricing.messages.loadFailed'));
    } finally {
      setChargeRulesLoading(false);
    }
  }, [t]);

  const fetchAuditExecutions = useCallback(async () => {
    try {
      setAuditLoading(true);
      const [execRes, runsRes] = await Promise.all([
        auditService.getExecutions({ limit: 100 }),
        auditService.getRuns({ limit: 50 }),
      ]);
      setAuditExecutions(execRes.data.data || []);
      setAuditRuns(runsRes.data.data || []);
    } catch {
      setError(t('admin.pricing.messages.loadFailed'));
    } finally {
      setAuditLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchRoomTypes();
    fetchRatePlans();
    fetchRules();
    fetchTaxes();
    fetchServices();
    fetchServicePrices();
    fetchChargeTemplates();
    fetchChargeRules();
    fetchAuditExecutions();
  }, [fetchRoomTypes, fetchRatePlans, fetchRules, fetchTaxes, fetchServices, fetchServicePrices, fetchChargeTemplates, fetchChargeRules, fetchAuditExecutions]);

  useEffect(() => {
    if (ruleCompanySearch.length >= 1) {
      companiesService.getCompanies({ search: ruleCompanySearch, limit: 20 })
        .then(res => setRuleCompanyOptions(res.data.data || []))
        .catch(() => {});
    }
  }, [ruleCompanySearch]);

  useEffect(() => {
    if (ruleGuestSearch.length >= 1) {
      guestsService.getGuests({ search: ruleGuestSearch, limit: 20 })
        .then(res => setRuleGuestOptions(res.data.data || []))
        .catch(() => {});
    }
  }, [ruleGuestSearch]);

  useEffect(() => {
    if (servicePriceCompanySearch.length >= 1) {
      companiesService.getCompanies({ search: servicePriceCompanySearch, limit: 20 })
        .then(res => setServicePriceCompanyOptions(res.data.data || []))
        .catch(() => {});
    }
  }, [servicePriceCompanySearch]);

  // ── Room Type handlers removed (management moved to Settings) ─────

  // ── Rate Plan handlers ────────────────────────────────────
  const openNewRatePlan = () => {
    setRatePlanForm({ name: '', roomTypeId: '', basePrice: 0, pricingMode: 'tiered', occupancyTiers: defaultTiers(), isActive: true });
    setSelectedRatePlanRoomType(null);
    setRatePlanDialog(true);
  };

  const openEditRatePlan = (plan: RatePlan) => {
    const rtId = typeof plan.roomTypeId === 'object' && plan.roomTypeId ? (plan.roomTypeId as any)._id : plan.roomTypeId;
    const rtObj = typeof plan.roomTypeId === 'object' && plan.roomTypeId
      ? plan.roomTypeId as any
      : roomTypes.find(rt => rt._id === plan.roomTypeId) || null;
    setSelectedRatePlanRoomType(rtObj ? { _id: rtObj._id || '', name: rtObj.name || '', capacity: rtObj.capacity || 0, isActive: true, createdAt: '', updatedAt: '' } : null);
    setRatePlanForm({ ...plan, roomTypeId: rtId || '', occupancyTiers: plan.occupancyTiers.map(tier => ({ ...tier })) });
    setRatePlanDialog(true);
  };

  const saveRatePlan = async () => {
    try {
      if (!ratePlanForm.name.trim()) { setError(t('admin.pricing.ratePlans.errors.nameRequired')); return; }
      if (!ratePlanForm.roomTypeId || String(ratePlanForm.roomTypeId).trim() === '') { setError(t('admin.pricing.ratePlans.errors.roomTypeRequired')); return; }
      setError(null);
      if (ratePlanForm._id) {
        await pricingService.updateRatePlan(ratePlanForm._id, { ...ratePlanForm, roomTypeId: String(typeof ratePlanForm.roomTypeId === 'object' && ratePlanForm.roomTypeId ? (ratePlanForm.roomTypeId as any)._id : ratePlanForm.roomTypeId) });
      } else {
        await pricingService.createRatePlan(ratePlanForm as any);
      }
      setRatePlanDialog(false);
      await fetchRatePlans();
    } catch (e: any) {
      setError(e.response?.data?.message || t('admin.pricing.messages.saveFailed'));
    }
  };

  const deleteRatePlan = async (id: string) => {
    if (!window.confirm(t('admin.pricing.dialog.deletePrompt'))) return;
    try {
      await pricingService.deleteRatePlan(id);
      await fetchRatePlans();
    } catch {
      setError(t('admin.pricing.messages.saveFailed'));
    }
  };

  const addTier = () => {
    setRatePlanForm(prev => ({
      ...prev,
      occupancyTiers: [...prev.occupancyTiers, { guestType: 'adult', guestNumber: prev.occupancyTiers.filter(tier => tier.guestType === 'adult').length + 1, price: 0 }],
    }));
  };

  const removeTier = (index: number) => {
    setRatePlanForm(prev => ({ ...prev, occupancyTiers: prev.occupancyTiers.filter((_, i) => i !== index) }));
  };

  const updateTier = (index: number, field: keyof OccupancyTier, value: any) => {
    setRatePlanForm(prev => ({
      ...prev,
      occupancyTiers: prev.occupancyTiers.map((tier, i) => i === index ? { ...tier, [field]: value } : tier),
    }));
  };

  // ── Rule handlers ─────────────────────────────────────────
  const openNewRule = () => {
    setRuleForm(defaultRuleWizardForm());
    setSelectedRuleCompany(null);
    setSelectedRuleGuest(null);
    setSelectedRuleRatePlan(null);
    setRuleWizardStep(0);
    setRuleDialog(true);
  };

  const openEditRule = (rule: PricingRule) => {
    const companyId = typeof rule.companyId === 'object' && rule.companyId ? (rule.companyId as any)._id : rule.companyId;
    const companyName = typeof rule.companyId === 'object' && rule.companyId ? (rule.companyId as any).name : undefined;
    const ratePlanId = typeof rule.ratePlanId === 'object' && rule.ratePlanId ? (rule.ratePlanId as any)._id : rule.ratePlanId;
    const ratePlanObj = typeof rule.ratePlanId === 'object' && rule.ratePlanId
      ? rule.ratePlanId as any
      : ratePlans.find(rp => rp._id === (typeof rule.ratePlanId === 'string' ? rule.ratePlanId : (rule.ratePlanId as any)?._id)) || null;
    setSelectedRuleCompany(companyId && rule.ruleTarget === 'company' ? { _id: companyId, name: companyName || companyId } as Company : null);
    setSelectedRuleGuest(rule.ruleTarget === 'guest' && rule.guestEmail
      ? { _id: '', firstName: '', lastName: '', email: rule.guestEmail, createdAt: '', updatedAt: '' } as Guest
      : null);
    setSelectedRuleRatePlan(ratePlanObj
      ? { _id: ratePlanObj._id || ratePlanId || '', name: ratePlanObj.name || '', roomTypeId: ratePlanObj.roomTypeId || '', basePrice: ratePlanObj.basePrice ?? 0, pricingMode: 'tiered', occupancyTiers: ratePlanObj.occupancyTiers || [] }
      : null);
    setRuleForm({
      _id: rule._id,
      name: rule.name,
      ruleTarget: rule.ruleTarget,
      companyId: companyId || '',
      guestEmail: rule.guestEmail || '',
      ratePlanId: ratePlanId || '',
      ruleModel: rule.ruleModel,
      direction: rule.direction || 'discount',
      value: rule.value ?? 0,
      scope: rule.scope || 'both',
      customBasePrice: rule.customBasePrice ?? 0,
      customOccupancyTiers: rule.customOccupancyTiers ? [...rule.customOccupancyTiers] : defaultTiers().map(t => ({ ...t })),
      periodPattern: rule.periodPattern || 'all_days',
      specificDays: rule.specificDays || [],
      dateStart: rule.dateStart?.substring(0, 10) || '',
      dateEnd: rule.dateEnd?.substring(0, 10) || '',
      minimumNights: rule.minimumNights != null ? String(rule.minimumNights) : '',
      blackoutDates: rule.blackoutDates
        ? rule.blackoutDates.map(b => ({ start: b.start.substring(0, 10), end: b.end.substring(0, 10) }))
        : [],
      isActive: rule.isActive ?? true,
    });
    setRuleWizardStep(0);
    setRuleDialog(true);
  };

  const validateRuleWizardStep = (): string | null => {
    if (ruleWizardStep === 0) {
      if (!ruleForm.name.trim()) return t('admin.pricing.rules.errors.nameRequired', 'Rule name is required');
      if (!ruleForm.ratePlanId) return 'Please select a base rate plan';
      if (ruleForm.ruleTarget === 'company' && !ruleForm.companyId) return 'Please select a company';
      if (ruleForm.ruleTarget === 'guest' && !ruleForm.guestEmail.trim()) return 'Please select or enter a guest email';
    }
    if (ruleWizardStep === 2) {
      if (ruleForm.dateStart && !ruleForm.dateEnd) return t('admin.pricing.rules.errors.endDateRequired', 'End date is required when start date is set');
      if (!ruleForm.dateStart && ruleForm.dateEnd) return 'Start date is required when end date is set';
      if (ruleForm.periodPattern === 'specific_days' && ruleForm.specificDays.length === 0) return 'Please select at least one day';
      for (const bo of ruleForm.blackoutDates) {
        if (!bo.start || !bo.end) return 'Blackout dates require both start and end dates';
      }
    }
    return null;
  };

  const handleRuleWizardNext = () => {
    const err = validateRuleWizardStep();
    if (err) { setError(err); return; }
    setError(null);
    setRuleWizardStep(s => s + 1);
  };

  const saveRule = async () => {
    const err = validateRuleWizardStep();
    if (err) { setError(err); return; }
    try {
      setError(null);
      const payload: any = {
        name: ruleForm.name,
        ruleTarget: ruleForm.ruleTarget,
        companyId: ruleForm.ruleTarget === 'company' ? ruleForm.companyId || null : null,
        guestEmail: ruleForm.ruleTarget === 'guest' ? ruleForm.guestEmail.trim() || null : null,
        ratePlanId: ruleForm.ratePlanId,
        ruleModel: ruleForm.ruleModel,
        periodPattern: ruleForm.periodPattern,
        specificDays: ruleForm.periodPattern === 'specific_days' ? ruleForm.specificDays : [],
        dateStart: ruleForm.dateStart || null,
        dateEnd: ruleForm.dateEnd || null,
        minimumNights: ruleForm.minimumNights !== '' ? Number(ruleForm.minimumNights) : null,
        blackoutDates: ruleForm.blackoutDates,
        isActive: ruleForm.isActive,
      };
      if (ruleForm.ruleModel === 'custom') {
        payload.customBasePrice = ruleForm.customBasePrice;
        payload.customOccupancyTiers = ruleForm.customOccupancyTiers;
      } else {
        payload.direction = ruleForm.ruleTarget === 'promotional' ? ruleForm.direction : 'discount';
        payload.value = ruleForm.value;
        payload.scope = ruleForm.scope;
      }
      if (ruleForm._id) {
        await pricingService.updatePricingRule(ruleForm._id, payload);
      } else {
        await pricingService.createPricingRule(payload);
      }
      setRuleDialog(false);
      await fetchRules();
    } catch (e: any) {
      setError(e.response?.data?.message || t('admin.pricing.messages.saveFailed'));
    }
  };

  const deleteRule = async (id: string) => {
    if (!window.confirm(t('admin.pricing.dialog.deletePrompt'))) return;
    try {
      await pricingService.deletePricingRule(id);
      await fetchRules();
    } catch {
      setError(t('admin.pricing.messages.saveFailed'));
    }
  };

  // ── Custom tier helpers for rule wizard ───────────────────
  const addRuleTier = () => {
    setRuleForm(prev => ({
      ...prev,
      customOccupancyTiers: [...prev.customOccupancyTiers, { guestType: 'adult', guestNumber: prev.customOccupancyTiers.filter(tt => tt.guestType === 'adult').length + 1, price: 0 }],
    }));
  };

  const removeRuleTier = (index: number) => {
    setRuleForm(prev => ({ ...prev, customOccupancyTiers: prev.customOccupancyTiers.filter((_, i) => i !== index) }));
  };

  const updateRuleTier = (index: number, field: keyof IOccupancyTierOverride, value: any) => {
    setRuleForm(prev => ({
      ...prev,
      customOccupancyTiers: prev.customOccupancyTiers.map((tier, i) => i === index ? { ...tier, [field]: value } : tier),
    }));
  };

  const toggleRuleDay = (day: number) => {
    setRuleForm(prev => ({
      ...prev,
      specificDays: prev.specificDays.includes(day)
        ? prev.specificDays.filter(d => d !== day)
        : [...prev.specificDays, day].sort((a, b) => a - b),
    }));
  };

  const addRuleBlackout = () => {
    setRuleForm(prev => ({ ...prev, blackoutDates: [...prev.blackoutDates, { start: '', end: '' }] }));
  };

  const removeRuleBlackout = (index: number) => {
    setRuleForm(prev => ({ ...prev, blackoutDates: prev.blackoutDates.filter((_, i) => i !== index) }));
  };

  const updateRuleBlackout = (index: number, field: 'start' | 'end', value: string) => {
    setRuleForm(prev => ({
      ...prev,
      blackoutDates: prev.blackoutDates.map((b, i) => i === index ? { ...b, [field]: value } : b),
    }));
  };

  // ── Tax handlers ──────────────────────────────────────────
  const openNewTax = () => {
    setTaxForm({ name: '', type: 'percentage', value: 0, appliesTo: 'total', isInclusive: false, priority: 0, isActive: true });
    setTaxDialog(true);
  };

  const openEditTax = (tax: TaxConfig) => {
    setTaxForm({ ...tax });
    setTaxDialog(true);
  };

  const saveTax = async () => {
    try {
      if (!taxForm.name.trim()) { setError(t('admin.pricing.taxes.errors.nameRequired')); return; }
      setError(null);
      if (taxForm._id) {
        await pricingService.updateTax(taxForm._id, taxForm as any);
      } else {
        await pricingService.createTax(taxForm as any);
      }
      setTaxDialog(false);
      await fetchTaxes();
    } catch (e: any) {
      setError(e.response?.data?.message || t('admin.pricing.messages.saveFailed'));
    }
  };

  const deleteTax = async (id: string) => {
    if (!window.confirm(t('admin.pricing.dialog.deletePrompt'))) return;
    try {
      await pricingService.deleteTax(id);
      await fetchTaxes();
    } catch {
      setError(t('admin.pricing.messages.saveFailed'));
    }
  };

  // ── Service handlers ──────────────────────────────────────
  const openNewService = () => {
    setServiceForm({ code: '', name: '', kind: 'daypass', chargeBasis: 'perPerson', isActive: true, isOnlineBookable: false, isVisibleInPOS: true });
    setServiceDialog(true);
  };

  const openEditService = (svc: ServiceRecord) => {
    setServiceForm({ ...svc });
    setServiceDialog(true);
  };

  const saveService = async () => {
    try {
      if (!serviceForm.name?.trim()) { setError('Service name is required'); return; }
      if (!serviceForm.code?.trim()) { setError('Service code is required'); return; }
      setError(null);
      if ((serviceForm as any)._id) {
        await servicesService.updateService((serviceForm as any)._id, serviceForm as ServiceRecord);
      } else {
        await servicesService.createService(serviceForm as ServiceRecord);
      }
      setServiceDialog(false);
      await fetchServices();
    } catch (e: any) {
      setError(e.response?.data?.message || t('admin.pricing.messages.saveFailed'));
    }
  };

  const deleteService = async (id: string) => {
    if (!window.confirm(t('admin.pricing.dialog.deletePrompt'))) return;
    try {
      await servicesService.deleteService(id);
      await fetchServices();
    } catch {
      setError(t('admin.pricing.messages.saveFailed'));
    }
  };

  // ── Service Price handlers ────────────────────────────────
  const openNewServicePrice = () => {
    setServicePriceForm({ serviceId: '', category: 'standard', validity: 'everyday', adultPrice: 0, childrenPrice: 0, isActive: true });
    setServicePriceSelectedService(null);
    setServicePriceSelectedCompany(null);
    setServicePriceDialog(true);
  };

  const openEditServicePrice = (sp: ServicePriceRecord) => {
    const svcId = typeof sp.serviceId === 'object' && sp.serviceId ? (sp.serviceId as ServiceRecord)._id : sp.serviceId;
    const svcObj = typeof sp.serviceId === 'object' && sp.serviceId ? sp.serviceId as ServiceRecord : services.find(s => s._id === sp.serviceId) || null;
    const compId = typeof sp.companyId === 'object' && sp.companyId ? (sp.companyId as any)._id : sp.companyId;
    const compName = typeof sp.companyId === 'object' && sp.companyId ? (sp.companyId as any).name : undefined;
    setServicePriceSelectedService(svcObj);
    setServicePriceSelectedCompany(compId ? { _id: compId, name: compName || compId } as Company : null);
    setServicePriceForm({
      ...sp,
      serviceId: svcId,
      companyId: compId,
      startDate: sp.startDate ? sp.startDate.substring(0, 10) : undefined,
      endDate: sp.endDate ? sp.endDate.substring(0, 10) : undefined,
    });
    setServicePriceDialog(true);
  };

  const saveServicePrice = async () => {
    try {
      if (!servicePriceForm.serviceId) { setError('Please select a service'); return; }
      setError(null);
      const payload = {
        ...servicePriceForm,
        adultPrice: Number(servicePriceForm.adultPrice) || 0,
        childrenPrice: Number(servicePriceForm.childrenPrice) || 0,
      };
      if ((servicePriceForm as any)._id) {
        await servicePricesService.updateServicePrice((servicePriceForm as any)._id, payload as any);
      } else {
        await servicePricesService.createServicePrice(payload as any);
      }
      setServicePriceDialog(false);
      await fetchServicePrices();
    } catch (e: any) {
      setError(e.response?.data?.message || t('admin.pricing.messages.saveFailed'));
    }
  };

  const deleteServicePrice = async (id: string) => {
    if (!window.confirm(t('admin.pricing.dialog.deletePrompt'))) return;
    try {
      await servicePricesService.deleteServicePrice(id);
      await fetchServicePrices();
    } catch {
      setError(t('admin.pricing.messages.saveFailed'));
    }
  };

  // ── Charge Policy handlers (unified: template + rule) ───────
  const openNewChargePolicy = () => {
    setChargePolicyEditIds({ ruleId: null, templateId: null });
    setChargePolicyForm({ name: '', trigger: 'checkout_overdue', calculationMethod: 'fixed', amount: 0, taxApplicable: false, isActive: true, timeThresholdHours: undefined });
    setChargePolicyDialog(true);
  };

  const openEditChargePolicy = (rule: ChargeRule) => {
    const rawTmplId = typeof rule.chargeTemplateId === 'object' && rule.chargeTemplateId
      ? (rule.chargeTemplateId as any)._id
      : rule.chargeTemplateId;
    const tmpl = chargeTemplates.find(tmplItem => tmplItem._id === rawTmplId)
      || (typeof rule.chargeTemplateId === 'object' && rule.chargeTemplateId ? rule.chargeTemplateId as unknown as ChargeTemplate : undefined);
    setChargePolicyEditIds({ ruleId: rule._id!, templateId: rawTmplId || null });
    setChargePolicyForm({
      name: rule.name,
      trigger: rule.trigger,
      calculationMethod: tmpl?.calculationMethod ?? 'fixed',
      amount: tmpl?.amount ?? 0,
      taxApplicable: tmpl?.taxApplicable ?? false,
      isActive: rule.isActive,
      timeThresholdHours: rule.conditions?.timeThresholdHours,
    });
    setChargePolicyDialog(true);
  };

  const saveChargePolicy = async () => {
    try {
      const { ruleId, templateId } = chargePolicyEditIds;
      const { name, trigger, calculationMethod, amount, taxApplicable, isActive, timeThresholdHours } = chargePolicyForm;
      if (!name.trim()) { setError(t('admin.pricing.chargePolicies.errors.nameRequired', 'Policy name is required')); return; }
      setError(null);
      const templatePayload = {
        name: `${name} (template)`,
        descriptionTemplate: `Charge for reservation {code}`,
        calculationMethod,
        amount: Number(amount) || 0,
        category: 'late_fee' as ChargeCategory,
        taxApplicable,
        isActive,
      };
      const rulePayload: Partial<ChargeRule> = {
        name,
        trigger,
        isActive,
        priority: 0,
        multiplierOverride: 1,
        conditions: timeThresholdHours != null ? { timeThresholdHours } : {},
      };
      if (ruleId && templateId) {
        await chargeTemplatesService.updateChargeTemplate(templateId, templatePayload);
        await chargeRulesService.updateChargeRule(ruleId, rulePayload);
      } else {
        const tmplRes = await chargeTemplatesService.createChargeTemplate(templatePayload as any);
        const newTmplId = tmplRes.data.data?._id || (tmplRes.data as any)._id;
        await chargeRulesService.createChargeRule({ ...rulePayload, chargeTemplateId: newTmplId } as any);
      }
      setChargePolicyDialog(false);
      await Promise.all([fetchChargeTemplates(), fetchChargeRules()]);
    } catch {
      setError(t('admin.pricing.messages.saveFailed'));
    }
  };

  const deleteChargePolicy = async (rule: ChargeRule) => {
    if (!window.confirm(t('admin.pricing.dialog.deletePrompt'))) return;
    try {
      const rawTmplId = typeof rule.chargeTemplateId === 'object' && rule.chargeTemplateId
        ? (rule.chargeTemplateId as any)._id
        : rule.chargeTemplateId;
      await chargeRulesService.deleteChargeRule(rule._id!);
      if (rawTmplId) await chargeTemplatesService.deleteChargeTemplate(rawTmplId);
      await Promise.all([fetchChargeTemplates(), fetchChargeRules()]);
    } catch {
      setError(t('admin.pricing.messages.saveFailed'));
    }
  };

  // ── Audit handlers ────────────────────────────────────────
  const handleRunAudit = async (dryRun = false) => {
    setAuditRunning(true);
    try {
      const res = await auditService.runAudit({ dryRun });
      setAuditLastSummary(res.data.data || null);
      await fetchAuditExecutions();
    } catch {
      setError(t('admin.pricing.messages.saveFailed'));
    } finally {
      setAuditRunning(false);
    }
  };

  // ── Helper: label for service kind ────────────────────────
  const serviceKindLabel: Record<string, string> = {
    daypass: 'Day Pass',
    pasatarde: 'Pasa Tarde',
    event: 'Event',
    roomAddon: 'Room Add-on',
    generic: 'Generic',
  };

  const chargeBasisLabel: Record<string, string> = {
    perPerson: 'Per Person',
    perRoom: 'Per Room',
    perStay: 'Per Stay',
    perEvent: 'Per Event',
  };

  // ─────────────────────────────────────────────────────────────
  const taxAppliesToLabel = {
    room: t('admin.pricing.taxes.appliesToLabels.room'),
    guest: t('admin.pricing.taxes.appliesToLabels.guest'),
    total: t('admin.pricing.taxes.appliesToLabels.total'),
  };

  // ── Helper: resolve room type name from populated data ─
  const getRoomTypeName = (roomTypeId: any): string => {
    if (!roomTypeId) return '';
    if (typeof roomTypeId === 'object' && roomTypeId) return roomTypeId.name || '';
    const found = roomTypes.find(rt => rt._id === roomTypeId);
    return found?.name || String(roomTypeId);
  };

  return (
    <AdminLayout>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <SectionTitle title={t('admin.pricing.title')} />

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
        )}

        <Paper sx={{ mb: 2 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
            <Tab label={t('admin.pricing.tabs.ratePlans')} />
            <Tab label={t('admin.pricing.tabs.rules')} />
            <Tab label={t('admin.pricing.tabs.taxes')} />
            <Tab label={t('admin.pricing.tabs.services', 'Services')} />
            <Tab label={t('admin.pricing.tabs.servicePrices', 'Service Prices')} />
            <Tab label={t('admin.pricing.tabs.chargePolicies', 'Auto-Charge Policies')} />
            <Tab label={t('admin.pricing.tabs.auditLog', 'Audit Log')} />
          </Tabs>
        </Paper>

        {/* ── Rate Plans Tab ──────────────────────────────── */}
        <TabPanel value={tab} index={0}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openNewRatePlan}>
              {t('admin.pricing.ratePlans.actions.new')}
            </Button>
          </Box>

          {ratePlans.length === 0 && !ratePlanLoading ? (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">{t('admin.pricing.ratePlans.empty')}</Typography>
            </Paper>
          ) : (
            <Box sx={{ display: 'grid', gap: 2 }}>
              {ratePlans.map(plan => (
                <Paper key={plan._id} variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={600}>{plan.name}</Typography>
                      <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                        <Chip size="small" label={getRoomTypeName(plan.roomTypeId)} color="primary" variant="outlined" />
                        <Chip size="small" label={`${t('admin.pricing.ratePlans.basePrice')}: $${plan.basePrice}`} />
                        {!plan.isActive && <Chip size="small" label={t('admin.pricing.inactive')} color="warning" />}
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <IconButton size="small" onClick={() => openEditRatePlan(plan)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => deleteRatePlan(plan._id!)}><DeleteIcon fontSize="small" /></IconButton>
                    </Box>
                  </Box>

                  {plan.occupancyTiers.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {t('admin.pricing.ratePlans.occupancyTiers')}
                      </Typography>
                      <TableContainer sx={{ mt: 1 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>{t('admin.pricing.ratePlans.tiersTable.guestType')}</TableCell>
                              <TableCell>{t('admin.pricing.ratePlans.tiersTable.guestNumber')}</TableCell>
                              <TableCell>{t('admin.pricing.ratePlans.tiersTable.price')}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {plan.occupancyTiers.map((tier, idx) => (
                              <TableRow key={idx}>
                                <TableCell sx={{ textTransform: 'capitalize' }}>{tier.guestType}</TableCell>
                                <TableCell>#{tier.guestNumber}</TableCell>
                                <TableCell>
                                  {tier.price === 0
                                    ? <Chip size="small" label={t('admin.pricing.ratePlans.included')} color="success" />
                                    : `$${tier.price}`}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>
                  )}
                </Paper>
              ))}
            </Box>
          )}
        </TabPanel>

        {/* ── Rules Tab ───────────────────────────────────── */}
        <TabPanel value={tab} index={1}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">{t('admin.pricing.rules.description')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openNewRule}>
              {t('admin.pricing.rules.actions.new')}
            </Button>
          </Box>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Rate Plan</TableCell>
                  <TableCell>Rule</TableCell>
                  <TableCell>Period</TableCell>
                  <TableCell>{t('admin.pricing.rules.table.active')}</TableCell>
                  <TableCell>{t('admin.pricing.rules.table.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rules.map(rule => {
                  const companyName = typeof rule.companyId === 'object' ? (rule.companyId as any)?.name : rule.companyId;
                  const ratePlanName = typeof rule.ratePlanId === 'object' && rule.ratePlanId
                    ? (rule.ratePlanId as any).name
                    : ratePlans.find(rp => rp._id === rule.ratePlanId)?.name || rule.ratePlanId;
                  return (
                    <TableRow key={rule._id}>
                      <TableCell>{rule.name}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          <Chip size="small"
                            label={rule.ruleTarget}
                            color={rule.ruleTarget === 'guest' ? 'success' : rule.ruleTarget === 'company' ? 'primary' : 'default'}
                          />
                          {rule.ruleTarget === 'company' && companyName && (
                            <Typography variant="caption">{companyName}</Typography>
                          )}
                          {rule.ruleTarget === 'guest' && rule.guestEmail && (
                            <Typography variant="caption">{rule.guestEmail}</Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{ratePlanName || '—'}</Typography>
                      </TableCell>
                      <TableCell>
                        {rule.ruleModel === 'custom' ? (
                          <Chip size="small" label="Custom" />
                        ) : (
                          <Box>
                            <Typography variant="body2">
                              {rule.direction === 'surcharge' ? '+' : '−'}
                              {rule.ruleModel === 'percentage' ? `${rule.value}%` : `$${rule.value}`}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">on {rule.scope}</Typography>
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          <Chip size="small" label={(rule.periodPattern || 'all_days').replace('_', ' ')} variant="outlined" />
                          {rule.dateStart && (
                            <Typography variant="caption">{rule.dateStart.substring(0, 10)} → {rule.dateEnd?.substring(0, 10)}</Typography>
                          )}
                          {rule.minimumNights && (
                            <Typography variant="caption">{rule.minimumNights}+ nights</Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={rule.isActive ? t('common.yes') : t('common.no')} color={rule.isActive ? 'success' : 'default'} />
                      </TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => openEditRule(rule)}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => deleteRule(rule._id!)}><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rules.length === 0 && !rulesLoading && (
                  <TableRow><TableCell colSpan={7} align="center">{t('admin.pricing.rules.empty')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        {/* ── Taxes Tab ───────────────────────────────────── */}
        <TabPanel value={tab} index={2}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">{t('admin.pricing.taxes.description')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openNewTax}>
              {t('admin.pricing.taxes.actions.new')}
            </Button>
          </Box>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('admin.pricing.taxes.table.name')}</TableCell>
                  <TableCell>{t('admin.pricing.taxes.table.type')}</TableCell>
                  <TableCell>{t('admin.pricing.taxes.table.value')}</TableCell>
                  <TableCell>{t('admin.pricing.taxes.table.appliesTo')}</TableCell>
                  <TableCell>{t('admin.pricing.taxes.table.inclusive')}</TableCell>
                  <TableCell>{t('admin.pricing.taxes.table.priority')}</TableCell>
                  <TableCell>{t('admin.pricing.taxes.table.active')}</TableCell>
                  <TableCell>{t('admin.pricing.taxes.table.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {taxes.map(tax => (
                  <TableRow key={tax._id}>
                    <TableCell>{tax.name}</TableCell>
                    <TableCell><Chip size="small" label={tax.type} /></TableCell>
                    <TableCell>{tax.type === 'percentage' ? `${tax.value}%` : `$${tax.value}`}</TableCell>
                    <TableCell>{taxAppliesToLabel[tax.appliesTo]}</TableCell>
                    <TableCell>
                      <Chip size="small"
                        label={tax.isInclusive ? t('admin.pricing.taxes.inclusive') : t('admin.pricing.taxes.exclusive')}
                        color={tax.isInclusive ? 'info' : 'default'}
                      />
                    </TableCell>
                    <TableCell>{tax.priority}</TableCell>
                    <TableCell>
                      <Chip size="small" label={tax.isActive ? t('common.yes') : t('common.no')} color={tax.isActive ? 'success' : 'default'} />
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => openEditTax(tax)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => deleteTax(tax._id!)}><DeleteIcon fontSize="small" /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {taxes.length === 0 && !taxesLoading && (
                  <TableRow><TableCell colSpan={8} align="center">{t('admin.pricing.taxes.empty')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        {/* ── Services Tab ─────────────────────────────────── */}
        <TabPanel value={tab} index={3}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openNewService}>
              {t('admin.pricing.services.actions.new', 'New Service')}
            </Button>
          </Box>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('admin.pricing.services.table.code', 'Code')}</TableCell>
                  <TableCell>{t('admin.pricing.services.table.name', 'Name')}</TableCell>
                  <TableCell>{t('admin.pricing.services.table.kind', 'Kind')}</TableCell>
                  <TableCell>{t('admin.pricing.services.table.chargeBasis', 'Charge Basis')}</TableCell>
                  <TableCell>{t('admin.pricing.services.table.pos', 'POS')}</TableCell>
                  <TableCell>{t('admin.pricing.services.table.active', 'Active')}</TableCell>
                  <TableCell>{t('admin.pricing.services.table.actions', 'Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {servicesLoading ? (
                  <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                ) : services.map(svc => (
                  <TableRow key={svc._id} hover>
                    <TableCell><Chip size="small" label={svc.code} /></TableCell>
                    <TableCell>{svc.name}</TableCell>
                    <TableCell>{serviceKindLabel[svc.kind] || svc.kind}</TableCell>
                    <TableCell>{chargeBasisLabel[svc.chargeBasis] || svc.chargeBasis}</TableCell>
                    <TableCell><Chip size="small" color={svc.isVisibleInPOS ? 'success' : 'default'} label={svc.isVisibleInPOS ? t('common.yes', 'Yes') : t('common.no', 'No')} /></TableCell>
                    <TableCell><Chip size="small" color={svc.isActive ? 'success' : 'default'} label={svc.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')} /></TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => openEditService(svc)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => deleteService(svc._id!)}><DeleteIcon fontSize="small" /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {services.length === 0 && !servicesLoading && (
                  <TableRow><TableCell colSpan={7} align="center">{t('admin.pricing.services.empty', 'No services configured.')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        {/* ── Service Prices Tab ───────────────────────────── */}
        <TabPanel value={tab} index={4}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openNewServicePrice}>
              {t('admin.pricing.servicePrices.actions.new', 'New Price')}
            </Button>
          </Box>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('admin.pricing.servicePrices.table.service', 'Service')}</TableCell>
                  <TableCell>{t('admin.pricing.servicePrices.table.category', 'Category')}</TableCell>
                  <TableCell>{t('admin.pricing.servicePrices.table.validity', 'Validity')}</TableCell>
                  <TableCell>{t('admin.pricing.servicePrices.table.dates', 'Dates')}</TableCell>
                  <TableCell>{t('admin.pricing.servicePrices.table.adultPrice', 'Adult Price')}</TableCell>
                  <TableCell>{t('admin.pricing.servicePrices.table.childrenPrice', 'Children Price')}</TableCell>
                  <TableCell>{t('admin.pricing.servicePrices.table.active', 'Active')}</TableCell>
                  <TableCell>{t('admin.pricing.servicePrices.table.actions', 'Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {servicePricesLoading ? (
                  <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                ) : servicePrices.map(sp => {
                  const svcName = typeof sp.serviceId === 'object' && sp.serviceId ? (sp.serviceId as ServiceRecord).name : services.find(s => s._id === sp.serviceId)?.name || sp.serviceId;
                  const dateRange = sp.startDate && sp.endDate ? `${sp.startDate.substring(0,10)} – ${sp.endDate.substring(0,10)}` : '—';
                  return (
                    <TableRow key={sp._id} hover>
                      <TableCell>{svcName}</TableCell>
                      <TableCell><Chip size="small" label={sp.category} /></TableCell>
                      <TableCell>{sp.validity}</TableCell>
                      <TableCell>{dateRange}</TableCell>
                      <TableCell>{sp.adultPrice}</TableCell>
                      <TableCell>{sp.childrenPrice}</TableCell>
                      <TableCell><Chip size="small" color={sp.isActive ? 'success' : 'default'} label={sp.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')} /></TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => openEditServicePrice(sp)}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => deleteServicePrice(sp._id!)}><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {servicePrices.length === 0 && !servicePricesLoading && (
                  <TableRow><TableCell colSpan={8} align="center">{t('admin.pricing.servicePrices.empty', 'No service prices configured.')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        {/* ── Rate Plan Dialog ─────────────────────────────── */}
        <Dialog open={ratePlanDialog} onClose={() => setRatePlanDialog(false)} maxWidth="md" fullWidth>
          <DialogTitle>
            {ratePlanForm._id ? t('admin.pricing.ratePlans.dialog.editTitle') : t('admin.pricing.ratePlans.dialog.newTitle')}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <TextField
                  label={t('admin.pricing.ratePlans.form.name')}
                  value={ratePlanForm.name}
                  onChange={e => setRatePlanForm(p => ({ ...p, name: e.target.value }))}
                  required fullWidth
                />
                <Autocomplete
                  options={roomTypes}
                  getOptionLabel={o => o.name}
                  value={selectedRatePlanRoomType}
                  onChange={(_, val) => {
                    setSelectedRatePlanRoomType(val);
                    setRatePlanForm(p => ({ ...p, roomTypeId: val?._id || '' }));
                  }}
                  renderInput={params => (
                    <TextField {...params} label={t('admin.pricing.ratePlans.form.roomType')} required
                      helperText={t('admin.pricing.ratePlans.form.roomTypeHelper')}
                    />
                  )}
                />
              </Box>

              <NumberField
                label={t('admin.pricing.ratePlans.form.basePrice')}
                value={ratePlanForm.basePrice}
                onChange={val => setRatePlanForm(p => ({ ...p, basePrice: val ?? 0 }))}
                min={0}
                allowDecimal
              />

              <Divider />

              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle2">{t('admin.pricing.ratePlans.occupancyTiers')}</Typography>
                  <Button size="small" startIcon={<AddIcon />} onClick={addTier}>
                    {t('admin.pricing.ratePlans.actions.addTier')}
                  </Button>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  {t('admin.pricing.ratePlans.tiersHint')}
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('admin.pricing.ratePlans.tiersTable.guestType')}</TableCell>
                        <TableCell>{t('admin.pricing.ratePlans.tiersTable.guestNumber')}</TableCell>
                        <TableCell>{t('admin.pricing.ratePlans.tiersTable.price')}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {ratePlanForm.occupancyTiers.map((tier, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <FormControl size="small" fullWidth>
                              <Select value={tier.guestType} onChange={e => updateTier(idx, 'guestType', e.target.value)}>
                                <MenuItem value="adult">{t('admin.pricing.ratePlans.adult')}</MenuItem>
                                <MenuItem value="child">{t('admin.pricing.ratePlans.child')}</MenuItem>
                              </Select>
                            </FormControl>
                          </TableCell>
                          <TableCell>
                            <NumberField
                              size="small"
                              value={tier.guestNumber}
                              onChange={v => updateTier(idx, 'guestNumber', v ?? 1)}
                              min={1}
                              sx={{ width: 80 }}
                            />
                          </TableCell>
                          <TableCell>
                            <NumberField
                              size="small"
                              allowDecimal
                              value={tier.price}
                              onChange={v => updateTier(idx, 'price', v ?? 0)}
                              min={0}
                              helperText={tier.price === 0 ? t('admin.pricing.ratePlans.included') : undefined}
                              sx={{ width: 100 }}
                            />
                          </TableCell>
                          <TableCell>
                            <Tooltip title={t('admin.pricing.ratePlans.actions.removeTier')}>
                              <IconButton size="small" onClick={() => removeTier(idx)}><DeleteIcon fontSize="small" /></IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                      {ratePlanForm.occupancyTiers.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} align="center">
                            <Typography variant="caption" color="text.secondary">{t('admin.pricing.ratePlans.noTiers')}</Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>

              <FormControlLabel
                control={<Switch checked={ratePlanForm.isActive ?? true} onChange={e => setRatePlanForm(p => ({ ...p, isActive: e.target.checked }))} />}
                label={t('admin.pricing.form.active')}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRatePlanDialog(false)}>{t('admin.pricing.actions.cancel')}</Button>
            <Button variant="contained" onClick={saveRatePlan}>{t('admin.pricing.actions.save')}</Button>
          </DialogActions>
        </Dialog>

        {/* ── Rule Wizard Dialog ───────────────────────────── */}
        <Dialog open={ruleDialog} onClose={() => { setRuleDialog(false); setError(null); }} maxWidth="md" fullWidth>
          <DialogTitle>
            {ruleForm._id ? t('admin.pricing.rules.dialog.editTitle', 'Edit Price Rule') : t('admin.pricing.rules.dialog.newTitle', 'New Price Rule')}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ pt: 1 }}>
              <Stepper activeStep={ruleWizardStep} sx={{ mb: 3 }}>
                {['Target', 'Rule Model', 'Period', 'Preview'].map(label => (
                  <Step key={label}><StepLabel>{label}</StepLabel></Step>
                ))}
              </Stepper>

              {/* ── Step 1: Name + Target + Rate Plan ── */}
              {ruleWizardStep === 0 && (
                <Box sx={{ display: 'grid', gap: 2 }}>
                  <TextField
                    label="Rule Name"
                    value={ruleForm.name}
                    onChange={e => setRuleForm(p => ({ ...p, name: e.target.value }))}
                    required fullWidth
                  />
                  <FormControl fullWidth>
                    <InputLabel>Who is this rule for?</InputLabel>
                    <Select
                      value={ruleForm.ruleTarget}
                      label="Who is this rule for?"
                      onChange={e => setRuleForm(p => ({ ...p, ruleTarget: e.target.value as RuleTarget, companyId: '', guestEmail: '' }))}
                    >
                      <MenuItem value="company">Company</MenuItem>
                      <MenuItem value="guest">Guest</MenuItem>
                      <MenuItem value="promotional">Promotional</MenuItem>
                    </Select>
                  </FormControl>

                  {ruleForm.ruleTarget === 'company' && (
                    <Autocomplete
                      options={ruleCompanyOptions}
                      getOptionLabel={o => o.name}
                      value={selectedRuleCompany}
                      onChange={(_, val) => {
                        setSelectedRuleCompany(val);
                        setRuleForm(p => ({ ...p, companyId: val?._id || '' }));
                      }}
                      onInputChange={(_, v) => setRuleCompanySearch(v)}
                      renderInput={params => (
                        <TextField {...params} label="Company" required helperText="Type to search companies" />
                      )}
                    />
                  )}

                  {ruleForm.ruleTarget === 'guest' && (
                    <Autocomplete
                      options={ruleGuestOptions}
                      getOptionLabel={o => `${o.firstName} ${o.lastName}`}
                      value={selectedRuleGuest}
                      onChange={(_, val) => {
                        setSelectedRuleGuest(val);
                        setRuleForm(p => ({ ...p, guestEmail: val?.email || '' }));
                      }}
                      onInputChange={(_, v) => setRuleGuestSearch(v)}
                      renderOption={(props, o) => (
                        <li {...props} key={o._id}>
                          <Box>
                            <Typography variant="body2">{o.firstName} {o.lastName}</Typography>
                            <Typography variant="caption" color="text.secondary">{o.email}</Typography>
                          </Box>
                        </li>
                      )}
                      renderInput={params => (
                        <TextField {...params} label="Guest" required helperText="Search by name" />
                      )}
                    />
                  )}

                  {ruleForm.ruleTarget === 'guest' && ruleForm.guestEmail && (
                    <TextField
                      label="Guest Email"
                      value={ruleForm.guestEmail}
                      onChange={e => setRuleForm(p => ({ ...p, guestEmail: e.target.value }))}
                      size="small"
                      helperText="You can also type an email directly"
                    />
                  )}

                  <Autocomplete
                    options={ratePlans}
                    getOptionLabel={o => o.name}
                    value={selectedRuleRatePlan}
                    onChange={(_, val) => {
                      setSelectedRuleRatePlan(val);
                      setRuleForm(p => ({ ...p, ratePlanId: val?._id || '' }));
                    }}
                    renderInput={params => (
                      <TextField {...params} label="Base Rate Plan" required helperText="The rate plan this rule will modify" />
                    )}
                  />
                </Box>
              )}

              {/* ── Step 2: Rule Model ── */}
              {ruleWizardStep === 1 && (
                <Box sx={{ display: 'grid', gap: 2 }}>
                  <FormControl fullWidth>
                    <InputLabel>Rule Model</InputLabel>
                    <Select
                      value={ruleForm.ruleModel}
                      label="Rule Model"
                      onChange={e => setRuleForm(p => ({ ...p, ruleModel: e.target.value as RuleModel }))}
                    >
                      <MenuItem value="percentage">Percentage</MenuItem>
                      <MenuItem value="fixed">Fixed Amount</MenuItem>
                      <MenuItem value="custom">Custom</MenuItem>
                    </Select>
                  </FormControl>

                  {ruleForm.ruleModel === 'custom' && (
                    <Alert severity="info">Custom rules replace the rate plan entirely with specific prices you define below.</Alert>
                  )}

                  {(ruleForm.ruleModel === 'percentage' || ruleForm.ruleModel === 'fixed') && (
                    <>
                      {ruleForm.ruleTarget === 'promotional' ? (
                        <FormControl fullWidth>
                          <InputLabel>Direction</InputLabel>
                          <Select
                            value={ruleForm.direction}
                            label="Direction"
                            onChange={e => setRuleForm(p => ({ ...p, direction: e.target.value as RuleDirection }))}
                          >
                            <MenuItem value="discount">Discount (reduces price)</MenuItem>
                            <MenuItem value="surcharge">Surcharge (increases price)</MenuItem>
                          </Select>
                        </FormControl>
                      ) : (
                        <Alert severity="info">Company and Guest rules always apply as discounts.</Alert>
                      )}
                      <NumberField
                        label={ruleForm.ruleModel === 'percentage' ? 'Amount (%)' : 'Amount ($)'}
                        value={ruleForm.value}
                        onChange={val => setRuleForm(p => ({ ...p, value: val ?? 0 }))}
                        min={0}
                        allowDecimal
                      />
                      <FormControl fullWidth>
                        <InputLabel>Applies to</InputLabel>
                        <Select
                          value={ruleForm.scope}
                          label="Applies to"
                          onChange={e => setRuleForm(p => ({ ...p, scope: e.target.value as RuleScope }))}
                        >
                          <MenuItem value="base">Base Price only</MenuItem>
                          <MenuItem value="occupancy">Occupancy charges only</MenuItem>
                          <MenuItem value="both">Both (base + occupancy)</MenuItem>
                        </Select>
                      </FormControl>
                    </>
                  )}

                  {ruleForm.ruleModel === 'custom' && (
                    <>
                      <NumberField
                        label="Base Price per night ($)"
                        value={ruleForm.customBasePrice}
                        onChange={val => setRuleForm(p => ({ ...p, customBasePrice: val ?? 0 }))}
                        min={0}
                        allowDecimal
                      />
                      <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                          <Typography variant="subtitle2">Occupancy Tier Prices</Typography>
                          <Button size="small" startIcon={<AddIcon />} onClick={addRuleTier}>Add Tier</Button>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                          Set price to 0 to include that guest in the base price.
                        </Typography>
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Type</TableCell>
                                <TableCell>#</TableCell>
                                <TableCell>Price</TableCell>
                                <TableCell />
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {ruleForm.customOccupancyTiers.map((tier, idx) => (
                                <TableRow key={idx}>
                                  <TableCell>
                                    <FormControl size="small" fullWidth>
                                      <Select value={tier.guestType} onChange={e => updateRuleTier(idx, 'guestType', e.target.value)}>
                                        <MenuItem value="adult">Adult</MenuItem>
                                        <MenuItem value="child">Child</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </TableCell>
                                  <TableCell>
                                    <NumberField size="small" value={tier.guestNumber} onChange={v => updateRuleTier(idx, 'guestNumber', v ?? 1)} min={1} sx={{ width: 70 }} />
                                  </TableCell>
                                  <TableCell>
                                    <NumberField size="small" allowDecimal value={tier.price} onChange={v => updateRuleTier(idx, 'price', v ?? 0)} min={0}
                                      helperText={tier.price === 0 ? 'Included' : undefined} sx={{ width: 100 }} />
                                  </TableCell>
                                  <TableCell>
                                    <Tooltip title="Remove"><IconButton size="small" onClick={() => removeRuleTier(idx)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {ruleForm.customOccupancyTiers.length === 0 && (
                                <TableRow><TableCell colSpan={4} align="center"><Typography variant="caption" color="text.secondary">No tiers added</Typography></TableCell></TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                    </>
                  )}
                </Box>
              )}

              {/* ── Step 3: Period ── */}
              {ruleWizardStep === 2 && (
                <Box sx={{ display: 'grid', gap: 2 }}>
                  <FormControl fullWidth>
                    <InputLabel>Period Pattern</InputLabel>
                    <Select
                      value={ruleForm.periodPattern}
                      label="Period Pattern"
                      onChange={e => setRuleForm(p => ({ ...p, periodPattern: e.target.value as PeriodPattern, specificDays: [] }))}
                    >
                      <MenuItem value="all_days">All Days</MenuItem>
                      <MenuItem value="weekdays">Weekdays Only (Mon–Fri)</MenuItem>
                      <MenuItem value="weekends">Weekends Only (Sat–Sun)</MenuItem>
                      <MenuItem value="specific_days">Specific Days</MenuItem>
                    </Select>
                  </FormControl>

                  {ruleForm.periodPattern === 'specific_days' && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Select which days apply:</Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                          <Chip
                            key={i}
                            label={day}
                            clickable
                            color={ruleForm.specificDays.includes(i) ? 'primary' : 'default'}
                            onClick={() => toggleRuleDay(i)}
                          />
                        ))}
                      </Box>
                    </Box>
                  )}

                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    <TextField
                      type="date"
                      label="Validity Start"
                      value={ruleForm.dateStart}
                      onChange={e => setRuleForm(p => ({ ...p, dateStart: e.target.value }))}
                      InputLabelProps={{ shrink: true }}
                      helperText="Leave blank for open-ended"
                    />
                    <TextField
                      type="date"
                      label="Validity End"
                      value={ruleForm.dateEnd}
                      onChange={e => setRuleForm(p => ({ ...p, dateEnd: e.target.value }))}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Box>

                  <TextField
                    label="Minimum Nights"
                    type="number"
                    value={ruleForm.minimumNights}
                    onChange={e => setRuleForm(p => ({ ...p, minimumNights: e.target.value }))}
                    inputProps={{ min: 1, step: 1 }}
                    helperText="Leave blank for no minimum"
                  />

                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="subtitle2">Blackout Dates</Typography>
                      <Button size="small" startIcon={<AddIcon />} onClick={addRuleBlackout}>Add Period</Button>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Rule never applies during blackout periods, even if they overlap with the validity window.
                    </Typography>
                    {ruleForm.blackoutDates.map((bo, i) => (
                      <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 1, mb: 1, alignItems: 'center' }}>
                        <TextField
                          type="date" label="From" value={bo.start}
                          onChange={e => updateRuleBlackout(i, 'start', e.target.value)}
                          InputLabelProps={{ shrink: true }} size="small"
                        />
                        <TextField
                          type="date" label="To" value={bo.end}
                          onChange={e => updateRuleBlackout(i, 'end', e.target.value)}
                          InputLabelProps={{ shrink: true }} size="small"
                        />
                        <IconButton size="small" onClick={() => removeRuleBlackout(i)}><DeleteIcon /></IconButton>
                      </Box>
                    ))}
                    {ruleForm.blackoutDates.length === 0 && (
                      <Typography variant="caption" color="text.secondary">No blackout periods configured</Typography>
                    )}
                  </Box>
                </Box>
              )}

              {/* ── Step 4: Preview ── */}
              {ruleWizardStep === 3 && (
                <Box sx={{ display: 'grid', gap: 2 }}>
                  <Typography variant="h6">{ruleForm.name || '—'}</Typography>

                  <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Target</Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Chip
                        label={ruleForm.ruleTarget}
                        color={ruleForm.ruleTarget === 'guest' ? 'success' : ruleForm.ruleTarget === 'company' ? 'primary' : 'default'}
                      />
                      {ruleForm.ruleTarget === 'company' && selectedRuleCompany && (
                        <Typography variant="body2">{selectedRuleCompany.name}</Typography>
                      )}
                      {ruleForm.ruleTarget === 'guest' && ruleForm.guestEmail && (
                        <Typography variant="body2">{ruleForm.guestEmail}</Typography>
                      )}
                    </Box>
                    {(ruleForm.ruleTarget === 'company' || ruleForm.ruleTarget === 'guest') && (
                      <Typography variant="caption" color="text.secondary">
                        Applies only when reservation is created by front desk staff.
                      </Typography>
                    )}
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Base Rate Plan</Typography>
                    <Typography>{selectedRuleRatePlan?.name || ruleForm.ratePlanId || '—'}</Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Pricing Rule</Typography>
                    {ruleForm.ruleModel === 'custom' ? (
                      <Box>
                        <Chip label="Custom" size="small" />
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                          Replaces rate plan entirely. Base: ${ruleForm.customBasePrice}/night + {ruleForm.customOccupancyTiers.length} occupancy tiers.
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="body2">
                        {ruleForm.ruleTarget !== 'promotional' ? 'Discount' : ruleForm.direction === 'discount' ? 'Discount' : 'Surcharge'} of{' '}
                        {ruleForm.ruleModel === 'percentage' ? `${ruleForm.value}%` : `$${ruleForm.value}`}
                        {' '}on{' '}
                        {ruleForm.scope === 'base' ? 'base price' : ruleForm.scope === 'occupancy' ? 'occupancy charges' : 'base + occupancy'}
                      </Typography>
                    )}
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Period</Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Chip size="small" label={(ruleForm.periodPattern || 'all_days').replace(/_/g, ' ')} />
                      {ruleForm.periodPattern === 'specific_days' && ruleForm.specificDays.length > 0 && (
                        <Typography variant="body2">
                          {ruleForm.specificDays.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}
                        </Typography>
                      )}
                    </Box>
                    {ruleForm.dateStart && (
                      <Typography variant="body2">Valid: {ruleForm.dateStart} → {ruleForm.dateEnd || 'open-ended'}</Typography>
                    )}
                    {ruleForm.minimumNights && (
                      <Typography variant="body2">Minimum stay: {ruleForm.minimumNights} nights</Typography>
                    )}
                    {ruleForm.blackoutDates.length > 0 && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">Blackout periods:</Typography>
                        {ruleForm.blackoutDates.map((b, i) => (
                          <Typography key={i} variant="caption" display="block">&nbsp;• {b.start} → {b.end}</Typography>
                        ))}
                      </Box>
                    )}
                  </Paper>

                  <FormControlLabel
                    control={<Switch checked={ruleForm.isActive} onChange={e => setRuleForm(p => ({ ...p, isActive: e.target.checked }))} />}
                    label={t('admin.pricing.form.active')}
                  />
                </Box>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setRuleDialog(false); setError(null); }}>{t('admin.pricing.actions.cancel')}</Button>
            <Box sx={{ flex: 1 }} />
            {ruleWizardStep > 0 && (
              <Button onClick={() => { setError(null); setRuleWizardStep(s => s - 1); }}>Back</Button>
            )}
            {ruleWizardStep < 3 ? (
              <Button variant="contained" onClick={handleRuleWizardNext}>Next</Button>
            ) : (
              <Button variant="contained" onClick={saveRule}>{t('admin.pricing.actions.save')}</Button>
            )}
          </DialogActions>
        </Dialog>

        {/* ── Tax Dialog ───────────────────────────────────── */}
        <Dialog open={taxDialog} onClose={() => setTaxDialog(false)} maxWidth="sm" fullWidth>
          <DialogTitle>
            {taxForm._id ? t('admin.pricing.taxes.dialog.editTitle') : t('admin.pricing.taxes.dialog.newTitle')}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              <TextField
                label={t('admin.pricing.taxes.form.name')}
                value={taxForm.name}
                onChange={e => setTaxForm(p => ({ ...p, name: e.target.value }))}
                required fullWidth
              />
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <FormControl fullWidth>
                  <InputLabel>{t('admin.pricing.taxes.form.type')}</InputLabel>
                  <Select
                    value={taxForm.type}
                    label={t('admin.pricing.taxes.form.type')}
                    onChange={e => setTaxForm(p => ({ ...p, type: e.target.value as any }))}
                  >
                    <MenuItem value="percentage">{t('admin.pricing.taxes.typeLabels.percentage')}</MenuItem>
                    <MenuItem value="fixed">{t('admin.pricing.taxes.typeLabels.fixed')}</MenuItem>
                  </Select>
                </FormControl>
                <NumberField
                  label={taxForm.type === 'percentage' ? t('admin.pricing.taxes.form.valuePercent') : t('admin.pricing.taxes.form.value')}
                  value={taxForm.value}
                  onChange={val => setTaxForm(p => ({ ...p, value: val ?? 0 }))}
                  min={0}
                  allowDecimal
                />
              </Box>
              <FormControl fullWidth>
                <InputLabel>{t('admin.pricing.taxes.form.appliesTo')}</InputLabel>
                <Select
                  value={taxForm.appliesTo}
                  label={t('admin.pricing.taxes.form.appliesTo')}
                  onChange={e => setTaxForm(p => ({ ...p, appliesTo: e.target.value as any }))}
                >
                  <MenuItem value="total">{taxAppliesToLabel.total}</MenuItem>
                  <MenuItem value="room">{taxAppliesToLabel.room}</MenuItem>
                  <MenuItem value="guest">{taxAppliesToLabel.guest}</MenuItem>
                </Select>
              </FormControl>
              <FormControlLabel
                control={<Switch checked={taxForm.isInclusive} onChange={e => setTaxForm(p => ({ ...p, isInclusive: e.target.checked }))} />}
                label={t('admin.pricing.taxes.form.inclusive')}
              />
              <NumberField
                label={t('admin.pricing.taxes.form.priority')}
                value={taxForm.priority}
                onChange={val => setTaxForm(p => ({ ...p, priority: val ?? 0 }))}
              />
              <FormControlLabel
                control={<Switch checked={taxForm.isActive ?? true} onChange={e => setTaxForm(p => ({ ...p, isActive: e.target.checked }))} />}
                label={t('admin.pricing.form.active')}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setTaxDialog(false)}>{t('admin.pricing.actions.cancel')}</Button>
            <Button variant="contained" onClick={saveTax}>{t('admin.pricing.actions.save')}</Button>
          </DialogActions>
        </Dialog>

        {/* ── Service Dialog ───────────────────────────────── */}
        <Dialog open={serviceDialog} onClose={() => setServiceDialog(false)} maxWidth="sm" fullWidth>
          <DialogTitle>
            {(serviceForm as any)._id ? t('admin.pricing.services.dialog.editTitle', 'Edit Service') : t('admin.pricing.services.dialog.newTitle', 'New Service')}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              <TextField
                label={t('admin.pricing.services.form.code', 'Code')}
                value={serviceForm.code || ''}
                onChange={e => setServiceForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                inputProps={{ maxLength: 20 }}
                required
              />
              <TextField
                label={t('admin.pricing.services.form.name', 'Name')}
                value={serviceForm.name || ''}
                onChange={e => setServiceForm(p => ({ ...p, name: e.target.value }))}
                required
              />
              <FormControl>
                <InputLabel>{t('admin.pricing.services.form.kind', 'Kind')}</InputLabel>
                <Select
                  value={serviceForm.kind || 'daypass'}
                  label={t('admin.pricing.services.form.kind', 'Kind')}
                  onChange={e => setServiceForm(p => ({ ...p, kind: e.target.value as ServiceKind }))}
                >
                  {Object.entries(serviceKindLabel).map(([v, l]) => (
                    <MenuItem key={v} value={v}>{l}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <InputLabel>{t('admin.pricing.services.form.chargeBasis', 'Charge Basis')}</InputLabel>
                <Select
                  value={serviceForm.chargeBasis || 'perPerson'}
                  label={t('admin.pricing.services.form.chargeBasis', 'Charge Basis')}
                  onChange={e => setServiceForm(p => ({ ...p, chargeBasis: e.target.value as ChargeBasis }))}
                >
                  {Object.entries(chargeBasisLabel).map(([v, l]) => (
                    <MenuItem key={v} value={v}>{l}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControlLabel
                control={<Switch checked={serviceForm.isOnlineBookable ?? false} onChange={e => setServiceForm(p => ({ ...p, isOnlineBookable: e.target.checked }))} />}
                label={t('admin.pricing.services.form.onlineBookable', 'Online Bookable')}
              />
              {serviceForm.isOnlineBookable && (
                <FormControl>
                  <InputLabel>{t('admin.pricing.services.form.reservationMode', 'Reservation Mode')}</InputLabel>
                  <Select
                    value={serviceForm.reservationMode || 'dateRange'}
                    label={t('admin.pricing.services.form.reservationMode', 'Reservation Mode')}
                    onChange={e => setServiceForm(p => ({ ...p, reservationMode: e.target.value as ReservationMode }))}
                  >
                    <MenuItem value="dateRange">{t('admin.pricing.services.form.reservationModeRange', 'Date Range (multi-night)')}</MenuItem>
                    <MenuItem value="singleDate">{t('admin.pricing.services.form.reservationModeSingle', 'Single Date')}</MenuItem>
                  </Select>
                </FormControl>
              )}
              <FormControlLabel
                control={<Switch checked={serviceForm.isVisibleInPOS ?? true} onChange={e => setServiceForm(p => ({ ...p, isVisibleInPOS: e.target.checked }))} />}
                label={t('admin.pricing.services.form.visibleInPOS', 'Visible in POS')}
              />
              <FormControlLabel
                control={<Switch checked={serviceForm.isActive ?? true} onChange={e => setServiceForm(p => ({ ...p, isActive: e.target.checked }))} />}
                label={t('admin.pricing.form.active')}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setServiceDialog(false)}>{t('admin.pricing.actions.cancel')}</Button>
            <Button variant="contained" onClick={saveService}>{t('admin.pricing.actions.save')}</Button>
          </DialogActions>
        </Dialog>

        {/* ── Service Price Dialog ─────────────────────────── */}
        <Dialog open={servicePriceDialog} onClose={() => setServicePriceDialog(false)} maxWidth="sm" fullWidth>
          <DialogTitle>
            {(servicePriceForm as any)._id ? t('admin.pricing.servicePrices.dialog.editTitle', 'Edit Service Price') : t('admin.pricing.servicePrices.dialog.newTitle', 'New Service Price')}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              <Autocomplete
                options={services}
                getOptionLabel={o => `${o.name} (${o.code})`}
                value={servicePriceSelectedService}
                onChange={(_, v) => {
                  setServicePriceSelectedService(v);
                  setServicePriceForm(p => ({ ...p, serviceId: v?._id || '' }));
                }}
                renderInput={params => <TextField {...params} label={t('admin.pricing.servicePrices.form.service', 'Service')} required />}
              />
              <FormControl>
                <InputLabel>{t('admin.pricing.rules.form.category', 'Category')}</InputLabel>
                <Select
                  value={servicePriceForm.category || 'standard'}
                  label={t('admin.pricing.rules.form.category', 'Category')}
                  onChange={e => setServicePriceForm(p => ({ ...p, category: e.target.value as ServicePriceCategory }))}
                >
                  {(['standard', 'special', 'guest', 'company'] as ServicePriceCategory[]).map(c => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <InputLabel>{t('admin.pricing.rules.form.validity', 'Validity')}</InputLabel>
                <Select
                  value={servicePriceForm.validity || 'everyday'}
                  label={t('admin.pricing.rules.form.validity', 'Validity')}
                  onChange={e => setServicePriceForm(p => ({ ...p, validity: e.target.value as ServicePriceValidity }))}
                >
                  {(['everyday', 'weekdays', 'weekend', 'custom'] as ServicePriceValidity[]).map(v => (
                    <MenuItem key={v} value={v}>{v}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {servicePriceForm.validity === 'custom' && (
                <>
                  <TextField
                    type="date"
                    label={t('admin.pricing.rules.form.startDate', 'Start Date')}
                    value={servicePriceForm.startDate || ''}
                    onChange={e => setServicePriceForm(p => ({ ...p, startDate: e.target.value }))}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    type="date"
                    label={t('admin.pricing.rules.form.endDate', 'End Date')}
                    value={servicePriceForm.endDate || ''}
                    onChange={e => setServicePriceForm(p => ({ ...p, endDate: e.target.value }))}
                    InputLabelProps={{ shrink: true }}
                  />
                </>
              )}
              {servicePriceForm.category === 'guest' && (
                <TextField
                  label={t('admin.pricing.rules.form.guestEmail', 'Guest Email')}
                  value={servicePriceForm.guestEmail || ''}
                  onChange={e => setServicePriceForm(p => ({ ...p, guestEmail: e.target.value }))}
                  type="email"
                />
              )}
              {servicePriceForm.category === 'company' && (
                <Autocomplete
                  options={servicePriceCompanyOptions}
                  getOptionLabel={o => o.name}
                  value={servicePriceSelectedCompany}
                  inputValue={servicePriceCompanySearch}
                  onInputChange={(_, v) => setServicePriceCompanySearch(v)}
                  onChange={(_, v) => {
                    setServicePriceSelectedCompany(v);
                    setServicePriceForm(p => ({ ...p, companyId: v?._id }));
                  }}
                  renderInput={params => <TextField {...params} label={t('admin.pricing.rules.form.company', 'Company')} />}
                />
              )}
              <TextField
                label={t('admin.pricing.rules.form.adultPrice', 'Adult Price')}
                type="number"
                value={servicePriceForm.adultPrice ?? ''}
                onChange={e => setServicePriceForm(p => ({ ...p, adultPrice: e.target.value === '' ? '' as any : Number(e.target.value) }))}
                onBlur={e => { if (e.target.value === '') setServicePriceForm(p => ({ ...p, adultPrice: 0 })); }}
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                label={t('admin.pricing.rules.form.childrenPrice', 'Children Price')}
                type="number"
                value={servicePriceForm.childrenPrice ?? ''}
                onChange={e => setServicePriceForm(p => ({ ...p, childrenPrice: e.target.value === '' ? '' as any : Number(e.target.value) }))}
                onBlur={e => { if (e.target.value === '') setServicePriceForm(p => ({ ...p, childrenPrice: 0 })); }}
                inputProps={{ min: 0, step: 0.01 }}
              />
              <FormControlLabel
                control={<Switch checked={servicePriceForm.isActive ?? true} onChange={e => setServicePriceForm(p => ({ ...p, isActive: e.target.checked }))} />}
                label={t('admin.pricing.form.active')}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setServicePriceDialog(false)}>{t('admin.pricing.actions.cancel')}</Button>
            <Button variant="contained" onClick={saveServicePrice}>{t('admin.pricing.actions.save')}</Button>
          </DialogActions>
        </Dialog>

        {/* ── Auto-Charge Policies Tab ──────────────────────── */}
        <TabPanel value={tab} index={5}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('admin.pricing.chargePolicies.description', 'Define automatic charges that apply when specific events occur, such as late checkouts or no-shows.')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openNewChargePolicy}>
              {t('admin.pricing.chargePolicies.actions.new', 'New Policy')}
            </Button>
          </Box>
          {(chargeRulesLoading || chargeTemplatesLoading) ? <CircularProgress /> : (
            chargeRules.length === 0 ? (
              <Paper sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">{t('admin.pricing.chargePolicies.empty', 'No automatic charge policies configured.')}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  {t('admin.pricing.chargePolicies.emptyHint', 'Policies automatically charge guests for late checkouts, no-shows, and early departures.')}
                </Typography>
              </Paper>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {chargeRules.map(rule => {
                  const rawTmplId = typeof rule.chargeTemplateId === 'object' && rule.chargeTemplateId ? (rule.chargeTemplateId as any)._id : rule.chargeTemplateId;
                  const tmpl = chargeTemplates.find(tmplItem => tmplItem._id === rawTmplId) || (typeof rule.chargeTemplateId === 'object' && rule.chargeTemplateId ? rule.chargeTemplateId as unknown as ChargeTemplate : undefined);
                  const triggerSentence: Record<ChargeTrigger, string> = {
                    checkout_overdue: t('admin.pricing.chargePolicies.triggers.checkout_overdue', 'guest checks out late'),
                    no_show: t('admin.pricing.chargePolicies.triggers.no_show', 'guest never shows up'),
                    early_departure: t('admin.pricing.chargePolicies.triggers.early_departure', 'guest leaves before scheduled check-out'),
                  };
                  let chargeDesc = '—';
                  if (tmpl) {
                    if (tmpl.calculationMethod === 'fixed') chargeDesc = `$${Number(tmpl.amount).toFixed(2)}`;
                    else if (tmpl.calculationMethod === 'extra_night') chargeDesc = t('admin.pricing.chargePolicies.chargeDesc.extra_night', 'one additional night at nightly rate');
                    else if (tmpl.calculationMethod === 'percent_of_nightly_rate') chargeDesc = `${tmpl.amount}% ${t('admin.pricing.chargePolicies.chargeDesc.percent', 'of nightly rate')}`;
                  }
                  return (
                    <Paper key={rule._id} variant="outlined" sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle1" fontWeight={600}>{rule.name}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {t('admin.pricing.chargePolicies.summary', 'Charges {{chargeDesc}} when {{triggerSentence}}', { chargeDesc, triggerSentence: triggerSentence[rule.trigger] })}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                            {rule.conditions?.timeThresholdHours != null && (
                              <Chip size="small" variant="outlined" label={t('admin.pricing.chargePolicies.graceHours', '{{hours}}h grace period', { hours: rule.conditions.timeThresholdHours })} />
                            )}
                            {tmpl?.taxApplicable && (
                              <Chip size="small" variant="outlined" label={t('admin.pricing.chargePolicies.taxApplicable', 'Tax applicable')} />
                            )}
                            <Chip size="small" label={rule.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')} color={rule.isActive ? 'success' : 'default'} />
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <IconButton size="small" onClick={() => openEditChargePolicy(rule)}><EditIcon fontSize="small" /></IconButton>
                          <IconButton size="small" color="error" onClick={() => deleteChargePolicy(rule)}><DeleteIcon fontSize="small" /></IconButton>
                        </Box>
                      </Box>
                    </Paper>
                  );
                })}
              </Box>
            )
          )}
        </TabPanel>

        {/* ── Audit Log Tab ─────────────────────────────────── */}
        <TabPanel value={tab} index={6}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
            <Button variant="contained" onClick={() => handleRunAudit(false)} disabled={auditRunning}>
              {auditRunning ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
              {t('admin.pricing.auditLog.actions.run', 'Run Audit Now')}
            </Button>
            <Button variant="outlined" color="secondary" onClick={() => handleRunAudit(true)} disabled={auditRunning}>
              {t('admin.pricing.auditLog.actions.dryRun', 'Preview (Dry Run)')}
            </Button>
            <Button variant="outlined" onClick={fetchAuditExecutions} disabled={auditLoading}>
              {t('admin.pricing.auditLog.actions.refresh', 'Refresh')}
            </Button>
          </Box>
          {auditLastSummary && (
            <Box sx={{ mb: 2 }}>
              {auditLastSummary.map((s, i) => (
                <Alert key={i} severity={s.dryRun ? 'info' : 'success'} sx={{ mb: 1 }}>
                  {s.dryRun && <strong>{t('admin.pricing.auditLog.dryRunLabel', '[DRY RUN] ')}</strong>}
                  {t('admin.pricing.auditLog.summary', '{{chargesPosted}} charge(s) posted, {{skipped}} skipped, {{errors}} error(s) — {{rulesEvaluated}} rule(s) across {{reservationsScanned}} reservation(s)', { chargesPosted: s.chargesPosted, skipped: s.skipped, errors: s.errors, rulesEvaluated: s.rulesEvaluated, reservationsScanned: s.reservationsScanned })}
                </Alert>
              ))}
            </Box>
          )}

          {/* Audit Runs (run-level records) */}
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
            {t('admin.pricing.auditLog.runsTitle', 'Audit Runs')}
          </Typography>
          {auditLoading ? <CircularProgress sx={{ mb: 3 }} /> : (
            <TableContainer component={Paper} sx={{ mb: 4 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.pricing.auditLog.runs.businessDate', 'Business Date')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.runs.status', 'Status')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.runs.trigger', 'Triggered By')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.runs.dryRun', 'Dry Run')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.runs.charged', 'Charged')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.runs.skipped', 'Skipped')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.runs.errors', 'Errors')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.runs.duration', 'Duration')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {auditRuns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} align="center">
                        {t('admin.pricing.auditLog.runs.empty', 'No audit runs yet')}
                      </TableCell>
                    </TableRow>
                  ) : auditRuns.map(run => {
                    const durationMs = run.completedAt && run.startedAt
                      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
                      : null;
                    const durationStr = durationMs !== null
                      ? durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
                      : '—';
                    return (
                      <TableRow key={run._id}>
                        <TableCell>{run.businessDate}</TableCell>
                        <TableCell>
                          <Chip
                            label={run.status}
                            size="small"
                            color={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : run.status === 'running' ? 'warning' : 'default'}
                          />
                        </TableCell>
                        <TableCell>{run.triggeredBy}</TableCell>
                        <TableCell>{run.dryRun ? <Chip label="dry" size="small" variant="outlined" /> : '—'}</TableCell>
                        <TableCell>{run.summary?.chargesPosted ?? '—'}</TableCell>
                        <TableCell>{run.summary?.skipped ?? '—'}</TableCell>
                        <TableCell>{run.summary?.errors ?? '—'}</TableCell>
                        <TableCell>{durationStr}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Execution-level log */}
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
            {t('admin.pricing.auditLog.executionsTitle', 'Execution Log')}
          </Typography>
          {auditLoading ? <CircularProgress /> : (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.pricing.auditLog.columns.reservation', 'Reservation')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.columns.rule', 'Rule')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.columns.businessDate', 'Business Date')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.columns.status', 'Status')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.columns.executedAt', 'Executed At')}</TableCell>
                    <TableCell>{t('admin.pricing.auditLog.columns.error', 'Error')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {auditExecutions.map(ex => (
                    <TableRow key={ex._id}>
                      <TableCell>{typeof ex.reservationId === 'object' && ex.reservationId ? (ex.reservationId as any).code ?? ex.reservationId : ex.reservationId}</TableCell>
                      <TableCell>{typeof ex.chargeRuleId === 'object' && ex.chargeRuleId ? (ex.chargeRuleId as any).name ?? ex.chargeRuleId : ex.chargeRuleId}</TableCell>
                      <TableCell>{ex.businessDate}</TableCell>
                      <TableCell>
                        <Chip label={ex.status} size="small" color={ex.status === 'success' ? 'success' : ex.status === 'error' ? 'error' : 'default'} />
                      </TableCell>
                      <TableCell>{new Date(ex.executedAt).toLocaleString()}</TableCell>
                      <TableCell>{ex.errorMessage || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </TabPanel>

        {/* ── Charge Policy Dialog ─────────────────────────── */}
        <Dialog open={chargePolicyDialog} onClose={() => setChargePolicyDialog(false)} maxWidth="sm" fullWidth>
          <DialogTitle>
            {chargePolicyEditIds.ruleId
              ? t('admin.pricing.chargePolicies.dialog.edit', 'Edit Charge Policy')
              : t('admin.pricing.chargePolicies.dialog.new', 'New Charge Policy')}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>

              {/* When */}
              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('admin.pricing.chargePolicies.form.whenTitle', 'When should this charge apply?')}
                </Typography>
                <FormControl fullWidth>
                  <InputLabel>{t('admin.pricing.chargePolicies.form.trigger', 'Situation')}</InputLabel>
                  <Select
                    value={chargePolicyForm.trigger}
                    label={t('admin.pricing.chargePolicies.form.trigger', 'Situation')}
                    onChange={e => setChargePolicyForm(p => ({ ...p, trigger: e.target.value as ChargeTrigger }))}
                  >
                    <MenuItem value="checkout_overdue">{t('admin.pricing.chargePolicies.triggerOptions.checkout_overdue', 'Guest checks out late')}</MenuItem>
                    <MenuItem value="no_show">{t('admin.pricing.chargePolicies.triggerOptions.no_show', 'Guest never shows up')}</MenuItem>
                    <MenuItem value="early_departure">{t('admin.pricing.chargePolicies.triggerOptions.early_departure', 'Guest leaves before scheduled check-out')}</MenuItem>
                  </Select>
                </FormControl>
                {chargePolicyForm.trigger === 'checkout_overdue' && (
                  <TextField
                    fullWidth
                    sx={{ mt: 2 }}
                    label={t('admin.pricing.chargePolicies.form.graceHours', 'Charge after how many hours past checkout?')}
                    type="number"
                    value={chargePolicyForm.timeThresholdHours ?? ''}
                    onChange={e => setChargePolicyForm(p => ({ ...p, timeThresholdHours: e.target.value === '' ? undefined : Number(e.target.value) }))}
                    inputProps={{ min: 0, step: 1 }}
                    helperText={t('admin.pricing.chargePolicies.form.graceHoursHint', 'Leave blank to charge immediately at checkout time')}
                  />
                )}
              </Box>

              <Divider />

              {/* What to charge */}
              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('admin.pricing.chargePolicies.form.whatTitle', 'What should we charge?')}
                </Typography>
                <FormControl fullWidth>
                  <InputLabel>{t('admin.pricing.chargePolicies.form.chargeType', 'Charge type')}</InputLabel>
                  <Select
                    value={chargePolicyForm.calculationMethod}
                    label={t('admin.pricing.chargePolicies.form.chargeType', 'Charge type')}
                    onChange={e => setChargePolicyForm(p => ({ ...p, calculationMethod: e.target.value as CalculationMethod }))}
                  >
                    <MenuItem value="fixed">{t('admin.pricing.chargePolicies.form.chargeTypeFixed', 'Fixed amount')}</MenuItem>
                    <MenuItem value="extra_night">{t('admin.pricing.chargePolicies.form.chargeTypeExtraNight', 'One additional night at nightly rate')}</MenuItem>
                    <MenuItem value="percent_of_nightly_rate">{t('admin.pricing.chargePolicies.form.chargeTypePercent', 'Percentage of nightly rate')}</MenuItem>
                  </Select>
                </FormControl>
                {(chargePolicyForm.calculationMethod === 'fixed' || chargePolicyForm.calculationMethod === 'percent_of_nightly_rate') && (
                  <TextField
                    fullWidth
                    sx={{ mt: 2 }}
                    label={chargePolicyForm.calculationMethod === 'fixed'
                      ? t('admin.pricing.chargePolicies.form.amountFixed', 'Amount ($)')
                      : t('admin.pricing.chargePolicies.form.amountPercent', 'Percentage (%)')}
                    type="number"
                    value={chargePolicyForm.amount}
                    onChange={e => setChargePolicyForm(p => ({ ...p, amount: e.target.value }))}
                    inputProps={{ min: 0, step: chargePolicyForm.calculationMethod === 'fixed' ? 0.01 : 1 }}
                  />
                )}
                <FormControlLabel
                  sx={{ mt: 1 }}
                  control={<Switch checked={chargePolicyForm.taxApplicable} onChange={e => setChargePolicyForm(p => ({ ...p, taxApplicable: e.target.checked }))} />}
                  label={t('admin.pricing.chargePolicies.form.taxApplicable', 'Apply taxes to this charge')}
                />
              </Box>

              <Divider />

              {/* Name and status */}
              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('admin.pricing.chargePolicies.form.identifierTitle', 'Name and status')}
                </Typography>
                <TextField
                  fullWidth
                  label={t('admin.pricing.chargePolicies.form.name', 'Policy name')}
                  value={chargePolicyForm.name}
                  onChange={e => setChargePolicyForm(p => ({ ...p, name: e.target.value }))}
                  required
                  helperText={t('admin.pricing.chargePolicies.form.nameHint', 'A short name to identify this policy')}
                />
                <FormControlLabel
                  sx={{ mt: 1 }}
                  control={<Switch checked={chargePolicyForm.isActive} onChange={e => setChargePolicyForm(p => ({ ...p, isActive: e.target.checked }))} />}
                  label={t('admin.pricing.form.active')}
                />
              </Box>

            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setChargePolicyDialog(false)}>{t('admin.pricing.actions.cancel')}</Button>
            <Button variant="contained" onClick={saveChargePolicy}>{t('admin.pricing.actions.save')}</Button>
          </DialogActions>
        </Dialog>

      </Container>
    </AdminLayout>
  );
};

export default PriceManagement;
