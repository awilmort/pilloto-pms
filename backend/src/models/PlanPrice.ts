import mongoose, { Document, Schema } from 'mongoose';
import { BILLING_PRODUCTS, BillingProduct } from './Tenant';

/**
 * The price list: what a plan costs per month, in Dominican pesos before ITBIS. A tenant's own
 * contract (`Tenant.billing.contracts`) copies the price when its subscription starts, so editing
 * this list only reaches new subscriptions.
 *
 * Not tenant-scoped: it belongs to the platform.
 */
export interface IPlanPriceChange {
  previous: number | null;
  price: number;
  changedAt: Date;
  changedByEmail?: string;
}

export interface IPlanPrice extends Document {
  product: BillingProduct;
  plan: string;
  monthlyPrice: number;
  history: IPlanPriceChange[];
  createdAt: Date;
  updatedAt: Date;
}

const planPriceSchema = new Schema<IPlanPrice>(
  {
    product: { type: String, enum: BILLING_PRODUCTS, required: true },
    plan: { type: String, required: true, trim: true },
    monthlyPrice: { type: Number, required: true, min: 0 },
    history: {
      type: [
        new Schema<IPlanPriceChange>(
          {
            previous: { type: Number, default: null },
            price: { type: Number, required: true },
            changedAt: { type: Date, default: Date.now },
            changedByEmail: { type: String, trim: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

planPriceSchema.index({ product: 1, plan: 1 }, { unique: true });

export default mongoose.model<IPlanPrice>('PlanPrice', planPriceSchema);
