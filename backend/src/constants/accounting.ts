import { AccountType, AccountNormalBalance } from '../models/Account';

/**
 * Assets/expenses carry a debit normal balance; liabilities/equity/revenue carry
 * credit — standard double-entry convention. Derived here (never entered by the
 * user) so `Account.normalBalance` can never drift out of sync with `Account.type`.
 */
export const NORMAL_BALANCE_BY_ACCOUNT_TYPE: Record<AccountType, AccountNormalBalance> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
};

/**
 * Default Chart of Accounts. Seeded idempotently per tenant at
 * Accounting-provisioning time (see `provisionTenant.ts`).
 * `parentCode` (not an ObjectId, since seeding is order-independent) is resolved to
 * the parent's `_id` at seed time.
 */
export interface DefaultAccountDefinition {
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
}

/**
 * Well-known account codes that auto-posting hooks look up by code —
 * never by a hardcoded ObjectId.
 */
export const SYSTEM_ACCOUNT_CODES = {
  CASH: '1000',
  BANK: '1010',
  ACCOUNTS_RECEIVABLE: '1100',
  INVENTORY: '1200',
  ACCOUNTS_PAYABLE: '2000',
  SALES_TAX_PAYABLE: '2100',
  RETAINED_EARNINGS: '3900',
  SALES_REVENUE: '4000',
  SALES_RETURNS_AND_ALLOWANCES: '4100',
  OTHER_REVENUE: '4200',
  COST_OF_GOODS_SOLD: '5000',
  /** Nets both cash overages (credited) and shortages (debited) found at
   *  CashierClosure time; a single account is the standard bookkeeping convention for this. */
  CASH_OVER_SHORT: '6070',
} as const;

// Names are Spanish/Dominican-market terms (e.g. "ITBIS" — DR's VAT — not a generic
// "sales tax"), matching how the tenant-facing product and DGII e-CF flow are already
// localized.
export const DEFAULT_CHART_OF_ACCOUNTS: DefaultAccountDefinition[] = [
  { code: '1000', name: 'Caja', type: 'asset' },
  { code: '1010', name: 'Bancos', type: 'asset' },
  { code: '1100', name: 'Cuentas por Cobrar', type: 'asset' },
  { code: '1200', name: 'Inventario', type: 'asset' },
  { code: '2000', name: 'Cuentas por Pagar', type: 'liability' },
  { code: '2100', name: 'ITBIS por Pagar', type: 'liability' },
  { code: '3000', name: 'Capital del Propietario', type: 'equity' },
  { code: '3900', name: 'Utilidades Retenidas', type: 'equity' },
  { code: '4000', name: 'Ingresos por Ventas', type: 'revenue' },
  // Contra-revenue: typed 'revenue' but debit-heavy in practice, so it nets against
  // 4000 in the P&L's revenue-sum logic (credit - debit), without any special-casing.
  { code: '4100', name: 'Devoluciones y Descuentos en Ventas', type: 'revenue' },
  // Mirror of 4100 on the positive side: where a DebitNote's issue() posts recovered
  // costs/interest/corrections — kept distinct from 4000 so ad hoc
  // recoveries never inflate reported sales revenue.
  { code: '4200', name: 'Otros Ingresos', type: 'revenue' },
  { code: '5000', name: 'Costo de Ventas', type: 'expense' },
  { code: '6000', name: 'Gastos Operativos', type: 'expense' },
  { code: '6010', name: 'Alquiler', type: 'expense', parentCode: '6000' },
  { code: '6020', name: 'Servicios Básicos', type: 'expense', parentCode: '6000' },
  { code: '6030', name: 'Sueldos y Salarios', type: 'expense', parentCode: '6000' },
  { code: '6040', name: 'Fletes y Envíos', type: 'expense', parentCode: '6000' },
  // CashierClosure hook: debited for a shortage, credited for an overage —
  // see SYSTEM_ACCOUNT_CODES.CASH_OVER_SHORT.
  { code: '6070', name: 'Sobrante/Faltante de Caja', type: 'expense', parentCode: '6000' },
  { code: '6090', name: 'Otros Gastos', type: 'expense', parentCode: '6000' },
];
