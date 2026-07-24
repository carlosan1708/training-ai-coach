import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box, Divider, Drawer, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, Typography,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ChatIcon from '@mui/icons-material/Chat';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LogoutIcon from '@mui/icons-material/Logout';
import { signOut } from '../../firebase/auth';
import { useAuthStore } from '../../store/authStore';
import LanguageSwitcher from './LanguageSwitcher';

const DRAWER_WIDTH = 240;
const ADMIN_UID = import.meta.env.VITE_ADMIN_UID as string | undefined;

// Meal Plans is intentionally unlisted for now — the page stays reachable at /plans
const navItems = [
  { labelKey: 'nav.dashboard', path: '/dashboard', icon: <DashboardIcon /> },
  { labelKey: 'nav.log',       path: '/log',       icon: <EditNoteIcon /> },
  { labelKey: 'nav.workouts',  path: '/routines',  icon: <FitnessCenterIcon /> },
  { labelKey: 'nav.chat',      path: '/chat',      icon: <ChatIcon /> },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { currentUser, setCurrentUser } = useAuthStore();

  const isAdmin = ADMIN_UID && currentUser?.uid === ADMIN_UID;

  const handleSignOut = async () => {
    await signOut();
    setCurrentUser(null);
    navigate('/');
  };

  return (
    <Drawer variant="permanent" sx={{
      width: DRAWER_WIDTH, flexShrink: 0,
      '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
    }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <FitnessCenterIcon color="primary" />
        <Typography variant="h6" fontWeight={700} color="primary">{t('app.name')}</Typography>
      </Box>

      <Divider />

      <List sx={{ flexGrow: 1 }}>
        {navItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton selected={pathname === item.path}
              onClick={() => navigate(item.path)} sx={{ borderRadius: 1, mx: 1 }}>
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={t(item.labelKey)} />
            </ListItemButton>
          </ListItem>
        ))}
        {isAdmin && (
          <ListItem disablePadding>
            <ListItemButton selected={pathname === '/admin'}
              onClick={() => navigate('/admin')} sx={{ borderRadius: 1, mx: 1 }}>
              <ListItemIcon><AdminPanelSettingsIcon color="secondary" /></ListItemIcon>
              <ListItemText primary={t('nav.admin')}
                primaryTypographyProps={{ color: 'secondary', fontWeight: 600 }} />
            </ListItemButton>
          </ListItem>
        )}
      </List>

      <Divider />
      <List>
        <ListItem disablePadding>
          <LanguageSwitcher variant="row" />
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton onClick={handleSignOut} sx={{ borderRadius: 1, mx: 1 }}>
            <ListItemIcon><LogoutIcon /></ListItemIcon>
            <ListItemText primary={t('auth.signOut')} />
          </ListItemButton>
        </ListItem>
      </List>
    </Drawer>
  );
}
