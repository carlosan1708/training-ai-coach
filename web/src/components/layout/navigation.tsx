import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';

export const navigationItems = [
  { key: 'redesign.nav.today', path: '/dashboard', icon: <WbSunnyOutlinedIcon /> },
  { key: 'redesign.nav.train', path: '/routines', icon: <FitnessCenterRoundedIcon /> },
  { key: 'redesign.nav.progress', path: '/progress', icon: <InsightsRoundedIcon /> },
  { key: 'redesign.nav.coach', path: '/chat', icon: <AutoAwesomeOutlinedIcon /> },
];

export function navigationPath(path: string) {
  if (path.startsWith('/routines')) return '/routines';
  if (path.startsWith('/progress') || path === '/workout-history') return '/progress';
  if (path === '/log' || path === '/plans') return '/dashboard';
  return path;
}
