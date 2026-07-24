import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import { signOut } from '../firebase/auth';
import { useAuthStore } from '../store/authStore';

export default function PendingApprovalPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { setCurrentUser } = useAuthStore();

  const handleSignOut = async () => {
    await signOut();
    setCurrentUser(null);
    navigate('/');
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Container maxWidth="sm">
        <Stack spacing={3} alignItems="center" textAlign="center">
          <HourglassTopIcon sx={{ fontSize: 72, color: 'warning.main' }} />
          <Typography variant="h4" fontWeight={700}>
            {t('pendingApproval.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('pendingApproval.body')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('pendingApproval.autoUpdate')}
          </Typography>
          <Button variant="outlined" color="inherit" onClick={handleSignOut}>
            {t('auth.signOut')}
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
