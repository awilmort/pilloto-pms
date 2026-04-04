/**
 * OTA routes
 *
 * Endpoints:
 *   Listing Mappings
 *     GET    /api/ota/mappings
 *     POST   /api/ota/mappings
 *     PUT    /api/ota/mappings/:id
 *     DELETE /api/ota/mappings/:id
 *     POST   /api/ota/mappings/:id/rotate-token
 *
 *   Sync
 *     POST   /api/ota/sync              (manual sync — all or single mapping)
 *     GET    /api/ota/sync-runs         (history)
 *
 *   Conflicts
 *     GET    /api/ota/conflicts
 *     PUT    /api/ota/conflicts/:id/resolve
 *
 *   Outbound Feed (public — no auth, token-based)
 *   Registered separately at /api/ota/feed/:token  (see index.ts)
 */

import express, { Response } from 'express';
import crypto from 'crypto';
import { authenticate, authorize, authorizePermission, AuthRequest } from '../middleware/auth';
import OtaListingMapping from '../models/OtaListingMapping';
import OtaSyncRun from '../models/OtaSyncRun';
import OtaConflict from '../models/OtaConflict';
import OtaExternalEvent from '../models/OtaExternalEvent';
import Reservation from '../models/Reservation';
import { runOtaSyncForTenant } from '../utils/otaWorker';
import { getTenantId } from '../middleware/tenantContext';

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ─────────────────────────────────────────────────────────────
// Listing Mappings
// ─────────────────────────────────────────────────────────────

// GET /api/ota/mappings
router.get(
  '/mappings',
  authenticate,
  authorizePermission('admin.ota.view'),
  async (req: AuthRequest, res: Response) => {
    try {
      const backendPublicUrl = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '');
      const mappings = await OtaListingMapping.find()
        .populate('roomId', 'name number floor')
        .sort({ createdAt: -1 })
        .lean();
      const mapped = mappings.map((m: any) => ({
        ...m,
        outboundFeedUrl: backendPublicUrl
          ? `${backendPublicUrl}/api/ota/feed/${m.outboundToken}`
          : undefined,
      }));
      res.json({ success: true, data: mapped });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// POST /api/ota/mappings
router.post(
  '/mappings',
  authenticate,
  authorizePermission('admin.ota.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        provider,
        providerLabel,
        externalListingId,
        inboundFeedUrl,
        roomId,
        isActive,
      } = req.body;

      if (!provider) {
        return res.status(400).json({ success: false, message: 'provider is required' });
      }

      const outboundToken = generateOpaqueToken();

      const mapping = await OtaListingMapping.create({
        provider,
        providerLabel: providerLabel?.trim().slice(0, 120),
        externalListingId: externalListingId?.trim().slice(0, 200),
        inboundFeedUrl: inboundFeedUrl?.trim().slice(0, 2000),
        outboundToken,
        roomId: roomId || undefined,
        isActive: isActive !== false,
      });

      res.status(201).json({ success: true, data: mapping });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
);

// PUT /api/ota/mappings/:id
router.put(
  '/mappings/:id',
  authenticate,
  authorizePermission('admin.ota.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { provider, providerLabel, externalListingId, inboundFeedUrl, roomId, isActive } =
        req.body;

      const update: any = {};
      if (provider !== undefined) update.provider = provider;
      if (providerLabel !== undefined) update.providerLabel = providerLabel?.trim().slice(0, 120);
      if (externalListingId !== undefined)
        update.externalListingId = externalListingId?.trim().slice(0, 200);
      if (inboundFeedUrl !== undefined)
        update.inboundFeedUrl = inboundFeedUrl?.trim().slice(0, 2000);
      if (roomId !== undefined) update.roomId = roomId || null;
      if (isActive !== undefined) update.isActive = isActive;

      const mapping = await OtaListingMapping.findByIdAndUpdate(
        req.params.id,
        { $set: update },
        { new: true, runValidators: true },
      );

      if (!mapping) return res.status(404).json({ success: false, message: 'Mapping not found' });
      res.json({ success: true, data: mapping });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
);

// DELETE /api/ota/mappings/:id
router.delete(
  '/mappings/:id',
  authenticate,
  authorizePermission('admin.ota.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const mapping = await OtaListingMapping.findByIdAndDelete(req.params.id);
      if (!mapping) return res.status(404).json({ success: false, message: 'Mapping not found' });
      res.json({ success: true, data: null });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// POST /api/ota/mappings/:id/rotate-token
router.post(
  '/mappings/:id/rotate-token',
  authenticate,
  authorizePermission('admin.ota.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const outboundToken = generateOpaqueToken();
      const mapping = await OtaListingMapping.findByIdAndUpdate(
        req.params.id,
        { $set: { outboundToken } },
        { new: true },
      );
      if (!mapping) return res.status(404).json({ success: false, message: 'Mapping not found' });
      const backendPublicUrl = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '');
      const outboundFeedUrl = backendPublicUrl
        ? `${backendPublicUrl}/api/ota/feed/${outboundToken}`
        : undefined;
      res.json({ success: true, data: { ...(mapping as any).toObject(), outboundFeedUrl } });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────
// Manual Sync
// ─────────────────────────────────────────────────────────────

// POST /api/ota/sync
router.post(
  '/sync',
  authenticate,
  authorizePermission('admin.ota.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId();
      if (!tenantId) {
        return res.status(400).json({ success: false, message: 'Tenant context not resolved' });
      }

      const { mappingId } = req.body;
      const result = await runOtaSyncForTenant(tenantId, {
        triggeredBy: 'manual',
        mappingId: mappingId || undefined,
      });

      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// GET /api/ota/sync-runs
router.get(
  '/sync-runs',
  authenticate,
  authorizePermission('admin.ota.view'),
  async (req: AuthRequest, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const runs = await OtaSyncRun.find()
        .sort({ startedAt: -1 })
        .limit(limit)
        .lean();
      res.json({ success: true, data: runs });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────
// Conflicts
// ─────────────────────────────────────────────────────────────

// GET /api/ota/conflicts
router.get(
  '/conflicts',
  authenticate,
  authorizePermission('admin.ota.view'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { status, page = 1, limit = 25 } = req.query;
      const filter: any = {};
      if (status) filter.status = status;

      const skip = (Number(page) - 1) * Number(limit);
      const [conflicts, total] = await Promise.all([
        OtaConflict.find(filter)
          .populate('mappingId', 'provider providerLabel roomId')
          .populate('externalEventId', 'externalUid summary guestName checkIn checkOut')
          .populate({
            path: 'overlappingReservationId',
            select: 'checkInDate checkOutDate status guestName reservationCode',
          })
          .populate('resolvedBy', 'firstName lastName')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        OtaConflict.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: conflicts,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// GET /api/ota/conflicts/count  — quick badge count
router.get(
  '/conflicts/count',
  authenticate,
  authorizePermission('admin.ota.view'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const count = await OtaConflict.countDocuments({ status: 'pending_review' });
      res.json({ success: true, data: { pendingCount: count } });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// PUT /api/ota/conflicts/:id/resolve
router.put(
  '/conflicts/:id/resolve',
  authenticate,
  authorizePermission('admin.ota.resolve'),
  async (req: AuthRequest, res: Response) => {
    try {
      const validStatuses = [
        'resolved_keep_pilloto',
        'resolved_accept_ota',
        'resolved_outside_system',
        'ignored_false_positive',
      ];
      const { status, notes } = req.body;

      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid resolution status' });
      }

      const conflict = await OtaConflict.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status,
            notes: notes?.slice(0, 2000),
            resolvedBy: req.user?._id,
            resolvedAt: new Date(),
          },
        },
        { new: true },
      );

      if (!conflict) return res.status(404).json({ success: false, message: 'Conflict not found' });
      res.json({ success: true, data: conflict });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

export default router;
