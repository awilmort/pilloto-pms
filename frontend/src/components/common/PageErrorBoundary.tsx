import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { ErrorOutline } from '@mui/icons-material';
import { useLocation } from 'react-router-dom';
import i18n from '../../i18n';

interface Props {
  children: React.ReactNode;
  /** Fill the viewport (boundaries that sit above any app shell) instead of the content area. */
  fullPage?: boolean;
  /** When this changes the boundary clears its error — e.g. the route path, so leaving a broken page recovers. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render error in the page it wraps and shows a calm message in its place, so one broken page
 * no longer unmounts the whole app (shell, sidebar, navigation). Navigating elsewhere clears it; "Try again"
 * re-renders the page. Chunk-loading failures are handled one level down by LazyBoundary, which re-throws
 * everything else to here.
 */
export class PageErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the details for whoever debugs it; the user sees the message below.
    console.error('Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Box
        role="alert"
        sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5,
          minHeight: this.props.fullPage ? '100vh' : '50vh', textAlign: 'center', px: 2, py: 6,
        }}
      >
        <ErrorOutline sx={{ fontSize: 48, color: 'text.disabled' }} />
        <Typography variant="h6">{i18n.t('common.pageErrorTitle')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>{i18n.t('common.pageErrorBody')}</Typography>
        {process.env.NODE_ENV !== 'production' && (
          <Typography variant="caption" color="error" sx={{ fontFamily: 'monospace', maxWidth: 560, wordBreak: 'break-word' }}>
            {error.message}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
          <Button variant="contained" onClick={this.reset}>{i18n.t('common.tryAgain')}</Button>
          <Button variant="outlined" onClick={() => window.location.reload()}>{i18n.t('common.reloadPage')}</Button>
        </Box>
      </Box>
    );
  }
}

/** The boundary, reset whenever the route path changes. Use this inside a Router. */
const RoutedErrorBoundary: React.FC<Omit<Props, 'resetKey'>> = (props) => {
  const { pathname } = useLocation();
  return <PageErrorBoundary {...props} resetKey={pathname} />;
};

export default RoutedErrorBoundary;
