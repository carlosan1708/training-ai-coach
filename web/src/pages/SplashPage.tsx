import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, CardContent, Chip, CircularProgress, Container, Stack, Typography } from '@mui/material';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LanguageSwitcher from '../components/layout/LanguageSwitcher';
import { signInWithGoogle } from '../firebase/auth';
import { createUserStatus } from '../firebase/firestore';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { enableDemoMode } from '../demo';

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
      if (!existing.exists()) await createUserStatus(uid, email ?? '', displayName ?? email ?? '');
      navigate('/dashboard');
    } catch { setError(t('auth.errors.generic')); }
    finally { setLoading(false); }
  };
  return <Box sx={{ minHeight: '100dvh', bgcolor: '#faf9fe', overflow: 'hidden' }}>
    <Container maxWidth="lg">
      <Stack component="header" direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 3 }}>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Box sx={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 3, bgcolor: 'primary.main', color: '#fff' }}><FitnessCenterRoundedIcon /></Box>
          <Typography fontWeight={800} sx={{ letterSpacing: '-0.04em', fontSize: 19 }}>{t('app.name')}</Typography>
        </Stack>
        <LanguageSwitcher />
      </Stack>
      <Box component="main" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, alignItems: 'center', gap: { xs: 5, md: 8 }, pt: { xs: 3, md: 7 }, pb: { xs: 5, md: 9 } }}>
        <Box>
          <Chip icon={<AutoAwesomeRoundedIcon sx={{ fontSize: '16px !important' }} />} label={t('redesign.welcome.badge')} sx={{ bgcolor: '#eee6fc', color: 'primary.dark', px: 0.75, mb: 3 }} />
          <Typography component="h1" variant="h3" sx={{ fontSize: { xs: '2.75rem', sm: '3.5rem', md: '3.8rem' }, lineHeight: 1.08, maxWidth: 550 }}>{t('redesign.welcome.title')} <Box component="span" sx={{ color: 'primary.main' }}>{t('redesign.welcome.titleAccent')}</Box></Typography>
          <Typography sx={{ mt: 3, color: 'text.secondary', fontSize: { xs: 16, sm: 18 }, maxWidth: 460, lineHeight: 1.7 }}>{t('redesign.welcome.description')}</Typography>
          <Stack spacing={1.5} sx={{ mt: 4, maxWidth: 360 }}>
            <Button variant="contained" size="large" onClick={handleGoogle} disabled={loading} startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <Box component="span" aria-hidden="true" sx={{ fontWeight: 800, fontSize: 20 }}>G</Box>} endIcon={!loading && <ArrowForwardRoundedIcon />} sx={{ minHeight: 54 }}>{t('auth.googleSignIn')}</Button>
            <Button variant="outlined" size="large" startIcon={<PlayArrowRoundedIcon />} onClick={() => { enableDemoMode(); window.location.assign('/dashboard'); }}>{t('splash.tryDemo')}</Button>
            <Typography variant="caption" textAlign="center" color="text.secondary">{t('splash.demoHint')}</Typography>
          </Stack>
          {error && <Typography role="alert" color="error" variant="body2" sx={{ mt: 2 }}>{error}</Typography>}
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 3 }}><LockOutlinedIcon sx={{ fontSize: 15, color: 'text.secondary' }} /><Typography variant="caption" color="text.secondary">{t('redesign.welcome.private')}</Typography></Stack>
        </Box>
        <Box aria-label={t('redesign.welcome.preview')} sx={{ position: 'relative', p: { xs: 2, sm: 4 }, borderRadius: 7, bgcolor: '#eee7fa', minWidth: 0 }}>
          <Box aria-hidden="true" sx={{ position: 'absolute', top: -25, right: -25, width: 100, height: 100, borderRadius: '50%', bgcolor: '#ffd7c5', zIndex: 0 }} />
          <Box sx={{ position: 'relative', p: { xs: 2.5, sm: 3 }, bgcolor: '#fff', borderRadius: 5, boxShadow: '0 25px 70px #4c1d951c', transform: { md: 'rotate(-2deg)' } }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="overline" color="text.secondary">{t('redesign.nav.today')}</Typography><Typography variant="h6">{t('redesign.welcome.previewGreeting')}</Typography></Box><Box sx={{ fontSize: 26 }} aria-hidden="true">✦</Box></Stack>
            <Box sx={{ my: 2.5, p: 2.5, borderRadius: 3.5, bgcolor: 'primary.main', color: '#fff', position: 'relative', overflow: 'hidden' }}>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>{t('redesign.today.nextUp')}</Typography>
              <Typography variant="h6" sx={{ mt: 0.75, mb: 1.5 }}>{t('redesign.welcome.previewWorkout')}</Typography>
              <Stack direction="row" spacing={1} alignItems="center"><Box sx={{ bgcolor: '#fff', color: 'primary.main', borderRadius: '50%', width: 32, height: 32, display: 'grid', placeItems: 'center' }}><PlayArrowRoundedIcon fontSize="small" /></Box><Typography variant="body2" fontWeight={600}>{t('redesign.welcome.previewAction')}</Typography></Stack>
              <FitnessCenterRoundedIcon sx={{ position: 'absolute', fontSize: 95, color: '#ffffff20', right: -12, top: 25, transform: 'rotate(-25deg)' }} />
            </Box>
            <Typography variant="body2" fontWeight={700}>{t('redesign.today.thisWeek')}</Typography>
            <Stack direction="row" justifyContent="space-between" sx={{ my: 1.5 }} aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <Box key={index} sx={{ width: { xs: 27, sm: 33 }, height: 37, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: [0, 2, 4].includes(index) ? '#e0f3e8' : '#f6f4fa', color: '#318c68' }}>{[0, 2, 4].includes(index) ? <CheckRoundedIcon sx={{ fontSize: 18 }} /> : <Box sx={{ width: 5, height: 5, bgcolor: '#d9d4e6', borderRadius: '50%' }} />}</Box>)}</Stack>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ p: 1.75, mt: 2, bgcolor: '#fff4e9', borderRadius: 3 }}><AutoAwesomeRoundedIcon sx={{ color: '#d38d46' }} /><Box><Typography variant="body2" fontWeight={650}>{t('redesign.welcome.previewCoach')}</Typography><Typography variant="caption" color="text.secondary">{t('redesign.welcome.previewCoachHint')}</Typography></Box></Stack>
          </Box>
          <Card sx={{ position: 'relative', width: 'fit-content', ml: 'auto', mr: { xs: -1, sm: -5 }, mt: -2, transform: 'rotate(3deg)', bgcolor: '#e1f5eb', borderColor: '#c4e8d6', boxShadow: '0 10px 30px #254d3210' }}><CardContent sx={{ py: '14px !important', px: 2 }}><Stack direction="row" spacing={1.25} alignItems="center"><InsightsRoundedIcon sx={{ color: '#278568' }} /><Box><Typography variant="body2" fontWeight={750}>{t('redesign.welcome.progressCard')}</Typography><Typography variant="caption" color="text.secondary">{t('redesign.welcome.progressHint')}</Typography></Box></Stack></CardContent></Card>
        </Box>
      </Box>
      <Stack component="footer" direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={2} sx={{ borderTop: 1, borderColor: 'divider', py: 3 }}>
        <Typography variant="caption" color="text.secondary">{t('redesign.welcome.footer')}</Typography>
        <Stack direction="row" spacing={2.5}>{['redesign.welcome.featureTrain', 'redesign.welcome.featureProgress', 'redesign.welcome.featureCoach'].map(key => <Typography key={key} variant="caption" fontWeight={650} color="text.secondary">{t(key)}</Typography>)}</Stack>
      </Stack>
    </Container>
  </Box>;
}
