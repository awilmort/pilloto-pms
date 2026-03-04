import express, { Response } from 'express';
import CreditAccount from '../models/CreditAccount';
import Guest from '../models/Guest';
import Company from '../models/Company';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = express.Router();

const buildReferenceMaps = async (accounts: Array<any>) => {
  const guestIds = accounts
    .filter(a => a.scope === 'guest')
    .map(a => String(a.referenceId));
  const companyIds = accounts
    .filter(a => a.scope === 'company')
    .map(a => String(a.referenceId));

  const [guests, companies] = await Promise.all([
    guestIds.length > 0
      ? Guest.find({ _id: { $in: guestIds } }).select('firstName lastName email').lean()
      : Promise.resolve([]),
    companyIds.length > 0
      ? Company.find({ _id: { $in: companyIds } }).select('name email').lean()
      : Promise.resolve([]),
  ]);

  const guestMap = new Map(guests.map(g => [String(g._id), g]));
  const companyMap = new Map(companies.map(c => [String(c._id), c]));

  return { guestMap, companyMap };
};

const enrichAccount = (account: any, maps: { guestMap: Map<string, any>; companyMap: Map<string, any> }) => {
  const refId = String(account.referenceId);
  const reference = account.scope === 'guest'
    ? maps.guestMap.get(refId) || null
    : maps.companyMap.get(refId) || null;

  return {
    ...account,
    reference,
  };
};

router.get('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { scope, status, page = '1', limit = '50' } = req.query as Record<string, string>;
    const filter: Record<string, unknown> = {};

    if (scope && ['guest', 'company'].includes(scope)) {
      filter.scope = scope;
    }
    if (status && ['active', 'suspended'].includes(status)) {
      filter.status = status;
    }

    const currentPage = Math.max(1, Number(page) || 1);
    const pageSize = Math.max(1, Number(limit) || 50);
    const skip = (currentPage - 1) * pageSize;

    const [accounts, total] = await Promise.all([
      CreditAccount.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      CreditAccount.countDocuments(filter),
    ]);

    const maps = await buildReferenceMaps(accounts);
    const enriched = accounts.map(a => enrichAccount(a, maps));

    res.status(200).json({ success: true, data: enriched, total });
  } catch (error) {
    console.error('Credit account list error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve credit accounts' });
  }
});

router.get('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const account = await CreditAccount.findById(req.params.id).lean();
    if (!account) {
      return res.status(404).json({ success: false, message: 'Credit account not found' });
    }

    const maps = await buildReferenceMaps([account]);
    const enriched = enrichAccount(account, maps);

    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    console.error('Credit account get error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve credit account' });
  }
});

router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { scope, referenceId, creditLimit, currentExposure = 0, status = 'active' } = req.body || {};
    if (!scope || !referenceId || creditLimit === undefined) {
      return res.status(400).json({ success: false, message: 'scope, referenceId and creditLimit are required' });
    }

    const referenceExists = scope === 'guest'
      ? await Guest.exists({ _id: referenceId })
      : await Company.exists({ _id: referenceId });

    if (!referenceExists) {
      return res.status(400).json({ success: false, message: 'Referenced guest/company not found' });
    }

    const account = await CreditAccount.create({
      scope,
      referenceId,
      creditLimit,
      currentExposure,
      status,
    });

    res.status(201).json({ success: true, data: account });
  } catch (error: any) {
    const message = error?.code === 11000
      ? 'A credit account already exists for this reference'
      : (error?.message || 'Failed to create credit account');
    res.status(400).json({ success: false, message });
  }
});

router.put('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { creditLimit, currentExposure, status } = req.body || {};
    const update: Record<string, unknown> = {};

    if (creditLimit !== undefined) update.creditLimit = creditLimit;
    if (currentExposure !== undefined) update.currentExposure = currentExposure;
    if (status !== undefined) update.status = status;

    const account = await CreditAccount.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );

    if (!account) {
      return res.status(404).json({ success: false, message: 'Credit account not found' });
    }

    res.status(200).json({ success: true, data: account });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error?.message || 'Failed to update credit account' });
  }
});

router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const account = await CreditAccount.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Credit account not found' });
    }

    if ((account.currentExposure || 0) > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete a credit account with outstanding exposure' });
    }

    await account.deleteOne();
    res.status(200).json({ success: true, message: 'Credit account deleted' });
  } catch (error) {
    console.error('Credit account delete error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete credit account' });
  }
});

export default router;
