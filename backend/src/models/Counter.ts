import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * Generic atomic-increment counter, keyed by name (e.g. 'journalEntryNumber'),
 * scoped per tenant via `tenantPlugin` so every tenant's sequences start at 1
 * independently. Backs sequential, gapless, never-reused document numbering
 * for every numbered document (JournalEntry, Invoice, Bill, CreditNote, etc.).
 */
export interface ICounter extends Document {
  key: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  key: { type: String, required: true, trim: true },
  seq: { type: Number, required: true, default: 0 },
});

counterSchema.plugin(tenantPlugin);
counterSchema.index({ tenantId: 1, key: 1 }, { unique: true });

const Counter = mongoose.model<ICounter>('Counter', counterSchema);

// Relies on tenantPlugin's findOneAndUpdate hook to inject { tenantId } into the
// filter, so the upsert-created document is scoped to the tenant in the current
// AsyncLocalStorage context — same mechanism every other model uses, applied to
// the one primitive that has to be correct under concurrency.
export async function nextSequence(key: string): Promise<number> {
  // Two concurrent *first* calls for a tenant both try to create the counter document. The server retries that
  // upsert race itself on MongoDB 4.2+, but a duplicate-key error is cheap to absorb and must never reach a
  // caller that is in the middle of creating a document.
  for (let attempt = 0; ; attempt++) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { key },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      return counter.seq;
    } catch (err: any) {
      if (err?.code === 11000 && attempt < 3) continue;
      throw err;
    }
  }
}

export default Counter;
