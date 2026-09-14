import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * A point-in-time snapshot of a single invoice line item.
 * Stored on ElectronicInvoice so the PDF can be rendered without re-fetching
 * the folio charges (which may change after the invoice is issued).
 */
export interface IEcfLineItem {
  description: string;
  qty: number;
  netPrice: number;   // price excluding ITBIS
  itbisRate: number;  // e.g. 18 (percent)
  itbisAmount: number;
  grossAmount: number; // netPrice + itbisAmount
}

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

export type EcfGenerationSource =
  | 'payment_screen'
  | 'manual'
  | 'credit_note'
  | 'debit_note'
  | 'accounting_invoice';

export interface IElectronicInvoice extends Document {
  // Pilloto references
  tenantId: mongoose.Types.ObjectId;
  folioId?: mongoose.Types.ObjectId;
  paymentId?: mongoose.Types.ObjectId;
  reservationId?: mongoose.Types.ObjectId;
  /** Set when generationSource is 'accounting_invoice' — the standalone AR Invoice this e-CF was issued for (Phase 5.1). */
  invoiceId?: mongoose.Types.ObjectId;

  // Invoice identity
  tipo: EcfTipo;
  eNCF: string;
  transaccionId: number;
  trackId?: string;
  numeroFacturaInterna?: string;

  // Status
  estadoECF: EcfEstadoECF;
  estatus: string;
  mensaje?: string;

  // Financial summary (denormalized)
  totalFactura: number;
  totalImpuestos: number;
  currency: string;

  // Buyer info (denormalized)
  buyerRnc?: string;
  buyerName?: string;
  buyerEmail?: string;

  // Line items snapshot (denormalized for self-contained PDF generation)
  lineItems?: IEcfLineItem[];
  /** DGII TipoPago code: '1'=Efectivo, '2'=Crédito, '3'=Tarjeta, '4'=Transferencia, '5'=Cheque, '6'=Mixto */
  tipoPago?: string;

  // Reference for credit/debit notes
  originalENCF?: string;
  codigoModificacion?: string;

  // Citrus response data
  urlCodigoQr?: string;
  codigoSeguridad?: string;
  fechaFirmaDigital?: Date;
  fechaVencimientoSecuencia?: Date;
  xmlUrl?: string;

  // Metadata
  generatedBy: mongoose.Types.ObjectId;
  generationSource: EcfGenerationSource;
  issuedAt: Date;
  lastStatusCheck?: Date;
  retryCount: number;

  createdAt: Date;
  updatedAt: Date;
}

const ecfLineItemSchema = new Schema<IEcfLineItem>(
  {
    description: { type: String, required: true, trim: true },
    qty:         { type: Number, required: true },
    netPrice:    { type: Number, required: true },
    itbisRate:   { type: Number, required: true },
    itbisAmount: { type: Number, required: true },
    grossAmount: { type: Number, required: true },
  },
  { _id: false },
);

const electronicInvoiceSchema = new Schema<IElectronicInvoice>(
  {
    folioId: { type: Schema.Types.ObjectId, ref: 'Folio', index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', index: true },
    reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation' },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', index: true },

    tipo: {
      type: String,
      required: true,
      enum: ['E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47'],
    },
    eNCF: { type: String, required: true, trim: true, index: true },
    transaccionId: { type: Number, required: true },
    trackId: { type: String, required: false, trim: true, index: true, sparse: true },
    numeroFacturaInterna: { type: String, trim: true },

    estadoECF: {
      type: String,
      required: true,
      enum: ['Aceptado', 'Aceptado Condicional', 'Rechazado', 'Error', 'En Proceso', 'Emitido Contingencia', 'Pendiente'],
      default: 'Pendiente',
      index: true,
    },
    estatus: { type: String, required: true, trim: true },
    mensaje: { type: String, trim: true },

    totalFactura: { type: Number, required: true, min: 0 },
    totalImpuestos: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, trim: true, default: 'DOP' },

    buyerRnc: { type: String, trim: true },
    buyerName: { type: String, trim: true },
    buyerEmail: { type: String, trim: true, lowercase: true },

    lineItems: { type: [ecfLineItemSchema], default: undefined },
    tipoPago: { type: String, trim: true },

    originalENCF: { type: String, trim: true },
    codigoModificacion: { type: String, trim: true },

    urlCodigoQr: { type: String, trim: true },
    codigoSeguridad: { type: String, trim: true },
    fechaFirmaDigital: { type: Date },
    fechaVencimientoSecuencia: { type: Date },
    xmlUrl: { type: String, trim: true },

    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    generationSource: {
      type: String,
      required: true,
      enum: ['payment_screen', 'manual', 'credit_note', 'debit_note', 'accounting_invoice'],
    },
    issuedAt: { type: Date, required: true, default: () => new Date(), index: true },
    lastStatusCheck: { type: Date },
    retryCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Multi-tenancy
electronicInvoiceSchema.plugin(tenantPlugin);

// Compound index for idempotency checks
electronicInvoiceSchema.index({ tenantId: 1, paymentId: 1, estadoECF: 1 });
electronicInvoiceSchema.index({ tenantId: 1, eNCF: 1 }, { unique: true, sparse: true });
electronicInvoiceSchema.index({ tenantId: 1, issuedAt: -1 });

export default mongoose.model<IElectronicInvoice>('ElectronicInvoice', electronicInvoiceSchema);
