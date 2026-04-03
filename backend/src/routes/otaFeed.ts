/**
 * otaFeed.ts — Public outbound iCal feed endpoint
 *
 * GET /api/ota/feed/:token
 *
 * Token-authenticated, no JWT required.
 * Returns iCal (text/calendar) content for the mapped listing.
 * No tenant auth required — the opaque token IS the auth.
 */

import express, { Request, Response } from 'express';
import { generateOutboundFeed } from '../utils/otaWorker';

const router = express.Router();

router.get('/:token', async (req: Request, res: Response) => {
  const { token } = req.params;

  // Validate token format: 64 hex chars
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(404).end();
  }

  try {
    const icalContent = await generateOutboundFeed(token);

    if (!icalContent) {
      return res.status(404).end();
    }

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="pilloto-calendar.ics"');
    res.set('Cache-Control', 'no-store');
    res.send(icalContent);
  } catch (err: any) {
    console.error('OTA feed error:', err?.message || err);
    res.status(500).end();
  }
});

export default router;
