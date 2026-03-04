/**
 * Mongoose Tenant Query-Scoping Plugin
 *
 * When applied to a schema, this plugin automatically:
 *  - Injects `{ tenantId }` into every query filter (find, findOne, update, etc.)
 *  - Sets `tenantId` on new documents before they are saved.
 *
 * It reads the tenantId from the AsyncLocalStorage set by `resolveTenant` middleware,
 * so no manual passing of tenantId through every route is required.
 *
 * Skipped when there is no tenantId in the current async context (platform/superadmin requests).
 */

import { Schema, Types } from 'mongoose';
import { getTenantId } from '../middleware/tenantContext';

export function tenantPlugin(schema: Schema): void {
  // ── Field definition ────────────────────────────────────────
  schema.add({
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },
  });

  // ── Pre-save: stamp tenantId on new documents ──────────────
  schema.pre('save', function (next) {
    if (this.isNew && !this.get('tenantId')) {
      const tid = getTenantId();
      if (tid) {
        this.set('tenantId', tid);
      }
    }
    next();
  });

  // ── Pre-insertMany: stamp tenantId on bulk inserts ─────────
  schema.pre('insertMany', function (_next, docs: any[]) {
    const tid = getTenantId();
    if (tid && Array.isArray(docs)) {
      docs.forEach((doc) => {
        if (!doc.tenantId) doc.tenantId = tid;
      });
    }
    _next();
  });

  // ── Pre-find/update/delete: scope queries by tenantId ──────
  const queryHooks = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndReplace',
    'countDocuments',
    'count',
    'distinct',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'replaceOne',
  ] as const;

  queryHooks.forEach((hook) => {
    schema.pre(hook as any, function (this: any) {
      const tid = getTenantId();
      if (tid) {
        // Only inject if not already present to allow superadmin overrides
        if (this.getFilter && !this.getFilter().tenantId) {
          this.where({ tenantId: tid });
        }
      }
    });
  });

  // ── Pre-aggregate: prepend $match { tenantId } to pipeline ──
  schema.pre('aggregate', function (this: any) {
    const tid = getTenantId();
    if (!tid) return; // superadmin / platform context — no scoping

    const pipeline: any[] = this.pipeline();

    // Don't inject if the pipeline already carries a tenantId match
    // (e.g. a route that explicitly built its own scoped pipeline)
    const alreadyScoped = pipeline.some(
      (stage) => stage.$match && stage.$match.tenantId != null
    );
    if (alreadyScoped) return;

    // Cast to ObjectId — aggregation pipelines do not auto-cast strings
    const tenantObjectId = new Types.ObjectId(tid);

    // Prepend so the very first stage narrows the collection scan
    pipeline.unshift({ $match: { tenantId: tenantObjectId } });
  });
}
