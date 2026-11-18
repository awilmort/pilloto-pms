/**
 * DGII codes and formats used by the purchases report (Formato 606, Norma General 07-2018) and the
 * withholding fields of a bill.
 */

/** 606 "Tipo de bienes y servicios comprados". */
export const EXPENSE_TYPES = {
  '01': 'Gastos de personal',
  '02': 'Gastos por trabajos, suministros y servicios',
  '03': 'Arrendamientos',
  '04': 'Gastos de activos fijos',
  '05': 'Gastos de representación',
  '06': 'Otras deducciones admitidas',
  '07': 'Gastos financieros',
  '08': 'Gastos extraordinarios',
  '09': 'Compras y gastos que formarán parte del costo de venta',
  '10': 'Adquisiciones de activos',
  '11': 'Gastos de seguros',
} as const;
export type ExpenseType = keyof typeof EXPENSE_TYPES;
export const EXPENSE_TYPE_CODES = Object.keys(EXPENSE_TYPES) as ExpenseType[];

/** 606 "Tipo de retención en ISR". */
export const ISR_WITHHOLDING_TYPES = {
  '1': 'Alquileres',
  '2': 'Honorarios por servicios',
  '3': 'Otras rentas',
  '4': 'Otras rentas (rentas presuntas)',
  '5': 'Intereses pagados a personas jurídicas',
  '6': 'Intereses pagados a personas físicas',
  '7': 'Retención por proveedores del Estado',
  '8': 'Juegos telefónicos',
} as const;
export type IsrWithholdingType = keyof typeof ISR_WITHHOLDING_TYPES;
export const ISR_WITHHOLDING_CODES = Object.keys(ISR_WITHHOLDING_TYPES) as IsrWithholdingType[];

/** 606 "Forma de pago". */
export const PAYMENT_FORMS = {
  '01': 'Efectivo',
  '02': 'Cheques/Transferencias/Depósito',
  '03': 'Tarjeta crédito/débito',
  '04': 'Compra a crédito',
  '05': 'Permuta',
  '06': 'Notas de crédito',
  '07': 'Mixto',
} as const;
export type PaymentForm = keyof typeof PAYMENT_FORMS;

/**
 * A comprobante number: series B (B + type + 8 digits, 11 characters) or an e-CF (E + type + 10
 * digits, 13 characters).
 */
export const NCF_PATTERN = /^(B\d{2}\d{8}|E\d{2}\d{10})$/;
export const normalizeNcf = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\s-]/g, '').toUpperCase() : '');
export const isNcf = (v: string): boolean => NCF_PATTERN.test(v);

/** 1: RNC (9 digits), 2: cédula (11 digits); null when the id is neither. */
export function taxIdType(taxId?: string | null): 1 | 2 | null {
  const digits = (taxId ?? '').replace(/\D/g, '');
  if (digits.length === 9) return 1;
  if (digits.length === 11) return 2;
  return null;
}
