/**
 * Bank accounts & reconciliation — /api/accounting/bank-accounts/* (the Esencial plan and up).
 *
 *   GET    /                                   accounts with book balance and lines to review
 *   POST   /                                   new bank account (with its own GL account)
 *   PUT    /:id                                rename, default, archive
 *   GET    /:id/statement-lines                statement lines (+ suggested matches for unmatched ones)
 *   POST   /:id/statement-lines                add one by hand
 *   POST   /:id/statement-lines/import         { rows: [{ date, description, amount, reference? }] }
 *   DELETE /:id/statement-lines/:lineId
 *   POST   /:id/statement-lines/:lineId/match   { lines: [journal line ids] }
 *   POST   /:id/statement-lines/:lineId/unmatch
 *   POST   /:id/statement-lines/:lineId/ignore  { ignore: boolean }
 *   POST   /:id/statement-lines/:lineId/entry   { account, memo? }  post the missing entry and match it
 *   GET    /:id/book-lines                      the bank's journal lines (?uncleared=true)
 *   GET    /:id/reconciliation                  the open reconciliation (or null) and the last closed one
 *   POST   /:id/reconciliation                  { statementDate, statementEndingBalance, openingBalance? }
 *   POST   /:id/reconciliation/:recId/close
 *   GET    /:id/reconciliations                 history
 */
import express, { Response } from 'express';
import { Types } from 'mongoose';
import { authenticate, authorizePermission, AuthRequest } from '../../middleware/auth';
import { requireAccountingFeature } from '../../services/entitlements';
import BankAccount, { IBankAccount } from '../../models/BankAccount';
import BankReconciliation from '../../models/BankReconciliation';
import BankStatementLine from '../../models/BankStatementLine';
import * as bank from '../../services/accounting/bank.service';

const router = express.Router();
router.use(authenticate);
router.use(requireAccountingFeature('bankReconciliation'));

const VIEW = authorizePermission('accounting', 'accounting.banks.view', 'accounting.banks.manage');
const MANAGE = authorizePermission('accounting', 'accounting.banks.manage');

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;
const act = (fn: Handler, status = 200) => async (req: AuthRequest, res: Response) => {
  try {
    const data = await fn(req, res);
    if (res.headersSent) return;
    res.status(status).json({ success: true, data });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
    if (err?.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    console.error('Bank accounts error:', err?.message ?? err);
    res.status(500).json({ success: false, message: 'The bank action failed' });
  }
};

async function bankOf(req: AuthRequest): Promise<IBankAccount> {
  await bank.ensureDefaultBankAccount();
  const id = req.params.id;
  const found = Types.ObjectId.isValid(id) ? await BankAccount.findById(id) : null;
  if (!found) throw Object.assign(new Error('Bank account not found'), { status: 404 });
  return found;
}

router.get('/', VIEW, act(async () => {
  await bank.ensureDefaultBankAccount();
  const accounts = await BankAccount.find({}).populate('glAccount', 'code name').sort({ isDefault: -1, name: 1 });
  return Promise.all(accounts.map(async (a) => ({
    ...a.toObject(),
    balance: await bank.glBalance((a.glAccount as any)._id ?? a.glAccount),
    unmatched: await BankStatementLine.countDocuments({ bankAccount: a._id, status: 'unmatched' }),
    lastReconciled: (await BankReconciliation.findOne({ bankAccount: a._id, status: 'closed' }).sort({ statementDate: -1 }).select('statementDate').lean())?.statementDate ?? null,
  })));
}));

router.post('/', MANAGE, act(async (req) => bank.createBankAccount(req.body ?? {}), 201));

router.put('/:id', MANAGE, act(async (req) => {
  const a = await bankOf(req);
  const b = req.body ?? {};
  if (b.name !== undefined) {
    if (!String(b.name).trim()) throw Object.assign(new Error('name is required'), { status: 400 });
    a.name = String(b.name).trim();
  }
  if (b.bankName !== undefined) a.bankName = b.bankName || undefined;
  if (b.accountNumberLast4 !== undefined) a.accountNumberLast4 = b.accountNumberLast4 || undefined;
  if (b.isActive === false && a.isDefault) throw Object.assign(new Error('Make another account the default first'), { status: 409 });
  if (b.isActive !== undefined) a.isActive = !!b.isActive;
  if (b.isDefault === true && !a.isDefault) {
    await BankAccount.updateMany({ _id: { $ne: a._id }, isDefault: true }, { $set: { isDefault: false } });
    a.isDefault = true;
  }
  await a.save();
  return a;
}));

// ─── Statement lines ─────────────────────────────────────────────────────────

router.get('/:id/statement-lines', VIEW, act(async (req) => {
  const a = await bankOf(req);
  const q = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = { bankAccount: a._id };
  if (q.status === 'unmatched' || q.status === 'matched' || q.status === 'ignored') filter.status = q.status;
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const lines = await BankStatementLine.find(filter).sort({ date: -1, createdAt: -1 }).limit(1000).lean();
  const unmatched = lines.filter((l) => l.status === 'unmatched');
  const book = unmatched.length ? await bank.bookLines(a, { unclearedOnly: true }) : [];
  const suggestions = bank.suggestMatches(unmatched as any, book);
  const byId = new Map(unmatched.map((l, i) => [String(l._id), suggestions[i].slice(0, 5)]));
  return lines.map((l) => ({ ...l, suggestions: byId.get(String(l._id)) ?? [] }));
}));

router.post('/:id/statement-lines', MANAGE, act(async (req) => bank.addStatementLines(await bankOf(req), [req.body ?? {}], 'manual', req.user?._id), 201));
router.post('/:id/statement-lines/import', MANAGE, act(async (req) => bank.addStatementLines(await bankOf(req), req.body?.rows, 'import', req.user?._id), 201));
router.delete('/:id/statement-lines/:lineId', MANAGE, act(async (req) => { await bank.deleteStatementLine(await bankOf(req), req.params.lineId); return { deleted: true }; }));
router.post('/:id/statement-lines/:lineId/match', MANAGE, act(async (req) => bank.matchLine(await bankOf(req), req.params.lineId, req.body?.lines)));
router.post('/:id/statement-lines/:lineId/unmatch', MANAGE, act(async (req) => bank.unmatchLine(await bankOf(req), req.params.lineId)));
router.post('/:id/statement-lines/:lineId/ignore', MANAGE, act(async (req) => bank.ignoreLine(await bankOf(req), req.params.lineId, req.body?.ignore !== false)));
router.post('/:id/statement-lines/:lineId/entry', MANAGE, act(async (req) =>
  bank.createEntryForLine(await bankOf(req), req.params.lineId, String(req.body?.account ?? ''), req.body?.memo, req.user?._id)));

router.get('/:id/book-lines', VIEW, act(async (req) => {
  const q = req.query as Record<string, string | undefined>;
  return bank.bookLines(await bankOf(req), { from: q.from, to: q.to, unclearedOnly: q.uncleared === 'true' });
}));

// ─── Reconciliation ──────────────────────────────────────────────────────────

router.get('/:id/reconciliation', VIEW, act(async (req) => {
  const a = await bankOf(req);
  const open = await BankReconciliation.findOne({ bankAccount: a._id, status: 'open' });
  const last = await BankReconciliation.findOne({ bankAccount: a._id, status: 'closed' }).sort({ statementDate: -1 });
  return { open: open ? await bank.viewReconciliation(a, open) : null, lastClosed: last };
}));

router.post('/:id/reconciliation', MANAGE, act(async (req) => {
  const a = await bankOf(req);
  const b = req.body ?? {};
  const rec = await bank.startReconciliation(a, String(b.statementDate ?? ''), Number(b.statementEndingBalance), b.openingBalance === undefined ? undefined : Number(b.openingBalance));
  return bank.viewReconciliation(a, rec);
}));

router.post('/:id/reconciliation/:recId/close', MANAGE, act(async (req) => bank.closeReconciliation(await bankOf(req), req.params.recId, req.user?._id)));

router.get('/:id/reconciliations', VIEW, act(async (req) => {
  const a = await bankOf(req);
  return BankReconciliation.find({ bankAccount: a._id }).sort({ statementDate: -1 }).limit(60);
}));

export default router;
