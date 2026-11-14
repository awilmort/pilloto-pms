/** useLoadedOnce: false until loading has finished once, then true for good — later refreshes don't bring placeholders back. */
import { renderHook } from '@testing-library/react';
import { useLoadedOnce } from '../useLoadedOnce';

describe('useLoadedOnce', () => {
  it('is false while the first load is running', () => {
    const { result } = renderHook(({ loading }) => useLoadedOnce(loading), { initialProps: { loading: true } });
    expect(result.current).toBe(false);
  });

  it('turns true when the first load finishes', () => {
    const { result, rerender } = renderHook(({ loading }) => useLoadedOnce(loading), { initialProps: { loading: true } });
    rerender({ loading: false });
    expect(result.current).toBe(true);
  });

  it('stays true when a later refresh starts (counts and totals must not vanish and reappear)', () => {
    const { result, rerender } = renderHook(({ loading }) => useLoadedOnce(loading), { initialProps: { loading: true } });
    rerender({ loading: false });
    rerender({ loading: true });
    expect(result.current).toBe(true);
    rerender({ loading: false });
    expect(result.current).toBe(true);
  });
});
