/**
 * Reservation "History" section: loads only when opened, then shows who did what and when,
 * edits as "field: before → after", amounts, and marks rows reconstructed from older data.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import mockEn from '../../../../locales/en/translation.json';

const mockHistory = jest.fn();
jest.mock('../../../../services/api', () => ({
  reservationsService: { getHistory: (...a: any[]) => mockHistory(...a) },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) => {
      const v = key.split('.').reduce((o: any, p) => (o ? o[p] : undefined), mockEn);
      if (typeof v !== 'string') return typeof arg === 'string' ? arg : key;
      return v.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(arg?.[k] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

// eslint-disable-next-line import/first
import ReservationHistorySection from '../ReservationHistorySection';

describe('reservation history UI', () => {
  it('fetches on first open and renders actors, diffs, notes and amounts', async () => {
    mockHistory.mockResolvedValue({ data: { data: [
      { id: 'e3', at: '2026-11-03T10:00:00Z', action: 'moved', actor: { kind: 'user', name: 'Ana Front' },
        changes: [{ field: 'rooms', from: ['T1'], to: ['T2'] }, { field: 'status', from: 'pending', to: 'confirmed' }] },
      { id: 'e2', at: '2026-11-02T10:00:00Z', action: 'payment_recorded', actor: { kind: 'user', name: 'Ana Front' }, amount: 100, method: 'cash', note: 'deposit' },
      { id: 'e1', at: '2026-11-01T10:00:00Z', action: 'created', actor: { kind: 'channel', name: 'Booking.com' }, inferred: true },
      { id: 'e0', at: '2026-11-01T09:00:00Z', action: 'cancelled', actor: { kind: 'guest' }, note: 'Flight cancelled' },
    ] } });
    render(<ReservationHistorySection reservationId="r1" formatCurrency={(v) => `RD$${v}`} />);
    expect(mockHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('Moved')).toBeInTheDocument();
    expect(mockHistory).toHaveBeenCalledWith('r1');
    expect(screen.getByText('Rooms: T1 → T2')).toBeInTheDocument();
    expect(screen.getByText('Status: Pending → Confirmed')).toBeInTheDocument();
    expect(screen.getByText('RD$100')).toBeInTheDocument();
    expect(screen.getByText('Deposit · Cash')).toBeInTheDocument();
    expect(screen.getByText('Channel: Booking.com')).toBeInTheDocument();
    expect(screen.getByText('(earlier record)')).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(screen.getByText('Flight cancelled')).toBeInTheDocument();
  });

  it('names a channel actor, and explains "Offline" (bookings entered in the channel manager)', async () => {
    mockHistory.mockResolvedValue({ data: { data: [
      { id: 'e2', at: '2026-11-05T10:00:00Z', action: 'channel_modified', actor: { kind: 'channel', name: 'Offline' } },
      { id: 'e1', at: '2026-11-05T09:00:00Z', action: 'created', actor: { kind: 'channel' } },
    ] } });
    render(<ReservationHistorySection reservationId="r2" formatCurrency={(v) => `RD$${v}`} />);
    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('Channel: Offline (booking entered directly in the channel manager)')).toBeInTheDocument();
    expect(screen.getByText('Channel')).toBeInTheDocument();
  });
});
