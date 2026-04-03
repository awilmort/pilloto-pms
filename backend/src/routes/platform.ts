/**
 * Platform Routes — /api/platform/*
 *
 * Accessible only from admin.pilloto.com (isPlatformRequest = true)
 * and only by users with role = 'superadmin'.
 *
 * Endpoints:
 *   GET    /api/platform/tenants            — list all tenants
 *   POST   /api/platform/tenants            — create + provision a new tenant
 *   GET    /api/platform/tenants/:id        — get single tenant
 *   PATCH  /api/platform/tenants/:id        — update metadata / enable-disable
 *   DELETE /api/platform/tenants/:id        — permanently delete (soft disabled instead)
 *   GET    /api/platform/tenants/:id/stats  — basic stats for a single tenant
 */

import express, { Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import Tenant from '../models/Tenant';
import User from '../models/User';
import Reservation from '../models/Reservation';
import Room from '../models/Room';
import { provisionTenant } from '../utils/provisionTenant';
import { tenantLocalStorage } from '../middleware/tenantContext';
import PlatformSettings from '../models/PlatformSettings';
import AppSettings from '../models/AppSettings';
import OtaSyncRun from '../models/OtaSyncRun';
import OtaListingMapping from '../models/OtaListingMapping';
import OtaConflict from '../models/OtaConflict';
import { getOtaCronStatus, restartOtaCron } from '../utils/otaCron';
import { runOtaSyncForTenant } from '../utils/otaWorker';

const router = express.Router();

// All platform routes require authentication + superadmin role
router.use(authenticate, authorize('superadmin'));

// ── List all tenants ───────────────────────────────────────────────────────────
router.get('/tenants', async (_req: AuthRequest, res: Response) => {
  try {
    const tenants = await Tenant.find().sort({ createdAt: -1 }).lean();
    res.status(200).json({ success: true, data: tenants });
  } catch (error) {
    console.error('List tenants error:', error);
    res.status(500).json({ success: false, message: 'Failed to list tenants.' });
  }
});

// ── Get single tenant ──────────────────────────────────────────────────────────
router.get('/tenants/:id', async (req: AuthRequest, res: Response) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    res.status(200).json({ success: true, data: tenant });
  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(500).json({ success: false, message: 'Failed to get tenant.' });
  }
});

// ── Create + provision a new tenant ───────────────────────────────────────────
router.post('/tenants', async (req: AuthRequest, res: Response) => {
  try {
    const {
      name, slug, plan, ownerEmail,
      adminFirstName, adminLastName, adminPassword,
      settings,
    } = req.body;

    if (!name || !slug || !ownerEmail || !adminFirstName || !adminLastName || !adminPassword) {
      return res.status(400).json({
        success: false,
        message: 'name, slug, ownerEmail, adminFirstName, adminLastName, and adminPassword are required.',
      });
    }

    // Validate slug uniqueness upfront for a cleaner error message
    const existing = await Tenant.findOne({ slug: slug.toLowerCase().trim() }).lean();
    if (existing) {
      return res.status(409).json({ success: false, message: `Slug '${slug}' is already taken.` });
    }

    const { tenant, adminUser } = await provisionTenant({
      name, slug, plan, ownerEmail,
      adminFirstName, adminLastName, adminPassword,
      settings,
    });

    res.status(201).json({
      success: true,
      message: `Tenant '${tenant.name}' provisioned successfully.`,
      data: {
        tenant,
        adminUser,
        loginUrl: `https://${tenant.slug}.pilloto.com/login`,
      },
    });
  } catch (error: any) {
    console.error('Provision tenant error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Slug or email already in use.' });
    }
    res.status(500).json({ success: false, message: 'Failed to provision tenant.', error: error.message });
  }
});

// ── Update tenant metadata ─────────────────────────────────────────────────────
router.patch('/tenants/:id', async (req: AuthRequest, res: Response) => {
  try {
    const allowed = ['name', 'plan', 'isActive', 'ownerEmail', 'settings'];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    res.status(200).json({ success: true, data: tenant });
  } catch (error: any) {
    console.error('Update tenant error:', error);
    res.status(500).json({ success: false, message: 'Failed to update tenant.' });
  }
});

// ── Soft-delete (disable) tenant ───────────────────────────────────────────────
// We do NOT hard-delete to preserve data integrity
router.delete('/tenants/:id', async (req: AuthRequest, res: Response) => {
  try {
    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    res.status(200).json({ success: true, message: 'Tenant deactivated.', data: tenant });
  } catch (error: any) {
    console.error('Deactivate tenant error:', error);
    res.status(500).json({ success: false, message: 'Failed to deactivate tenant.' });
  }
});

// ── Tenant stats ───────────────────────────────────────────────────────────────
router.get('/tenants/:id/stats', async (req: AuthRequest, res: Response) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    const tenantId = (tenant as any)._id.toString();

    // Run count queries inside this tenant's context so the plugin scopes them
    const [userCount, reservationCount, roomCount] = await tenantLocalStorage.run(
      { tenantId },
      () => Promise.all([
        User.countDocuments(),
        Reservation.countDocuments(),
        Room.countDocuments(),
      ])
    );

    res.status(200).json({
      success: true,
      data: {
        tenant,
        stats: { users: userCount, reservations: reservationCount, rooms: roomCount },
      },
    });
  } catch (error) {
    console.error('Tenant stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to get tenant stats.' });
  }
});

// ── OTA Sync: get platform config ──────────────────────────────────────────────
router.get('/ota/config', async (_req: AuthRequest, res: Response) => {
  try {
    const config = await PlatformSettings.findOne({ key: 'global' }).lean();
    res.status(200).json({
      success: true,
      data: {
        globalEnabled:       config?.otaSync?.globalEnabled       ?? true,
        cronIntervalMinutes: config?.otaSync?.cronIntervalMinutes ?? 5,
        cronStatus: getOtaCronStatus(),
      },
    });
  } catch (error) {
    console.error('Get OTA config error:', error);
    res.status(500).json({ success: false, message: 'Failed to get OTA config.' });
  }
});

// ── OTA Sync: update platform config ──────────────────────────────────────────
const ALLOWED_INTERVALS = [5, 10, 15, 20, 30, 60];

router.patch('/ota/config', async (req: AuthRequest, res: Response) => {
  try {
    const { globalEnabled, cronIntervalMinutes } = req.body;

    if (cronIntervalMinutes !== undefined && !ALLOWED_INTERVALS.includes(Number(cronIntervalMinutes))) {
      return res.status(400).json({
        success: false,
        message: `cronIntervalMinutes must be one of: ${ALLOWED_INTERVALS.join(', ')}`,
      });
    }

    const update: Record<string, any> = {};
    if (typeof globalEnabled === 'boolean')    update['otaSync.globalEnabled']       = globalEnabled;
    if (cronIntervalMinutes !== undefined)      update['otaSync.cronIntervalMinutes'] = Number(cronIntervalMinutes);

    const config = await PlatformSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    const newEnabled  = config?.otaSync?.globalEnabled       ?? true;
    const newInterval = config?.otaSync?.cronIntervalMinutes ?? 5;
    restartOtaCron(newInterval, newEnabled);

    res.status(200).json({
      success: true,
      data: {
        globalEnabled:       newEnabled,
        cronIntervalMinutes: newInterval,
        cronStatus: getOtaCronStatus(),
      },
    });
  } catch (error) {
    console.error('Update OTA config error:', error);
    res.status(500).json({ success: false, message: 'Failed to update OTA config.' });
  }
});

// ── OTA Sync: per-tenant stats table ──────────────────────────────────────────
router.get('/ota/tenant-stats', async (_req: AuthRequest, res: Response) => {
  try {
    const tenants = await Tenant.find().sort({ name: 1 }).lean();

    const rows = await Promise.all(
      tenants.map(async (tenant) => {
        const tid = String(tenant._id);

        const [appSettings, mappingCount, pendingConflicts, lastRun] = await Promise.all([
          AppSettings.findOne({ tenantId: tid }).select('otaSettings').lean(),
          OtaListingMapping.countDocuments({ tenantId: tid }),
          OtaConflict.countDocuments({ tenantId: tid, status: 'pending_review' }),
          OtaSyncRun.findOne({ tenantId: tid }).sort({ startedAt: -1 }).select('status startedAt completedAt imported updated conflicts errorCount').lean(),
        ]);

        return {
          tenantId: tid,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          isActive: tenant.isActive,
          otaEnabled: (appSettings as any)?.otaSettings?.enabled ?? false,
          syncIntervalMinutes: (appSettings as any)?.otaSettings?.syncIntervalMinutes ?? 60,
          mappingCount,
          pendingConflicts,
          lastRun: lastRun ?? null,
        };
      })
    );

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('OTA tenant stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to get OTA tenant stats.' });
  }
});

// ── OTA Sync: recent sync runs across all tenants ─────────────────────────────
router.get('/ota/sync-runs', async (req: AuthRequest, res: Response) => {
  try {
    const page  = Math.max(1, Number(req.query.page  || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const skip  = (page - 1) * limit;

    const filterTenantId = req.query.tenantId as string | undefined;
    const filterStatus   = req.query.status   as string | undefined;

    const query: Record<string, any> = {};
    if (filterTenantId) query.tenantId = filterTenantId;
    if (filterStatus)   query.status   = filterStatus;

    const [total, runs] = await Promise.all([
      OtaSyncRun.countDocuments(query),
      OtaSyncRun.find(query).sort({ startedAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    // Enrich with tenant name
    const tenantIds = [...new Set(runs.map((r: any) => r.tenantId))];
    const tenants   = await Tenant.find({ _id: { $in: tenantIds } }).select('name slug').lean();
    const tenantMap = new Map(tenants.map((t: any) => [String(t._id), t]));

    const enriched = runs.map((r: any) => ({
      ...r,
      tenantName: (tenantMap.get(r.tenantId) as any)?.name ?? r.tenantId,
      tenantSlug: (tenantMap.get(r.tenantId) as any)?.slug ?? '',
    }));

    res.status(200).json({
      success: true,
      data: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('OTA sync-runs error:', error);
    res.status(500).json({ success: false, message: 'Failed to get sync runs.' });
  }
});

// ── OTA Sync: trigger sync for one or all tenants ─────────────────────────────
router.post('/ota/sync', async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.body;

    const tenantList = tenantId
      ? await Tenant.find({ _id: tenantId, isActive: true }).lean()
      : await Tenant.find({ isActive: true }).lean();

    if (!tenantList.length) {
      return res.status(404).json({ success: false, message: 'No active tenants found.' });
    }

    // Kick off async; respond immediately with accepted status
    Promise.all(
      tenantList.map((t) =>
        runOtaSyncForTenant(String(t._id), { triggeredBy: 'manual' }).catch((err) =>
          console.error(`Manual OTA sync failed for tenant ${t._id}:`, err),
        ),
      ),
    );

    res.status(202).json({
      success: true,
      message: `OTA sync triggered for ${tenantList.length} tenant(s).`,
    });
  } catch (error) {
    console.error('OTA manual sync error:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger OTA sync.' });
  }
});

export default router;
