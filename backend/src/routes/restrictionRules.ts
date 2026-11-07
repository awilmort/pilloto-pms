/**
 * Booking rules — /api/restriction-rules (CHANNEX_IMPLEMENTATION_PLAN.md Phase 4.2)
 *
 *   GET    /api/restriction-rules?origin&active&from&to  — list (newest first), with summaries
 *   GET    /api/restriction-rules/:id
 *   POST   /api/restriction-rules                        — create a named rule (origin 'manual')
 *   POST   /api/restriction-rules/preview                — summary + problems for an unsaved rule
 *   POST   /api/restriction-rules/check                  — booking rules a stay breaks (staff warnings)
 *   PUT    /api/restriction-rules/:id
 *   DELETE /api/restriction-rules/:id
 *
 * Every rule comes back with `summary: { es, en }`, the plain-language sentence used by the
 * Pricing page, the Calendar and the setup wizard. Calendar-origin rules are written by the
 * Calendar (rate-calendar API), never created here.
 */

import express, { Response } from 'express';
import mongoose from 'mongoose';
import RestrictionRule from '../models/RestrictionRule';
import RoomType from '../models/RoomType';
import RatePlan from '../models/RatePlan';
import { authenticate, authorizeAppAccess, authorizePermission, AuthRequest } from '../middleware/auth';
import { isChannexDate, todayInTz } from '../services/channex/dates';
import { restrictionRuleProblems, summarizeRestrictionRule, RestrictionRuleLike, SummaryNames } from '../services/restrictionRules';
import { stayRestrictionWarnings, toStay } from '../services/stayQuote';
import { recommendedPlanIdsForRooms } from '../services/ratePlanSelection';

const router = express.Router();

const EDITABLE_FIELDS = [
  'name', 'scope', 'roomTypeIds', 'ratePlanIds', 'dateStart', 'dateEnd', 'days',
  'minStayArrival', 'maxStay', 'closedToArrival', 'closedToDeparture', 'stopSell', 'isActive',
] as const;

/** Whitelisted body fields; `null` clears an optional restriction value. */
function pickEditable(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of EDITABLE_FIELDS) if (body?.[f] !== undefined) out[f] = body[f];
  return out;
}

/** The property's local date (tenant timezone, falling back to UTC). */
function propertyToday(req: AuthRequest): string {
  const tz = (req.tenant as any)?.settings?.timezone;
  try { return todayInTz(tz || 'UTC'); } catch { return todayInTz('UTC'); }
}

const isIdList = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((id) => mongoose.Types.ObjectId.isValid(String(id))));

async function loadNames(rules: RestrictionRuleLike[]): Promise<SummaryNames> {
  const rtIds = new Set<string>();
  const rpIds = new Set<string>();
  for (const r of rules) {
    (r.roomTypeIds ?? []).forEach((id) => rtIds.add(String(id)));
    (r.ratePlanIds ?? []).forEach((id) => rpIds.add(String(id)));
  }
  const [rts, rps] = await Promise.all([
    rtIds.size ? RoomType.find({ _id: { $in: [...rtIds] } }).select('name').lean() : Promise.resolve([]),
    rpIds.size ? RatePlan.find({ _id: { $in: [...rpIds] } }).select('name').lean() : Promise.resolve([]),
  ]);
  return {
    roomTypes: Object.fromEntries(rts.map((r: any) => [String(r._id), r.name])),
    ratePlans: Object.fromEntries(rps.map((r: any) => [String(r._id), r.name])),
  };
}

const withSummary = (rule: any, names: SummaryNames) => ({
  ...rule,
  summary: { es: summarizeRestrictionRule(rule, 'es', names), en: summarizeRestrictionRule(rule, 'en', names) },
});

/** 400 message for invalid input, or null. Room types / rate plans must belong to the tenant. */
async function validateInput(req: AuthRequest, rule: Partial<RestrictionRuleLike>): Promise<string | null> {
  if (!isIdList(rule.roomTypeIds) || !isIdList(rule.ratePlanIds)) return 'Invalid room type or rate plan id.';
  if (rule.days !== undefined && !Array.isArray(rule.days)) return 'days must be a list of weekdays (mo, tu, we, th, fr, sa, su).';
  const problems = restrictionRuleProblems(rule, propertyToday(req));
  if (problems.length) return problems.join(' ');
  const rt = rule.roomTypeIds ?? [];
  const rp = rule.ratePlanIds ?? [];
  if (rt.length && (await RoomType.countDocuments({ _id: { $in: rt } })) !== new Set(rt.map(String)).size) return 'One of the room types was not found.';
  if (rp.length && (await RatePlan.countDocuments({ _id: { $in: rp } })) !== new Set(rp.map(String)).size) return 'One of the rate plans was not found.';
  return null;
}

// @route   GET /api/restriction-rules
router.get('/', authenticate, authorizePermission('pms', 'admin.pricing'), async (req: AuthRequest, res: Response) => {
  try {
    const { origin, active, from, to } = req.query;
    const filter: any = {};
    if (origin !== undefined) {
      if (origin !== 'manual' && origin !== 'calendar') return res.status(400).json({ success: false, message: 'origin must be manual or calendar' });
      filter.origin = origin;
    }
    if (active !== undefined) filter.isActive = active === 'true';
    if (from !== undefined || to !== undefined) {
      if (!isChannexDate(from) || !isChannexDate(to) || to < from) {
        return res.status(400).json({ success: false, message: 'from and to must be YYYY-MM-DD dates, with to on or after from' });
      }
      filter.dateStart = { $lte: to };
      filter.dateEnd = { $gte: from };
    }
    const rules = await RestrictionRule.find(filter).sort({ updatedAt: -1 }).lean();
    const names = await loadNames(rules as any);
    res.json({ success: true, data: rules.map((r) => withSummary(r, names)) });
  } catch (err) {
    console.error('Get restriction-rules error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/restriction-rules/preview — plain-language summary for an unsaved rule
router.post('/preview', authenticate, authorizePermission('pms', 'admin.pricing'), async (req: AuthRequest, res: Response) => {
  try {
    const rule = { scope: 'property', days: [], ...pickEditable(req.body) } as unknown as RestrictionRuleLike;
    const problems = isIdList(rule.roomTypeIds) && isIdList(rule.ratePlanIds)
      ? restrictionRuleProblems(rule, propertyToday(req))
      : ['Invalid room type or rate plan id.'];
    const summary = problems.length === 0 || (isChannexDate(rule.dateStart) && isChannexDate(rule.dateEnd))
      ? withSummary(rule, await loadNames([rule])).summary
      : null;
    res.json({ success: true, data: { summary, problems } });
  } catch (err) {
    console.error('Preview restriction-rule error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/restriction-rules/check — { checkIn, checkOut, ratePlanIds?, roomIds? }
// Booking rules the stay breaks on the given plans (or, for rooms, the plan each room would be
// pre-selected on — services/ratePlanSelection.ts). For the admin reservation dialogs:
// warnings staff may override, never errors.
router.post('/check', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { checkIn, checkOut, ratePlanIds, roomIds } = req.body ?? {};
    const stay = isChannexDate(checkIn) && isChannexDate(checkOut) ? toStay(checkIn, checkOut) : null;
    if (!stay || stay.checkOut <= stay.checkIn) {
      return res.status(400).json({ success: false, message: 'checkIn and checkOut must be YYYY-MM-DD dates, with checkOut after checkIn' });
    }
    if ((ratePlanIds !== undefined && !Array.isArray(ratePlanIds)) || (roomIds !== undefined && !Array.isArray(roomIds))
        || !isIdList(ratePlanIds) || !isIdList(roomIds)) {
      return res.status(400).json({ success: false, message: 'Invalid rate plan or room id.' });
    }
    const planIds = [...(ratePlanIds ?? []).map(String), ...(roomIds?.length ? await recommendedPlanIdsForRooms(roomIds.map(String), stay) : [])];
    res.json({ success: true, data: { warnings: await stayRestrictionWarnings({ ...stay, ratePlanIds: planIds }) } });
  } catch (err) {
    console.error('Check restriction-rules error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/restriction-rules/:id
router.get('/:id', authenticate, authorizePermission('pms', 'admin.pricing'), async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const rule = await RestrictionRule.findById(req.params.id).lean();
    if (!rule) return res.status(404).json({ success: false, message: 'Booking rule not found' });
    res.json({ success: true, data: withSummary(rule, await loadNames([rule as any])) });
  } catch (err) {
    console.error('Get restriction-rule error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/restriction-rules
router.post('/', authenticate, authorizePermission('pms', 'admin.pricing'), async (req: AuthRequest, res: Response) => {
  try {
    const input = { scope: 'property', days: [], ...pickEditable(req.body) } as any;
    const invalid = await validateInput(req, input);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const rule = await RestrictionRule.create({ ...input, origin: 'manual', updatedBy: req.user?.id });
    const plain = rule.toObject();
    res.status(201).json({ success: true, data: withSummary(plain, await loadNames([plain as any])) });
  } catch (err: any) {
    console.error('Create restriction-rule error:', err);
    if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/restriction-rules/:id
router.put('/:id', authenticate, authorizePermission('pms', 'admin.pricing'), async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const rule = await RestrictionRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: 'Booking rule not found' });

    const changes = pickEditable(req.body);
    const merged = { ...rule.toObject(), ...changes } as any;
    for (const [k, v] of Object.entries(changes)) if (v === null) delete merged[k];
    const invalid = await validateInput(req, merged);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    for (const [k, v] of Object.entries(changes)) rule.set(k, v === null ? undefined : v);
    rule.updatedBy = req.user?.id;
    await rule.save();
    const plain = rule.toObject();
    res.json({ success: true, data: withSummary(plain, await loadNames([plain as any])) });
  } catch (err: any) {
    console.error('Update restriction-rule error:', err);
    if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/restriction-rules/:id
router.delete('/:id', authenticate, authorizePermission('pms', 'admin.pricing'), async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const rule = await RestrictionRule.findByIdAndDelete(req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: 'Booking rule not found' });
    res.json({ success: true, message: 'Booking rule deleted' });
  } catch (err) {
    console.error('Delete restriction-rule error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
