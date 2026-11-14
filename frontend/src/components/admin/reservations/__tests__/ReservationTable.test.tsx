/**
 * Reservation list table: one contextual primary action per row (check-in / check-out), the rest behind a
 * "more" menu, row click opens the details, delete asks first and only admins see it.
 */
import React from 'react';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import mockEn from '../../../../locales/en/translation.json';

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => key.split('.').reduce((o: any, p) => (o ? o[p] : undefined), mockEn) ?? (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en' },
  }),
}));

// eslint-disable-next-line import/first
import ReservationTable from '../ReservationTable';
// eslint-disable-next-line import/first
import { Reservation } from '../../../../types';

const day = 86400000;
const iso = (offset: number) => new Date(Date.now() + offset * day).toISOString();
const reservation = (over: Partial<Reservation> & Record<string, unknown> = {}): Reservation => ({
  _id: 'r1', type: 'room', status: 'confirmed',
  guestName: { firstName: 'Ada', lastName: 'Lovelace' }, contactInfo: { email: 'ada@example.com' },
  checkInDate: iso(-1), checkOutDate: iso(2), totalNights: 3, guests: 2,
  estimatedTotal: 1000, totalPayments: 1000, room: { _id: 'room1abcd', name: 'Room 1' },
  ...over,
} as unknown as Reservation);

const baseProps = () => ({
  reservations: [reservation()],
  user: { role: 'admin' },
  canCheckIn: true,
  canCheckOut: true,
  emptyTitle: 'Nothing here',
  emptyBody: 'Try other filters',
  onViewDetails: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn().mockResolvedValue(undefined),
  onCheckIn: jest.fn(),
  onCheckOut: jest.fn(),
  onSnackbar: jest.fn(),
});

const moreLabel = mockEn.admin.reservations.actions.moreActions;
const checkIn = mockEn.admin.reservations.actions.checkin;
const checkOut = mockEn.admin.reservations.actions.checkout;

describe('ReservationTable', () => {
  it('shows one primary action per row: check-in, check-out or none', () => {
    const props = baseProps();
    props.reservations = [
      reservation({ _id: 'a', guestName: { firstName: 'Arrives', lastName: '' } }),
      reservation({ _id: 'b', guestName: { firstName: 'Staying', lastName: '' }, status: 'checked-in', actualCheckInAt: iso(-1) }),
      reservation({ _id: 'c', guestName: { firstName: 'Dropped', lastName: '' }, status: 'cancelled' }),
    ] as Reservation[];
    render(<ReservationTable {...props} />);
    const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
    expect(within(row('Arrives')).getByRole('button', { name: checkIn })).toBeEnabled();
    expect(within(row('Staying')).getByRole('button', { name: checkOut })).toBeInTheDocument();
    expect(within(row('Staying')).queryByRole('button', { name: checkIn })).toBeNull();
    expect(within(row('Dropped')).queryByRole('button', { name: checkIn })).toBeNull();
    expect(within(row('Dropped')).queryByRole('button', { name: checkOut })).toBeNull();
  });

  it('blocks check-in for a room reservation with no room assigned', () => {
    const props = baseProps();
    props.reservations = [reservation({ room: undefined })];
    render(<ReservationTable {...props} />);
    expect(screen.getByRole('button', { name: checkIn })).toBeDisabled();
  });

  it('hides check-in/out from users without those permissions', () => {
    const props = { ...baseProps(), canCheckIn: false, canCheckOut: false };
    render(<ReservationTable {...props} />);
    expect(screen.queryByRole('button', { name: checkIn })).toBeNull();
  });

  it('opens the details when the row is clicked, but not when an action is', () => {
    const props = baseProps();
    render(<ReservationTable {...props} />);
    fireEvent.click(screen.getByText('Ada Lovelace'));
    expect(props.onViewDetails).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: checkIn }));
    expect(props.onCheckIn).toHaveBeenCalledWith(props.reservations[0]);
    expect(props.onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('keeps view / edit / delete behind the more menu', () => {
    const props = baseProps();
    render(<ReservationTable {...props} />);
    expect(screen.queryByText(mockEn.admin.reservations.actions.editReservation)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: moreLabel }));
    fireEvent.click(screen.getByText(mockEn.admin.reservations.actions.editReservation));
    expect(props.onEdit).toHaveBeenCalledWith(props.reservations[0]);
  });

  it('asks before deleting, and only for admins', async () => {
    const props = baseProps();
    const confirm = jest.spyOn(window, 'confirm');
    const { rerender } = render(<ReservationTable {...props} />);

    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: moreLabel }));
    fireEvent.click(screen.getByText(mockEn.admin.reservations.actions.removeReservation));
    expect(props.onDelete).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(await screen.findByRole('button', { name: moreLabel }));
    fireEvent.click(screen.getByText(mockEn.admin.reservations.actions.removeReservation));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('r1'));

    rerender(<ReservationTable {...props} user={{ role: 'staff' }} />);
    fireEvent.click(await screen.findByRole('button', { name: moreLabel }));
    expect(screen.queryByText(mockEn.admin.reservations.actions.removeReservation)).toBeNull();
    confirm.mockRestore();
  });

  it('shows placeholders while loading and an empty state only when there is nothing', () => {
    const props = baseProps();
    const { rerender } = render(<ReservationTable {...props} reservations={[]} initialLoading />);
    expect(screen.queryByText('Nothing here')).toBeNull();
    rerender(<ReservationTable {...props} reservations={[]} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Try other filters')).toBeInTheDocument();
  });
});
