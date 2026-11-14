import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import i18n from '../../i18n';
import PageLoader from './PageLoader';

const RELOAD_FLAG = 'pilloto:chunk-reload-at';
const RELOAD_COOLDOWN_MS = 10_000;

/** A lazily loaded chunk that no longer exists (a new deploy replaced it) or could not be fetched. */
export const isChunkLoadError = (error: unknown): boolean => {
  const e = error as { name?: string; message?: string } | null;
  return (
    e?.name === 'ChunkLoadError' ||
    /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(e?.message ?? '')
  );
};

/** One automatic reload per cooldown window, so a server that stays broken cannot cause a reload loop. */
const reloadOnce = (): boolean => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
};

interface Props {
  children: React.ReactNode;
  /** Use the full-viewport loader — for boundaries that sit above any app shell. */
  fullPage?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Suspense boundary for lazily loaded routes, plus recovery from stale chunks: after a deploy an open tab
 * may ask for a file that no longer exists, so reload once to pick up the new build. Any other error is
 * re-thrown untouched, so this boundary changes nothing about how real bugs surface.
 */
class LazyBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) reloadOnce();
  }

  render() {
    const { error } = this.state;
    if (error) {
      if (!isChunkLoadError(error)) throw error;
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: this.props.fullPage ? '100vh' : '50vh', textAlign: 'center', px: 2 }}>
          <Typography variant="h6">{i18n.t('common.updatedReload')}</Typography>
          <Button variant="contained" onClick={() => window.location.reload()}>{i18n.t('common.reloadPage')}</Button>
        </Box>
      );
    }
    return <React.Suspense fallback={<PageLoader fullPage={this.props.fullPage} />}>{this.props.children}</React.Suspense>;
  }
}

export default LazyBoundary;
