import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Box, Button, Divider, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Stack, Typography } from '@mui/material';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { useAccessStore } from '../../store/accessStore';
import { navigationItems, navigationPath } from './navigation';

const DRAWER_WIDTH = 248;

export default function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = useAuthStore(state => state.currentUser);
  const profile = useProfileStore(state => state.profile);
  const isOwner = useAccessStore(state => state.isOwner);
  const name = profile?.name || user?.displayName || t('redesign.profile.title');

  return <Drawer variant="permanent" sx={{ width: DRAWER_WIDTH, flexShrink: 0,
    '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box', bgcolor: '#fff', borderColor: 'divider', p: 2 } }}>
    <Stack direction="row" spacing={1.2} alignItems="center" sx={{ px: 1, pt: 1, pb: 4 }}>
      <Box sx={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 3, bgcolor: 'primary.main', color: 'white', boxShadow: '0 6px 14px #6d28d927' }}><FitnessCenterIcon /></Box>
      <Box><Typography fontWeight={800} sx={{ letterSpacing: '-0.035em', fontSize: '1.1rem' }}>{t('app.name')}</Typography>
        <Typography variant="caption" color="text.secondary">{t('redesign.shell.tagline')}</Typography></Box>
    </Stack>
    <Typography variant="overline" color="text.secondary" sx={{ px: 2, mb: 1 }}>{t('redesign.shell.workspace')}</Typography>
    <List component="nav" aria-label={t('redesign.shell.mainNavigation')} sx={{ display: 'grid', gap: 0.75, py: 0 }}>
      {navigationItems.map(item => <ListItemButton key={item.path} selected={navigationPath(pathname) === item.path}
        onClick={() => navigate(item.path)} sx={{ px: 2, '&.Mui-selected': { bgcolor: '#eee7fc', color: 'primary.main', '&:hover': { bgcolor: '#e9defa' } } }}>
        <ListItemIcon sx={{ minWidth: 38, color: navigationPath(pathname) === item.path ? 'primary.main' : 'text.secondary' }}>{item.icon}</ListItemIcon>
        <ListItemText primary={t(item.key)} primaryTypographyProps={{ fontSize: 14, fontWeight: 650 }} />
        {navigationPath(pathname) === item.path && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main' }} />}
      </ListItemButton>)}
    </List>
    <Box sx={{ flex: 1 }} />
    <Box sx={{ my: 3, p: 2, bgcolor: '#f3f0fc', borderRadius: 4 }}>
      <Typography fontWeight={700} variant="body2">{t('redesign.shell.coachCard')}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, mb: 1.5 }}>{t('redesign.shell.coachHint')}</Typography>
      <Button size="small" fullWidth variant="contained" endIcon={<ArrowForwardRoundedIcon fontSize="small" />} onClick={() => navigate('/chat')}>{t('redesign.nav.coach')}</Button>
    </Box>
    <List disablePadding sx={{ mb: 1 }}>
      {isOwner && <ListItemButton selected={pathname.startsWith('/admin')} onClick={() => navigate('/admin')}>
        <ListItemIcon sx={{ minWidth: 38 }}><AdminPanelSettingsOutlinedIcon /></ListItemIcon>
        <ListItemText primary={t('nav.admin')} primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
      </ListItemButton>}
      <ListItemButton selected={pathname === '/profile'} onClick={() => navigate('/profile')}>
        <ListItemIcon sx={{ minWidth: 38 }}><PersonOutlineRoundedIcon /></ListItemIcon>
        <ListItemText primary={t('redesign.profile.title')} primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
      </ListItemButton>
    </List>
    <Divider />
    <Button onClick={() => navigate('/profile')} color="inherit" sx={{ mt: 1.5, px: 1, justifyContent: 'flex-start', gap: 1.25, textAlign: 'left' }}>
      <Avatar sx={{ bgcolor: '#e8dcfa', color: 'primary.dark', width: 38, height: 38, fontSize: 15, fontWeight: 700 }}>{name.slice(0, 1).toUpperCase()}</Avatar>
      <Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={700} noWrap>{name}</Typography><Typography variant="caption" color="text.secondary">{t('redesign.shell.viewProfile')}</Typography></Box>
    </Button>
  </Drawer>;
}
