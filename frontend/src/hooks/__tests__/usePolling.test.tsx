/** usePolling: ticks while visible, stays quiet while hidden, catches up on return, honours `enabled`. */
import React from 'react';
import { render, act } from '@testing-library/react';
import { usePolling } from '../usePolling';

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

const Probe: React.FC<{ cb: () => void; ms?: number; enabled?: boolean }> = ({ cb, ms = 1000, enabled = true }) => {
  usePolling(cb, ms, enabled);
  return null;
};

beforeEach(() => { jest.useFakeTimers(); setVisibility('visible'); });
afterEach(() => { jest.useRealTimers(); });

describe('usePolling', () => {
  it('ticks every interval and does not run on mount', () => {
    const cb = jest.fn();
    render(<Probe cb={cb} />);
    expect(cb).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(3000); });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('makes no calls while the tab is hidden and catches up once when it is visible again', () => {
    const cb = jest.fn();
    render(<Probe cb={cb} />);
    act(() => { setVisibility('hidden'); jest.advanceTimersByTime(5000); });
    expect(cb).not.toHaveBeenCalled();
    act(() => { setVisibility('visible'); });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on return when a tick has just run', () => {
    const cb = jest.fn();
    render(<Probe cb={cb} />);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => { setVisibility('hidden'); setVisibility('visible'); });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is idle while disabled and stops on unmount', () => {
    const cb = jest.fn();
    const { rerender, unmount } = render(<Probe cb={cb} enabled={false} />);
    act(() => { jest.advanceTimersByTime(3000); });
    expect(cb).not.toHaveBeenCalled();
    rerender(<Probe cb={cb} enabled />);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(cb).toHaveBeenCalledTimes(1);
    unmount();
    act(() => { jest.advanceTimersByTime(3000); });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('always calls the latest callback without restarting the timer', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<Probe cb={first} />);
    act(() => { jest.advanceTimersByTime(500); });
    rerender(<Probe cb={second} />);
    act(() => { jest.advanceTimersByTime(500); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
