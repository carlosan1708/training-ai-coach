import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import ScienceIcon from '@mui/icons-material/Science';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';
import LanguageSwitcher from './LanguageSwitcher';
import { isDemoMode, disableDemoMode } from '../../demo';

function DemoBanner() {
  const { t } = useTranslation();

  const exit = () => {
    disableDemoMode();
    window.location.assign('/');
  };

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        px: 2,
        py: 0.5,
        bgcolor: 'warning.light',
        color: 'warning.contrastText',
        position: 'sticky',
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar,
      }}
    >
      <ScienceIcon fontSize="small" />
      <Typography variant="body2" sx={{ flex: 1 }}>
        {t('demo.banner')}
      </Typography>
      <Button size="small" color="inherit" variant="outlined" onClick={exit}>
        {t('demo.exit')}
      </Button>
    </Stack>
  );
}

/** Slim top bar for mobile, which otherwise has no header to hang the
 *  language switcher on. Desktop keeps the switcher in the sidebar. */
function MobileHeader() {
  const { t } = useTranslation();
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{
        px: 2, py: 1,
        borderBottom: 1, borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <FitnessCenterIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={700} color="primary">{t('app.name')}</Typography>
      </Stack>
      <LanguageSwitcher variant="icon" />
    </Stack>
  );
}

export default function AppShell() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {!isMobile && <Sidebar />}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          pb: isMobile ? 8 : 0,
          overflow: 'auto',
        }}
      >
        {isDemoMode() && <DemoBanner />}
        {isMobile && <MobileHeader />}
        <Outlet />
      </Box>
      {isMobile && <BottomNav />}
    </Box>
  );
}
