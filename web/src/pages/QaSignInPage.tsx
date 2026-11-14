import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button, Container, Stack, TextField, Typography } from '@mui/material';
import { isQaAuthenticationEnabled } from '../firebase/config';
import { signInForQa } from '../firebase/auth';

export default function QaSignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!isQaAuthenticationEnabled) return <Navigate to="/" replace />;
  return <Container maxWidth="xs" sx={{ py: 8 }}><Stack component="form" spacing={3} onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(false);
    try { await signInForQa(email, password); setPassword(''); navigate('/dashboard'); }
    catch { setError(true); }
    finally { setBusy(false); }
  }}><Typography variant="h4" fontWeight={800}>Training Coach QA</Typography><Alert severity="info">Synthetic test accounts only. This environment is isolated from production.</Alert>
    {error && <Alert severity="error">Sign-in failed. Check your test-account credentials.</Alert>}
    <TextField label="QA email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} />
    <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
    <Button variant="contained" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to QA'}</Button>
  </Stack></Container>;
}
