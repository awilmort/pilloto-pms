import express, { Response } from 'express';
import ChargeTemplate from '../models/ChargeTemplate';
import { authenticate, authorize, authorizeAppAccess, AuthRequest } from '../middleware/auth';

const router = express.Router();

// @route   GET /api/charge-templates
// @desc    List all charge templates
// @access  Private (any authenticated staff)
router.get('/', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { active } = req.query;
    const filter: any = {};
    if (active !== undefined) filter.isActive = active === 'true';
    const templates = await ChargeTemplate.find(filter).sort({ name: 1 }).lean();
    res.json({ success: true, data: templates });
  } catch (err) {
    console.error('Get charge-templates error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/charge-templates
// @desc    Create a charge template
// @access  Admin
router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, descriptionTemplate, calculationMethod, amount, category, taxApplicable, isActive } = req.body;
    if (!name || !descriptionTemplate || !calculationMethod || amount === undefined || !category) {
      return res.status(400).json({ success: false, message: 'name, descriptionTemplate, calculationMethod, amount, and category are required' });
    }
    const template = await ChargeTemplate.create({ name, descriptionTemplate, calculationMethod, amount, category, taxApplicable, isActive });
    res.status(201).json({ success: true, data: template });
  } catch (err: any) {
    console.error('Create charge-template error:', err);
    if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/charge-templates/:id
// @desc    Update a charge template
// @access  Admin
router.put('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, descriptionTemplate, calculationMethod, amount, category, taxApplicable, isActive } = req.body;
    const template = await ChargeTemplate.findByIdAndUpdate(
      req.params.id,
      { $set: { name, descriptionTemplate, calculationMethod, amount, category, taxApplicable, isActive } },
      { new: true, runValidators: true }
    );
    if (!template) return res.status(404).json({ success: false, message: 'Charge template not found' });
    res.json({ success: true, data: template });
  } catch (err: any) {
    console.error('Update charge-template error:', err);
    if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/charge-templates/:id
// @desc    Delete a charge template
// @access  Admin
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await ChargeTemplate.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Charge template not found' });
    res.json({ success: true, message: 'Charge template deleted' });
  } catch (err) {
    console.error('Delete charge-template error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
