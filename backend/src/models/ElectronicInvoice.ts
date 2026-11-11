import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * A point-in-time snapshot of a single invoice line item.
 * Stored on ElectronicInvoice so the document can be shown without re-fetching
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

/**
 * Where an e-CF stands. `Pendiente`: Pilloto recorded the intent but BillingSoft has not confirmed
 * it yet (a retry with the same idempotency key is safe). `Firmado`: issued and signed, DGII not
 * reached yet (BillingSoft sends it again by itself). The rest follow DGII's answer.
 */
export const ECF_ESTADOS = [
  'Pendiente',
  'Firmado',
  'En Proceso',
  'Aceptado',
  'Aceptado Condicional',
  'Rechazado',
  'Sin Resolver',
  'Anulado',
  'Error',
] as const;
export type EcfEstadoECF = (typeof ECF_ESTADOS)[number];

/** States BillingSoft will not move the document out of. */
export const ECF_TERMINAL_ESTADOS: readonly EcfEstadoECF[] = [
  'Aceptado',
  'Aceptado Condicional',
  'Rechazado',
  'Anulado',
  'Error',
];

/** States that count as a valid, usable e-CF (a note may reference it). */
export const ECF_VALID_ESTADOS: readonly EcfEstadoECF[] = ['Aceptado', 'Aceptado Condicional'];

export type EcfGenerationSource =
  | 'payment_screen'
  | 'manual'
  | 'credit_note'
  | 'debit_note'
  | 'accounting_invoice'
  | 'platform_payment';

/** The BillingSoft route a document is issued through. */
export type EcfRoute = 'invoices' | 'credit-notes' | 'debit-notes' | 'other';

export interface IEcfMessage {
  code?: string;
  message: string;
}

export interface IElectronicInvoice extends Document {
  // Pilloto references
  tenantId: mongoose.Types.ObjectId;
  folioId?: mongoose.Types.ObjectId;
  paymentId?: mongoose.Types.ObjectId;
  reservationId?: mongoose.Types.ObjectId;
  /** Set when generationSource is 'accounting_invoice' — the standalone AR Invoice this e-CF was issued for. */
  invoiceId?: mongoose.Types.ObjectId;
  /** Set when generationSource is 'platform_payment' — the tenant payment Pilloto's own e-CF was issued for. */
  billingPaymentId?: mongoose.Types.ObjectId;

  // Invoice identity
  tipo: EcfTipo;
  /** Assigned by BillingSoft when it signs the document. */
  eNCF?: string;
  /** BillingSoft's id of the document; absent while `Pendiente`. */
  billingsoftDocumentId?: string;
  trackId?: string;
  numeroFacturaInterna?: string;

  // Issuing intent — what makes a retry safe
  route: EcfRoute;
  /** Sent as the `Idempotency-Key`: the same key never issues a second fiscal document. */
  idempotencyKey: string;
  /** The exact request body, kept while `Pendiente` so a retry sends the same thing. */
  request?: unknown;

  // Status
  estadoECF: EcfEstadoECF;
  /** BillingSoft's own status word (`signed`, `in_process`, `accepted`…). */
  estatus: string;
  mensaje?: string;
  dgiiMessages?: IEcfMessage[];
  /** DGII environment it was issued for: only `ecf` has fiscal value. */
  environment?: 'testecf' | 'certecf' | 'ecf';

  // Financial summary (denormalized)
  totalFactura: number;
  totalImpuestos: number;
  currency: string;

  // Buyer info (denormalized)
  buyerRnc?: string;
  buyerName?: string;
  buyerEmail?: string;

  // Line items snapshot
  lineItems?: IEcfLineItem[];
  /** DGII TipoPago code: '1'=Efectivo, '2'=Crédito, '3'=Gratuito */
  tipoPago?: string;

  // Reference for credit/debit notes
  originalENCF?: string;
  codigoModificacion?: string;

  // BillingSoft response data
  codigoSeguridad?: string;
  fechaFirmaDigital?: Date;

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

const ecfMessageSchema = new Schema<IEcfMessage>(
  {
    code: { type: String, trim: true },
    message: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const electronicInvoiceSchema = new Schema<IElectronicInvoice>(
  {
    folioId: { type: Schema.Types.ObjectId, ref: 'Folio', index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', index: true },
    reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation' },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', index: true },
    billingPaymentId: { type: Schema.Types.ObjectId, ref: 'BillingPayment', index: true },

    tipo: {
      type: String,
      required: true,
      enum: ['E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47'],
    },
    eNCF: { type: String, trim: true },
    billingsoftDocumentId: { type: String, trim: true },
    trackId: { type: String, trim: true },
    numeroFacturaInterna: { type: String, trim: true },

    route: { type: String, required: true, enum: ['invoices', 'credit-notes', 'debit-notes', 'other'] },
    idempotencyKey: { type: String, required: true, trim: true },
    request: { type: Schema.Types.Mixed },

    estadoECF: { type: String, required: true, enum: ECF_ESTADOS, default: 'Pendiente', index: true },
    estatus: { type: String, required: true, trim: true, default: 'pending' },
    mensaje: { type: String, trim: true },
    dgiiMessages: { type: [ecfMessageSchema], default: undefined },
    environment: { type: String, enum: ['testecf', 'certecf', 'ecf'] },

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

    codigoSeguridad: { type: String, trim: true },
    fechaFirmaDigital: { type: Date },

    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    generationSource: {
      type: String,
      required: true,
      enum: ['payment_screen', 'manual', 'credit_note', 'debit_note', 'accounting_invoice', 'platform_payment'],
    },
    issuedAt: { type: Date, required: true, default: () => new Date(), index: true },
    lastStatusCheck: { type: Date },
    retryCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Multi-tenancy
electronicInvoiceSchema.plugin(tenantPlugin);

// Idempotency lookups (one e-CF per payment) and the retry key
electronicInvoiceSchema.index({ tenantId: 1, paymentId: 1, estadoECF: 1 });
electronicInvoiceSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
// A partial index, not a sparse one: a sparse compound index still indexes documents that lack `eNCF`
// (their `tenantId` exists), so two unconfirmed documents of one company would collide.
electronicInvoiceSchema.index({ tenantId: 1, eNCF: 1 }, { unique: true, partialFilterExpression: { eNCF: { $type: 'string' } } });
electronicInvoiceSchema.index({ tenantId: 1, billingsoftDocumentId: 1 }, { partialFilterExpression: { billingsoftDocumentId: { $type: 'string' } } });
electronicInvoiceSchema.index({ tenantId: 1, issuedAt: -1 });
// Sweep job: documents BillingSoft has not finished with
electronicInvoiceSchema.index({ estadoECF: 1, updatedAt: 1 });

export default mongoose.model<IElectronicInvoice>('ElectronicInvoice', electronicInvoiceSchema);
