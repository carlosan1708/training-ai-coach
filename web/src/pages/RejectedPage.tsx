import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import { signOut } from '../firebase/auth';
import { useAuthStore } from '../store/authStore';

export default function RejectedPage() {
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
          <BlockIcon sx={{ fontSize: 72, color: 'error.main' }} />
          <Typography variant="h4" fontWeight={700}>
            Access Denied
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Your account request was not approved. If you believe this is a
            mistake, please contact the administrator.
          </Typography>
          <Button variant="outlined" color="inherit" onClick={handleSignOut}>
            Sign Out
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
