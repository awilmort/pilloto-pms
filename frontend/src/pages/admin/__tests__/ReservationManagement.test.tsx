/**
 * Reservation list data flow: the first page is fetched once (no second fetch 300 ms later from a stale
 * closure), each filter change fetches once, an older answer never overwrites a newer one, and the rows
 * stay on screen while a new filter is loading — the list never flashes empty.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import mockEn from '../../../locales/en/translation.json';

const mockGetReservations = jest.fn();
jest.mock('../../../services/api', () => ({
  reservationsService: {
    getReservations: (...a: any[]) => mockGetReservations(...a),
    getChannelSources: () => Promise.resolve({ data: { data: [] } }),
    getReservation: () => Promise.resolve({ data: { data: null } }),
    deleteReservation: jest.fn(),
  },
  roomsService: { getRooms: () => Promise.resolve({ data: { data: { rooms: [] } } }) },
  servicesService: { getServices: () => Promise.resolve({ data: { data: [] } }) },
}));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, o?: any) => key.split('.').reduce((x: any, p) => (x ? x[p] : undefined), mockEn) ?? key,
    i18n: { language: 'en' },
  }),
}));
const mockNavigate = jest.fn();
let mockSearch = '';
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/admin/reservations', search: mockSearch }),
  useNavigate: () => mockNavigate,
}));
jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin' }, permissions: [] }),
}));
jest.mock('../../../components/admin/reservations/EditReservationDialog', () => () => null);
jest.mock('../../../components/admin/reservations/CheckInOutDialog', () => () => null);
jest.mock('../../../components/admin/reservations/CreateReservationDialog', () => () => null);

// eslint-disable-next-line import/first
import ReservationManagement from '../ReservationManagement';

const row = (id: string, name: string, status = 'confirmed') => ({
  _id: id, type: 'room', status, guestName: { firstName: name, lastName: '' }, contactInfo: { email: `${id}@x.com` },
  checkInDate: new Date().toISOString(), checkOutDate: new Date(Date.now() + 86400000).toISOString(),
  totalNights: 1, guests: 1, estimatedTotal: 100, totalPayments: 0,
});
const page = (rows: any[]) => ({ data: { data: rows, pagination: { page: 1, totalPages: 1, total: rows.length } } });
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>((r) => { resolve = r; }); return { promise, resolve }; };
const chip = (status: keyof typeof mockEn.admin.reservations.statusLabels) => screen.getByRole('button', { name: mockEn.admin.reservations.statusLabels[status] });

beforeEach(() => { mockGetReservations.mockReset(); mockNavigate.mockReset(); mockSearch = ''; });

describe('ReservationManagement list loading', () => {
  it('fetches the first page once, even after the old 300 ms refetch would have fired', async () => {
    mockGetReservations.mockResolvedValue(page([row('a', 'Ada')]));
    render(<ReservationManagement />);
    await screen.findByText('Ada');
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); }); // longer than the old 300 ms refetch delay
    expect(mockGetReservations).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });

  it('fetches once per filter change, sending the filter', async () => {
    mockGetReservations.mockResolvedValue(page([row('a', 'Ada')]));
    render(<ReservationManagement />);
    await screen.findByText('Ada');
    fireEvent.click(chip('pending'));
    await waitFor(() => expect(mockGetReservations).toHaveBeenCalledTimes(2));
    expect(mockGetReservations).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'pending', page: 1 }));
  });

  it('keeps showing the rows while a new filter loads — never an empty list', async () => {
    mockGetReservations.mockResolvedValueOnce(page([row('a', 'Ada', 'pending')]));
    render(<ReservationManagement />);
    await screen.findByText('Ada');
    const slow = deferred();
    mockGetReservations.mockReturnValueOnce(slow.promise);
    fireEvent.click(chip('pending'));
    await waitFor(() => expect(mockGetReservations).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.queryByText(mockEn.admin.reservations.empty.title)).toBeNull();
    await act(async () => { slow.resolve(page([row('b', 'Grace', 'pending')])); });
    expect(await screen.findByText('Grace')).toBeInTheDocument();
  });

  it('ignores an older answer that arrives after a newer one', async () => {
    mockGetReservations.mockResolvedValueOnce(page([row('a', 'Ada')]));
    render(<ReservationManagement />);
    await screen.findByText('Ada');
    const older = deferred();
    const newer = deferred();
    mockGetReservations.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    fireEvent.click(chip('pending'));
    await waitFor(() => expect(mockGetReservations).toHaveBeenCalledTimes(2));
    fireEvent.click(chip('confirmed'));
    await waitFor(() => expect(mockGetReservations).toHaveBeenCalledTimes(3));
    await act(async () => { newer.resolve(page([row('n', 'Newest', 'confirmed')])); });
    await act(async () => { older.resolve(page([row('o', 'Stale', 'pending')])); });
    expect(await screen.findByText('Newest')).toBeInTheDocument();
    expect(screen.queryByText('Stale')).toBeNull();
  });

  it('opens a reservation on its own page when its row is clicked (id URL when it has no code)', async () => {
    mockGetReservations.mockResolvedValue(page([row('abc123', 'Ada')]));
    render(<ReservationManagement />);
    fireEvent.click(await screen.findByText('Ada'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/reservations/abc123');
  });

  it('links to the reservation code when it has one, so the URL is the code staff use', async () => {
    mockGetReservations.mockResolvedValue(page([{ ...row('abc123', 'Ada'), reservationCode: 'B26X7KQ' }]));
    render(<ReservationManagement />);
    fireEvent.click(await screen.findByText('Ada'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/reservations/B26X7KQ');
  });

  it('redirects an old ?id= link to the reservation page (replacing, so Back does not loop)', async () => {
    mockSearch = '?id=abc123';
    mockGetReservations.mockResolvedValue(page([]));
    render(<ReservationManagement />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin/reservations/abc123', { replace: true }));
  });

  it('starts from the filters in the URL, so Back from a reservation returns to the same list', async () => {
    mockSearch = '?status=pending&q=ada&source=direct';
    mockGetReservations.mockResolvedValue(page([row('a', 'Ada', 'pending')]));
    render(<ReservationManagement />);
    await screen.findByText('Ada');
    expect(mockGetReservations).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', search: 'ada', source: 'direct' }));
  });

  it('writes filter changes into the URL without adding history entries', async () => {
    mockGetReservations.mockResolvedValue(page([row('a', 'Ada')]));
    render(<ReservationManagement />);
    await screen.findByText('Ada');
    mockNavigate.mockClear();
    fireEvent.click(chip('pending'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/admin/reservations', search: '?status=pending' }, { replace: true }));
  });
});
