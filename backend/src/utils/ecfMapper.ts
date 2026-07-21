/**
 * ecfMapper.ts — Maps Pilloto folio/charge/payment data to Citrus e-CF API payloads.
 *
 * Supports:
 *   - E32 (Factura de Consumo) — B2C, individual guests without RNC
 *   - E31 (Factura de Crédito Fiscal) — B2B, buyers with RNC
 *   - E34 (Nota de Crédito) — credit notes referencing E31/E32
 *   - E33 (Nota de Débito) — debit notes referencing E31/E32
 *   - E41 (Comprobante de Compras) — purchases from non-registered contributors
 *   - E43 (Gastos Menores) — petty cash / minor expenses
 *   - E44/E45 (Regímenes Especiales / Gubernamental)
 *   - E46 (Exportaciones) — foreign sales
 *   - E47 (Pagos al Exterior) — payments to foreign entities
 *
 * Tax assumption: charge amounts are GROSS (tax-inclusive at 18% ITBIS).
 *   Net amount per item = grossAmount / 1.18
 *   ITBIS per item     = netAmount * 0.18
 *   totalFactura       = sum of gross amounts
 *   totalImpuestos     = sum of ITBIS amounts
 *
 * Citrus API payload structure (flat — no 'e-CF' wrapper, no IdDoc/Emisor/Totales):
 *   {
 *     Fecha,                   // YYYY-MM-DD (required)
 *     NumeroFacturaInterna?,
 *     Encabezado,              // flat: TipoIngresos, IndicadorMontoGravado, TipoPago, Comprador?
 *     DetalleBienesOServicios, // item array (NOT DetallesItems.Item)
 *     InformacionReferencia?,  // top-level for E34/E33 (NOT inside Encabezado)
 *     totalFactura,            // required top-level
 *     totalImpuestos,          // required top-level
 *   }
 */

import { IFolio } from '../models/Folio';
import { ICharge } from '../models/Charge';
import { IPayment, PaymentMethod } from '../models/Payment';
import { IGuest } from '../models/Guest';
import { ICompany } from '../models/Company';
import { ITenant } from '../models/Tenant';

// ─── Citrus API payload type definitions ─────────────────────────────────────

export interface CitrusItem {
  NumeroLinea: number;
  /** 1 = normal detail line */
  IndicadorFacturacion: number;
  NombreItem: string;
  /** '1' = bienes, '2' = servicios */
  IndicadorBienoServicio: '1' | '2';
  CantidadItem: number;
  /** 4 = service unit */
  UnidadMedida: number;
  /** Net price excluding ITBIS (when IndicadorMontoGravado = "0") */
  PrecioUnitarioItem: number;
  DescuentoMonto: number;
  MontoItem: number;
  /** ITBIS rate percentage (e.g. 18). Required for taxable items. */
  TasaITBIS?: number;
  /** 1 = item is exempt from ITBIS */
  IndicadorExento?: number;
}

interface CitrusFlatEncabezado {
  /** Required for E31, E33, E34, E41, E43, E44, E45, E46, E47. Omit for E32. */
  TipoeCF?: string;
  /** "01" = income from operations */
  TipoIngresos?: string;
  /** "0" = item prices exclude tax (net); "1" = include tax */
  IndicadorMontoGravado?: string;
  /** "1"=cash, "2"=credit, "3"=card, "4"=transfer, "5"=check, "6"=mixed */
  TipoPago?: string;
  /** For E34 only: "0" */
  IndicadorNotaCredito?: string;
  Comprador?: {
    RNCComprador?: string;
    RazonSocialComprador?: string;
    NombreComprador?: string;
    CorreoComprador?: string;
  };
  CompradorExtranjero?: {
    NombreCompradorExtranjero: string;
    CodigoPaisCompradorExtranjero: string;
  };
}

/** Correct flat Citrus API payload — all invoice types share this structure */
interface CitrusFlatPayload {
  /** Invoice date in YYYY-MM-DD format (required) */
  Fecha: string;
  NumeroFacturaInterna?: string;
  Encabezado: CitrusFlatEncabezado;
  DetalleBienesOServicios: CitrusItem[];
  /** Top-level reference block for E34/E33 (NOT inside Encabezado) */
  InformacionReferencia?: {
    NCFModificado: string;
    RNCOtroContribuyente?: string;
    /** Date of the original invoice being modified (ISO format YYYY-MM-DD or datetime) */
    FechaNCFModificado?: string;
    CodigoModificacion: string;
    RazonModificacion?: string;
  };
  totalFactura: number;
  totalImpuestos: number;
}

export type CitrusE32Payload = CitrusFlatPayload;
export type CitrusE31Payload = CitrusFlatPayload;
export type CitrusE34Payload = CitrusFlatPayload;
export type CitrusE33Payload = CitrusFlatPayload;
export type CitrusE41Payload = CitrusFlatPayload;
export type CitrusE43Payload = CitrusFlatPayload;
export type CitrusE44Payload = CitrusFlatPayload;
export type CitrusE45Payload = CitrusFlatPayload;
export type CitrusE46Payload = CitrusFlatPayload;
export type CitrusE47Payload = CitrusFlatPayload;

// ─── Buyer info passed from the route ────────────────────────────────────────

export interface EcfBuyerInfo {
  rnc?: string;
  name?: string;
  email?: string;
  /** Legal name (for E31) */
  razonSocial?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const ITBIS_RATE = 0.18;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Returns today's date formatted as YYYY-MM-DD for the Citrus Fecha field. */
function getTodayFecha(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Map Pilloto PaymentMethod to DGII TipoPago code (string, per Citrus API spec).
 *
 * DGII codes:
 *  "1" = Efectivo (Cash)
 *  "2" = Crédito
 *  "3" = Tarjeta Débito/Crédito (Card)
 *  "4" = Cuenta Corriente / Transferencia
 *  "5" = Cheque
 *  "6" = Mixto (if multiple methods detected)
 */
function mapTipoPago(payments: IPayment[]): string {
  const activeMethods = [...new Set(
    payments
      .filter(p => p.status !== 'reversed')
      .map(p => p.method as PaymentMethod),
  )];

  if (activeMethods.length > 1) return '6'; // Pagos mixtos

  const method = activeMethods[0];
  switch (method) {
    case 'cash':     return '1';
    case 'credit':   return '2';
    case 'card':     return '3';
    case 'transfer': return '4';
    case 'check':    return '5';
    default:         return '1';
  }
}

function buildItems(charges: ICharge[]): {
  items: CitrusItem[];
  grossTotal: number;
  itbisTotal: number;
} {
  let grossTotal = 0;
  let itbisTotal = 0;

  const items: CitrusItem[] = charges.map((charge, idx) => {
    const gross = charge.amount;
    const net = round2(gross / (1 + ITBIS_RATE));
    const itbis = round2(net * ITBIS_RATE);

    grossTotal += gross;
    itbisTotal += itbis;

    return {
      NumeroLinea: idx + 1,
      IndicadorFacturacion: 1,
      NombreItem: charge.description.slice(0, 200),
      IndicadorBienoServicio: '2', // All hotel charges are services
      CantidadItem: 1.00,
      UnidadMedida: 4,
      PrecioUnitarioItem: net,
      DescuentoMonto: 0.00,
      MontoItem: net,
      TasaITBIS: 18,
    };
  });

  return {
    items,
    grossTotal: round2(grossTotal),
    itbisTotal: round2(itbisTotal),
  };
}

function internalRef(
  folio: IFolio,
  reservation?: { reservationCode?: string } | null,
): string | undefined {
  if (reservation?.reservationCode) return reservation.reservationCode;
  return `FOLIO-${String(folio._id).slice(-6).toUpperCase()}`;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export class EcfMapperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcfMapperError';
  }
}

function validateCommonPreconditions(
  tenant: ITenant,
  charges: ICharge[],
): void {
  if (!tenant.ecfConfig) {
    throw new EcfMapperError('Tenant has no e-CF configuration');
  }
  if (!tenant.ecfConfig.citrusToken) {
    throw new EcfMapperError('Tenant e-CF token is not configured');
  }
  if (!tenant.ecfConfig.isActive) {
    throw new EcfMapperError('e-CF invoicing is disabled for this tenant');
  }
  if (charges.length === 0) {
    throw new EcfMapperError('No charges on this folio — cannot generate invoice');
  }
  const total = charges.reduce((sum, c) => sum + c.amount, 0);
  if (total <= 0) {
    throw new EcfMapperError('Total charges must be greater than zero');
  }
}

// ─── Public mappers ───────────────────────────────────────────────────────────

/**
 * Map folio data to a Citrus E32 (Factura de Consumo) payload.
 * Use for B2C sales — individual guests without RNC.
 * Sent to POST /api/v1/FacturaConsumo.
 */
export function mapToFacturaConsumo(
  folio: IFolio,
  charges: ICharge[],
  payments: IPayment[],
  buyer: EcfBuyerInfo,
  tenant: ITenant,
  reservation?: { reservationCode?: string } | null,
): CitrusE32Payload {
  validateCommonPreconditions(tenant, charges);

  const { items, grossTotal, itbisTotal } = buildItems(charges);
  const tipoPago = mapTipoPago(payments);

  const comprador: CitrusFlatEncabezado['Comprador'] = {};
  if (buyer.name) comprador.NombreComprador = buyer.name;
  if (buyer.email) comprador.CorreoComprador = buyer.email;
  // E32 can optionally carry RNC if the buyer provides one
  if (buyer.rnc) comprador.RNCComprador = buyer.rnc;

  return {
    Fecha: getTodayFecha(),
    NumeroFacturaInterna: internalRef(folio, reservation),
    Encabezado: {
      TipoIngresos: '01',
      IndicadorMontoGravado: '0',
      TipoPago: tipoPago,
      ...(Object.keys(comprador).length > 0 ? { Comprador: comprador } : {}),
    },
    DetalleBienesOServicios: items,
    totalFactura: grossTotal,
    totalImpuestos: itbisTotal,
  };
}

/**
 * Map folio data to a Citrus E31 (Factura de Crédito Fiscal) payload.
 * Use for B2B sales — buyers with RNC.
 * Sent to POST /api/v1/Facturas.
 */
export function mapToFacturaCreditoFiscal(
  folio: IFolio,
  charges: ICharge[],
  payments: IPayment[],
  buyer: EcfBuyerInfo,
  tenant: ITenant,
  reservation?: { reservationCode?: string } | null,
): CitrusE31Payload {
  validateCommonPreconditions(tenant, charges);

  if (!buyer.rnc) {
    throw new EcfMapperError(
      "E31 (Factura de Crédito Fiscal) requires the buyer's RNC",
    );
  }

  const { items, grossTotal, itbisTotal } = buildItems(charges);
  const tipoPago = mapTipoPago(payments);

  return {
    Fecha: getTodayFecha(),
    NumeroFacturaInterna: internalRef(folio, reservation),
    Encabezado: {
      TipoeCF: '31',
      TipoIngresos: '01',
      IndicadorMontoGravado: '0',
      TipoPago: tipoPago,
      Comprador: {
        RNCComprador: buyer.rnc,
        ...(buyer.razonSocial ? { RazonSocialComprador: buyer.razonSocial } : {}),
        ...(buyer.name ? { NombreComprador: buyer.name } : {}),
        ...(buyer.email ? { CorreoComprador: buyer.email } : {}),
      },
    },
    DetalleBienesOServicios: items,
    totalFactura: grossTotal,
    totalImpuestos: itbisTotal,
  };
}

/**
 * Infer buyer info from guest record (for auto-filling the modal).
 * Prefers RNC → maps to E31; falls back to cédula/name only → maps to E32.
 */
export function inferBuyerFromGuest(guest: IGuest): EcfBuyerInfo {
  const fiscal = guest.fiscalInfo;
  return {
    rnc: fiscal?.rnc,
    name: `${guest.firstName} ${guest.lastName}`.trim(),
    email: guest.email,
    razonSocial: fiscal?.razonSocial,
  };
}

/**
 * Infer buyer info from a company record (for E31, B2B).
 */
export function inferBuyerFromCompany(company: ICompany): EcfBuyerInfo {
  return {
    rnc: company.rnc,
    name: company.name,
    razonSocial: company.razonSocial || company.name,
  };
}

// ─── Phase 3: Credit & Debit Note types and mappers ──────────────────────────

/**
 * Código de Modificación for E34 (Nota de Crédito):
 *  '1' = Anulación (full cancellation)
 *  '2' = Corrección de Precio / Error
 *  '3' = Devolución (return of goods/services)
 *  '4' = Descuentos / Bonificaciones
 *  '5' = Otros
 */
export type CodigoModificacion = '1' | '2' | '3' | '4' | '5';

export interface NoteItem {
  description: string;
  amount: number;
}

/** Minimal invoice reference needed to build credit/debit note payloads */
export interface OriginalInvoiceRef {
  eNCF: string;
  tipo: string;
  buyerRnc?: string;
  buyerName?: string;
  buyerEmail?: string;
  /** Issue date of the original invoice (for FechaNCFModificado in InformacionReferencia) */
  issuedAt?: Date | string;
}

/**
 * Build line items from a NoteItem array for E34/E33 credit and debit notes.
 * All amounts are treated as gross (ITBIS-inclusive).
 */
function buildNoteItems(items: NoteItem[]): {
  citrusItems: CitrusItem[];
  grossTotal: number;
  itbisTotal: number;
} {
  let grossTotal = 0;
  let itbisTotal = 0;

  const citrusItems: CitrusItem[] = items.map((item, idx) => {
    const gross = item.amount;
    const net = round2(gross / (1 + ITBIS_RATE));
    const itbis = round2(net * ITBIS_RATE);

    grossTotal += gross;
    itbisTotal += itbis;

    return {
      NumeroLinea: idx + 1,
      IndicadorFacturacion: 1,
      NombreItem: item.description.slice(0, 200),
      IndicadorBienoServicio: '2',
      CantidadItem: 1.00,
      UnidadMedida: 4,
      PrecioUnitarioItem: net,
      DescuentoMonto: 0.00,
      MontoItem: net,
      TasaITBIS: 18,
    };
  });

  return {
    citrusItems,
    grossTotal: round2(grossTotal),
    itbisTotal: round2(itbisTotal),
  };
}

/**
 * Map an original invoice + reason/items to a Citrus E34 (Nota de Crédito) payload.
 *
 * @param originalInvoice - Reference info from the original E31/E32
 * @param codigoModificacion - DGII modification code ('1'–'5')
 * @param razonModificacion - Free-text reason for the credit note
 * @param items - Line items being credited (each with description + gross amount)
 * @param tenant - Current tenant (for emisor fields + validation)
 */
export function mapToNotaCredito(
  originalInvoice: OriginalInvoiceRef,
  codigoModificacion: CodigoModificacion,
  razonModificacion: string,
  items: NoteItem[],
  tenant: ITenant,
): CitrusE34Payload {
  if (!tenant.ecfConfig) {
    throw new EcfMapperError('Tenant has no e-CF configuration');
  }
  if (!tenant.ecfConfig.citrusToken) {
    throw new EcfMapperError('Tenant e-CF token is not configured');
  }
  if (!tenant.ecfConfig.isActive) {
    throw new EcfMapperError('e-CF invoicing is disabled for this tenant');
  }
  if (items.length === 0) {
    throw new EcfMapperError('At least one item is required for a credit note');
  }
  const total = items.reduce((s, i) => s + i.amount, 0);
  if (total <= 0) {
    throw new EcfMapperError('Total amount must be greater than zero');
  }
  if (!razonModificacion?.trim()) {
    throw new EcfMapperError('Reason (razonModificacion) is required for a credit note');
  }

  const { citrusItems, grossTotal, itbisTotal } = buildNoteItems(items);

  const comprador: CitrusFlatEncabezado['Comprador'] = {};
  if (originalInvoice.buyerRnc) comprador.RNCComprador = originalInvoice.buyerRnc;
  if (originalInvoice.buyerName) comprador.NombreComprador = originalInvoice.buyerName;
  if (originalInvoice.buyerEmail) comprador.CorreoComprador = originalInvoice.buyerEmail;

  return {
    Fecha: getTodayFecha(),
    Encabezado: {
      TipoIngresos: '01',
      IndicadorMontoGravado: '0',
      TipoPago: '1',
      IndicadorNotaCredito: '0',
      ...(Object.keys(comprador).length > 0 ? { Comprador: comprador } : {}),
    },
    DetalleBienesOServicios: citrusItems,
    InformacionReferencia: {
      NCFModificado: originalInvoice.eNCF,
      ...(originalInvoice.buyerRnc ? { RNCOtroContribuyente: originalInvoice.buyerRnc } : {}),
      ...(originalInvoice.issuedAt ? { FechaNCFModificado: new Date(originalInvoice.issuedAt).toISOString().slice(0, 10) } : {}),
      CodigoModificacion: codigoModificacion,
      RazonModificacion: razonModificacion.trim().slice(0, 500),
    },
    totalFactura: grossTotal,
    totalImpuestos: itbisTotal,
  };
}

/**
 * Map an original invoice + additional charges to a Citrus E33 (Nota de Débito) payload.
 *
 * @param originalInvoice - Reference info from the original E31/E32
 * @param razonModificacion - Free-text reason (e.g. "Late checkout fee")
 * @param items - Additional line items being billed (each with description + gross amount)
 * @param tenant - Current tenant
 */
export function mapToNotaDebito(
  originalInvoice: OriginalInvoiceRef,
  razonModificacion: string,
  items: NoteItem[],
  tenant: ITenant,
): CitrusE33Payload {
  if (!tenant.ecfConfig) {
    throw new EcfMapperError('Tenant has no e-CF configuration');
  }
  if (!tenant.ecfConfig.citrusToken) {
    throw new EcfMapperError('Tenant e-CF token is not configured');
  }
  if (!tenant.ecfConfig.isActive) {
    throw new EcfMapperError('e-CF invoicing is disabled for this tenant');
  }
  if (items.length === 0) {
    throw new EcfMapperError('At least one item is required for a debit note');
  }
  const total = items.reduce((s, i) => s + i.amount, 0);
  if (total <= 0) {
    throw new EcfMapperError('Total amount must be greater than zero');
  }
  if (!razonModificacion?.trim()) {
    throw new EcfMapperError('Reason (razonModificacion) is required for a debit note');
  }

  const { citrusItems, grossTotal, itbisTotal } = buildNoteItems(items);

  const comprador: CitrusFlatEncabezado['Comprador'] = {};
  if (originalInvoice.buyerRnc) comprador.RNCComprador = originalInvoice.buyerRnc;
  if (originalInvoice.buyerName) comprador.NombreComprador = originalInvoice.buyerName;
  if (originalInvoice.buyerEmail) comprador.CorreoComprador = originalInvoice.buyerEmail;

  return {
    Fecha: getTodayFecha(),
    Encabezado: {
      TipoIngresos: '01',
      IndicadorMontoGravado: '0',
      TipoPago: '1',
      ...(Object.keys(comprador).length > 0 ? { Comprador: comprador } : {}),
    },
    DetalleBienesOServicios: citrusItems,
    InformacionReferencia: {
      NCFModificado: originalInvoice.eNCF,
      ...(originalInvoice.buyerRnc ? { RNCOtroContribuyente: originalInvoice.buyerRnc } : {}),
      ...(originalInvoice.issuedAt ? { FechaNCFModificado: new Date(originalInvoice.issuedAt).toISOString().slice(0, 10) } : {}),
      CodigoModificacion: '1',
      RazonModificacion: razonModificacion.trim().slice(0, 500),
    },
    totalFactura: grossTotal,
    totalImpuestos: itbisTotal,
  };
}

// ─── Phase 5: Additional invoice type mappers ─────────────────────────────────

/**
 * Shared buyer info for less-common invoice types.
 * RNC is optional for non-registered contributors.
 */
export interface EcfOtherBuyerInfo {
  rnc?: string;
  razonSocial?: string;
  name?: string;
  email?: string;
  /** ISO country code for export/foreign payment types */
  country?: string;
}

/** Generic item for other invoice types (amount is gross / ITBIS-inclusive) */
export interface OtherInvoiceItem {
  description: string;
  amount: number;
  /** If true, this item is exempt from ITBIS (e.g. some export items) */
  exempt?: boolean;
}

function buildOtherItems(items: OtherInvoiceItem[]): {
  citrusItems: CitrusItem[];
  grossTotal: number;
  itbisTotal: number;
  exemptTotal: number;
} {
  let grossTotal = 0;
  let itbisTotal = 0;
  let exemptTotal = 0;

  const citrusItems: CitrusItem[] = items.map((item, idx) => {
    const gross = item.amount;
    if (item.exempt) {
      exemptTotal += gross;
      grossTotal += gross;
      return {
        NumeroLinea: idx + 1,
        IndicadorFacturacion: 1,
        NombreItem: item.description.slice(0, 200),
        IndicadorBienoServicio: '2',
        CantidadItem: 1.00,
        UnidadMedida: 4,
        PrecioUnitarioItem: gross,
        DescuentoMonto: 0.00,
        MontoItem: gross,
        IndicadorExento: 1,
      };
    }
    const net = round2(gross / (1 + ITBIS_RATE));
    const itbis = round2(net * ITBIS_RATE);
    grossTotal += gross;
    itbisTotal += itbis;
    return {
      NumeroLinea: idx + 1,
      IndicadorFacturacion: 1,
      NombreItem: item.description.slice(0, 200),
      IndicadorBienoServicio: '2',
      CantidadItem: 1.00,
      UnidadMedida: 4,
      PrecioUnitarioItem: net,
      DescuentoMonto: 0.00,
      MontoItem: net,
      TasaITBIS: 18,
    };
  });

  return {
    citrusItems,
    grossTotal: round2(grossTotal),
    itbisTotal: round2(itbisTotal),
    exemptTotal: round2(exemptTotal),
  };
}

function validateOtherInvoicePreconditions(
  tenant: ITenant,
  items: OtherInvoiceItem[],
): void {
  if (!tenant.ecfConfig?.citrusToken) {
    throw new EcfMapperError('Tenant e-CF token is not configured');
  }
  if (!tenant.ecfConfig.isActive) {
    throw new EcfMapperError('e-CF invoicing is disabled for this tenant');
  }
  if (items.length === 0) {
    throw new EcfMapperError('At least one item is required');
  }
  const total = items.reduce((s, i) => s + i.amount, 0);
  if (total <= 0) {
    throw new EcfMapperError('Total amount must be greater than zero');
  }
}

// ─── E41 — Comprobante de Compras ─────────────────────────────────────────────

/**
 * E41 — Comprobante de Compras.
 * For purchases from non-registered contributors (suppliers without e-CF capability).
 */
export function mapToCompras(
  items: OtherInvoiceItem[],
  buyer: EcfOtherBuyerInfo,
  tipoPago: number,
  tenant: ITenant,
  refNumber?: string,
): CitrusE41Payload {
  validateOtherInvoicePreconditions(tenant, items);

  const { citrusItems, grossTotal, itbisTotal } = buildOtherItems(items);

  const comprador: CitrusFlatEncabezado['Comprador'] = {};
  if (buyer.rnc) comprador.RNCComprador = buyer.rnc;
  if (buyer.razonSocial) comprador.RazonSocialComprador = buyer.razonSocial;
  if (buyer.name) comprador.NombreComprador = buyer.name;

  return {
    Fecha: getTodayFecha(),
    NumeroFacturaInterna: refNumber,
    Encabezado: {
      TipoIngresos: '01',
      IndicadorMontoGravado: '0',
      TipoPago: String(tipoPago),
      ...(Object.keys(comprador).length > 0 ? { Comprador: comprador } : {}),
    },
    DetalleBienesOServicios: citrusItems,
    totalFactura: grossTotal,
    totalImpuestos: itbisTotal,
  };
}

// ─── E43 — Gastos Menores ─────────────────────────────────────────────────────

/**
 * E43 — Gastos Menores.
 * For petty cash / minor expense reimbursements (no supplier RNC required).
 */
export function mapToGastoMenor(
  items: OtherInvoiceItem[],
  tipoPago: number,
  tenant: ITenant,
  refNumber?: string,
): CitrusE43Payload {
  validateOtherInvoicePreconditions(tenant, items);

  const { citrusItems, grossTotal, itbisTotal } = buildOtherItems(items);

  return {
    Fecha: getTodayFecha(),
    NumeroFacturaInterna: refNumber,
    Encabezado: {
      TipoPago: String(tipoPago),
    },
    DetalleBienesOServicios: citrusItems,
    totalFactura: grossTotal,
    totalImpuestos: itbisTotal,
  };
}

// ─── E44 / E45 — Regímenes Especiales / Gubernamental ────────────────────────
// These use POST /api/v1/Facturas like E31 but with TipoeCF 44 or 45.

/**
 * E44 — Regímenes Especiales (tax-exempt entities).
 * E45 — Gubernamental (government entity purchases).
 * Both require buyer RNC and use the Facturas endpoint.
 */
export function mapToRegimenEspecial(
  tipo: '44' | '45',
  items: OtherInvoiceItem[],
  buyer: EcfOtherBuyerInfo,
  tipoPago: number,
  tenant: ITenant,
  refNumber?: string,
): CitrusE44Payload | CitrusE45Payload {
  validateOtherInvoicePreconditions(tenant, items);
  if (!buyer.rnc) {
    throw new EcfMapperError(`E${tipo} requires the buyer's RNC`);
  }

  const { citrusItems, grossTotal, itbisTotal } = buildOtherItems(items);

  return {
    Fecha: getTodayFecha(),
    NumeroFacturaInterna: refNumber,
    Encabezado: {
      TipoeCF: tipo,
      TipoIngresos: '01',
      IndicadorMontoGravado: '0',
      TipoPago: String(tipoPago),
      Comprador: {
        RNCComprador: buyer.rnc,
        ...(buyer.razonSocial ? { RazonSocialComprador: buyer.razonSocial } : {}),
        ...(buyer.name ? { NombreComprador: buyer.name } : {}),
        ...(buyer.email ? { CorreoComprador: buyer.email } : {}),
      },
    },
    DetalleBienesOServicios: citrusItems,
    totalFactura: grossTotal,
    totalImpuestos: itbisTotal,
  };
}

// ─── E46 — Exportaciones ──────────────────────────────────────────────────────

/**
 * E46 — Exportaciones (foreign sales).
 * Buyer is an entity outside Dominican Republic — no RNC required.
 */
export function mapToExportacion(
  items: OtherInvoiceItem[],
  buyer: EcfOtherBuyerInfo,
  tipoPago: number,
  tenant: ITenant,
  refNumber?: string,
): CitrusE46Payload {
  validateOtherInvoicePreconditions(tenant, items);
  if (!buyer.country) {
    throw new EcfMapperError('E46 (Exportaciones) requires a buyer country code');
  }
  if (!buyer.name && !buyer.razonSocial) {
    throw new EcfMapperError('E46 (Exportaciones) requires a buyer name or legal name');
  }

  const { citrusItems, grossTotal, itbisTotal } = buildOtherItems(items);

  return {
    Fecha: getTodayFecha(),
    NumeroFacturaInterna: refNumber,
    Encabezado: {
      TipoIngresos: '01',
      TipoPago: String(tipoPago),
      CompradorExtranjero: {
        NombreCompradorExtranjero: (buyer.razonSocial || buyer.name!).slice(0, 300),
        CodigoPaisCompradorExtranjero: buyer.country.toUpperCase().slice(0, 3),
      },
    },
    DetalleBienesOServicios: citrusItems,
    totalFactura: grossTotal,
    totalImpuestos: itbisTotal,
  };
}

// ─── E47 — Pagos al Exterior ──────────────────────────────────────────────────

/**
 * E47 — Pagos al Exterior (payments to foreign entities).
 */
export function mapToPagoExterior(
  items: OtherInvoiceItem[],
  buyer: EcfOtherBuyerInfo,
  tipoPago: number,
  tenant: ITenant,
  refNumber?: string,
): CitrusE47Payload {
  validateOtherInvoicePreconditions(tenant, items);
  if (!buyer.country) {
    throw new EcfMapperError('E47 (Pagos al Exterior) requires a payee country code');
  }
  if (!buyer.name && !buyer.razonSocial) {
    throw new EcfMapperError('E47 (Pagos al Exterior) requires a payee name or legal name');
  }

  const { citrusItems, grossTotal, itbisTotal } = buildOtherItems(items);

  return {
    Fecha: getTodayFecha(),
    NumeroFacturaInterna: refNumber,
    Encabezado: {
      TipoPago: String(tipoPago),
      CompradorExtranjero: {
        NombreCompradorExtranjero: (buyer.razonSocial || buyer.name!).slice(0, 300),
        CodigoPaisCompradorExtranjero: buyer.country.toUpperCase().slice(0, 3),
      },
    },
    DetalleBienesOServicios: citrusItems,
    totalFactura: grossTotal,
    totalImpuestos: itbisTotal,
  };
}
