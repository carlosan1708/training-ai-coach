import { Outlet } from 'react-router-dom';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';

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
        <Outlet />
      </Box>
      {isMobile && <BottomNav />}
    </Box>
  );
}
