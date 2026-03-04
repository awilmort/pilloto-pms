import { createTheme } from '@mui/material/styles';

// Pilloto Brand Colors
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2D3748', // Dark Gray
      light: '#4A5568',
      dark: '#1A202C',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#F4A460', // Sandy Brown
      light: '#F7B881',
      dark: '#D18B47',
      contrastText: '#ffffff',
    },
    background: {
      default: '#F8F9FA',
      paper: '#FFFFFF',
    },
    info: {
      main: '#3182CE', // Blue — Chakra blue.500
      light: '#63B3ED',
      dark: '#2C5282',
      contrastText: '#ffffff',
    },
    warning: {
      main: '#D69E2E', // Amber — Chakra yellow.500
      light: '#F6E05E',
      dark: '#B7791F',
      contrastText: '#ffffff',
    },
    success: {
      main: '#38A169', // Green — Chakra green.500
      light: '#68D391',
      dark: '#276749',
      contrastText: '#ffffff',
    },
    error: {
      main: '#E53E3E', // Red — Chakra red.500
      light: '#FC8181',
      dark: '#C53030',
      contrastText: '#ffffff',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '3rem',
      fontWeight: 700,
      lineHeight: 1.2,
    },
    h2: {
      fontSize: '2.5rem',
      fontWeight: 600,
      lineHeight: 1.3,
    },
    h3: {
      fontSize: '2rem',
      fontWeight: 600,
      lineHeight: 1.4,
    },
    h4: {
      fontSize: '1.5rem',
      fontWeight: 500,
      lineHeight: 1.4,
    },
    h5: {
      fontSize: '1.25rem',
      fontWeight: 500,
      lineHeight: 1.5,
    },
    h6: {
      fontSize: '1rem',
      fontWeight: 500,
      lineHeight: 1.6,
    },
    body1: {
      fontSize: '1rem',
      lineHeight: 1.7,
    },
    body2: {
      fontSize: '0.875rem',
      lineHeight: 1.6,
    },
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
          boxShadow: '0 4px 12px rgba(45, 55, 72, 0.3)',
          '&:hover': {
            boxShadow: '0 6px 16px rgba(45, 55, 72, 0.4)',
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

export default theme;
