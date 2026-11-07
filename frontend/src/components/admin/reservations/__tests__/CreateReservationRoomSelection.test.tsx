/**
 * New reservation, room step: a party that needs several rooms. Every selected room gets its
 * rate plan in the "Your selection" panel beside the room picker (the panel scrolls its own list
 * rather than covering the rooms), the action bar always shows guests covered + total, and a
 * room can be taken out from the panel.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import mockEn from '../../../../locales/en/translation.json';

const mockAvailableRooms = jest.fn();
const mockRateOptions = jest.fn();
jest.mock('../../../../services/api', () => ({
  reservationsService: { createReservation: jest.fn() },
  roomsService: { getAvailableRooms: (...a: any[]) => mockAvailableRooms(...a) },
  pricingService: { getRateOptions: (...a: any[]) => mockRateOptions(...a), calculateServicePrice: jest.fn() },
  companiesService: { getCompanies: jest.fn() },
  servicesService: { getServices: jest.fn() },
}));
jest.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin' }, permissions: [], discountLimit: 0 }),
}));
jest.mock('../../../common/DateRangePicker', () => () => null);
jest.mock('../../../../utils/currency', () => ({ formatMoney: (n: number) => `$${n}` }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    // t(key), t(key, opts), t(key, fallback) and t(key, fallback, opts)
    t: (key: string, a?: any, b?: any) => {
      const opts = typeof a === 'object' ? a : b;
      const v = key.split('.').reduce((o: any, p) => (o ? o[p] : undefined), mockEn);
      if (typeof v !== 'string') return typeof a === 'string' ? a : key;
      return v.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts?.[k] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

// eslint-disable-next-line import/first
import CreateReservationDialog from '../CreateReservationDialog';

const double = { _id: 'rt-d', name: 'Double', capacity: 2 };
const rooms = ['101', '102', '103', '104', '105'].map(n => ({ _id: `r${n}`, name: n, roomTypeId: double }));
const pricing = { basePrice: 200, occupancyCost: 0, subtotal: 200, adjustedSubtotal: 200, taxes: [], totalTaxes: 0, finalTotal: 200, nights: 2, perNight: 100 };

beforeEach(() => {
  jest.useFakeTimers();
  mockAvailableRooms.mockResolvedValue({ data: { data: rooms } });
  // Every requested room priced on one plan at $200
  mockRateOptions.mockImplementation(({ roomIds }: { roomIds: string[] }) => Promise.resolve({ data: { data: {
    checkIn: '2026-12-01', checkOut: '2026-12-03', nights: 2, promo: null,
    rooms: roomIds.map(id => ({
      roomId: id, roomName: id.slice(1), roomTypeId: 'rt-d', roomTypeName: 'Double', capacity: 2, assignedAdults: 2, assignedChildren: 0,
      options: [{ ratePlanId: 'bar', name: 'Best Available Rate', description: '', visibility: 'public', isDefault: true, promoMatch: false,
        contract: null, bookable: true, restrictionMessages: [], restrictionMessage: null, pricing }],
      recommended: { ratePlanId: 'bar', reason: 'default' }, selected: null, error: null,
    })),
  } } }));
});
afterEach(() => jest.useRealTimers());

async function openWithEightAdults() {
  render(
    <CreateReservationDialog
      open onClose={jest.fn()} onCreated={jest.fn()} onSnackbar={jest.fn()}
      reservationServices={{ accommodation: true, daypass: false, pasatarde: false, event: false }}
      defaultType="room" defaultCheckIn="2026-12-01" defaultCheckOut="2026-12-03"
    />,
  );
  await screen.findByRole('button', { name: /^101/ });
  const adults = screen.getByLabelText('Adults');
  fireEvent.change(adults, { target: { value: '8' } });
  fireEvent.blur(adults);
}

async function settleRates() {
  await act(async () => { jest.advanceTimersByTime(400); });
}

it('lists every selected room with its rate plan beside the picker, with guests covered and total always visible', async () => {
  await openWithEightAdults();
  const panel = screen.getByTestId('room-selection-panel');
  expect(within(panel).getByText('Pick rooms from the list. You need room for 8 guests.')).toBeInTheDocument();

  for (const n of ['101', '102', '103', '104']) fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${n}`) }));
  await settleRates();

  await waitFor(() => expect(within(panel).getAllByText('Best Available Rate · $200')).toHaveLength(4));
  expect(within(panel).getByText('4 selected')).toBeInTheDocument();
  expect(within(panel).getByText('$800')).toBeInTheDocument();
  // Room picker stays usable: the fifth room is still there to click
  expect(screen.getByRole('button', { name: /^105/ })).toHaveAttribute('aria-pressed', 'false');

  const summary = screen.getByTestId('room-selection-summary');
  expect(within(summary).getByText('8/8 guests')).toBeInTheDocument();
  expect(within(summary).getByText('$800')).toBeInTheDocument();
});

it('takes a room out from the selection panel', async () => {
  await openWithEightAdults();
  for (const n of ['101', '102']) fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${n}`) }));
  await settleRates();
  const panel = screen.getByTestId('room-selection-panel');
  await waitFor(() => expect(within(panel).getAllByText('Best Available Rate · $200')).toHaveLength(2));

  fireEvent.click(within(panel).getByRole('button', { name: 'Remove 101' }));
  await settleRates();

  expect(screen.getByRole('button', { name: /^101/ })).toHaveAttribute('aria-pressed', 'false');
  await waitFor(() => expect(within(panel).getAllByText('Best Available Rate · $200')).toHaveLength(1));
  expect(within(screen.getByTestId('room-selection-summary')).getByText('2/8 guests')).toBeInTheDocument();
  expect(within(panel).getByText('Selected rooms fit 2 guests, but 8 are needed.')).toBeInTheDocument();
});

it('shows a picked room right away, before its price is back', async () => {
  await openWithEightAdults();
  fireEvent.click(screen.getByRole('button', { name: /^103/ }));
  const panel = screen.getByTestId('room-selection-panel');
  expect(within(panel).getByText('103')).toBeInTheDocument();
  expect(within(panel).getByRole('button', { name: 'Remove 103' })).toBeInTheDocument();
});
