import { createTheme } from '@mui/material/styles';
import { BRAND, FONT_UI, PRODUCT_COLORS, alpha } from './brand';

// Pilloto brand theme — shared by every app (PMS, Accounting, Platform, marketing).
// Product identity (PMS blue / Accounting green) is carried by the AppShell
// accent and the logo dot, not by swapping the whole palette.
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: BRAND.ink,
      light: BRAND.inkSoft,
      dark: '#0B1022',
      contrastText: '#ffffff',
    },
    secondary: {
      main: BRAND.vermilion,
      light: BRAND.vermilionOnDark,
      dark: BRAND.vermilionText,
      contrastText: '#ffffff',
    },
    background: {
      default: BRAND.paper,
      paper: BRAND.white,
    },
    text: {
      primary: BRAND.ink,
      secondary: BRAND.slate,
    },
    divider: BRAND.mist,
    info: {
      main: PRODUCT_COLORS.pms,
      light: '#7FA8F8',
      dark: '#2858C4',
      contrastText: '#ffffff',
    },
    warning: {
      main: '#D98A0B',
      light: PRODUCT_COLORS.pos,
      dark: '#A86605',
      contrastText: '#ffffff',
    },
    success: {
      main: '#16A34A',
      light: '#4ADE80',
      dark: '#15803D',
      contrastText: '#ffffff',
    },
    error: {
      main: '#D92D20',
      light: '#F97066',
      dark: '#B42318',
      contrastText: '#ffffff',
    },
    grey: {
      50: '#F9FAFB',
      100: BRAND.paper,
      200: BRAND.mist,
      300: '#CDD2DE',
      400: '#9AA1B5',
      500: '#737A90',
      600: BRAND.slate,
      700: '#3F465C',
      800: BRAND.inkSoft,
      900: BRAND.ink,
    },
  },
  typography: {
    fontFamily: FONT_UI,
    h1: { fontSize: '3rem', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.03em' },
    h2: { fontSize: '2.5rem', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.025em' },
    h3: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em' },
    h4: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.015em' },
    h5: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.4, letterSpacing: '-0.01em' },
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 },
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 600 },
    body1: { fontSize: '1rem', lineHeight: 1.6 },
    body2: { fontSize: '0.875rem', lineHeight: 1.55 },
    button: { fontWeight: 600, textTransform: 'none' },
    overline: { fontWeight: 700, letterSpacing: '0.08em' },
  },
  shape: {
    borderRadius: 10,
  },
  spacing: 8,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: BRAND.paper },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          textTransform: 'none',
          fontWeight: 600,
          padding: '9px 20px',
        },
        sizeSmall: { padding: '5px 12px' },
        sizeLarge: { padding: '12px 26px' },
        containedPrimary: {
          '&:hover': { backgroundColor: BRAND.inkSoft },
        },
        outlined: {
          borderColor: '#CDD2DE',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          border: `1px solid ${BRAND.mist}`,
          boxShadow: `0 1px 2px ${alpha(BRAND.ink, 0.04)}, 0 4px 16px ${alpha(BRAND.ink, 0.04)}`,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: { borderRadius: 12 },
        elevation1: {
          boxShadow: `0 1px 2px ${alpha(BRAND.ink, 0.05)}, 0 2px 10px ${alpha(BRAND.ink, 0.04)}`,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 16 },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          border: `1px solid ${BRAND.mist}`,
          boxShadow: `0 8px 24px ${alpha(BRAND.ink, 0.1)}`,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#9AA1B5' },
        },
        notchedOutline: { borderColor: '#CDD2DE' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 8 },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { height: 3, borderRadius: 3 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, minHeight: 48 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
          color: BRAND.slate,
          backgroundColor: '#F9FAFB',
        },
        root: { borderBottomColor: BRAND.mist },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: BRAND.ink, fontSize: '0.75rem', borderRadius: 6 },
        arrow: { color: BRAND.ink },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { boxShadow: 'none' },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
  },
});

export default theme;
