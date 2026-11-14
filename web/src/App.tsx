import { BrowserRouter } from 'react-router-dom';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import AppRouter from './router';
import { useAuthListener } from './hooks/useAuth';
import { useProfileListener } from './hooks/useProfile';
import { useAccessListener } from './hooks/useAccess';
import { useUsageTracking } from './hooks/useUsageTracking';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#6d28d9',
      light: '#a78bfa',
      dark: '#4c1d95',
    },
    secondary: {
      main: '#f36f57',
      dark: '#c34431',
      contrastText: '#241b37',
    },
    background: { default: '#f7f7fc', paper: '#ffffff' },
    text: { primary: '#242137', secondary: '#706c83' },
    divider: '#eae8f2',
    success: { main: '#16866b', light: '#d9f5e9' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h3: { fontWeight: 800, letterSpacing: '-0.045em' },
    h4: { fontWeight: 800, letterSpacing: '-0.04em' },
    h5: { fontWeight: 750, letterSpacing: '-0.035em' },
    h6: { fontWeight: 700, letterSpacing: '-0.025em' },
    button: { fontWeight: 650 },
    overline: { fontWeight: 700, letterSpacing: '0.1em', fontSize: '0.67rem' },
    body1: { lineHeight: 1.65 },
    body2: { lineHeight: 1.6 },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { minWidth: 320 },
        '#root': { minHeight: '100dvh' },
        '*': { boxSizing: 'border-box' },
        '::selection': { background: '#e9ddff' },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': { scrollBehavior: 'auto !important', animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          minHeight: 44,
          borderRadius: 12,
          paddingInline: 18,
        },
        outlined: { borderColor: '#ddd7ec', backgroundColor: '#fff' },
        sizeLarge: { minHeight: 50, paddingInline: 22 },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: '1px solid #eae8f2',
          borderRadius: 20,
          boxShadow: '0 4px 20px rgba(40, 26, 70, 0.025)',
        },
      },
    },
    MuiCardContent: { styleOverrides: { root: { padding: 24, '&:last-child': { paddingBottom: 24 } } } },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 12, minHeight: 46, backgroundColor: '#fff' }, notchedOutline: { borderColor: '#ddd9e8' } },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: 8 }, sizeSmall: { height: 27 } } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 12, backgroundColor: '#eee8fb' }, bar: { borderRadius: 12 } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 48, fontWeight: 650 } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 22, backgroundImage: 'none' } } },
    MuiDialogActions: { styleOverrides: { root: { padding: 20, gap: 8 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiTooltip: { defaultProps: { enterDelay: 400 } },
    MuiLink: { defaultProps: { underline: 'hover' } },
    MuiMenuItem: { styleOverrides: { root: { minHeight: 44 } } },
    MuiListItemButton: {
      styleOverrides: {
        root: { minHeight: 48, borderRadius: 12 },
      },
    },
  },
});

function AppProviders() {
  useAuthListener();
  useAccessListener();
  useProfileListener();
  useUsageTracking();
  return <AppRouter />;
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AppProviders />
      </BrowserRouter>
    </ThemeProvider>
  );
}
