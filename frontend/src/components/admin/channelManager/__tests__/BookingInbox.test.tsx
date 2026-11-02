/**
 * Booking inbox panel (plan Phase 7.2): rows in words, link to the imported reservation,
 * OTA names as hoteliers write them, nothing that names the channel-manager provider.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import mockEn from '../../../../locales/en/translation.json';

const mockBookingInbox = jest.fn();
jest.mock('../../../../services/api', () => ({
  channelManagerService: { bookingInbox: (...args: any[]) => mockBookingInbox(...args) },
}));
jest.mock('react-router-dom', () => ({
  Link: require('react').forwardRef(({ children, to, ...props }: any, ref: any) => <a ref={ref} href={to} {...props}>{children}</a>),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Real English strings, so the test reads what a user reads
    t: (key: string) => key.split('.').reduce((o: any, p) => (o ? o[p] : undefined), mockEn) ?? key,
    i18n: { language: 'en' },
  }),
}));

// eslint-disable-next-line import/first
import BookingInbox from '../BookingInbox';
// eslint-disable-next-line import/first
import { otaLabel } from '../../../../utils/channels';

describe('BookingInbox', () => {
  it('maps OTA names', () => {
    expect(otaLabel('BookingCom')).toBe('Booking.com');
    expect(otaLabel('AirBNB')).toBe('Airbnb');
    expect(otaLabel('SomeNewOta')).toBe('SomeNewOta');
    expect(otaLabel(undefined)).toBe('—');
  });

  it('lists bookings with state in words and a link to the reservation', async () => {
    mockBookingInbox.mockResolvedValue({ data: { data: {
      total: 2, page: 1, limit: 20,
      rows: [
        { _id: '1', receivedAt: '2026-11-01T10:00:00Z', otaName: 'BookingCom', otaReservationCode: 'BDC-123', status: 'new', state: 'imported',
          guestName: 'Ana Pérez', arrivalDate: '2026-12-10', departureDate: '2026-12-12', reservationId: 'r1', acknowledged: true },
        { _id: '2', receivedAt: '2026-11-01T11:00:00Z', otaName: 'Expedia', otaReservationCode: 'EXP-9', status: 'modified', state: 'failed', acknowledged: false },
      ],
    } } });
    render(<BookingInbox active={false} />);
    expect(await screen.findByText('BDC-123')).toHaveAttribute('href', '/admin/reservations?id=r1');
    expect(screen.getByText('Booking.com')).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('Imported')).toBeInTheDocument();
    expect(screen.getByText('Could not import')).toBeInTheDocument();
    expect(screen.getByText(/Some bookings could not be imported/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/channex/i);
  });

  it('says so when nothing has arrived', async () => {
    mockBookingInbox.mockResolvedValue({ data: { data: { total: 0, page: 1, limit: 20, rows: [] } } });
    render(<BookingInbox active={false} />);
    expect(await screen.findByText('No bookings have arrived from your channels yet.')).toBeInTheDocument();
  });
});
