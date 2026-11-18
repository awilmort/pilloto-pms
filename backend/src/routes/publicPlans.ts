/**
 * GET /api/public/plans — the plans and prices Pilloto sells, for the marketing site's pricing
 * tables. No tenant, no auth: everything here is public list information.
 */
import express, { Request, Response } from 'express';
import { publicCatalog } from '../services/platformBilling/planCatalog';

const router = express.Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ success: true, data: await publicCatalog() });
  } catch (err) {
    console.error('Public plans error:', err);
    res.status(500).json({ success: false, message: 'Could not load the plans' });
  }
});

export default router;
