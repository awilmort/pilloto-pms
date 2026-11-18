import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * Pesos per unit of a foreign currency on a day (e.g. USD 1 = RD$ 63.15), as the company records
 * them (usually the Banco Central's published rate). Documents in that currency start from the
 * latest rate on or before their date; the rate actually used is stored on each document and
 * payment.
 */
export interface IExchangeRate extends Document {
  currency: 'USD' | 'EUR';
  /** `YYYY-MM-DD`. */
  date: string;
  rate: number;
  createdAt: Date;
  updatedAt: Date;
}

const exchangeRateSchema = new Schema<IExchangeRate>(
  {
    currency: { type: String, enum: ['USD', 'EUR'], required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    rate: { type: Number, required: true, min: 0.000001 },
  },
  { timestamps: true },
);

exchangeRateSchema.plugin(tenantPlugin);
exchangeRateSchema.index({ tenantId: 1, currency: 1, date: -1 }, { unique: true });

export default mongoose.model<IExchangeRate>('ExchangeRate', exchangeRateSchema);
