/**
 * The issuing pipeline against a local Mongo: intent saved first, idempotent, safe to retry, and a
 * refusal that leaves nothing behind. The BillingSoft side is a stateful fake.
 */
import mongoose from 'mongoose';

jest.mock('../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue('email-id') }));

/* eslint-disable import/first */
import { sendEmail } from '../utils/email';
import ElectronicInvoice from '../models/ElectronicInvoice';
import Tenant from '../models/Tenant';
import { tenantLocalStorage } from '../middleware/tenantContext';
import { FiscalError } from '../services/fiscal/fiscalCore';
import { issueFiscalDocument, sendIntent } from '../services/fiscal/fiscalIssuer';
import { setBillingSoftClient } from '../services/fiscal/fiscalClient';
import { resendPendingIntents, sweepOpenDocuments, sweepDelayMs } from '../services/fiscal/fiscalJobs';
import { folioInvoiceRequest } from '../services/fiscal/mappers';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import { createFakeBillingSoft, FakeBillingSoft, networkError, serverError, validationError } from './helpers/fakeBillingSoft';
/* eslint-enable import/first */

describe('fiscal issuer (local Mongo)', () => {
  let ready = false;
  let fake: FakeBillingSoft;
  const tenantId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const inTenant = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ tenantId: String(tenantId) }, fn);
  const loadTenant = () => Tenant.findById(tenantId).then((t) => t!);
  const request = () => folioInvoiceRequest({ charges: [{ description: 'Habitación 101', amount: 11800 }], payments: [{ method: 'cash' }] });
  const issue = async (over: Record<string, unknown> = {}) =>
    inTenant(async () => issueFiscalDocument({ tenant: await loadTenant(), route: 'invoices', request: request(), actorId: userId, source: 'manual', ...over }));

  beforeAll(async () => {
    process.env.BILLINGSOFT_PARTNER_API_KEY = 'test-partner-key';
    ready = await connectTestDb('pilloto_fiscal_issuer');
    if (ready) await Promise.all([ElectronicInvoice.init()]); // unique indexes exist before the first write
    if (!ready) console.warn('Mongo unreachable — skipping fiscal issuer DB tests');
  });
  afterAll(async () => {
    setBillingSoftClient(null);
    delete process.env.BILLINGSOFT_PARTNER_API_KEY;
    if (ready) await dropTestDb();
  });
  beforeEach(async () => {
    if (!ready) return;
    fake = createFakeBillingSoft();
    setBillingSoftClient(fake.client);
    await ElectronicInvoice.collection.deleteMany({});
    await Tenant.collection.deleteMany({});
    await Tenant.collection.insertOne({
      _id: tenantId, name: 'Hotel Prueba', slug: 'prueba', plan: 'pro', ownerEmail: 'dueno@prueba.com', isActive: true, products: ['pms'],
      fiscal: { organizationId: 'org-1', environment: 'ecf', certification: 'certified', isActive: true, plan: 'essential' },
    });
  });

  itDb('issues, stores the BillingSoft document and fills totals and the security code from it', async () => {
    const { record, queued } = await issue();
    expect(queued).toBe(false);
    expect(record).toMatchObject({
      estadoECF: 'En Proceso', estatus: 'in_process', tipo: 'E32', route: 'invoices', environment: 'ecf',
      totalFactura: 11800, totalImpuestos: 1800, codigoSeguridad: 'SEC123', generationSource: 'manual',
    });
    expect(record.eNCF).toMatch(/^E32\d{10}$/);
    expect(record.billingsoftDocumentId).toBeDefined();
    expect(record.lineItems?.[0]).toMatchObject({ description: 'Habitación 101', netPrice: 10000, itbisAmount: 1800 });
  });

  itDb('the same idempotency key never issues a second document', async () => {
    const a = await issue({ idempotencyKey: 'pms-payment-1-0' });
    const b = await issue({ idempotencyKey: 'pms-payment-1-0' });
    expect(String(b.record._id)).toBe(String(a.record._id));
    expect(fake.created()).toBe(1);
    expect(await ElectronicInvoice.countDocuments({ tenantId })).toBe(1);
  });

  itDb('when BillingSoft cannot be reached the intent is saved, queued, and the caller is told', async () => {
    fake.failNext('issue', networkError());
    const { record, queued } = await issue({ idempotencyKey: 'k1' });
    expect(queued).toBe(true);
    expect(record).toMatchObject({ estadoECF: 'Pendiente', mensaje: 'Pendiente de envío a BillingSoft', retryCount: 1 });
    expect(record.eNCF).toBeUndefined();
    expect(record.request).toBeDefined();
    expect(fake.created()).toBe(0);
  });

  itDb('a 5xx is treated like an unreachable BillingSoft', async () => {
    fake.failNext('issue', serverError());
    expect((await issue()).queued).toBe(true);
  });

  itDb('the queued document is sent by the next sweep with the same key — once', async () => {
    fake.failNext('issue', networkError());
    const { record } = await issue({ idempotencyKey: 'k2' });
    // not yet: a request may still be in flight
    expect(await resendPendingIntents(new Date(), 100)).toBe(0);
    const later = new Date(Date.now() + 60_000);
    expect(await resendPendingIntents(later)).toBe(1);
    const sent = await ElectronicInvoice.findById(record._id);
    expect(sent).toMatchObject({ estadoECF: 'En Proceso' });
    expect(sent!.eNCF).toBeDefined();
    expect(fake.created()).toBe(1);
    // and sending it again changes nothing
    await sendIntent(sent!, await loadTenant(), false);
    expect(fake.created()).toBe(1);
  });

  itDb('a timeout that BillingSoft actually processed is recovered without issuing twice', async () => {
    // BillingSoft created the document but the answer was lost.
    const first = await issue({ idempotencyKey: 'k3' });
    await ElectronicInvoice.updateOne({ _id: first.record._id }, { $set: { estadoECF: 'Pendiente' }, $unset: { eNCF: '', billingsoftDocumentId: '' } });
    const pending = (await ElectronicInvoice.findById(first.record._id))!;
    const { record } = await sendIntent(pending, await loadTenant(), false);
    expect(fake.created()).toBe(1);
    expect(record.estadoECF).toBe('En Proceso');
    expect(record.eNCF).toBe(first.record.eNCF);
  });

  itDb('a refusal issued nothing: the record is removed and the reason is thrown', async () => {
    fake.failNext('issue', validationError('El RNC del comprador no existe'));
    await expect(issue()).rejects.toMatchObject({ statusCode: 400, code: 'FISCAL_REJECTED', message: 'El RNC del comprador no existe' });
    expect(await ElectronicInvoice.countDocuments({ tenantId })).toBe(0);
  });

  itDb('after a refusal the same key can be used again (BillingSoft released it)', async () => {
    fake.failNext('issue', validationError());
    await expect(issue({ idempotencyKey: 'k4' })).rejects.toBeInstanceOf(FiscalError);
    const { record } = await issue({ idempotencyKey: 'k4' });
    expect(record.estadoECF).toBe('En Proceso');
  });

  itDb('in the background a refusal marks the record Error instead of deleting it', async () => {
    fake.failNext('issue', networkError());
    const { record } = await issue({ idempotencyKey: 'k5' });
    fake.failNext('issue', validationError('Datos inválidos'));
    const { record: after } = await sendIntent(record, await loadTenant(), false);
    expect(after).toMatchObject({ estadoECF: 'Error', mensaje: 'Datos inválidos' });
  });

  itDb('gives up on a document BillingSoft never confirmed after 24 hours', async () => {
    fake.failNext('issue', networkError());
    const { record } = await issue({ idempotencyKey: 'k6' });
    fake.failNext('issue', networkError());
    const { record: after, queued } = await sendIntent(record, await loadTenant(), false, new Date(Date.now() + 25 * 3600_000));
    expect(queued).toBe(false);
    expect(after).toMatchObject({ estadoECF: 'Error', mensaje: expect.stringContaining('24 horas') });
  });

  itDb('refuses before saving anything when the company cannot issue', async () => {
    await Tenant.collection.updateOne({ _id: tenantId }, { $set: { 'fiscal.certification': 'in_progress' } });
    await expect(issue()).rejects.toMatchObject({ code: 'FISCAL_NOT_CERTIFIED' });
    await Tenant.collection.updateOne({ _id: tenantId }, { $set: { 'fiscal.certification': 'certified', 'fiscal.isActive': false } });
    await expect(issue()).rejects.toMatchObject({ code: 'FISCAL_SUSPENDED' });
    expect(await ElectronicInvoice.countDocuments({ tenantId })).toBe(0);
    expect(fake.calls.filter((c) => c.startsWith('issue'))).toHaveLength(0);
  });

  itDb('the sweep follows a document to DGII\'s verdict and stops there', async () => {
    const { record } = await issue();
    fake.setStatus(record.billingsoftDocumentId!, 'accepted');
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await sweepOpenDocuments(later)).toBe(1);
    expect(await ElectronicInvoice.findById(record._id)).toMatchObject({ estadoECF: 'Aceptado', estatus: 'accepted' });
    expect(await sweepOpenDocuments(new Date(later.getTime() + 3600_000))).toBe(0); // terminal: not asked again
  });

  itDb('a rejection keeps DGII\'s message on the record', async () => {
    const { record } = await issue();
    fake.setStatus(record.billingsoftDocumentId!, 'rejected');
    await sweepOpenDocuments(new Date(Date.now() + 5 * 60_000));
    const rejected = await ElectronicInvoice.findById(record._id);
    expect(rejected).toMatchObject({ estadoECF: 'Rechazado', mensaje: 'Rechazado por DGII' });
    // the owner is told, once
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail as jest.Mock).mock.calls[0][0]).toMatchObject({ to: 'dueno@prueba.com' });
    await sweepOpenDocuments(new Date(Date.now() + 3600_000));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  itDb('the sweep backs off as a document ages', async () => {
    expect(sweepDelayMs(0)).toBe(60_000);
    expect(sweepDelayMs(12)).toBe(600_000);
    expect(sweepDelayMs(80)).toBe(3_600_000);
    const { record } = await issue();
    const checked = (await ElectronicInvoice.findById(record._id))!;
    // checked just now: not due again within the minute
    expect(await sweepOpenDocuments(new Date(checked.lastStatusCheck!.getTime() + 10_000))).toBe(0);
  });

  itDb('never exposes one company\'s documents to another', async () => {
    await issue();
    const other = new mongoose.Types.ObjectId();
    const seen = await tenantLocalStorage.run({ tenantId: String(other) }, async () => ElectronicInvoice.countDocuments({}));
    expect(seen).toBe(0);
  });
});
