import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import Invoice from '../../models/Invoice';

/**
 * City Ledger pending-authorization queue (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md
 * Phase 10.4). Every Invoice here was already created automatically at checkout by
 * `cityLedger.service.ts` — this controller only ever reviews/authorizes/declines an
 * existing one, it never creates one itself.
 */

export const listPendingCityLedger = async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '50' } = req.query as Record<string, string | undefined>;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const filter = { 'cityLedger.authorizationStatus': 'pending' };

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .populate('customer', 'name email phone')
        .populate('cityLedger.sourceReservationId', 'reservationCode checkInDate checkOutDate')
        .sort({ issueDate: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean({ virtuals: true }),
      Invoice.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: invoices,
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    console.error('List City Ledger queue error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching City Ledger queue' });
  }
};

export const getPendingCityLedgerCount = async (req: AuthRequest, res: Response) => {
  try {
    const count = await Invoice.countDocuments({ 'cityLedger.authorizationStatus': 'pending' });
    res.status(200).json({ success: true, data: { count } });
  } catch (error: any) {
    console.error('City Ledger pending count error:', error);
    res.status(500).json({ success: false, message: 'Server error while counting City Ledger queue' });
  }
};

// Flips a pending transfer to authorized: status goes 'draft' -> 'sent' directly
// (never through `invoices.controller.ts`'s sendInvoice — no e-CF, no inventory
// deduction, no new GL entry belongs here; see architecture §11.5).
export const authorizeCityLedgerInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (!invoice.cityLedger) {
      return res.status(400).json({ success: false, message: 'Invoice is not a City Ledger transfer' });
    }
    if (invoice.cityLedger.authorizationStatus !== 'pending') {
      return res.status(400).json({ success: false, message: `Cannot authorize — already ${invoice.cityLedger.authorizationStatus}` });
    }

    invoice.cityLedger.authorizationStatus = 'authorized';
    invoice.cityLedger.authorizedBy = req.user._id;
    invoice.cityLedger.authorizedAt = new Date();
    invoice.status = 'sent';
    await invoice.save();

    res.status(200).json({ success: true, message: 'City Ledger transfer authorized', data: invoice });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    console.error('Authorize City Ledger invoice error:', error);
    res.status(500).json({ success: false, message: 'Server error while authorizing City Ledger transfer' });
  }
};

// Voids the transfer. Deliberately does not reopen the folio or reverse the front-desk
// settlement — the guest has already departed and the room already turned over; a declined
// balance becomes a manual write-off matter outside the system (architecture §11.5).
export const declineCityLedgerInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { reason } = req.body as { reason?: string };
    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required to decline a City Ledger transfer' });
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (!invoice.cityLedger) {
      return res.status(400).json({ success: false, message: 'Invoice is not a City Ledger transfer' });
    }
    if (invoice.cityLedger.authorizationStatus !== 'pending') {
      return res.status(400).json({ success: false, message: `Cannot decline — already ${invoice.cityLedger.authorizationStatus}` });
    }

    invoice.cityLedger.authorizationStatus = 'declined';
    invoice.cityLedger.authorizedBy = req.user._id;
    invoice.cityLedger.authorizedAt = new Date();
    invoice.cityLedger.declinedReason = reason.trim();
    invoice.status = 'void';
    await invoice.save();

    res.status(200).json({ success: true, message: 'City Ledger transfer declined', data: invoice });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    console.error('Decline City Ledger invoice error:', error);
    res.status(500).json({ success: false, message: 'Server error while declining City Ledger transfer' });
  }
};
