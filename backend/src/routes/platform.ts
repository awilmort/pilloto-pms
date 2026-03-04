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

export default router;
