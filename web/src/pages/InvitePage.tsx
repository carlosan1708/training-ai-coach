import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Avatar, Box, Button, Card, CircularProgress, Container, Stack, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { acceptInvitation, accessErrorKey } from '../firebase/access';
import { signInWithGoogle, signOut } from '../firebase/auth';
import { useAuthStore } from '../store/authStore';

const PENDING = 'tac_pending_invitation';
function pendingToken() {
  try {
    const incoming = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? new URLSearchParams(window.location.search).get('token');
    if (incoming && incoming.length <= 160) {
      sessionStorage.setItem(PENDING, JSON.stringify({ token: incoming, saved: Date.now() }));
      window.history.replaceState(window.history.state, '', window.location.pathname);
      return incoming;
    }
    const saved = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null') as { token?: string; saved?: number } | null;
    if (saved?.token && saved.saved && Date.now() - saved.saved < 7 * 86400_000) return saved.token;
    sessionStorage.removeItem(PENDING);
  } catch { /* The original link can be opened again if storage is unavailable. */ }
  return '';
}

export default function InvitePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentUser, loading: authLoading, setCurrentUser } = useAuthStore();
  const [token] = useState(pendingToken);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(token ? '' : 'access.errors.invalid');
  const [retry, setRetry] = useState(0);
  const attempted = useRef<{ key: string; promise: ReturnType<typeof acceptInvitation> } | null>(null);
  useEffect(() => {
    if (!currentUser || !token || success) return;
    const key = `${currentUser.uid}:${token}:${retry}`;
    if (attempted.current?.key !== key) attempted.current = { key, promise: acceptInvitation(token) };
    let canceled = false;
    setBusy(true); setError('');
    void attempted.current.promise.then(() => {
      if (canceled) return;
      try { sessionStorage.removeItem(PENDING); } catch { /* acceptance still succeeded */ }
      setSuccess(true);
    }).catch(failure => { if (!canceled) setError(accessErrorKey(failure)); }).finally(() => { if (!canceled) setBusy(false); });
    return () => { canceled = true; };
  }, [currentUser, token, retry, success]);
  const login = async () => {
    setBusy(true); setError('');
    try { await signInWithGoogle(); }
    catch (failure) { setError(accessErrorKey(failure)); }
    finally { setBusy(false); }
  };
  const switchAccount = async () => {
    await signOut(); setCurrentUser(null); setError(''); attempted.current = null;
  };
  return <Box sx={{ minHeight: '100dvh', display: 'grid', alignItems: 'center', py: 5, bgcolor: 'background.default', backgroundImage: 'radial-gradient(ellipse at 15% 10%, rgba(44,125,99,0.12), transparent 65%)' }}>
    <Container maxWidth="sm"><Stack spacing={3} alignItems="center">
      <Stack component={RouterLink} to="/" direction="row" alignItems="center" spacing={1} sx={{ textDecoration: 'none', color: 'text.primary' }}><FitnessCenterRoundedIcon color="primary" /><Typography fontWeight={800}>{t('app.name')}</Typography></Stack>
      <Card sx={{ p: { xs: 3, sm: 5 }, width: '100%', boxSizing: 'border-box', borderRadius: 4, border: 1, borderColor: 'divider' }}>
        <Stack spacing={3} alignItems="center" textAlign="center">
          <Avatar sx={{ width: 70, height: 70, bgcolor: 'primary.main' }}>{success ? <CheckRoundedIcon sx={{ fontSize: 32 }} /> : <FitnessCenterRoundedIcon sx={{ fontSize: 30 }} />}</Avatar>
          <Box><Typography variant="h4" fontWeight={800} sx={{ letterSpacing: '-0.04em' }}>{t(success ? 'access.welcome.successTitle' : 'access.welcome.title')}</Typography><Typography color="text.secondary" sx={{ mt: 1.5 }}>{t(success ? 'access.welcome.successBody' : 'access.welcome.body')}</Typography></Box>
          {error && <Alert severity="warning" sx={{ width: '100%', boxSizing: 'border-box', textAlign: 'left' }}>{t(error)}</Alert>}
          {(busy || authLoading) && <Stack direction="row" alignItems="center" spacing={1.5}><CircularProgress size={22} /><Typography variant="body2" color="text.secondary">{t('access.welcome.connecting')}</Typography></Stack>}
          {success ? <Button fullWidth size="large" variant="contained" endIcon={<ArrowForwardRoundedIcon />} onClick={() => navigate('/dashboard', { replace: true })}>{t('access.welcome.start')}</Button> : currentUser ? <Stack spacing={1} sx={{ width: '100%' }}><Typography variant="body2" color="text.secondary">{t('access.welcome.signedIn', { email: currentUser.email })}</Typography>{error && token && <Button variant="contained" disabled={busy} onClick={() => setRetry(value => value + 1)}>{t('access.retry')}</Button>}<Button disabled={busy} color="inherit" onClick={() => void switchAccount().catch(() => setError('access.errors.generic'))}>{t('access.welcome.switchAccount')}</Button></Stack> : <Button fullWidth size="large" variant="contained" disabled={busy || authLoading || !token} onClick={() => void login()}>{t('auth.googleSignIn')}</Button>}
          {!success && <Typography variant="caption" color="text.secondary">{t('access.welcome.private')}</Typography>}
        </Stack>
      </Card>
    </Stack></Container>
  </Box>;
}
