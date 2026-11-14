/**
 * Guest reservation page opened by number (/reservation/code/:code): the number is sequential and guessable, so
 * it never opens anything by itself — the token from the guest's confirmation must come with it.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import mockEn from '../../../locales/en/translation.json';

const mockGetByCode = jest.fn();
const mockGetByToken = jest.fn();
jest.mock('../../../services/api', () => ({
  reservationsService: {
    getPublicReservationByCode: (...a: any[]) => mockGetByCode(...a),
    getPublicReservation: (...a: any[]) => mockGetByToken(...a),
    cancelPublicReservationByCode: jest.fn(),
    cancelPublicReservation: jest.fn(),
  },
}));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key.split('.').reduce((o: any, p) => (o ? o[p] : undefined), mockEn) ?? key, i18n: { language: 'en' } }),
}));
let mockParams: Record<string, string | undefined> = {};
let mockQuery = '';
jest.mock('react-router-dom', () => ({
  useParams: () => mockParams,
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(mockQuery)],
}));

// eslint-disable-next-line import/first
import ReservationSummaryPage from '../ReservationSummaryPage';

const reservation = { _id: 'r1', reservationCode: 'RES-000007', status: 'confirmed', type: 'room', guestName: { firstName: 'Ada', lastName: 'Lovelace' }, contactInfo: { email: 'a@b.co' },
  checkInDate: new Date().toISOString(), checkOutDate: new Date(Date.now() + 86400000).toISOString(), totalNights: 1, guests: 1, guestDetails: { adults: 1, children: 0, infants: 0 }, estimatedTotal: 100, items: [] };

beforeEach(() => { mockGetByCode.mockReset(); mockGetByToken.mockReset(); mockParams = {}; mockQuery = ''; jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());

describe('ReservationSummaryPage', () => {
  it('opened by number without a token: asks the server nothing and shows "not found"', async () => {
    mockParams = { reservationCode: 'RES-000007' };
    render(<ReservationSummaryPage />);
    expect(await screen.findByText(mockEn.pages.reservationSummary.notFound)).toBeInTheDocument();
    expect(mockGetByCode).not.toHaveBeenCalled();
  });

  it('opened by number with the token: sends both', async () => {
    mockParams = { reservationCode: 'RES-000007' };
    mockQuery = '?token=secret-token';
    mockGetByCode.mockResolvedValue({ data: { data: reservation } });
    render(<ReservationSummaryPage />);
    await waitFor(() => expect(mockGetByCode).toHaveBeenCalledWith('RES-000007', 'secret-token'));
  });

  it('opened by the token link: unchanged', async () => {
    mockParams = { confirmationToken: 'tok' };
    mockGetByToken.mockResolvedValue({ data: { data: reservation } });
    render(<ReservationSummaryPage />);
    await waitFor(() => expect(mockGetByToken).toHaveBeenCalledWith('tok'));
    expect(mockGetByCode).not.toHaveBeenCalled();
  });
});
