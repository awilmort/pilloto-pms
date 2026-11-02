/**
 * Provisioning prerequisites/payloads (services/channex/provisioning.ts, plan Phase 5.1) and
 * structural-sync payloads/diffs (services/channex/structuralSync.ts, plan Phase 5.2).
 * Pure functions — no database, no Channex.
 */

import { computePrerequisites, propertyBody, propertyDetails, isValidTimezone, ProvisioningInput, PROFILE_ROUTE } from '../services/channex/provisioning';
import {
  childrenFeeFor, desiredRoomType, diffRoomType, occupancyOptionsFor, ratePlanBody, ratePlanUpdateBody, roomTypeBody,
} from '../services/channex/structuralSync';

const contact = { email: 'hotel@example.com', phone: '+1 809 555 0100', address: 'Calle 1', city: 'Santo Domingo', state: 'DN', country: 'DO', zipCode: '10101' };
const input = (over: Partial<ProvisioningInput> = {}): ProvisioningInput => ({
  tenantName: 'Test Property - Pilloto', currency: 'USD', timezone: 'America/Santo_Domingo', contact,
  roomTypes: [{ _id: 'twin', name: 'Twin Room', isActive: true }],
  activeRooms: { twin: 8 },
  ratePlans: [{ _id: 'bar', roomTypeId: 'twin', isActive: true }],
  ...over,
});
const failing = (i: ProvisioningInput) => computePrerequisites(i).filter((p) => !p.ok).map((p) => p.id);

describe('provisioning prerequisites', () => {
  it('a complete tenant passes every check', () => {
    expect(failing(input())).toEqual([]);
  });

  it.each([
    ['no currency', { currency: '' }, ['currency']],
    ['bad currency', { currency: 'US' }, ['currency']],
    ['unknown timezone', { timezone: 'Mars/Olympus' }, ['timezone']],
    ['no timezone', { timezone: undefined }, ['timezone']],
    ['missing address', { contact: { ...contact, address: ' ' } }, ['contact']],
    ['bad email', { contact: { ...contact, email: 'nope' } }, ['contact']],
    ['country not 2 letters', { contact: { ...contact, country: 'DOM' } }, ['contact']],
    ['no room types', { roomTypes: [], activeRooms: {}, ratePlans: [] }, ['roomTypes', 'rooms', 'ratePlans']],
    ['room type without active rooms', { activeRooms: {} }, ['rooms', 'ratePlans']],
    ['no rate plan', { ratePlans: [] }, ['ratePlans']],
    ['only inactive rate plans', { ratePlans: [{ _id: 'bar', roomTypeId: 'twin', isActive: false }] }, ['ratePlans']],
    ['rate plan on a room type without rooms', { roomTypes: [{ _id: 'twin', name: 'Twin', isActive: true }, { _id: 'dbl', name: 'Dbl', isActive: true }], activeRooms: { dbl: 1 }, ratePlans: [{ _id: 'bar', roomTypeId: 'twin', isActive: true }] }, ['ratePlans']],
  ])('%s', (_name, over, expected) => {
    expect(failing(input(over as Partial<ProvisioningInput>))).toEqual(expected);
  });

  it('every failed check says what to do and where to fix it, without naming Channex', () => {
    for (const p of computePrerequisites(input({ currency: '', contact: {}, ratePlans: [] })).filter((x) => !x.ok)) {
      expect(p.message.length).toBeGreaterThan(10);
      expect(p.message).not.toMatch(/channex/i);
      expect(p.fixRoute).toMatch(/^\/admin\//);
    }
  });

  it('currency, time zone and contact are fixed in the property profile', () => {
    const checks = computePrerequisites(input({ currency: '', timezone: undefined, contact: {} }));
    for (const id of ['currency', 'timezone', 'contact']) expect(checks.find((c) => c.id === id)?.fixRoute).toBe(PROFILE_ROUTE);
  });

  it('Channex size limits: more than 20 room types is refused', () => {
    const roomTypes = Array.from({ length: 21 }, (_, i) => ({ _id: `t${i}`, name: `T${i}`, isActive: true }));
    const activeRooms = Object.fromEntries(roomTypes.map((r) => [r._id, 1]));
    const ratePlans = roomTypes.map((r) => ({ _id: `p${r._id}`, roomTypeId: r._id, isActive: true }));
    expect(failing(input({ roomTypes, activeRooms, ratePlans }))).toEqual(['limits']);
  });

  it('timezone validation', () => {
    expect(isValidTimezone('America/Santo_Domingo')).toBe(true);
    expect(isValidTimezone('Etc/GMT-12')).toBe(true);
    expect(isValidTimezone('nope')).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
  });
});

describe('property payload', () => {
  it('carries the settings of architecture §6.5 and the contact data', () => {
    const { property } = propertyBody(input(), 'group-1');
    expect(property).toMatchObject({
      title: 'Test Property - Pilloto', currency: 'USD', timezone: 'America/Santo_Domingo', property_type: 'hotel', group_id: 'group-1',
      email: 'hotel@example.com', country: 'DO', zip_code: '10101', city: 'Santo Domingo',
      settings: { min_stay_type: 'arrival', state_length: 500, allow_availability_autoupdate_on_modification: false, allow_availability_autoupdate_on_cancellation: false },
    });
  });

  it('always creates a per-property (hotel) Channex property', () => {
    expect(propertyBody(input(), 'g').property.property_type).toBe('hotel');
  });

  it('property details (sent again after a profile edit) never include the currency', () => {
    const d = propertyDetails(input());
    expect(d).toMatchObject({ title: 'Test Property - Pilloto', timezone: 'America/Santo_Domingo', email: 'hotel@example.com', zip_code: '10101' });
    expect(d).not.toHaveProperty('currency');
  });

  it('normalizes currency and country case', () => {
    const { property } = propertyBody(input({ currency: 'usd', contact: { ...contact, country: 'do' } }), 'g');
    expect(property.currency).toBe('USD');
    expect(property.country).toBe('DO');
  });
});

describe('room type payloads', () => {
  const twin = { _id: 'twin', name: ' Twin Room ', capacity: 3, isActive: true };

  it('occupancy = capacity adults, no child-only beds, traceable meta', () => {
    expect(roomTypeBody(twin, 8, 'prop-1').room_type).toEqual({
      property_id: 'prop-1', title: 'Twin Room', count_of_rooms: 8, occ_adults: 3, occ_children: 0, occ_infants: 0,
      default_occupancy: 3, room_kind: 'room', meta: { pillotoRoomTypeId: 'twin' },
    });
  });

  it('updates carry no property id or meta; zero rooms still sends 1 (Channex minimum)', () => {
    const { room_type } = roomTypeBody(twin, 0);
    expect(room_type.count_of_rooms).toBe(1);
    expect(room_type).not.toHaveProperty('property_id');
    expect(room_type).not.toHaveProperty('meta');
  });

  it('diff: nothing, update, capacity increase / decrease', () => {
    const snap = { title: 'Twin Room', occupancyOptions: [1, 2, 3], countOfRooms: 8 };
    expect(diffRoomType(snap, twin, 8)).toBe('none');
    expect(diffRoomType(snap, { ...twin, name: 'Twin' }, 8)).toBe('update');
    expect(diffRoomType(snap, twin, 9)).toBe('update');
    expect(diffRoomType(snap, { ...twin, capacity: 4 }, 8)).toBe('capacity_increase');
    expect(diffRoomType(snap, { ...twin, capacity: 2 }, 8)).toBe('capacity_decrease');
    expect(desiredRoomType({ ...twin, capacity: 0 }, 2).capacity).toBe(1);
  });
});

describe('rate plan payloads', () => {
  const plan = {
    _id: 'bar', name: 'Best Available Rate', roomTypeId: 'twin', isActive: true,
    occupancyTiers: [
      { guestType: 'adult' as const, guestNumber: 1, price: 0 },
      { guestType: 'child' as const, guestNumber: 2, price: 30 },
      { guestType: 'child' as const, guestNumber: 1, price: 12.5 },
    ],
  };
  const ctx = { channexPropertyId: 'prop-1', channexRoomTypeId: 'rt-1', currency: 'USD' };

  it('always per_person with options 1..capacity, primary = capacity', () => {
    const { rate_plan } = ratePlanBody(plan, 3, ctx);
    expect(rate_plan).toMatchObject({
      title: 'Best Available Rate', property_id: 'prop-1', room_type_id: 'rt-1', currency: 'USD', sell_mode: 'per_person', rate_mode: 'manual',
      meta: { pillotoRatePlanId: 'bar' },
    });
    expect(rate_plan.options).toEqual([
      { occupancy: 1, is_primary: false, rate: 0 }, { occupancy: 2, is_primary: false, rate: 0 }, { occupancy: 3, is_primary: true, rate: 0 },
    ]);
    expect(occupancyOptionsFor(1)).toEqual([1]);
  });

  it('children_fee is the first child tier as a decimal string', () => {
    expect(childrenFeeFor(plan)).toBe(12.5);
    expect(ratePlanBody(plan, 2, ctx).rate_plan.children_fee).toBe('12.50');
    expect(ratePlanBody({ ...plan, occupancyTiers: [] }, 2, ctx).rate_plan.children_fee).toBe('0.00');
  });

  it('updates send only the editable fields (options and sell mode are immutable)', () => {
    expect(ratePlanUpdateBody(plan, ctx, 3)).toEqual({ rate_plan: { title: 'Best Available Rate', children_fee: '12.50' } });
  });
});

// ─── Phase 5.3: settings and readiness ───────────────────────────────────────

import { parseSettingsUpdate } from '../services/channex/provisioning';
import { computeReadiness, hasBlockingErrors } from '../services/channex/readiness';

describe('parseSettingsUpdate (channel-manager options)', () => {
  it('only the three options are stored on the channel-manager settings', () => {
    expect(parseSettingsUpdate({ ratesIncludeTaxes: true, autoAssignRooms: false })).toEqual({
      appSettings: { 'channelManager.ratesIncludeTaxes': true, 'channelManager.autoAssignRooms': false },
    });
    // Profile fields are not channel-manager settings any more: ignored here
    expect(parseSettingsUpdate({ currency: 'USD', contact: { phone: '1' }, propertyType: 'villa' })).toEqual({ appSettings: {} });
  });

  it.each([[{ ratesIncludeTaxes: 'yes' }], [{ sendGuestConfirmationEmail: 1 }]])('rejects %j', (body) => {
    expect((parseSettingsUpdate(body) as any).errors?.length).toBeGreaterThan(0);
  });
});

describe('computeReadiness', () => {
  const ok = computePrerequisites(input());
  const facts = { roomTypesWithoutRooms: [], unattributableReservations: 0, noPriceNights: 0 };

  it('all clear → every check ok, nothing blocks', () => {
    const checks = computeReadiness(ok, facts);
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
    expect(hasBlockingErrors(checks)).toBe(false);
  });

  it('failed prerequisites are errors (block); extra facts are warnings (do not), each with a fix route', () => {
    const checks = computeReadiness(computePrerequisites(input({ currency: '' })), { roomTypesWithoutRooms: ['Suite'], unattributableReservations: 2, noPriceNights: 3 });
    expect(checks.find((c) => c.id === 'currency')?.status).toBe('error');
    expect(hasBlockingErrors(checks)).toBe(true);
    for (const id of ['roomTypesWithoutRooms', 'unattributableReservations', 'noPriceNights']) {
      const c = checks.find((x) => x.id === id)!;
      expect(c.status).toBe('warning');
      expect(c.fixRoute).toMatch(/^\/admin\//);
      expect(c.message).not.toBe('');
    }
    expect(checks.find((c) => c.id === 'unattributableReservations')?.count).toBe(2);
    expect(hasBlockingErrors(computeReadiness(ok, { roomTypesWithoutRooms: ['Suite'], unattributableReservations: 2, noPriceNights: 3 }))).toBe(false);
  });
});
