/**
 * Reservation page (/admin/reservations/:id): loads by id from the URL, says clearly when the reservation does
 * not exist, offers a retry on a failed load, and "back" goes where the user came from.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import mockEn from '../../../locales/en/translation.json';

const mockGetReservation = jest.fn();
jest.mock('../../../services/api', () => ({ reservationsService: { getReservation: (...a: any[]) => mockGetReservation(...a) } }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key.split('.').reduce((o: any, p) => (o ? o[p] : undefined), mockEn) ?? key, i18n: { language: 'en' } }),
}));
const mockNavigate = jest.fn();
let mockLocationKey = 'abc';
let mockRef = 'r1';
jest.mock('react-router-dom', () => ({
  useParams: () => ({ id: mockRef }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/admin/reservations/r1', search: '', key: mockLocationKey }),
}));
jest.mock('../../../components/admin/ReservationDetails', () => ({ reservation, onBack }: any) => (
  <div><p>details of {reservation.guestName.firstName}</p><button onClick={onBack}>go back</button></div>
));

// eslint-disable-next-line import/first
import ReservationDetailPage from '../ReservationDetailPage';

const ok = { data: { data: { _id: 'r1', guestName: { firstName: 'Ada', lastName: 'Lovelace' } } } };
const d = mockEn.admin.reservations.details;

beforeEach(() => { mockGetReservation.mockReset(); mockNavigate.mockReset(); mockLocationKey = 'abc'; mockRef = 'r1'; });

describe('ReservationDetailPage', () => {
  it('loads the reservation named in the URL and shows it', async () => {
    mockGetReservation.mockResolvedValue(ok);
    render(<ReservationDetailPage />);
    expect(await screen.findByText('details of Ada')).toBeInTheDocument();
    expect(mockGetReservation).toHaveBeenCalledWith('r1');
    expect(mockGetReservation).toHaveBeenCalledTimes(1);
  });

  it.each([404, 400])('shows a clear not-found page for a %s', async (status) => {
    mockGetReservation.mockRejectedValue({ response: { status } });
    render(<ReservationDetailPage />);
    expect(await screen.findByText(d.notFoundTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: d.back }));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/reservations');
  });

  it('offers a retry when the load fails for another reason', async () => {
    mockGetReservation.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce(ok);
    render(<ReservationDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: d.retry }));
    expect(await screen.findByText('details of Ada')).toBeInTheDocument();
    expect(mockGetReservation).toHaveBeenCalledTimes(2);
  });

  it('goes back in history when the user came from inside the app', async () => {
    mockGetReservation.mockResolvedValue(ok);
    render(<ReservationDetailPage />);
    fireEvent.click(await screen.findByText('go back'));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('falls back to the list when opened from a direct link (nothing to go back to)', async () => {
    mockLocationKey = 'default';
    mockGetReservation.mockResolvedValue(ok);
    render(<ReservationDetailPage />);
    fireEvent.click(await screen.findByText('go back'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin/reservations'));
  });

  describe('the URL carries the reservation code', () => {
    const withCode = { data: { data: { _id: 'r1', reservationCode: 'B26X7KQ', guestName: { firstName: 'Ada', lastName: 'Lovelace' } } } };

    it('rewrites an id URL to the code URL (replacing history), without fetching twice', async () => {
      mockGetReservation.mockResolvedValue(withCode);
      render(<ReservationDetailPage />);
      await screen.findByText('details of Ada');
      expect(mockNavigate).toHaveBeenCalledWith('/admin/reservations/B26X7KQ', { replace: true });
      expect(mockGetReservation).toHaveBeenCalledTimes(1);
    });

    it('leaves a code URL alone', async () => {
      mockRef = 'B26X7KQ';
      mockGetReservation.mockResolvedValue(withCode);
      render(<ReservationDetailPage />);
      await screen.findByText('details of Ada');
      expect(mockGetReservation).toHaveBeenCalledWith('B26X7KQ');
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('normalises a lower-case code to the canonical one', async () => {
      mockRef = 'b26x7kq';
      mockGetReservation.mockResolvedValue(withCode);
      render(<ReservationDetailPage />);
      await screen.findByText('details of Ada');
      expect(mockNavigate).toHaveBeenCalledWith('/admin/reservations/B26X7KQ', { replace: true });
    });

    it('keeps a reservation that has no code on its id URL', async () => {
      mockGetReservation.mockResolvedValue(ok);
      render(<ReservationDetailPage />);
      await screen.findByText('details of Ada');
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
