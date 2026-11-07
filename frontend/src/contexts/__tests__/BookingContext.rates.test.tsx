/**
 * Booking engine cart and rate plans: one plan per room type (choosing another plan replaces
 * it), the promo code travels with the search, and room items priced for another search are
 * dropped when the guest searches again.
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockGetConfig = jest.fn();
const mockGetAvailability = jest.fn();

jest.mock('../../services/api', () => ({
  bookingService: {
    getConfig: (...args: any[]) => mockGetConfig(...args),
    getAvailability: (...args: any[]) => mockGetAvailability(...args),
  },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: jest.fn() } }),
}));

// eslint-disable-next-line import/first
import { BookingProvider, useBooking, BookingItem } from '../BookingContext';

const pricing = (total: number) => ({
  basePrice: total, occupancyCost: 0, subtotal: total, adjustedSubtotal: total, taxes: [], totalTaxes: 0, finalTotal: total, nights: 2, perNight: total / 2,
});
const room = (plans: Array<[string, number, boolean?]>) => ({
  roomType: { _id: 'rt1', name: 'Twin', capacity: 2 },
  availableCount: 3,
  ratePlan: { _id: plans[0][0], name: plans[0][0] },
  ratePlans: plans.map(([id, total, promo]) => ({ _id: id, name: id.toUpperCase(), description: '', isDefault: false, promo: !!promo, pricing: pricing(total) })),
  pricing: pricing(plans[0][1]),
  images: [], features: {}, amenities: [], bedConfiguration: '',
});
const item = (ratePlanId: string, total: number, dates = { checkIn: '2026-12-04', checkOut: '2026-12-06' }): BookingItem => ({
  kind: 'room', roomTypeId: 'rt1', ratePlanId, ratePlanName: ratePlanId.toUpperCase(), roomTypeName: 'Twin', ...dates,
  adults: 2, children: 0, quantity: 1, pricing: { subtotal: total, taxes: 0, total, perNight: total / 2, nights: 2 },
});

function Consumer({ onRender }: { onRender: (ctx: ReturnType<typeof useBooking>) => void }) {
  onRender(useBooking());
  return null;
}

async function setup() {
  let ctx: ReturnType<typeof useBooking>;
  render(<BookingProvider><Consumer onRender={c => { ctx = c; }} /></BookingProvider>);
  await waitFor(() => expect(ctx!.configLoading).toBe(false));
  return () => ctx!;
}

beforeEach(() => {
  mockGetConfig.mockResolvedValue({ data: { data: { enabled: true, currency: 'USD' } } });
  mockGetAvailability.mockReset();
});

it('another rate plan of a room type replaces it in the cart; the same plan again is a no-op', async () => {
  const ctx = await setup();
  act(() => { ctx().addItem(item('bar', 200)); });
  act(() => { ctx().addItem(item('bar', 200)); });
  await waitFor(() => expect(ctx().items).toHaveLength(1));
  act(() => { ctx().addItem(item('bb', 240)); });
  await waitFor(() => expect(ctx().items.map(i => i.ratePlanId)).toEqual(['bb']));
  expect(ctx().totalPrice).toBe(240);
});

it('sends the promo code (upper case) with the search and keeps what the server said about it', async () => {
  mockGetAvailability.mockResolvedValue({ data: { data: [room([['vip', 140, true], ['bar', 200]])], promo: { code: 'AMIGOS', valid: true, applied: true } } });
  const ctx = await setup();
  await act(async () => { await ctx().searchAvailability({ checkIn: '2026-12-04', checkOut: '2026-12-06', adults: 2, children: 0, promoCode: ' amigos ' }); });
  expect(mockGetAvailability).toHaveBeenCalledWith(expect.objectContaining({ promoCode: 'AMIGOS' }));
  expect(ctx().searchParams?.promoCode).toBe('AMIGOS');
  expect(ctx().promo).toEqual({ code: 'AMIGOS', valid: true, applied: true });
  expect(ctx().availability[0].ratePlans.map(p => p._id)).toEqual(['vip', 'bar']);
});

it('a new search drops room items priced for another search, keeps the ones still offered at that price', async () => {
  const ctx = await setup();
  act(() => { ctx().addItem(item('vip', 140)); });
  act(() => { ctx().addItem({ kind: 'service', serviceId: 's1', serviceName: 'Spa', adults: 1, children: 0, quantity: 1, pricing: { subtotal: 20, taxes: 0, total: 20 } }); });

  // Same dates, but without the code the private plan is no longer offered
  mockGetAvailability.mockResolvedValue({ data: { data: [room([['bar', 200], ['bb', 240]])], promo: null } });
  await act(async () => { await ctx().searchAvailability({ checkIn: '2026-12-04', checkOut: '2026-12-06', adults: 2, children: 0 }); });
  expect(ctx().items.map(i => i.kind)).toEqual(['service']);

  act(() => { ctx().addItem(item('bar', 200)); });
  await act(async () => { await ctx().searchAvailability({ checkIn: '2026-12-04', checkOut: '2026-12-06', adults: 2, children: 0 }); });
  expect(ctx().items.map(i => i.ratePlanId ?? i.kind)).toEqual(['service', 'bar']);

  // Other dates: the room item no longer applies
  await act(async () => { await ctx().searchAvailability({ checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 2, children: 0 }); });
  expect(ctx().items.map(i => i.kind)).toEqual(['service']);
});
