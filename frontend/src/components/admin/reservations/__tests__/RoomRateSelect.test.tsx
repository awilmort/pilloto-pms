/**
 * RoomRateSelect: every plan of the room's type with its price and what sets it apart, why the
 * selected plan is selected, and the way back to the pre-selection.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import RoomRateSelect from '../RoomRateSelect';
import type { RateOption, RoomRateOptions } from '../../../../services/api';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts && Object.keys(opts).length ? `${key} ${JSON.stringify(opts)}` : key),
    i18n: { language: 'en' },
  }),
}));
jest.mock('../../../../utils/currency', () => ({ formatMoney: (n: number) => `$${n}` }));

const basePricing = { basePrice: 200, occupancyCost: 0, subtotal: 200, adjustedSubtotal: 200, taxes: [], totalTaxes: 0, finalTotal: 200, nights: 2, perNight: 100 };
const option = (over: Partial<RateOption>): RateOption => ({
  ratePlanId: 'bar', name: 'Best Available Rate', description: '', visibility: 'public', isDefault: false, promoMatch: false,
  contract: null, bookable: true, restrictionMessages: [], restrictionMessage: null, pricing: basePricing,
  ...over,
});
const line = (options: RateOption[], over: Partial<RoomRateOptions> = {}): RoomRateOptions => ({
  roomId: 'r1', roomName: 'T1', roomTypeId: 'rt1', roomTypeName: 'Twin', capacity: 2, assignedAdults: 2, assignedChildren: 0,
  options, recommended: options[0] ? { ratePlanId: options[0].ratePlanId, reason: 'default' } : null, selected: null, error: null, ...over,
});

const options = [
  option({ isDefault: true }),
  option({ ratePlanId: 'bb', name: 'Bed & Breakfast Rate', description: 'Breakfast for two', pricing: { ...basePricing, finalTotal: 240, perNight: 120 } }),
  option({ ratePlanId: 'corp', name: 'Corporate', visibility: 'private', contract: 'company', pricing: { ...basePricing, finalTotal: 190 } }),
  option({ ratePlanId: 'closed', name: 'Non-refundable', bookable: false, restrictionMessages: [{ es: 'Cerrado', en: 'Closed to sale' }] }),
];

it('shows the selected plan with its price and why it is selected', () => {
  render(<RoomRateSelect line={line(options)} value="bar" reason="default" lang="en" onChange={jest.fn()} onReset={jest.fn()} />);
  expect(screen.getByText('Best Available Rate · $200')).toBeInTheDocument();
  expect(screen.getByText('admin.reservations.create.rates.reason.default')).toBeInTheDocument();
  expect(screen.queryByText(/useRecommended/)).not.toBeInTheDocument();
});

it('lists every plan with price, description, badges and booking-rule messages; choosing one reports it', () => {
  const onChange = jest.fn();
  render(<RoomRateSelect line={line(options)} value="bar" reason="default" lang="en" onChange={onChange} onReset={jest.fn()} />);
  fireEvent.mouseDown(screen.getByText('Best Available Rate · $200'));
  const list = within(screen.getByRole('listbox'));
  expect(list.getByText('Bed & Breakfast Rate')).toBeInTheDocument();
  expect(list.getByText(/Breakfast for two/)).toBeInTheDocument();
  expect(list.getByText('$190')).toBeInTheDocument();
  expect(list.getByText('admin.reservations.create.rates.badge.company')).toBeInTheDocument();
  expect(list.getByText('admin.reservations.create.rates.badge.default')).toBeInTheDocument();
  expect(list.getByText('Closed to sale')).toBeInTheDocument();
  fireEvent.click(list.getByText('Corporate'));
  expect(onChange).toHaveBeenCalledWith('corp');
});

it('after a manual choice offers the way back to the pre-selected plan', () => {
  const onReset = jest.fn();
  render(<RoomRateSelect line={line(options)} value="bb" reason="manual" lang="en" onChange={jest.fn()} onReset={onReset} />);
  fireEvent.click(screen.getByText(/admin.reservations.create.rates.useRecommended/));
  expect(onReset).toHaveBeenCalled();
});

it('explains a room without plans', () => {
  render(<RoomRateSelect line={line([], { error: 'no_rate_plan' })} value="" reason={null} lang="en" onChange={jest.fn()} onReset={jest.fn()} />);
  expect(screen.getByText('admin.reservations.create.rates.error.no_rate_plan')).toBeInTheDocument();
});
