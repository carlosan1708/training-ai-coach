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
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { signInWithGoogle } from '../firebase/auth';
import { createUserStatus } from '../firebase/firestore';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { enableDemoMode } from '../demo';
import { enableTrialMode, seedTrialData } from '../lib/trial';

export default function SplashPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDemo = () => {
    enableDemoMode();
    // Full reload so the auth listener starts up with the demo user
    window.location.assign('/dashboard');
  };

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

  // Live-AI demo: sign in, seed the sample data into the user's own Firestore
  // so the real (metered) AI has context, then drop into the app. `fresh` skips
  // the seed and sends them to onboarding to build their own data.
  const handleTrial = async (fresh = false) => {
    setLoading(true);
    setError('');
    try {
      const cred = await signInWithGoogle();
      enableTrialMode();
      if (!fresh) await seedTrialData(cred.user.uid);
      // Full reload so the auth/profile listeners start with the seeded data.
      window.location.assign(fresh ? '/onboarding' : '/dashboard');
    } catch {
      setError(t('auth.errors.generic'));
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
                <Box component="svg" viewBox="0 0 48 48" sx={{ width: 22, height: 22 }}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </Box>
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

          <Button
            variant="contained"
            size="large"
            onClick={() => handleTrial(false)}
            disabled={loading}
            startIcon={<AutoAwesomeIcon />}
            sx={{
              bgcolor: 'rgba(255,255,255,0.16)',
              color: 'white',
              fontWeight: 700,
              px: 4,
              py: 1.4,
              backdropFilter: 'blur(2px)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.26)' },
            }}
          >
            {t('splash.tryRealAi')}
          </Button>
          <Typography variant="caption" sx={{ opacity: 0.7, mt: -2 }}>
            {t('splash.realAiHint')}{' '}
            <Box
              component="span"
              role="button"
              tabIndex={0}
              onClick={() => !loading && handleTrial(true)}
              sx={{ textDecoration: 'underline', cursor: 'pointer', '&:hover': { opacity: 1 } }}
            >
              {t('splash.startFresh')}
            </Box>
          </Typography>

          <Button
            variant="outlined"
            size="large"
            onClick={handleDemo}
            startIcon={<PlayCircleOutlineIcon />}
            sx={{
              color: 'white',
              borderColor: 'rgba(255,255,255,0.6)',
              px: 4,
              py: 1.2,
              '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.08)' },
            }}
          >
            {t('splash.tryDemo')}
          </Button>
          <Typography variant="caption" sx={{ opacity: 0.7, mt: -2 }}>
            {t('splash.demoHint')}
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
