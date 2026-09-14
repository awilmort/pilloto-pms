/**
 * Accounting Routes — /api/accounting/*
 *
 * Mount point for the Accounting app's backend surface
 * (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 2.2). Business logic
 * lives in `backend/src/controllers/accounting/` (fat-controller
 * convention, matching the design precedent this plan ports from) — this
 * file only wires routes to controllers.
 *
 * Phase 3.1 added the Chart of Accounts sub-router; Phase 4.1 added
 * Warehouses/Products (Inventory); Phase 5 added Invoices/Customers/Quotes
 * (AR); Phase 6.1 added Suppliers/Bills (AP); Phase 8.1 adds Credit Notes.
 * Phase 9.1 adds manual Journal Entries; Phase 9.2 adds financial Reports.
 */

import express from 'express';
import { getHealth } from '../../controllers/accounting/health.controller';
import accountsRoutes from './accounts.routes';
import warehousesRoutes from './warehouses.routes';
import productsRoutes from './products.routes';
import invoicesRoutes from './invoices.routes';
import customersRoutes from './customers.routes';
import quotesRoutes from './quotes.routes';
import suppliersRoutes from './suppliers.routes';
import billsRoutes from './bills.routes';
import creditNotesRoutes from './creditNotes.routes';
import debitNotesRoutes from './debitNotes.routes';
import journalEntriesRoutes from './journalEntries.routes';
import reportsRoutes from './reports.routes';
import cityLedgerRoutes from './cityLedger.routes';

const router = express.Router();

router.get('/health', getHealth);
router.use('/accounts', accountsRoutes);
router.use('/warehouses', warehousesRoutes);
router.use('/products', productsRoutes);
router.use('/invoices', invoicesRoutes);
router.use('/customers', customersRoutes);
router.use('/quotes', quotesRoutes);
router.use('/suppliers', suppliersRoutes);
router.use('/bills', billsRoutes);
router.use('/credit-notes', creditNotesRoutes);
router.use('/debit-notes', debitNotesRoutes);
router.use('/journal-entries', journalEntriesRoutes);
router.use('/reports', reportsRoutes);
router.use('/city-ledger', cityLedgerRoutes);

export default router;
