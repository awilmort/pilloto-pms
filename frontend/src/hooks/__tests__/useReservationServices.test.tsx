/** useReservationServices: one shared fetch, cached across pages, never a wrong-then-right layout. */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockGetServices = jest.fn();
jest.mock('../../services/api', () => ({ servicesService: { getServices: (...a: any[]) => mockGetServices(...a) } }));

// eslint-disable-next-line import/first
import { useReservationServices, invalidateReservationServices, loadReservationServices } from '../useReservationServices';

const reply = (kinds: string[]) => ({ data: { data: kinds.map((kind) => ({ kind })) } });
const Probe: React.FC = () => {
  const { services, ready } = useReservationServices();
  return <p data-testid="out">{ready ? 'ready' : 'waiting'}:{Object.entries(services).filter(([, on]) => on).map(([k]) => k).join(',')}</p>;
};

beforeEach(() => { mockGetServices.mockReset(); invalidateReservationServices(); });

describe('useReservationServices', () => {
  it('is not ready until the answer arrives, then reports the enabled kinds', async () => {
    mockGetServices.mockResolvedValue(reply(['daypass', 'event']));
    render(<Probe />);
    expect(screen.getByTestId('out')).toHaveTextContent('waiting:accommodation');
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('ready:daypass,accommodation,event'));
  });

  it('fetches once for any number of simultaneous readers', async () => {
    mockGetServices.mockResolvedValue(reply(['daypass']));
    render(<><Probe /><Probe /><Probe /></>);
    await waitFor(() => expect(screen.getAllByTestId('out')[0]).toHaveTextContent('ready'));
    expect(mockGetServices).toHaveBeenCalledTimes(1);
  });

  it('serves a later page from the cache: ready on the very first render, no request', async () => {
    mockGetServices.mockResolvedValue(reply(['pasatarde']));
    await act(async () => { await loadReservationServices(); });
    mockGetServices.mockClear();
    render(<Probe />);
    expect(screen.getByTestId('out')).toHaveTextContent('ready:accommodation,pasatarde');
    expect(mockGetServices).not.toHaveBeenCalled();
  });

  it('fetches again after an invalidation (a service was edited)', async () => {
    mockGetServices.mockResolvedValueOnce(reply(['daypass']));
    await act(async () => { await loadReservationServices(); });
    invalidateReservationServices();
    mockGetServices.mockResolvedValueOnce(reply([]));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('ready:accommodation'));
    expect(mockGetServices).toHaveBeenCalledTimes(2);
  });

  it('falls back to the defaults when the request fails, without caching the failure', async () => {
    mockGetServices.mockRejectedValueOnce(new Error('boom'));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('ready:accommodation'));
    mockGetServices.mockResolvedValueOnce(reply(['event']));
    await act(async () => { expect((await loadReservationServices()).event).toBe(true); });
  });
});
