import express, { Response } from 'express';
import ChargeRule from '../models/ChargeRule';
import { authenticate, authorize, authorizeAppAccess, AuthRequest } from '../middleware/auth';

const router = express.Router();

// @route   GET /api/charge-rules
// @desc    List all charge rules
// @access  Private (any authenticated staff)
router.get('/', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { active } = req.query;
    const filter: any = {};
    if (active !== undefined) filter.isActive = active === 'true';
    const rules = await ChargeRule.find(filter)
      .populate('chargeTemplateId', 'name category calculationMethod amount')
      .populate('conditions.roomTypeId', 'name')
      .sort({ priority: -1, name: 1 })
      .lean();
    res.json({ success: true, data: rules });
  } catch (err) {
    console.error('Get charge-rules error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/charge-rules
// @desc    Create a charge rule
// @access  Admin
router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, trigger, priority, conditions, chargeTemplateId, multiplierOverride, isActive } = req.body;
    if (!name || !trigger || !chargeTemplateId) {
      return res.status(400).json({ success: false, message: 'name, trigger, and chargeTemplateId are required' });
    }
    const rule = await ChargeRule.create({ name, trigger, priority, conditions, chargeTemplateId, multiplierOverride, isActive });
    await rule.populate('chargeTemplateId', 'name category calculationMethod amount');
    res.status(201).json({ success: true, data: rule });
  } catch (err: any) {
    console.error('Create charge-rule error:', err);
    if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/charge-rules/:id
// @desc    Update a charge rule
// @access  Admin
router.put('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, trigger, priority, conditions, chargeTemplateId, multiplierOverride, isActive } = req.body;
    const rule = await ChargeRule.findByIdAndUpdate(
      req.params.id,
      { $set: { name, trigger, priority, conditions, chargeTemplateId, multiplierOverride, isActive } },
      { new: true, runValidators: true }
    ).populate('chargeTemplateId', 'name category calculationMethod amount')
     .populate('conditions.roomTypeId', 'name');
    if (!rule) return res.status(404).json({ success: false, message: 'Charge rule not found' });
    res.json({ success: true, data: rule });
  } catch (err: any) {
    console.error('Update charge-rule error:', err);
    if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/charge-rules/:id
// @desc    Delete a charge rule
// @access  Admin
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await ChargeRule.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Charge rule not found' });
    res.json({ success: true, message: 'Charge rule deleted' });
  } catch (err) {
    console.error('Delete charge-rule error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
