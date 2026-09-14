import { UnitOfMeasureCode } from '../lib/unitsOfMeasure';

export interface Tenant {
  _id: string;
  name: string;
  slug: string;
  plan: 'basic' | 'pro' | 'enterprise';
  isActive: boolean;
  ownerEmail: string;
  settings: {
    language?: string;
    currency?: string;
    timezone?: string;
    logoUrl?: string;
    primaryColor?: string;
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}

/** Mirrors backend/src/constants/apps.ts APP_CODES — the products a tenant/user can be scoped to. */
export type AppCode = 'pms' | 'accounting';

/** One entry of `/auth/me`'s resolved `resolvedAppRoles`, per app the user has a role in. */
export interface ResolvedAppRole {
  roleId: string;
  roleName: string;
  permissions: string[];
  discountLimit?: number;
}

export interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  avatar?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  /** Raw per-app role assignments (unresolved role refs), at most one per app. */
  appRoles?: { app: AppCode; role: string }[];
  /** Tenant-level owner bypass — distinct from platform-level superadmin. */
  isSuperAdmin?: boolean;
  /** Joined role name + permissions per app, as returned by `GET /auth/me`. Absent on the raw login/register response. */
  resolvedAppRoles?: Partial<Record<AppCode, ResolvedAppRole>>;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  _id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  /** RNC for B2B e-CF (Factura de Crédito Fiscal E31) */
  rnc?: string;
  razonSocial?: string;
  createdAt: string;
  updatedAt: string;
}

/** Accounting AR customer (PILLOTO_ACCOUNTING_ARCHITECTURE.md §11 amendment) — a
 * dedicated model, distinct from the PMS-side `Company` above. `linkedCompanyId`
 * optionally bridges to a real PMS `Company` for a pre-approved direct-bill account. */
export interface Customer {
  _id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  rnc?: string;
  razonSocial?: string;
  linkedCompanyId?: string | Company;
  createdAt: string;
  updatedAt: string;
}

export interface RoomType {
  _id: string;
  name: string;
  capacity: number;
  image?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GuestCompanyLink {
  companyId: string | Company;
  autoApproveCorporateRate: boolean;
}

export interface Guest {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  notes?: string;
  companyLinks: GuestCompanyLink[];
  fiscalInfo?: {
    rnc?: string;
    cedula?: string;
    tipoId?: 'RNC' | 'Cedula' | 'Pasaporte' | 'Otro';
    razonSocial?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreditAccount {
  _id: string;
  scope: 'guest' | 'company';
  referenceId: string;
  creditLimit: number;
  currentExposure: number;
  status: 'active' | 'suspended';
  reference?: {
    _id: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Room {
  _id: string;
  name: string;
  type: 'standard' | 'deluxe' | 'suite' | 'villa';
  description: string;
  amenities: string[];
  bedConfiguration: string;
  images: string[];
  status: 'active' | 'inactive';
  condition: 'pending_cleanup' | 'clean';
  comment?: string;
  features?: {
    wifi: boolean;
    airConditioning: boolean;
    miniBar: boolean;
    balcony: boolean;
    oceanView: boolean;
    kitchenette: boolean;
    jacuzzi: boolean;
  };
  roomTypeId?: string | RoomType; // Optional link to a RoomType
  createdAt: string;
  updatedAt: string;
}

export interface Reservation {
  _id: string;
  reservationCode?: string;
  user?: string | User; // Optional for guest bookings

  // Guest identification (required when user is not logged in)
  guestName?: {
    firstName: string;
    lastName: string;
  };

  // Unique confirmation token for guest access
  confirmationToken?: string;

  // Reservation type - determines which fields are required
  type: 'room' | 'daypass' | 'PasaTarde' | 'event';

  // Room-specific fields (required for room reservations)
  room?: string | Room; // Specific room assigned by admin
  rooms?: Array<string | Room>; // Multiple rooms assigned
  roomType?: 'standard' | 'deluxe' | 'suite' | 'villa'; // For compatibility during transition

  // Event-specific fields (required for event reservations)
  eventType?: string;
  eventDescription?: string;
  expectedAttendees?: number;

  // Common date fields
  checkInDate: string;
  checkOutDate?: string; // Optional for day pass and some events
  actualCheckInAt?: string;
  actualCheckOutAt?: string;
  identificationDocument?: string;
  identificationType?: string;

  // Guest information
  guests: number;
  guestDetails: {
    adults: number;
    children: number;
    infants: number;
  };
  // Pricing and payment
  estimatedTotal: number;
  totalPrice?: number; // compatibility alias
  totalPayments?: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'checked-in' | 'completed';
  paymentMethod?: string;
  payments?: Payment[];

  // Contact and requests
  contactInfo: {
    phone: string;
    email: string;
    emergencyContact?: string;
    country?: string;
  };
  specialRequests?: string;

  // Calculated fields
  totalNights?: number; // For room reservations
  totalDays?: number; // For multi-day events

  // Administrative fields
  assignedBy?: string | User;
  assignedAt?: string;

  // Corporate booking
  isCorporate?: boolean;
  company?: string | Company;
  corporatePriceStatus?: 'pending' | 'approved' | 'declined';
  guestRecord?: string | Guest;

  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  _id?: string;
  folioId?: string;
  amount: number;
  method: 'cash' | 'card' | 'transfer' | 'credit' | 'check';
  status?: 'completed' | 'pending' | 'reversed';
  reference?: string;
  note?: string;
  createdAt: string;
  createdBy?: string | User;
}

export interface Charge {
  _id: string;
  folioId: string;
  description: string;
  amount: number;
  type?: 'base' | 'manual' | 'auto_rule';
  category?: 'room' | 'late_fee' | 'service' | 'damage' | 'adjustment';
  chargeTemplateId?: string;
  createdAt: string;
  updatedAt: string;
}

export type CalculationMethod = 'fixed' | 'extra_night' | 'percent_of_nightly_rate';
export type ChargeCategory = 'room' | 'late_fee' | 'service' | 'damage' | 'adjustment';
export type ChargeTrigger = 'checkout_overdue' | 'no_show' | 'early_departure';
export type ExecutionStatus = 'success' | 'skipped' | 'error';

export interface ChargeTemplate {
  _id?: string;
  name: string;
  descriptionTemplate: string;
  calculationMethod: CalculationMethod;
  amount: number;
  category: ChargeCategory;
  taxApplicable: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChargeRule {
  _id?: string;
  name: string;
  trigger: ChargeTrigger;
  priority: number;
  conditions: {
    timeThresholdHours?: number;
    reservationTypes?: Array<'room' | 'daypass' | 'PasaTarde' | 'event'>;
    roomTypeId?: string;
    dateStart?: string;
    dateEnd?: string;
  };
  chargeTemplateId: string | ChargeTemplate;
  multiplierOverride?: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChargeRuleExecution {
  _id?: string;
  chargeRuleId: string | ChargeRule;
  reservationId: string | Record<string, any>;
  businessDate: string;
  status: ExecutionStatus;
  chargeId?: string | Charge;
  errorMessage?: string;
  executedAt: string;
  createdAt?: string;
}

export type AuditRunStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface AuditRunSummary {
  rulesEvaluated: number;
  reservationsScanned: number;
  chargesPosted: number;
  skipped: number;
  errors: number;
}

export interface AuditRun {
  _id?: string;
  tenantId: string;
  businessDate: string;
  status: AuditRunStatus;
  triggeredBy: 'cron' | 'manual';
  dryRun: boolean;
  startedAt: string;
  completedAt?: string;
  summary?: AuditRunSummary;
  error?: string;
}

export interface MediaItem {
  _id: string;
  title: string;
  description?: string;
  url: string;
  type: 'image' | 'video';
  category: 'rooms' | 'aquapark' | 'facilities' | 'dining' | 'activities' | 'general';
  isPublic: boolean;
  isFeatured: boolean;
  tags: string[];
  uploadedBy: string | {
    _id: string;
    firstName: string;
    lastName: string;
  };
  fileSize: number;
  dimensions?: {
    width: number;
    height: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Amenity {
  _id: string;
  name: string;
  description: string;
  image: string;
  isActive: boolean;
  category: 'accommodation' | 'dining' | 'recreation' | 'wellness' | 'business' | 'general';
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventType {
  _id: string;
  type: string; // identifier e.g., 'wedding'
  title: string; // display name
  description?: string;
  features: string[];
  priceFrom: number;
  maxGuests: number;
  maxChildren: number;
  maxAdults?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WristbandDelivery {
  _id: string;
  date: string;
  type: 'delivery' | 'collection';
  deliveredBy?: string | User;
  recipient?: string;
  counts: {
    daypassAdults: number;
    daypassChildren: number;
    accommodations: number;
    pasatarde: number;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (userData: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
  permissions: string[];
  /** Max discount % the current user is allowed to apply (0 = none). Derived from their Role's discountLimit. */
  discountLimit: number;
  /** Joined role name + permissions per app (pms/accounting), from `GET /auth/me`. */
  resolvedAppRoles: Partial<Record<AppCode, ResolvedAppRole>>;
  refreshUser: () => Promise<void>;
}

export interface RegisterData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface SearchFilters {
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  roomType?: string;
  minPrice?: number;
  maxPrice?: number;
}

export interface BookingData {
  roomId: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  specialRequests?: string;
}

// ─── e-CF (Electronic Fiscal Invoicing) ──────────────────────────────────────

export type EcfAmbiente = 'Simulacion' | 'Pruebas' | 'Certificacion' | 'Produccion';

export type EcfTipo =
  | 'E31' | 'E32' | 'E33' | 'E34'
  | 'E41' | 'E43' | 'E44' | 'E45'
  | 'E46' | 'E47';

export type EcfEstadoECF =
  | 'Aceptado'
  | 'Aceptado Condicional'
  | 'Rechazado'
  | 'Error'
  | 'En Proceso'
  | 'Emitido Contingencia'
  | 'Pendiente';

export interface TenantEcfConfig {
  rnc: string;
  razonSocial: string;
  nombreComercial?: string;
  phone?: string;
  ambiente: EcfAmbiente;
  isActive: boolean;
  sucursal?: string;
  citrusBaseUrl: string;
  /** Never contains the actual token — backend returns this flag instead */
  hasToken: boolean;
}

export interface ElectronicInvoice {
  _id: string;
  tenantId: string;
  folioId?: string;
  paymentId?: string;
  reservationId?: string;
  invoiceId?: string;
  tipo: EcfTipo;
  eNCF: string;
  transaccionId: number;
  trackId: string;
  numeroFacturaInterna?: string;
  estadoECF: EcfEstadoECF;
  estatus: string;
  mensaje?: string;
  totalFactura: number;
  totalImpuestos: number;
  currency: string;
  buyerRnc?: string;
  buyerName?: string;
  buyerEmail?: string;
  lineItems?: Array<{
    description: string;
    qty: number;
    netPrice: number;
    itbisRate: number;
    itbisAmount: number;
    grossAmount: number;
  }>;
  tipoPago?: string;
  originalENCF?: string;
  codigoModificacion?: string;
  urlCodigoQr?: string;
  codigoSeguridad?: string;
  fechaFirmaDigital?: string;
  fechaVencimientoSecuencia?: string;
  generationSource: 'payment_screen' | 'manual' | 'credit_note' | 'debit_note' | 'accounting_invoice';
  issuedAt: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Phase 4: Reporting types ─────────────────────────────────────────────────

export interface EcfMonthlyTaxByTipo {
  tipo: EcfTipo;
  totalFactura: number;
  totalImpuestos: number;
  count: number;
}

export interface EcfMonthlyTaxRow {
  year: number;
  month: number;
  byTipo: EcfMonthlyTaxByTipo[];
  totalFactura: number;
  totalImpuestos: number;
  totalInvoices: number;
}

export interface EcfSequenceInfo {
  tipo: EcfTipo;
  latestENCF: string;
  latestIssuedAt: string;
  latestExpiry?: string;
  totalIssued: number;
  issuedThisMonth: number;
  lastEstadoECF: EcfEstadoECF;
}

// ─── Accounting: Inventory (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 4) ─

export interface Warehouse {
  _id: string;
  name: string;
  code: string;
  address?: string;
  isDefault: boolean;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductStockEntry {
  warehouse: string | Warehouse;
  onHandQty: number;
}

export interface Product {
  _id: string;
  name: string;
  sku: string;
  category?: string;
  unitOfMeasure: UnitOfMeasureCode;
  cost: number;
  defaultUnitPrice: number;
  onHandQty: number;
  reorderPoint: number;
  description?: string;
  isSellable: boolean;
  isPurchasable: boolean;
  notes?: string;
  isActive: boolean;
  stockByWarehouse?: ProductStockEntry[];
  createdAt: string;
  updatedAt: string;
}

export type InventoryTransactionType = 'purchase' | 'adjustment' | 'sale-deduction' | 'opening-balance';

// ─── Accounting: AR / Invoices (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5) ─

export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'void';
export type InvoicePaymentMethod = 'cash' | 'card' | 'transfer' | 'check' | 'credit';

export interface IndividualCustomer {
  name: string;
  email?: string;
  phone?: string;
}

export interface InvoiceLineItem {
  _id?: string;
  description: string;
  product?: string | Product;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  lineTotal: number;
  taxAmount: number;
  total: number;
}

export interface InvoicePayment {
  _id?: string;
  amount: number;
  method: InvoicePaymentMethod;
  date: string;
  reference?: string;
  recordedBy: string;
}

export type CityLedgerAuthorizationStatus = 'pending' | 'authorized' | 'declined';

export interface InvoiceCityLedger {
  sourceReservationId: string | { _id: string; reservationCode?: string; checkInDate?: string; checkOutDate?: string };
  sourceFolioId: string;
  preApproved: boolean;
  authorizationStatus: CityLedgerAuthorizationStatus;
  authorizedBy?: string;
  authorizedAt?: string;
  declinedReason?: string;
}

export interface Invoice {
  _id: string;
  invoiceNumber: string;
  customer?: string | Customer;
  isIndividual: boolean;
  individualCustomer?: IndividualCustomer;
  cityLedger?: InvoiceCityLedger;
  issueDate: string;
  dueDate?: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  payments: InvoicePayment[];
  amountPaid: number;
  balanceDue: number;
  status: InvoiceStatus;
  isOverdue: boolean;
  electronicInvoiceId?: string | ElectronicInvoice;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
// ─── Accounting: AR / Quotes (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5.3/5.4) ─

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';

export interface QuoteLineItem {
  _id?: string;
  description: string;
  product?: string | Product;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  lineTotal: number;
  taxAmount: number;
  total: number;
}

export interface Quote {
  _id: string;
  quoteNumber: string;
  customer?: string | Customer;
  isIndividual: boolean;
  individualCustomer?: IndividualCustomer;
  issueDate: string;
  expiryDate?: string;
  lineItems: QuoteLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  status: QuoteStatus;
  notes?: string;
  convertedInvoiceId?: string | Invoice;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Accounting: AR / Credit Notes (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 8) ─

export type CreditNoteStatus = 'draft' | 'issued' | 'partial' | 'closed' | 'void';
export type CreditNoteLineType = 'return' | 'allowance';
export type CreditNoteReason =
  | 'billing-error'
  | 'price-adjustment'
  | 'goods-returned'
  | 'service-not-rendered'
  | 'duplicate-charge'
  | 'goodwill'
  | 'other';
export type CreditNoteFiscalModificationCode = '1' | '2' | '3' | '4';
export type CreditNoteApplicationType = 'invoice' | 'refund';
export type CreditNoteRefundMethod = 'cash' | 'card' | 'transfer' | 'check' | 'other';

export interface CreditNoteLineItem {
  _id?: string;
  lineType: CreditNoteLineType;
  description: string;
  taxRate: number;
  lineTotal: number;
  taxAmount: number;
  total: number;
  // 'return' lines only:
  product?: string | Product;
  quantity?: number;
  unitPrice?: number;
  unitCost?: number;
}

export interface CreditNoteApplication {
  _id?: string;
  type: CreditNoteApplicationType;
  amount: number;
  invoice?: string | Invoice;
  method?: CreditNoteRefundMethod;
  reference?: string;
  note?: string;
  createdAt: string;
  createdBy: string;
}

export interface CreditNote {
  _id: string;
  creditNoteNumber: string;
  invoice: string | Invoice;
  customer?: string | Customer;
  isIndividual: boolean;
  individualCustomer?: IndividualCustomer;
  warehouse?: string | Warehouse;
  reason: CreditNoteReason;
  fiscalModificationCode: CreditNoteFiscalModificationCode;
  issueDate: string;
  status: CreditNoteStatus;
  lineItems: CreditNoteLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  applications: CreditNoteApplication[];
  amountApplied: number;
  remainingCredit: number;
  electronicInvoiceId?: string | ElectronicInvoice;
  notes?: string;
  voidedAt?: string;
  voidReason?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Accounting: AR / Debit Notes (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 8.3/8.4) ─
// Structurally closer to Invoice than to CreditNote — its own payments[] ledger and
// draft→issued→partial→paid→void lifecycle, no applications[]/apply/refund concept.

export type DebitNoteStatus = 'draft' | 'issued' | 'partial' | 'paid' | 'void';
export type DebitNoteReason = 'interest-on-overdue' | 'price-correction' | 'quantity-correction' | 'additional-charge' | 'other';
export type DebitNoteFiscalModificationCode = '1' | '2' | '3' | '4';
export type DebitNotePaymentMethod = 'cash' | 'card' | 'transfer' | 'check' | 'credit';

export interface DebitNoteLineItem {
  _id?: string;
  description: string;
  taxRate: number;
  lineTotal: number;
  taxAmount: number;
  total: number;
  product?: string | Product; // informational only — no quantity/stock semantics
}

export interface DebitNotePayment {
  _id?: string;
  amount: number;
  method: DebitNotePaymentMethod;
  date: string;
  reference?: string;
  recordedBy: string;
}

export interface DebitNote {
  _id: string;
  debitNoteNumber: string;
  invoice: string | Invoice;
  customer?: string | Customer;
  isIndividual: boolean;
  individualCustomer?: IndividualCustomer;
  reason: DebitNoteReason;
  fiscalModificationCode: DebitNoteFiscalModificationCode;
  issueDate: string;
  dueDate?: string;
  status: DebitNoteStatus;
  lineItems: DebitNoteLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  payments: DebitNotePayment[];
  amountPaid: number;
  balanceDue: number;
  isOverdue: boolean;
  electronicInvoiceId?: string | ElectronicInvoice;
  notes?: string;
  voidedAt?: string;
  voidReason?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Accounting: Chart of Accounts (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 3.1) ─

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type AccountNormalBalance = 'debit' | 'credit';

export interface Account {
  _id: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: AccountNormalBalance;
  parentAccount?: string | Account;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Accounting: General Ledger / Journal Entries (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 3.2/9.1) ─

export type JournalEntrySource =
  | 'manual'
  | 'invoice_sent' | 'invoice_payment' | 'invoice_void'
  | 'bill_received' | 'bill_payment' | 'bill_void'
  | 'credit_note_issue' | 'credit_note_refund' | 'credit_note_void'
  | 'debit_note_issue' | 'debit_note_payment' | 'debit_note_void';

export interface JournalEntryLine {
  _id?: string;
  account: string | Account;
  debit: number;
  credit: number;
  memo?: string;
}

export interface JournalEntry {
  _id: string;
  entryNumber: string;
  date: string;
  memo: string;
  source: JournalEntrySource;
  sourceModel?: 'JournalEntry' | 'Invoice' | 'Bill' | 'CreditNote' | 'DebitNote';
  sourceId?: string;
  lines: JournalEntryLine[];
  isVoid: boolean;
  voidedAt?: string;
  voidReason?: string;
  createdBy: string | { _id: string; name: string; email: string };
  createdAt: string;
  updatedAt: string;
}

// ─── Accounting: Financial Reports (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 9.2) ─
// Every shape below is a plain read model returned by `/api/accounting/reports/*` —
// computed live server-side, never persisted, so there is no corresponding backend model.

export interface TrialBalanceRow { account: Account; debit: number; credit: number }
export interface TrialBalanceReport {
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface ProfitAndLossLine { account: Account; amount: number }
export interface ProfitAndLossReport {
  from: string;
  to: string;
  revenue: ProfitAndLossLine[];
  totalRevenue: number;
  expenses: ProfitAndLossLine[];
  totalExpenses: number;
  netIncome: number;
}

export interface BalanceSheetLine { account: Account; balance: number }
export interface BalanceSheetReport {
  asOf: string;
  assets: BalanceSheetLine[];
  totalAssets: number;
  liabilities: BalanceSheetLine[];
  totalLiabilities: number;
  equity: BalanceSheetLine[];
  netIncomeToDate: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
}

export type AgingBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
export type AgingBuckets = Record<AgingBucketKey, number>;
export interface ApAgingRow { supplier: { _id: string; name: string }; buckets: AgingBuckets; total: number }
export interface ApAgingReport { asOf: string; rows: ApAgingRow[]; grandTotal: AgingBuckets; grandTotalSum: number }
export interface ArAgingRow { customer: { _id: string; name: string }; buckets: AgingBuckets; total: number }
export interface ArAgingReport { asOf: string; rows: ArAgingRow[]; grandTotal: AgingBuckets; grandTotalSum: number }

export interface StatementTransaction {
  date: string;
  type: 'bill' | 'invoice' | 'payment';
  reference: string;
  debit: number;
  credit: number;
  runningBalance: number;
}
export interface SupplierStatementReport {
  supplier: { _id: string; name: string; taxId?: string };
  from?: string; to?: string;
  openingBalance: number;
  transactions: StatementTransaction[];
  closingBalance: number;
}
export interface CustomerStatementReport {
  customer: { _id: string; name: string };
  from?: string; to?: string;
  openingBalance: number;
  transactions: StatementTransaction[];
  closingBalance: number;
}

export interface GeneralLedgerTransaction {
  entryNumber: string;
  date: string;
  memo: string;
  source: JournalEntrySource;
  debit: number;
  credit: number;
  runningBalance: number;
}
export interface GeneralLedgerReport {
  account: Account;
  from?: string; to?: string;
  openingBalance: number;
  transactions: GeneralLedgerTransaction[];
  closingBalance: number;
}

// ─── Accounting: AP / Supplier/Bill (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 6) ─

export interface Supplier {
  _id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  paymentTermsDays?: number;
  taxId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BillStatus = 'draft' | 'received' | 'partial' | 'paid' | 'void';
export type BillPaymentMethod = 'cash' | 'card' | 'transfer' | 'check' | 'other';
export type BillLineType = 'inventory' | 'expense';

export interface BillLineItem {
  _id?: string;
  lineType: BillLineType;
  description: string;
  taxRate: number;
  lineTotal: number;
  taxAmount: number;
  total: number;
  // inventory lines only:
  product?: string | Product;
  purchaseUnitOfMeasure?: UnitOfMeasureCode;
  purchaseQuantity?: number;
  purchaseUnitCost?: number;
  stockUnitOfMeasure?: UnitOfMeasureCode;
  stockQuantity?: number;
  unitCost?: number;
  // expense lines only:
  account?: string | Account;
}

export interface BillPayment {
  _id?: string;
  amount: number;
  method: BillPaymentMethod;
  date: string;
  reference?: string;
  recordedBy: string;
}

export interface Bill {
  _id: string;
  billNumber: string;
  supplier: string | Supplier;
  warehouse?: string | Warehouse;
  vendorInvoiceNumber?: string;
  issueDate: string;
  dueDate: string;
  status: BillStatus;
  lineItems: BillLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  payments: BillPayment[];
  amountPaid: number;
  balanceDue: number;
  notes?: string;
  isOverdue: boolean;
  voidedAt?: string;
  voidReason?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type InventoryAdjustmentReason = 'count-correction' | 'damaged' | 'lost' | 'theft' | 'other';

export interface InventoryTransaction {
  _id: string;
  product: string | Product;
  warehouse: string | Warehouse;
  type: InventoryTransactionType;
  quantityDelta: number;
  balanceAfter: number;
  unitCost?: number;
  reason?: InventoryAdjustmentReason;
  notes?: string;
  recordedBy: string | { _id: string; firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
}

