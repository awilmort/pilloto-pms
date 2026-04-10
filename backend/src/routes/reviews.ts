import express, { Response } from 'express';
import { body } from 'express-validator';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { handleValidationErrors } from '../middleware/validation';
import Review from '../models/Review';

const router = express.Router();

// ── GET /api/reviews — list all reviews (admin) ─────────────────────────────
router.get('/', authenticate, authorize('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    const reviews = await Review.find().sort({ displayOrder: 1, createdAt: -1 }).lean();
    res.json({ success: true, data: reviews });
  } catch (error: any) {
    console.error('List reviews error:', error);
    res.status(500).json({ success: false, message: 'Failed to load reviews.' });
  }
});

// ── POST /api/reviews — create a review (admin) ─────────────────────────────
router.post(
  '/',
  authenticate,
  authorize('admin'),
  [
    body('guestName').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Guest name is required (max 120 chars).'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1–5.'),
    body('comment').isString().trim().isLength({ min: 1, max: 500 }).withMessage('Comment is required (max 500 chars).'),
    body('source').optional().isString().trim().isLength({ max: 60 }),
    body('isActive').optional().isBoolean(),
    body('displayOrder').optional().isInt({ min: 0 }),
  ],
  handleValidationErrors,
  async (req: AuthRequest, res: Response) => {
    try {
      const { guestName, rating, comment, source, isActive, displayOrder } = req.body;
      const review = await Review.create({
        guestName,
        rating,
        comment,
        source: source || 'Direct',
        isActive: isActive !== undefined ? isActive : true,
        displayOrder: displayOrder || 0,
      });
      res.status(201).json({ success: true, data: review });
    } catch (error: any) {
      console.error('Create review error:', error);
      res.status(500).json({ success: false, message: 'Failed to create review.' });
    }
  }
);

// ── PUT /api/reviews/:id — update a review (admin) ──────────────────────────
router.put(
  '/:id',
  authenticate,
  authorize('admin'),
  [
    body('guestName').optional().isString().trim().isLength({ min: 1, max: 120 }),
    body('rating').optional().isInt({ min: 1, max: 5 }),
    body('comment').optional().isString().trim().isLength({ min: 1, max: 500 }),
    body('source').optional().isString().trim().isLength({ max: 60 }),
    body('isActive').optional().isBoolean(),
    body('displayOrder').optional().isInt({ min: 0 }),
  ],
  handleValidationErrors,
  async (req: AuthRequest, res: Response) => {
    try {
      const review = await Review.findByIdAndUpdate(
        req.params.id,
        { $set: req.body },
        { new: true, runValidators: true }
      );
      if (!review) {
        return res.status(404).json({ success: false, message: 'Review not found.' });
      }
      res.json({ success: true, data: review });
    } catch (error: any) {
      console.error('Update review error:', error);
      res.status(500).json({ success: false, message: 'Failed to update review.' });
    }
  }
);

// ── DELETE /api/reviews/:id — delete a review (admin) ────────────────────────
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }
    res.json({ success: true, message: 'Review deleted.' });
  } catch (error: any) {
    console.error('Delete review error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete review.' });
  }
});

export default router;
