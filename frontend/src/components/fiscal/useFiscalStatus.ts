import { useCallback, useEffect, useState } from 'react';
import { fiscalService } from '../../services/api';
import type { FiscalStatus } from '../../types';

/**
 * The company's e-CF status, shared by every component on the page (and by PMS and Accounting
 * alike: it is one company capability). One request serves everyone who asks within a few seconds;
 * `invalidateFiscalStatus` makes the next read fresh, e.g. after activating or changing plan.
 */
const FRESH_MS = 15_000;
let cache: { at: number; status: FiscalStatus } | null = null;
let inflight: Promise<FiscalStatus> | null = null;
const listeners = new Set<(status: FiscalStatus | null) => void>();

const publish = (status: FiscalStatus | null) => listeners.forEach((l) => l(status));

async function load(force: boolean): Promise<FiscalStatus> {
  if (!force && cache && Date.now() - cache.at < FRESH_MS) return cache.status;
  if (!inflight) {
    inflight = fiscalService
      .getStatus()
      .then((res) => {
        const status = res.data.data as FiscalStatus;
        cache = { at: Date.now(), status };
        publish(status);
        return status;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function invalidateFiscalStatus(next?: FiscalStatus): void {
  cache = next ? { at: Date.now(), status: next } : null;
  publish(next ?? null);
}

/** For tests. */
export const resetFiscalStatusCache = (): void => {
  cache = null;
  inflight = null;
  listeners.clear();
};

export interface UseFiscalStatus {
  status: FiscalStatus | null;
  loading: boolean;
  /** The server's answer to the last request, when it failed. */
  error: unknown;
  refresh: (force?: boolean) => Promise<void>;
}

export function useFiscalStatus(enabled = true): UseFiscalStatus {
  const [status, setStatus] = useState<FiscalStatus | null>(cache?.status ?? null);
  const [loading, setLoading] = useState(enabled && !cache);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async (force = true) => {
    try {
      setError(null);
      setStatus(await load(force));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (next: FiscalStatus | null) => {
      if (next) setStatus(next);
      else void refresh(true);
    };
    listeners.add(listener);
    void refresh(false);
    return () => {
      listeners.delete(listener);
    };
  }, [enabled, refresh]);

  return { status, loading, error, refresh };
}
