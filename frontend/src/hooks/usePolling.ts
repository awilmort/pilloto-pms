import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Calls `callback` every `intervalMs` while `enabled`, but only while the tab is visible — a backgrounded
 * tab makes no requests. When the tab becomes visible again it refreshes at once if a tick was skipped
 * (i.e. at least one interval has passed since the last run).
 *
 * It does not run the callback on mount: callers keep their own initial load, so a change of query
 * (page, filter) still reloads immediately. The latest `callback` is always used, so it needs no
 * `useCallback` and never restarts the timer.
 */
export function usePolling(
  callback: () => unknown,
  intervalMs: number,
  enabled: boolean = true
): void {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let lastRun = Date.now();
    const run = () => {
      lastRun = Date.now();
      // Loaders handle their own errors; a rejection here must not become an unhandled one.
      Promise.resolve(latest.current()).catch(() => undefined);
    };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRun >= intervalMs) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled]);
}
