import { useEffect, useState } from 'react';

/**
 * True once `loading` has turned false for the first time. Use it to keep counts, totals and empty states off
 * the screen until real data has arrived — they would otherwise show `0` / "nothing found" first and then
 * change. The `loading` flag it reads must start as `true`.
 */
export function useLoadedOnce(loading: boolean): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loading) setLoaded(true);
  }, [loading]);
  return loaded;
}
