import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import { signInWithGoogle } from '../firebase/auth';
import { createUserStatus } from '../firebase/firestore';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';

export default function SplashPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogle = async () => {
    setLoading(true);
    setError('');
    try {
      const cred = await signInWithGoogle();
      const { uid, email, displayName } = cred.user;
      const existing = await getDoc(doc(db, 'user_status', uid));
      if (!existing.exists()) {
        await createUserStatus(uid, email ?? '', displayName ?? email ?? '');
      }
      navigate('/dashboard');
    } catch {
      setError(t('auth.errors.generic'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #1a237e 0%, #0d47a1 50%, #01579b 100%)',
        color: 'white',
      }}
    >
      <Container maxWidth="sm">
        <Stack spacing={4} alignItems="center" textAlign="center">
          <FitnessCenterIcon sx={{ fontSize: 72, opacity: 0.9 }} />
          <Box>
            <Typography variant="h3" fontWeight={700} gutterBottom>
              {t('splash.headline')}
            </Typography>
            <Typography variant="h6" sx={{ opacity: 0.85, fontWeight: 400 }}>
              {t('splash.sub')}
            </Typography>
          </Box>

          {error && (
            <Typography variant="body2" sx={{ color: 'error.light' }}>
              {error}
            </Typography>
          )}

          <Button
            variant="contained"
            size="large"
            onClick={handleGoogle}
            disabled={loading}
            startIcon={
              loading ? (
                <CircularProgress size={20} sx={{ color: 'inherit' }} />
              ) : (
                <img
                  src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                  alt="Google"
                  width={22}
                  height={22}
                />
              )
            }
            sx={{
              bgcolor: 'white',
              color: 'primary.dark',
              fontWeight: 700,
              px: 4,
              py: 1.5,
              '&:hover': { bgcolor: 'grey.100' },
            }}
          >
            {t('auth.googleSignIn')}
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
