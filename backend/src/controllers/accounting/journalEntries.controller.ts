import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import JournalEntry from '../../models/JournalEntry';
import Account from '../../models/Account';
import { postJournalEntry } from '../../services/accounting/ledger.service';

/**
 * Manual journal entries (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 9.1).
 * `create` posts through the same `postJournalEntry` primitive every auto-posting
 * hook (Phase 7/8) uses, with `source: 'manual'` and no `sourceRef` — there is no
 * originating AR/AP/inventory document to drill into. `void` is specific to this
 * endpoint (not the shared `reversePostedEntries`, which keys off `sourceModel`/
 * `sourceId` of an *owning* document): it reverses exactly the one entry named by
 * `:id`, referencing it back via `sourceModel: 'JournalEntry'` for drill-down, and
 * is deliberately restricted to `source: 'manual'` entries — an auto-posted entry
 * must be voided through its owning Invoice/Bill/CreditNote/DebitNote action so
 * that document's own status/balance stays in sync with the ledger.
 */

interface ManualLineInput {
  account?: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

export const listJournalEntries = async (req: AuthRequest, res: Response) => {
  try {
    const { source, isVoid, from, to, page = '1', limit = '50' } = req.query as {
      source?: string; isVoid?: string; from?: string; to?: string; page?: string; limit?: string;
    };
    const filter: any = {};
    if (source) filter.source = source;
    if (isVoid !== undefined) filter.isVoid = isVoid === 'true';
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) filter.date.$lte = new Date(to);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [entries, total] = await Promise.all([
      JournalEntry.find(filter)
        .sort({ date: -1, entryNumber: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('lines.account', 'code name')
        .populate('createdBy', 'name email')
        .lean(),
      JournalEntry.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: entries,
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('List journal entries error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching journal entries' });
  }
};

export const getJournalEntry = async (req: AuthRequest, res: Response) => {
  try {
    const entry = await JournalEntry.findById(req.params.id)
      .populate('lines.account', 'code name type normalBalance')
      .populate('createdBy', 'name email')
      .populate('sourceId');
    if (!entry) return res.status(404).json({ success: false, message: 'Journal entry not found' });
    res.status(200).json({ success: true, data: entry });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid journal entry ID' });
    console.error('Get journal entry error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching journal entry' });
  }
};

// Balance/account validation is duplicated here (ahead of `postJournalEntry`'s own
// model-level checks) purely to turn what would otherwise be a generic 500 into a
// precise 400 the client's running balance-check indicator can surface directly.
export const createJournalEntry = async (req: AuthRequest, res: Response) => {
  try {
    const { date, memo, lines } = req.body as { date?: string; memo?: string; lines?: ManualLineInput[] };

    if (!memo || !memo.trim()) {
      return res.status(400).json({ success: false, message: 'memo is required' });
    }
    if (!Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({ success: false, message: 'A journal entry requires at least 2 lines' });
    }
    for (const line of lines) {
      if (!line.account) return res.status(400).json({ success: false, message: 'Every line requires an account' });
      const hasDebit = Number(line.debit) > 0;
      const hasCredit = Number(line.credit) > 0;
      if (hasDebit === hasCredit) {
        return res.status(400).json({ success: false, message: 'Each line must have exactly one of debit or credit greater than zero' });
      }
    }

    const accountIds = Array.from(new Set(lines.map((l) => String(l.account))));
    const foundAccounts = await Account.find({ _id: { $in: accountIds } }).select('_id').lean();
    if (foundAccounts.length !== accountIds.length) {
      return res.status(400).json({ success: false, message: 'One or more accounts are invalid' });
    }

    // A "control" account (has its own sub-accounts, e.g. 6000 Gastos Operativos)
    // only rolls up its children's balances and cannot itself receive postings —
    // `postJournalEntry` enforces this too, but checking it here turns the error
    // into a precise 400 instead of a generic 500, same as the balance check above.
    const controlAccountIds = await Account.find({ parentAccount: { $in: accountIds } }).distinct('parentAccount');
    const postedControlIds = accountIds.filter((id) => controlAccountIds.some((c) => String(c) === id));
    if (postedControlIds.length > 0) {
      const controlAccounts = await Account.find({ _id: { $in: postedControlIds } }).select('code name').lean();
      const names = controlAccounts.map((a) => `${a.code} ${a.name}`).join(', ');
      return res.status(400).json({
        success: false,
        message: `Cannot post to control account(s) ${names} — they only summarize their sub-accounts' balances. Post to a sub-account instead.`,
      });
    }

    const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      return res.status(400).json({
        success: false,
        message: `Journal entry is not balanced: total debits ${totalDebit} do not equal total credits ${totalCredit}`,
      });
    }

    const entry = await postJournalEntry(
      lines.map((l) => ({ account: l.account as string, debit: l.debit, credit: l.credit, memo: l.memo })),
      'manual',
      undefined,
      memo.trim(),
      req.user._id,
      date ? new Date(date) : undefined
    );

    res.status(201).json({ success: true, message: 'Journal entry posted successfully', data: entry });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid account ID' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
    console.error('Create journal entry error:', error);
    res.status(500).json({ success: false, message: 'Server error while posting journal entry' });
  }
};

export const voidJournalEntry = async (req: AuthRequest, res: Response) => {
  try {
    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Journal entry not found' });
    if (entry.isVoid) return res.status(400).json({ success: false, message: 'Journal entry is already void' });
    if (entry.source !== 'manual') {
      return res.status(400).json({
        success: false,
        message: 'Only manual journal entries can be voided directly — void the originating record instead',
      });
    }

    const reason = (req.body?.reason as string | undefined)?.trim();
    const reversal = await postJournalEntry(
      entry.lines.map((line) => ({ account: line.account, debit: line.credit, credit: line.debit, memo: line.memo })),
      'manual',
      { model: 'JournalEntry', id: entry._id as any },
      reason ? `Reversal of ${entry.entryNumber}: ${reason}` : `Reversal of ${entry.entryNumber}`,
      req.user._id
    );

    entry.isVoid = true;
    entry.voidedAt = new Date();
    entry.voidReason = reason;
    await entry.save();

    res.status(200).json({ success: true, message: 'Journal entry voided successfully', data: { journalEntry: entry, reversal } });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid journal entry ID' });
    console.error('Void journal entry error:', error);
    res.status(500).json({ success: false, message: 'Server error while voiding journal entry' });
  }
};
