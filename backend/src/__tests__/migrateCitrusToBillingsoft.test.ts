/**
 * The Citrus → BillingSoft cleanup, against a throwaway Mongo: a dry run writes nothing, applying
 * removes exactly the Citrus records and fields, and everything else is left alone.
 */
import mongoose from 'mongoose';
import { cleanupCitrus } from '../scripts/migrate-citrus-to-billingsoft';
import { connectTestDb, dropTestDb } from './helpers/testDb';

describe('migrate-citrus-to-billingsoft (local Mongo)', () => {
  let ready = false;
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const db = () => mongoose.connection.db!;
  const tenantId = new mongoose.Types.ObjectId();
  const ecfId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_citrus_cleanup');
    if (!ready) console.warn('Mongo unreachable — skipping cleanup DB tests');
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    if (!ready) return;
    for (const c of ['electronicinvoices', 'invoices', 'creditnotes', 'debitnotes', 'tenants', 'journalentries']) await db().collection(c).deleteMany({});
    // the pre-BillingSoft index: unique and sparse
    await db().collection('electronicinvoices').createIndex({ tenantId: 1, eNCF: 1 }, { unique: true, sparse: true });
    await db().collection('electronicinvoices').insertMany([
      { tenantId, eNCF: 'E320000000001', tipo: 'E32', transaccionId: 1 },
      { tenantId, eNCF: 'E320000000002', tipo: 'E32', transaccionId: 2 },
    ]);
    await db().collection('invoices').insertMany([{ invoiceNumber: 'INV-1', electronicInvoiceId: ecfId, status: 'sent' }, { invoiceNumber: 'INV-2', status: 'draft' }]);
    await db().collection('creditnotes').insertOne({ creditNoteNumber: 'CN-1', electronicInvoiceId: ecfId });
    await db().collection('journalentries').insertOne({ sourceModel: 'ElectronicInvoice', sourceId: ecfId });
    await db().collection('tenants').insertMany([
      { _id: tenantId, name: 'Hotel A', ecfConfig: { citrusToken: 'enc', citrusBaseUrl: 'https://test.ecf.citrus.com.do', ambiente: 'Simulacion', isActive: true, sucursal: 'Sosúa', defaultItbisRate: 16 } },
      { name: 'Hotel B', ecfConfig: { defaultItbisRate: 18 } },
      { name: 'Hotel C' },
    ]);
  });

  itDb('a dry run reports what it would do and writes nothing', async () => {
    const r = await cleanupCitrus(db(), false);
    expect(r).toEqual({
      applied: false, electronicInvoices: 2, links: { invoices: 1, creditnotes: 1, debitnotes: 0 },
      tenantsWithCitrusConfig: 1, oldIndexPresent: true, journalEntriesKept: 1,
    });
    expect(await db().collection('electronicinvoices').countDocuments({})).toBe(2);
    expect(await db().collection('invoices').countDocuments({ electronicInvoiceId: { $exists: true } })).toBe(1);
    expect(await db().collection('tenants').countDocuments({ 'ecfConfig.citrusToken': { $exists: true } })).toBe(1);
  });

  itDb('applying deletes the e-CF records, clears the links and the Citrus fields, and drops the old index', async () => {
    const r = await cleanupCitrus(db(), true);
    expect(r.applied).toBe(true);
    expect(await db().collection('electronicinvoices').countDocuments({})).toBe(0);
    expect(await db().collection('invoices').countDocuments({ electronicInvoiceId: { $exists: true } })).toBe(0);
    expect(await db().collection('creditnotes').countDocuments({ electronicInvoiceId: { $exists: true } })).toBe(0);
    const a = await db().collection('tenants').findOne({ _id: tenantId });
    expect(a!.ecfConfig).toEqual({ defaultItbisRate: 16 }); // the tax default survives
    const indexes = await db().collection('electronicinvoices').indexes();
    expect(indexes.some((i) => i.name === 'tenantId_1_eNCF_1')).toBe(false);
  });

  itDb('leaves everything else alone: the invoices themselves, other tenants, and the posted ledger', async () => {
    await cleanupCitrus(db(), true);
    expect(await db().collection('invoices').countDocuments({})).toBe(2);
    expect((await db().collection('invoices').findOne({ invoiceNumber: 'INV-1' }))!.status).toBe('sent');
    expect(await db().collection('tenants').countDocuments({})).toBe(3);
    expect((await db().collection('tenants').findOne({ name: 'Hotel B' }))!.ecfConfig).toEqual({ defaultItbisRate: 18 });
    expect(await db().collection('journalentries').countDocuments({})).toBe(1);
  });

  itDb('is safe to run twice, and on a database with nothing to clean', async () => {
    await cleanupCitrus(db(), true);
    const second = await cleanupCitrus(db(), true);
    expect(second).toMatchObject({ electronicInvoices: 0, tenantsWithCitrusConfig: 0, oldIndexPresent: false });
    for (const c of ['electronicinvoices', 'invoices', 'creditnotes', 'debitnotes', 'tenants', 'journalentries']) await db().collection(c).deleteMany({});
    await expect(cleanupCitrus(db(), true)).resolves.toMatchObject({ electronicInvoices: 0 });
  });

  itDb('does not drop the new partial index', async () => {
    await db().collection('electronicinvoices').dropIndexes();
    await db().collection('electronicinvoices').createIndex({ tenantId: 1, eNCF: 1 }, { unique: true, partialFilterExpression: { eNCF: { $type: 'string' } } });
    const r = await cleanupCitrus(db(), false);
    expect(r.oldIndexPresent).toBe(false);
    await cleanupCitrus(db(), true);
    expect((await db().collection('electronicinvoices').indexes()).some((i) => i.name === 'tenantId_1_eNCF_1')).toBe(true);
  });
});
