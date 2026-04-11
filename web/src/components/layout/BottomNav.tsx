import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EditNoteIcon from '@mui/icons-material/EditNote';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import ChatIcon from '@mui/icons-material/Chat';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { useAuthStore } from '../../store/authStore';

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID as string | undefined;

const baseNavItems = [
  { labelKey: 'nav.dashboard', value: '/dashboard', icon: <DashboardIcon /> },
  { labelKey: 'nav.log',       value: '/log',       icon: <EditNoteIcon /> },
  { labelKey: 'nav.plans',     value: '/plans',     icon: <RestaurantMenuIcon /> },
  { labelKey: 'nav.chat',      value: '/chat',      icon: <ChatIcon /> },
];

export default function BottomNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { currentUser } = useAuthStore();

  const isAdmin = ADMIN_UID && currentUser?.uid === ADMIN_UID;
  const navItems = isAdmin
    ? [...baseNavItems, { labelKey: 'nav.admin', value: '/admin', icon: <AdminPanelSettingsIcon /> }]
    : baseNavItems;

  return (
    <Paper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100 }} elevation={3}>
      <BottomNavigation value={pathname} onChange={(_, val) => navigate(val)} showLabels>
        {navItems.map((item) => (
          <BottomNavigationAction
            key={item.value}
            label={t(item.labelKey)}
            value={item.value}
            icon={item.icon}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
