import { createTheme } from '@mui/material/styles';

/**
 * Pilloto Accounting theme — same shape as `theme.ts` (the PMS theme), with
 * a deep-emerald accent so the Accounting app reads as visually distinct
 * from PMS's dark-gray/sandy-brown, per PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md
 * Phase 2.1 ("distinct theme accent... own accountingTheme.ts, same shape as
 * the pms theme").
 */
const accountingTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1B4332', // Deep emerald
      light: '#2D6A4F',
      dark: '#0F2A1D',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#52B788', // Emerald accent
      light: '#74C69D',
      dark: '#40916C',
      contrastText: '#ffffff',
    },
    background: {
      default: '#F8F9FA',
      paper: '#FFFFFF',
    },
    info: {
      main: '#3182CE',
      light: '#63B3ED',
      dark: '#2C5282',
      contrastText: '#ffffff',
    },
    warning: {
      main: '#D69E2E',
      light: '#F6E05E',
      dark: '#B7791F',
      contrastText: '#ffffff',
    },
    success: {
      main: '#38A169',
      light: '#68D391',
      dark: '#276749',
      contrastText: '#ffffff',
    },
    error: {
      main: '#E53E3E',
      light: '#FC8181',
      dark: '#C53030',
      contrastText: '#ffffff',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontSize: '3rem', fontWeight: 700, lineHeight: 1.2 },
    h2: { fontSize: '2.5rem', fontWeight: 600, lineHeight: 1.3 },
    h3: { fontSize: '2rem', fontWeight: 600, lineHeight: 1.4 },
    h4: { fontSize: '1.5rem', fontWeight: 500, lineHeight: 1.4 },
    h5: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.5 },
    h6: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.6 },
    body1: { fontSize: '1rem', lineHeight: 1.7 },
    body2: { fontSize: '0.875rem', lineHeight: 1.6 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 600,
          padding: '10px 24px',
        },
        containedPrimary: {
          boxShadow: '0 4px 12px rgba(27, 67, 50, 0.3)',
          '&:hover': {
            boxShadow: '0 6px 16px rgba(27, 67, 50, 0.4)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.08)',
          '&:hover': {
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.12)',
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        },
      },
    },
  },
  shape: {
    borderRadius: 8,
  },
  spacing: 8,
});

/** AppShell `sidebarBg` for the Accounting app — matches the theme's primary dark tone. */
export const ACCOUNTING_SIDEBAR_BG = '#1B4332';

export default accountingTheme;
