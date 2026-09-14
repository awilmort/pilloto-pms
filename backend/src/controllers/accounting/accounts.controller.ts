import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import Account from '../../models/Account';
import { NORMAL_BALANCE_BY_ACCOUNT_TYPE } from '../../constants/accounting';

export const listAccounts = async (req: AuthRequest, res: Response) => {
  try {
    const { active, type } = req.query as { active?: string; type?: string };
    const filter: any = {};
    if (active === undefined) filter.isActive = true;
    else if (active !== 'all') filter.isActive = active === 'true';
    if (type) filter.type = type;

    const accounts = await Account.find(filter).sort({ code: 1 }).lean();
    res.status(200).json({ success: true, data: accounts });
  } catch (error) {
    console.error('List accounts error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching accounts' });
  }
};

export const getAccount = async (req: AuthRequest, res: Response) => {
  try {
    const account = await Account.findById(req.params.id).populate('parentAccount', 'code name');
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    res.status(200).json({ success: true, data: account });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid account ID' });
    console.error('Get account error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching account' });
  }
};

async function resolveParentAccount(parentAccountId: unknown): Promise<string | undefined> {
  if (!parentAccountId) return undefined;
  const parent = await Account.findById(parentAccountId);
  if (!parent) throw { status: 400, message: 'Invalid parentAccount' };
  return String(parent._id);
}

// normalBalance is always derived from type — never accepted from the client — so it can
// never drift out of sync (see NORMAL_BALANCE_BY_ACCOUNT_TYPE).
export const createAccount = async (req: AuthRequest, res: Response) => {
  try {
    const { code, name, type, parentAccount } = req.body as {
      code?: string; name?: string; type?: string; parentAccount?: string;
    };
    if (!code || !name) return res.status(400).json({ success: false, message: 'code and name are required' });
    if (!type || !(type in NORMAL_BALANCE_BY_ACCOUNT_TYPE)) {
      return res.status(400).json({ success: false, message: 'type must be one of asset, liability, equity, revenue, expense' });
    }

    const resolvedParent = await resolveParentAccount(parentAccount);

    const account = await Account.create({
      code,
      name,
      type,
      normalBalance: NORMAL_BALANCE_BY_ACCOUNT_TYPE[type as keyof typeof NORMAL_BALANCE_BY_ACCOUNT_TYPE],
      parentAccount: resolvedParent,
      isSystem: false,
    });
    res.status(201).json({ success: true, message: 'Account created successfully', data: account });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.code === 11000) return res.status(400).json({ success: false, message: 'An account with this code already exists' });
    console.error('Create account error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating account' });
  }
};

// System accounts (isSystem: true) can be renamed but never retyped — retyping would
// silently flip normalBalance and invalidate every journal entry already posted against it.
export const updateAccount = async (req: AuthRequest, res: Response) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    const { code, name, type, parentAccount, isActive } = req.body as {
      code?: string; name?: string; type?: string; parentAccount?: string | null; isActive?: boolean;
    };

    if (type !== undefined && type !== account.type) {
      if (account.isSystem) {
        return res.status(400).json({ success: false, message: 'Cannot change the type of a system account' });
      }
      if (!(type in NORMAL_BALANCE_BY_ACCOUNT_TYPE)) {
        return res.status(400).json({ success: false, message: 'type must be one of asset, liability, equity, revenue, expense' });
      }
      account.type = type as any;
      account.normalBalance = NORMAL_BALANCE_BY_ACCOUNT_TYPE[type as keyof typeof NORMAL_BALANCE_BY_ACCOUNT_TYPE];
    }

    if (code !== undefined) account.code = code;
    if (name !== undefined) account.name = name;
    if (isActive !== undefined) account.isActive = isActive;
    if (parentAccount !== undefined) {
      if (parentAccount === null) {
        account.parentAccount = undefined;
      } else if (String(parentAccount) === String(account._id)) {
        return res.status(400).json({ success: false, message: 'An account cannot be its own parent' });
      } else {
        account.parentAccount = (await resolveParentAccount(parentAccount)) as any;
      }
    }

    await account.save();
    res.status(200).json({ success: true, message: 'Account updated successfully', data: account });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid account ID' });
    if (error.code === 11000) return res.status(400).json({ success: false, message: 'An account with this code already exists' });
    console.error('Update account error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating account' });
  }
};

// Archives rather than deletes — JournalEntry lines (Phase 3.2) reference accounts
// permanently. Blocked for system accounts. The plan's second guard ("blocked if
// referenced by a JournalEntry line") applies once JournalEntry lands in Phase 3.2 —
// nothing posts against accounts yet, so there's nothing to check here.
export const deleteAccount = async (req: AuthRequest, res: Response) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    if (account.isSystem) {
      return res.status(400).json({ success: false, message: 'Cannot archive a system account' });
    }

    account.isActive = false;
    await account.save();
    res.status(200).json({ success: true, message: 'Account archived successfully', data: account });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid account ID' });
    console.error('Archive account error:', error);
    res.status(500).json({ success: false, message: 'Server error while archiving account' });
  }
};
