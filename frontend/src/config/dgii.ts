/** DGII codes the purchases screens use — mirror of backend/src/constants/dgii.ts. */

export const EXPENSE_TYPES: Record<string, string> = {
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
};

export const ISR_WITHHOLDING_TYPES: Record<string, string> = {
  '1': 'Alquileres',
  '2': 'Honorarios por servicios',
  '3': 'Otras rentas',
  '4': 'Otras rentas (rentas presuntas)',
  '5': 'Intereses pagados a personas jurídicas',
  '6': 'Intereses pagados a personas físicas',
  '7': 'Retención por proveedores del Estado',
  '8': 'Juegos telefónicos',
};

export const PAYMENT_FORMS: Record<string, string> = {
  '01': 'Efectivo', '02': 'Cheque/Transferencia/Depósito', '03': 'Tarjeta', '04': 'Crédito', '05': 'Permuta', '06': 'Nota de crédito', '07': 'Mixto',
};

export const normalizeNcf = (v: string): string => v.replace(/[\s-]/g, '').toUpperCase();
export const isNcf = (v: string): boolean => /^(B\d{2}\d{8}|E\d{2}\d{10})$/.test(v);
export const normalizeTaxId = (v: string): string => v.replace(/[\s-]/g, '');
export const isTaxId = (v: string): boolean => /^\d{9}$|^\d{11}$/.test(v);
/** 11 digits: a cédula — an individual. */
export const isCedula = (v?: string): boolean => /^\d{11}$/.test(normalizeTaxId(v ?? ''));

/**
 * Usual withholdings when a company pays an individual (cédula) for services: 100% of the ITBIS
 * and 10% ISR (Norma 02-05, Código Tributario art. 309). A suggestion the user confirms — the
 * accountant decides each case.
 */
export function suggestedWithholdings(supplierTaxId: string | undefined, subtotal: number, itbis: number) {
  if (!isCedula(supplierTaxId)) return null;
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return { itbisWithheld: r2(itbis), isrWithheld: r2(subtotal * 0.1), isrWithholdingType: '2' };
}
