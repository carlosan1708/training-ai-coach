import { useNavigate } from 'react-router-dom';
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
            Awaiting Approval
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Your account has been created and is pending approval. You'll get
            access as soon as the administrator reviews your request.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            This page updates automatically — no need to refresh.
          </Typography>
          <Button variant="outlined" color="inherit" onClick={handleSignOut}>
            Sign Out
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
