/**
 * Property profile (services/propertyProfile.ts, routes/propertyProfile.ts): validation, the
 * views every module reads, the currency lock, and the push of profile edits to the channel
 * manager (provisioning.pushPropertyDetails), and the migration that fills the profile.
 */
import mongoose from 'mongoose';
import {
  currencyDataReason, currencyLock, formatAddress, missingContactFields, parseProfileUpdate, profileView, tenantCurrency,
} from '../services/propertyProfile';
import { pushPropertyDetails, runInTenant } from '../services/channex/provisioning';
import { buildProfileMigration } from '../scripts/migrate-property-profile';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import ChannexProperty from '../models/ChannexProperty';
import Reservation from '../models/Reservation';

describe('parseProfileUpdate', () => {
  it('maps name to the tenant, currency/time zone to settings and the rest to profile, normalized', () => {
    expect(parseProfileUpdate({
      name: ' Hotel Mar ', legalName: 'Mar SRL', rnc: '131-23456-7', email: ' Info@Mar.DO ', phone: '809', country: 'do',
      currency: 'usd', timezone: 'America/Santo_Domingo',
    })).toEqual({
      set: {
        name: 'Hotel Mar', 'profile.legalName': 'Mar SRL', 'profile.rnc': '131234567', 'profile.email': 'info@mar.do', 'profile.phone': '809',
        'profile.country': 'DO', 'settings.currency': 'USD', 'settings.timezone': 'America/Santo_Domingo',
      },
    });
  });

  it('partial updates and clearing optional fields', () => {
    expect(parseProfileUpdate({})).toEqual({ set: {} });
    expect(parseProfileUpdate({ rnc: '', email: '', country: '' })).toEqual({ set: { 'profile.rnc': '', 'profile.email': '', 'profile.country': '' } });
  });

  it.each([
    [{ name: '' }], [{ email: 'nope' }], [{ rnc: '123' }], [{ country: 'DOM' }], [{ currency: 'JPY' }], [{ currency: 'US' }],
    [{ timezone: 'Mars/Base' }], [{ zipCode: 'x'.repeat(21) }], [{ phone: 5 }],
  ])('rejects %j', (body) => {
    expect((parseProfileUpdate(body) as any).errors?.length).toBeGreaterThan(0);
  });
});

describe('views', () => {
  const tenant = { name: 'Hotel Mar', settings: { timezone: 'America/Santo_Domingo' }, profile: { address: 'Calle 1', city: 'Las Terrenas', country: 'DO', zipCode: '32000' } };

  it('profileView fills every field, empty when unset', () => {
    expect(profileView(tenant)).toEqual({
      name: 'Hotel Mar', legalName: '', rnc: '', email: '', phone: '', address: 'Calle 1', city: 'Las Terrenas', state: '', country: 'DO',
      zipCode: '32000', currency: '', timezone: 'America/Santo_Domingo',
    });
  });

  it('an unset currency is DOP', () => {
    expect(tenantCurrency(tenant)).toBe('DOP');
    expect(tenantCurrency({ settings: { currency: 'USD' } })).toBe('USD');
    expect(tenantCurrency(null)).toBe('DOP');
  });

  it('formatAddress joins the non-empty parts for guests', () => {
    expect(formatAddress(tenant.profile)).toBe('Calle 1, Las Terrenas, 32000, DO');
    expect(formatAddress(undefined)).toBe('');
  });

  it('missingContactFields lists what the channel manager still needs', () => {
    expect(missingContactFields(tenant.profile)).toEqual(['email', 'phone']);
  });
});

describe('currency lock and channel-manager push (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const put = jest.fn();
  const client: any = { config: { environment: 'staging', apiKey: 'k', baseUrl: 'https://staging.channex.io/api/v1' }, put };
  const tenant = {
    name: 'Hotel Mar', settings: { currency: 'USD', timezone: 'America/Santo_Domingo' },
    profile: { email: 'info@mar.do', phone: '809', address: 'Calle 1', city: 'Las Terrenas', country: 'DO', zipCode: '32000' },
  };
  const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_profile');
    if (!ready) console.warn('Mongo unreachable — skipping property profile DB tests');
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    put.mockReset();
    if (!ready) return;
    await ChannexProperty.deleteMany({});
    await Reservation.collection.deleteMany({});
  });

  it('reservations or a channel-manager property make a saved currency permanent', async () => {
    if (!ready) return;
    expect(await inTenant(() => currencyDataReason())).toBeNull();
    await Reservation.collection.insertOne({ tenantId, type: 'room', status: 'confirmed' });
    expect(await inTenant(() => currencyDataReason())).toBe('reservations');
    // Another tenant's reservations do not lock this one
    expect(await runInTenant(new mongoose.Types.ObjectId(), () => currencyDataReason())).toBeNull();
    await ChannexProperty.collection.insertOne({ tenantId, environment: 'staging', status: 'active', channexPropertyId: 'cx1' });
    expect(await inTenant(() => currencyDataReason())).toBe('channel_manager');
  });

  it('an unset currency can be chosen once even with reservations; a saved one is locked', () => {
    expect(currencyLock(undefined, 'reservations')).toBeNull();
    expect(currencyLock('', 'channel_manager')).toBeNull();
    expect(currencyLock('USD', 'reservations')).toBe('reservations');
    expect(currencyLock('DOP', null)).toBeNull();
  });

  it('a property without a Channex id yet (failed first enable) does not lock the currency', async () => {
    if (!ready) return;
    await ChannexProperty.collection.insertOne({ tenantId, environment: 'staging', status: 'error' });
    expect(await inTenant(() => currencyDataReason())).toBeNull();
  });

  it('profile edits are pushed to the Channex property: name, time zone, contact — never the currency', async () => {
    if (!ready) return;
    await ChannexProperty.collection.insertOne({ tenantId, environment: 'staging', status: 'active', channexPropertyId: 'cx1' });
    put.mockResolvedValue({ data: {} });
    expect(await inTenant(() => pushPropertyDetails(tenant, client))).toEqual({ pushed: true });
    expect(put).toHaveBeenCalledTimes(1);
    const [path, body] = put.mock.calls[0];
    expect(path).toBe('/properties/cx1');
    expect(body.property).toMatchObject({ title: 'Hotel Mar', timezone: 'America/Santo_Domingo', email: 'info@mar.do', zip_code: '32000' });
    expect(body.property).not.toHaveProperty('currency');
  });

  it('nothing is pushed before the channel manager is set up, and a failure is recorded, not thrown', async () => {
    if (!ready) return;
    expect(await inTenant(() => pushPropertyDetails(tenant, client))).toEqual({ pushed: false });
    expect(put).not.toHaveBeenCalled();

    await ChannexProperty.collection.insertOne({ tenantId, environment: 'staging', status: 'active', channexPropertyId: 'cx1' });
    put.mockRejectedValue(new Error('boom'));
    expect(await inTenant(() => pushPropertyDetails(tenant, client))).toEqual({ pushed: false, error: 'boom' });
    expect((await ChannexProperty.collection.findOne({ tenantId }))?.lastError).toMatch(/boom/);
  });
});

describe('migrate-property-profile', () => {
  const legacy = {
    tenant: { name: 'Hotel Mar', ecfConfig: { rnc: '131-23456-7', razonSocial: 'Mar SRL', nombreComercial: 'Hotel Mar', phone: '809-111' } },
    settings: {
      bookingSettings: { contactPhone: '809-222', contactEmail: 'Reservas@Mar.do', contactAddress: 'Calle 1, Las Terrenas' },
      channelManager: { propertyType: 'hotel', contact: { email: 'reservas@mar.do', phone: '', address: 'Calle 1', city: 'Las Terrenas', state: '', country: 'do', zipCode: '32000' } },
    },
  };

  it('copies each field from the first non-empty source and unsets every old field', () => {
    const m = buildProfileMigration(legacy);
    expect(m.set).toEqual({
      'profile.legalName': 'Mar SRL', 'profile.rnc': '131234567', 'profile.email': 'reservas@mar.do', 'profile.phone': '809-222',
      'profile.address': 'Calle 1', 'profile.city': 'Las Terrenas', 'profile.country': 'DO', 'profile.zipCode': '32000',
    });
    expect(m.unsetTenant.sort()).toEqual(['ecfConfig.nombreComercial', 'ecfConfig.phone', 'ecfConfig.razonSocial', 'ecfConfig.rnc']);
    expect(m.unsetSettings.sort()).toEqual([
      'bookingSettings.contactAddress', 'bookingSettings.contactEmail', 'bookingSettings.contactPhone', 'channelManager.contact', 'channelManager.propertyType',
    ]);
  });

  it('reports sources that disagree (case-insensitive for email), never overwrites the profile', () => {
    const m = buildProfileMigration(legacy);
    expect(m.conflicts).toEqual([
      'phone: profile keeps "809-222", e-invoicing had "809-111"',
      'address: profile keeps "Calle 1", booking engine had "Calle 1, Las Terrenas"',
    ]);
    const kept = buildProfileMigration({ ...legacy, tenant: { ...legacy.tenant, profile: { phone: '809-999' } } });
    expect(kept.set['profile.phone']).toBeUndefined();
  });

  it('a different e-invoicing commercial name is reported, not copied', () => {
    const m = buildProfileMigration({ tenant: { name: 'Hotel Mar', ecfConfig: { nombreComercial: 'Mar Resort' } }, settings: null });
    expect(m.conflicts).toEqual(['name: the property name stays "Hotel Mar", e-invoicing used the commercial name "Mar Resort"']);
  });

  it('second run: nothing to copy or unset', () => {
    const m = buildProfileMigration({ tenant: { name: 'Hotel Mar', profile: { phone: '809-222' }, ecfConfig: {} }, settings: { bookingSettings: {}, channelManager: {} } });
    expect(m).toEqual({ set: {}, unsetTenant: [], unsetSettings: [], conflicts: [] });
  });
});
