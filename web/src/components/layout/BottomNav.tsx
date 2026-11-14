import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import { navigationItems, navigationPath } from './navigation';

export default function BottomNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return <Paper component="nav" aria-label={t('redesign.shell.mainNavigation')} elevation={0}
    sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100, borderTop: 1, borderColor: 'divider', pb: 'env(safe-area-inset-bottom)', bgcolor: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(16px)' }}>
    <BottomNavigation value={navigationPath(pathname)} onChange={(_, value: string) => navigate(value)} showLabels sx={{ height: 70, bgcolor: 'transparent', px: 1 }}>
      {navigationItems.map(item => <BottomNavigationAction key={item.path} label={t(item.key)} value={item.path} icon={item.icon}
        sx={{ minWidth: 60, gap: 0.5, color: 'text.secondary', '& .MuiBottomNavigationAction-label': { fontSize: '0.69rem', fontWeight: 600, '&.Mui-selected': { fontSize: '0.69rem', fontWeight: 750 } }, '&.Mui-selected': { color: 'primary.main' } }} />)}
    </BottomNavigation>
  </Paper>;
}
