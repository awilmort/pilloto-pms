import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { FISCAL_PLANS, FiscalPlan } from './Tenant';

/**
 * A tenant's electronic invoicing charges for one calendar month (Dominican time): the plan, what
 * was included, what was used and what the extra transactions cost. It is the billable unit — what
 * a payment provider will charge — so once `closed` its figures never change; only the payment
 * fields do (`paid`, `void`).
 *
 * Amounts are Dominican pesos, at BillingSoft's published prices.
 */
export const FISCAL_STATEMENT_STATUSES = ['open', 'closed', 'paid', 'void'] as const;
export type FiscalStatementStatus = (typeof FISCAL_STATEMENT_STATUSES)[number];

export interface IFiscalPlanChange {
  from: FiscalPlan;
  to: FiscalPlan;
  at: Date;
}

export interface IFiscalStatement extends Document {
  tenantId: mongoose.Types.ObjectId;
  /** `YYYY-MM`, Dominican time. */
  period: string;
  status: FiscalStatementStatus;
  currency: 'DOP';

  /** The BillingSoft plan in force at the end of the period. */
  plan: FiscalPlan;
  /** The plan the tenant's Pilloto plan(s) include; absent when none does. */
  includedPlan?: FiscalPlan;
  /** Monthly price of `plan`. */
  planPrice: number;
  /** Monthly price of `includedPlan` (0 when none). */
  includedPlanPrice: number;
  /** What the tenant pays for the plan: `planPrice` less what its Pilloto plan includes. */
  planCharge: number;

  transactions: { included: number | null; used: number; extra: number };
  overageUnitPrice: number;
  overageAmount: number;
  /** `planCharge + overageAmount`. */
  total: number;

  planChanges: IFiscalPlanChange[];
  /** Where the usage figures came from: BillingSoft's own count for the month, or Pilloto's reconstruction. */
  usageSource: 'billingsoft' | 'snapshot' | 'documents';

  lastSnapshotAt?: Date;
  closedAt?: Date;
  paidAt?: Date;
  /** Filled by the payment integration (reference of the charge, method used). */
  payment?: { reference?: string; method?: string };
  voidReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

const fiscalStatementSchema = new Schema<IFiscalStatement>(
  {
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: FISCAL_STATEMENT_STATUSES, default: 'open', required: true },
    currency: { type: String, enum: ['DOP'], default: 'DOP' },

    plan: { type: String, enum: FISCAL_PLANS, required: true },
    includedPlan: { type: String, enum: FISCAL_PLANS },
    planPrice: { type: Number, required: true, min: 0 },
    includedPlanPrice: { type: Number, required: true, min: 0, default: 0 },
    planCharge: { type: Number, required: true, min: 0 },

    transactions: {
      included: { type: Number, default: null },
      used: { type: Number, required: true, min: 0, default: 0 },
      extra: { type: Number, required: true, min: 0, default: 0 },
    },
    overageUnitPrice: { type: Number, required: true, min: 0, default: 0 },
    overageAmount: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },

    planChanges: {
      type: [new Schema<IFiscalPlanChange>(
        {
          from: { type: String, enum: FISCAL_PLANS, required: true },
          to: { type: String, enum: FISCAL_PLANS, required: true },
          at: { type: Date, required: true },
        },
        { _id: false },
      )],
      default: [],
    },
    usageSource: { type: String, enum: ['billingsoft', 'snapshot', 'documents'], default: 'snapshot' },

    lastSnapshotAt: { type: Date },
    closedAt: { type: Date },
    paidAt: { type: Date },
    payment: {
      reference: { type: String, trim: true },
      method: { type: String, trim: true },
    },
    voidReason: { type: String, trim: true },
  },
  { timestamps: true },
);

fiscalStatementSchema.plugin(tenantPlugin);
fiscalStatementSchema.index({ tenantId: 1, period: 1 }, { unique: true });
fiscalStatementSchema.index({ period: 1, status: 1 });

export default mongoose.model<IFiscalStatement>('FiscalStatement', fiscalStatementSchema);
