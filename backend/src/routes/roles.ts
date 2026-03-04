import express, { Request, Response } from 'express';
import Role from '../models/Role';
import { authenticate, authorizePermission } from '../middleware/auth';

const router = express.Router();

// @route   GET /api/roles
// @desc    List roles
// @access  Private (Admin only)
// Allow any authenticated user to read roles for permission mapping in frontend
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const roles = await Role.find().sort('name');
    res.status(200).json({ success: true, data: roles });
  } catch (error: any) {
    console.error('List roles error:', error);
    res.status(500).json({ success: false, message: 'Server error while listing roles' });
  }
});

// @route   POST /api/roles
// @desc    Create a role
// @access  Private (Admin only)
router.post('/', authenticate, authorizePermission('admin.roles'), async (req: Request, res: Response) => {
  try {
    const { name, description, permissions } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Role name is required' });
    }
    const existing = await Role.findOne({ name: String(name).toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Role name already exists' });
    }
    const role = await Role.create({ name: String(name).toLowerCase(), description, permissions: Array.isArray(permissions) ? permissions : [] });
    res.status(201).json({ success: true, message: 'Role created', data: role });
  } catch (error: any) {
    console.error('Create role error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating role' });
  }
});

// @route   PUT /api/roles/:id
// @desc    Update a role
// @access  Private (Admin only)
router.put('/:id', authenticate, authorizePermission('admin.roles'), async (req: Request, res: Response) => {
  try {
    const { name, description, permissions } = req.body;
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }
    if (name) role.name = String(name).toLowerCase();
    if (description !== undefined) role.description = description;
    if (permissions) role.permissions = Array.isArray(permissions) ? permissions : [];
    await role.save();
    res.status(200).json({ success: true, message: 'Role updated', data: role });
  } catch (error: any) {
    console.error('Update role error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating role' });
  }
});

// @route   DELETE /api/roles/:id
// @desc    Delete a role
// @access  Private (Admin only)
router.delete('/:id', authenticate, authorizePermission('admin.roles'), async (req: Request, res: Response) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }
    // Prevent deleting core roles
    if (['admin', 'customer', 'maintenance', 'staff'].includes(role.name)) {
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
