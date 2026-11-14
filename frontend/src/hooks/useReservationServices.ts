import { useEffect, useState } from 'react';
import { servicesService } from '../services/api';

/** Which kinds of reservation this property sells; accommodation is always on. */
export interface ReservationServices {
  daypass: boolean;
  accommodation: boolean;
  pasatarde: boolean;
  event: boolean;
}

const DEFAULTS: ReservationServices = { daypass: false, accommodation: true, pasatarde: false, event: false };
/** Services change rarely (only when someone edits them); a short TTL is a safety net for edits made elsewhere. */
const TTL_MS = 5 * 60 * 1000;

let cached: { value: ReservationServices; at: number } | null = null;
let inflight: Promise<ReservationServices> | null = null;

const isFresh = () => !!cached && Date.now() - cached.at < TTL_MS;

/** Fetches (once at a time) and caches the active service kinds. A failure falls back to the defaults and is not cached. */
export function loadReservationServices(): Promise<ReservationServices> {
  if (isFresh()) return Promise.resolve(cached!.value);
  if (!inflight) {
    inflight = servicesService.getServices({ active: true })
      .then((res) => {
        const list: Array<{ kind?: string }> = res.data.data ?? [];
        const hasKind = (k: string) => list.some((svc) => svc.kind === k);
        const value: ReservationServices = { ...DEFAULTS, daypass: hasKind('daypass'), pasatarde: hasKind('pasatarde'), event: hasKind('event') };
        cached = { value, at: Date.now() };
        return value;
      })
      .catch(() => cached?.value ?? DEFAULTS)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Call after creating, editing or deleting a service so the next read sees it. */
export function invalidateReservationServices(): void {
  cached = null;
}

/**
 * The active service kinds, shared by every page that shapes itself around them (schedule, wristbands,
 * revenue, reservations). Cached across pages and warmed by the admin shell, so by the time a page asks the
 * answer is usually already there. `ready` is false only the very first time — pages should wait for it
 * rather than draw the defaults and then rearrange themselves.
 */
export function useReservationServices(): { services: ReservationServices; ready: boolean } {
  const [state, setState] = useState<ReservationServices | null>(() => cached?.value ?? null);

  useEffect(() => {
    let alive = true;
    // Stale or missing: refresh. A stale value stays on screen meanwhile (no flash back to defaults).
    if (!isFresh()) loadReservationServices().then((value) => { if (alive) setState(value); });
    else if (!state && cached) setState(cached.value);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { services: state ?? DEFAULTS, ready: state !== null };
}
