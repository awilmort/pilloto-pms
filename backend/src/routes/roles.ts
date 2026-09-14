import express, { Response } from 'express';
import Role from '../models/Role';
import { authenticate, userHasAppAccess, userHasPermission, AuthRequest } from '../middleware/auth';
import { AppCode, isAppCode } from '../constants/apps';
import { APP_ROLES_PERMISSION } from '../constants/permissions';

const router = express.Router();

/** Resolves and validates the `app` a request is scoped to (query for GET, body for writes). */
function resolveRequestedApp(req: AuthRequest): AppCode | null {
  const raw = (req.query.app as string | undefined) ?? req.body?.app ?? 'pms';
  return isAppCode(raw) ? raw : null;
}

// @route   GET /api/roles?app=pms|accounting
// @desc    List roles for the given app
// @access  Private — caller must have some access to that app
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const app = resolveRequestedApp(req);
    if (!app) {
      return res.status(400).json({ success: false, message: 'Invalid or missing app' });
    }
    if (!userHasAppAccess(req.user, app, (req.tenant as any)?.products)) {
      return res.status(403).json({ success: false, message: 'Access denied for this app.' });
    }

    const roles = await Role.find({ app }).sort('name');
    res.status(200).json({ success: true, data: roles });
  } catch (error: any) {
    console.error('List roles error:', error);
    res.status(500).json({ success: false, message: 'Server error while listing roles' });
  }
});

// @route   POST /api/roles
// @desc    Create a role for the given app (defaults to pms)
// @access  Private — caller must hold that app's role-management permission
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const app = resolveRequestedApp(req);
    if (!app) {
      return res.status(400).json({ success: false, message: 'Invalid or missing app' });
    }
    const allowed = await userHasPermission(req.user, app, [APP_ROLES_PERMISSION[app]], req.tenantId, (req.tenant as any)?.products);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
    }

    const { name, description, permissions, discountLimit } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Role name is required' });
    }
    const existing = await Role.findOne({ name: String(name).toLowerCase(), app });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Role name already exists' });
    }
    const role = await Role.create({
      name: String(name).toLowerCase(),
      app,
      description,
      permissions: Array.isArray(permissions) ? permissions : [],
      discountLimit: Number(discountLimit) >= 0 ? Math.min(100, Number(discountLimit)) : 0,
    });
    res.status(201).json({ success: true, message: 'Role created', data: role });
  } catch (error: any) {
    console.error('Create role error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating role' });
  }
});

// @route   PUT /api/roles/:id
// @desc    Update a role
// @access  Private — caller must hold the role's own app's role-management permission
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }
    const app = role.app as AppCode;
    const allowed = await userHasPermission(req.user, app, [APP_ROLES_PERMISSION[app]], req.tenantId, (req.tenant as any)?.products);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
    }

    const { name, description, permissions, discountLimit } = req.body;
    if (name) role.name = String(name).toLowerCase();
    if (description !== undefined) role.description = description;
    if (permissions) role.permissions = Array.isArray(permissions) ? permissions : [];
    if (discountLimit !== undefined) role.discountLimit = Math.min(100, Math.max(0, Number(discountLimit) || 0));
    await role.save();
    res.status(200).json({ success: true, message: 'Role updated', data: role });
  } catch (error: any) {
    console.error('Update role error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating role' });
  }
});

// @route   DELETE /api/roles/:id
// @desc    Delete a role
// @access  Private — caller must hold the role's own app's role-management permission
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }
    const app = role.app as AppCode;
    const allowed = await userHasPermission(req.user, app, [APP_ROLES_PERMISSION[app]], req.tenantId, (req.tenant as any)?.products);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
    }

    // Prevent deleting system-seeded roles
    if (role.isSystem) {
      return res.status(400).json({ success: false, message: 'Cannot delete a core role' });
    }
    await Role.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Role deleted' });
  } catch (error: any) {
    console.error('Delete role error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting role' });
  }
});

export default router;
