/**
 * Reservation channel UI (plan Phase 7.4): the badge and the "Channel" section of the details.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import mockEn from '../../../../locales/en/translation.json';

const mockHistory = jest.fn();
jest.mock('../../../../services/api', () => ({
  reservationsService: { getChannelHistory: (...a: any[]) => mockHistory(...a) },
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
import ChannelBadge from '../ChannelBadge';
// eslint-disable-next-line import/first
import ReservationChannelSection from '../ReservationChannelSection';

const source = {
  provider: 'channex' as const, otaName: 'Booking.com', otaCode: 'BDC', otaReservationCode: '4021337', paymentCollect: 'ota' as const,
  paymentType: 'credit_card', otaCommission: 30, currency: 'USD',
  guaranteeSummary: { cardType: 'MC', last4: '1111', expirationDate: '12/2027', isVirtual: true, virtualCardCurrency: 'USD', virtualCardBalance: 220 },
};

describe('channel UI', () => {
  it('badge shows the OTA and its code, nothing for direct bookings', () => {
    const { container, rerender } = render(<ChannelBadge source={source} />);
    expect(screen.getByText('Booking.com 4021337')).toBeInTheDocument();
    rerender(<ChannelBadge source={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('channel section: who collects, commission, masked card and the change history', async () => {
    mockHistory.mockResolvedValue({ data: { data: [
      { _id: 'h1', receivedAt: '2026-11-01T10:00:00Z', status: 'new', state: 'imported', acknowledged: true },
      { _id: 'h2', receivedAt: '2026-11-02T10:00:00Z', status: 'modified', state: 'outdated', acknowledged: true },
    ] } });
    render(<ReservationChannelSection reservationId="r1" source={source} formatCurrency={(v) => `US$${v}`} />);
    expect(screen.getByText(/The channel charges the guest and pays the property/)).toBeInTheDocument();
    expect(screen.getByText('US$30')).toBeInTheDocument();
    expect(screen.getByText(/MC · •••• 1111 · expires 12\/2027 · virtual card · balance 220.00 USD/)).toBeInTheDocument();
    expect(await screen.findByText('Modified')).toBeInTheDocument();
    expect(screen.getByText('Already updated')).toBeInTheDocument();
    expect(mockHistory).toHaveBeenCalledWith('r1');
    expect(document.body.textContent).not.toMatch(/channex/i);
  });
});
