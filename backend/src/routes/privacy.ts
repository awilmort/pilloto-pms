import express, { Request, Response } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { handleValidationErrors } from '../middleware/validation';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import PrivacyRequest from '../models/PrivacyRequest';
import TermsAcceptance from '../models/TermsAcceptance';

const router = express.Router();

// ── Rate limit: privacy request submissions ──────────────────────────
const privacyRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many privacy requests from this IP. Please try again later.',
});

// ── PUBLIC: Submit a data subject / privacy request ──────────────────
// POST /api/privacy/requests
router.post(
  '/requests',
  privacyRequestLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
    body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Name is required'),
    body('requestType')
      .isIn(['access', 'deletion', 'rectification', 'portability', 'objection'])
      .withMessage('Invalid request type'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Description must be 2000 characters or fewer'),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { email, name, requestType, description } = req.body;

      const privacyReq = await PrivacyRequest.create({
        email,
        name,
        requestType,
        description: description || '',
      });

      res.status(201).json({
        success: true,
        message: 'Privacy request submitted. We will respond within 30 days.',
        data: { id: privacyReq._id, requestType, status: privacyReq.status },
      });
    } catch (error: any) {
      console.error('Privacy request submission error:', error);
      res.status(500).json({ success: false, message: 'Failed to submit privacy request' });
    }
  }
);

// ── ADMIN: List privacy requests (platform admin) ──────────────────
// GET /api/privacy/requests
router.get(
  '/requests',
  authenticate,
  authorize('superadmin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { status, page = '1', limit = '20' } = req.query;
      const filter: any = {};
      if (status && ['pending', 'in_progress', 'completed', 'denied'].includes(status as string)) {
        filter.status = status;
      }

      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
      const skip = (pageNum - 1) * limitNum;

      const [requests, total] = await Promise.all([
        PrivacyRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
        PrivacyRequest.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: requests,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    } catch (error: any) {
      console.error('List privacy requests error:', error);
      res.status(500).json({ success: false, message: 'Failed to list privacy requests' });
    }
  }
);

// ── ADMIN: Update privacy request status ─────────────────────────────
// PATCH /api/privacy/requests/:id
router.patch(
  '/requests/:id',
  authenticate,
  authorize('superadmin'),
  [
    body('status')
      .isIn(['pending', 'in_progress', 'completed', 'denied'])
      .withMessage('Invalid status'),
    body('resolutionNotes')
      .optional()
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Resolution notes must be 2000 characters or fewer'),
  ],
  handleValidationErrors,
  async (req: AuthRequest, res: Response) => {
    try {
      const update: any = { status: req.body.status };
      if (req.body.resolutionNotes !== undefined) {
        update.resolutionNotes = req.body.resolutionNotes;
      }
      if (req.body.status === 'completed' || req.body.status === 'denied') {
        update.resolvedAt = new Date();
        update.resolvedBy = req.user?._id;
      }

      const request = await PrivacyRequest.findByIdAndUpdate(req.params.id, update, { new: true });
      if (!request) {
        return res.status(404).json({ success: false, message: 'Privacy request not found' });
      }

      res.json({ success: true, data: request });
    } catch (error: any) {
      console.error('Update privacy request error:', error);
      res.status(500).json({ success: false, message: 'Failed to update privacy request' });
    }
  }
);

// ── AUTHENTICATED: Record terms/policy acceptance ────────────────────
// POST /api/privacy/accept
router.post(
  '/accept',
  authenticate,
  [
    body('documentType')
      .isIn(['terms', 'privacy', 'aup'])
      .withMessage('Invalid document type'),
    body('documentVersion')
      .trim()
      .isLength({ min: 1, max: 20 })
      .withMessage('Document version is required'),
  ],
  handleValidationErrors,
  async (req: AuthRequest, res: Response) => {
    try {
      const { documentType, documentVersion } = req.body;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = (req.headers['user-agent'] || '').slice(0, 500);

      const acceptance = await TermsAcceptance.create({
        tenantId: req.tenantId,
        userId: req.user._id,
        documentType,
        documentVersion,
        ipAddress: ip,
        userAgent,
      });

      res.status(201).json({ success: true, data: { id: acceptance._id, acceptedAt: acceptance.acceptedAt } });
    } catch (error: any) {
      console.error('Terms acceptance error:', error);
      res.status(500).json({ success: false, message: 'Failed to record acceptance' });
    }
  }
);

// ── AUTHENTICATED: Get current user's acceptance history ─────────────
// GET /api/privacy/acceptances
router.get(
  '/acceptances',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const acceptances = await TermsAcceptance.find({ userId: req.user._id })
        .sort({ acceptedAt: -1 })
        .lean();

      res.json({ success: true, data: acceptances });
    } catch (error: any) {
      console.error('Get acceptances error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve acceptances' });
    }
  }
);

export default router;
