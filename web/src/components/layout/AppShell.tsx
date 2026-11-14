import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Avatar, Box, Button, IconButton, ListItemIcon, Menu, MenuItem, Stack, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';
import LanguageSwitcher from './LanguageSwitcher';
import { isDemoMode, disableDemoMode } from '../../demo';
import { signOut } from '../../firebase/auth';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { useAccessStore } from '../../store/accessStore';
import { navigationItems, navigationPath } from './navigation';

function DemoBanner() {
  const { t } = useTranslation();
  return <Stack direction="row" alignItems="center" spacing={1} sx={{ px: { xs: 2, sm: 4 }, py: 0.6, bgcolor: '#fff5dc', color: '#74531c', flexShrink: 0 }}>
    <ScienceOutlinedIcon fontSize="small" /><Typography variant="caption" sx={{ flex: 1 }}>{t('demo.banner')}</Typography>
    <Button size="small" color="inherit" sx={{ minHeight: 36 }} onClick={() => { disableDemoMode(); window.location.assign('/'); }}>{t('demo.exit')}</Button>
  </Stack>;
}

function WorkspaceHeader() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const profile = useProfileStore(state => state.profile);
  const user = useAuthStore(state => state.currentUser);
  const isOwner = useAccessStore(state => state.isOwner);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState(false);
  const current = navigationItems.find(item => item.path === navigationPath(pathname));
  const name = profile?.name || user?.displayName || '';
  const logout = async () => {
    setAnchor(null);
    try {
      if (isDemoMode()) { disableDemoMode(); window.location.assign('/'); return; }
      await signOut();
      useAuthStore.getState().setCurrentUser(null);
      navigate('/');
    } catch { setError(true); }
  };
  return <Box sx={{ flexShrink: 0, bgcolor: 'rgba(255,255,255,0.86)', borderBottom: 1, borderColor: 'divider', backdropFilter: 'blur(16px)' }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: { xs: 2, md: 4 }, minHeight: { xs: 68, md: 76 }, gap: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
        <Box sx={{ display: { xs: 'grid', md: 'none' }, placeItems: 'center', width: 34, height: 34, bgcolor: 'primary.main', color: '#fff', borderRadius: 2.5, flexShrink: 0 }}><FitnessCenterIcon sx={{ fontSize: 20 }} /></Box>
        <Typography fontWeight={750} noWrap sx={{ letterSpacing: '-0.025em', display: { md: 'none' } }}>{t('app.name')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>{t('redesign.shell.workspace')} <Box component="span" sx={{ mx: 1.5, color: '#c9c4d8' }}>/</Box><Box component="span" sx={{ color: 'text.primary', fontWeight: 650 }}>{current ? t(current.key) : t(pathname.startsWith('/admin') ? 'nav.admin' : 'redesign.profile.title')}</Box></Typography>
      </Stack>
      <Stack direction="row" alignItems="center" spacing={0.75}>
        <LanguageSwitcher />
        <Tooltip title={t('redesign.shell.account')}><IconButton aria-label={t('redesign.shell.account')} aria-controls={anchor ? 'account-menu' : undefined} aria-haspopup="true" aria-expanded={!!anchor}
          onClick={event => setAnchor(event.currentTarget)} sx={{ p: 0.5 }}><Avatar sx={{ width: 35, height: 35, bgcolor: '#eee4fe', color: 'primary.dark', fontSize: 14, fontWeight: 750 }}>{name.charAt(0).toUpperCase() || <PersonOutlineRoundedIcon fontSize="small" />}</Avatar></IconButton></Tooltip>
      </Stack>
    </Stack>
    {error && <Alert severity="error" onClose={() => setError(false)}>{t('common.error')}</Alert>}
    <Menu id="account-menu" anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { minWidth: 230, borderRadius: 3, mt: 1, border: 1, borderColor: 'divider' } } }}>
      <Box sx={{ px: 2, py: 1, maxWidth: 280 }}><Typography variant="body2" fontWeight={700} noWrap>{name}</Typography><Typography variant="caption" color="text.secondary" noWrap component="div">{user?.email}</Typography></Box>
      <MenuItem onClick={() => { setAnchor(null); navigate('/profile'); }}><ListItemIcon><PersonOutlineRoundedIcon fontSize="small" /></ListItemIcon>{t('redesign.profile.title')}</MenuItem>
      {isOwner && <MenuItem onClick={() => { setAnchor(null); navigate('/admin'); }}><ListItemIcon><AdminPanelSettingsOutlinedIcon fontSize="small" /></ListItemIcon>{t('nav.admin')}</MenuItem>}
      <MenuItem onClick={() => { void logout(); }}><ListItemIcon><LogoutRoundedIcon fontSize="small" /></ListItemIcon>{t('auth.signOut')}</MenuItem>
    </Menu>
  </Box>;
}

export default function AppShell() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { pathname } = useLocation();
  const isChat = pathname === '/chat';
  return <Box sx={{ display: 'flex', minHeight: '100dvh', ...(isChat ? { height: '100dvh', overflow: 'hidden' } : {}) }}>
    {!isMobile && <Sidebar />}
    <Box component="main" id="main-content" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', pb: isMobile ? 'calc(70px + env(safe-area-inset-bottom))' : 0, ...(isChat ? { height: '100dvh', overflow: 'hidden' } : {}) }}>
      {isDemoMode() && <DemoBanner />}
      <WorkspaceHeader />
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, ...(isChat ? { display: 'flex', flexDirection: 'column', overflow: 'hidden' } : {}) }}><Outlet /></Box>
    </Box>
    {isMobile && <BottomNav />}
  </Box>;
}
