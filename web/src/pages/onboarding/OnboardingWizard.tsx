import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Card, CardActionArea, CardContent, Chip, Container, LinearProgress, MenuItem, Stack, TextField, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import { serverTimestamp } from 'firebase/firestore';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { setProfile } from '../../firebase/firestore';
import type { UserProfile } from '../../types/user';
import LanguageSwitcher from '../../components/layout/LanguageSwitcher';
import Step3Exercise from './Step3Exercise';
import Step5Language from './Step5Language';

const TOTAL_STEPS = 3;

export default function OnboardingWizard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const currentUser = useAuthStore(state => state.currentUser);
  const existingProfile = useProfileStore(state => state.profile);
  const storageKey = 'tac:onboarding:' + (currentUser?.uid || 'anonymous') + ':v2';
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Partial<UserProfile>>(() => {
    const language = i18n.language.startsWith('es') ? 'es' : 'en';
    const initial: Partial<UserProfile> = {
      name: existingProfile?.name || currentUser?.displayName || '',
      training_goal: 'general', equipment: 'gym', training_days_per_week: 3, session_length_min: 45,
      units: 'metric', workout_weight_unit: 'lb', ui_language: language, response_language: language,
      coaching_tone: 'friendly', ...existingProfile,
    };
    try { const saved = localStorage.getItem(storageKey); return saved ? { ...initial, ...JSON.parse(saved) } : initial; }
    catch { return initial; }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!currentUser) return;
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* private browsing can disable storage */ }
  }, [draft, currentUser, storageKey]);
  const update = (partial: Partial<UserProfile>) => setDraft(previous => ({ ...previous, ...partial }));
  const next = () => {
    if (!draft.name?.trim() || draft.name.trim().length > 80) { setError(t('redesign.onboarding.nameError')); return; }
    setError('');
    setStep(previous => Math.min(previous + 1, TOTAL_STEPS - 1));
  };
  const finish = async () => {
    if (!currentUser || saving) return;
    if (!draft.name?.trim()) { setError(t('redesign.onboarding.nameError')); setStep(0); return; }
    setSaving(true);
    setError('');
    const payload = {
      ...draft, name: draft.name.trim(), onboarding_complete: true,
      created_at: existingProfile?.created_at ?? serverTimestamp(), updated_at: serverTimestamp(),
      ui_language: (i18n.language.startsWith('es') ? 'es' : 'en') as UserProfile['ui_language'],
    };
    try {
      await setProfile(currentUser.uid, payload);
      const latest = useProfileStore.getState();
      latest.setProfile({ ...existingProfile, ...payload } as UserProfile, currentUser.uid);
      try { localStorage.removeItem(storageKey); } catch { /* local draft is optional */ }
      navigate('/dashboard', { replace: true });
    } catch { setError(t('redesign.onboarding.saveError')); }
    finally { setSaving(false); }
  };
  const labels = ['redesign.onboarding.you', 'redesign.onboarding.rhythm', 'redesign.onboarding.coach'];
  return <Box sx={{ minHeight: '100dvh', bgcolor: '#f7f6fc' }}>
    <Container maxWidth="sm" sx={{ py: { xs: 2, sm: 4 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 4 }}><Stack direction="row" alignItems="center" spacing={1}><FitnessCenterRoundedIcon color="primary" /><Typography fontWeight={800}>{t('app.name')}</Typography></Stack><LanguageSwitcher /></Stack>
      <Stack direction="row" gap={1} alignItems="center" sx={{ mb: 2 }}><Chip size="small" color="primary" label={t('redesign.onboarding.quickSetup')} /><Typography variant="caption" color="text.secondary">{t('redesign.onboarding.time')}</Typography></Stack>
      <Typography component="h1" variant="h4" sx={{ fontSize: { xs: '1.85rem', sm: '2.1rem' } }}>{t(labels[step])}</Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>{t('redesign.onboarding.stepHint' + (step + 1))}</Typography>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}><Typography variant="caption" fontWeight={650}>{t('onboarding.step', { current: step + 1, total: TOTAL_STEPS })}</Typography><Typography variant="caption" color="text.secondary">{t('redesign.onboarding.later')}</Typography></Stack>
      <LinearProgress variant="determinate" value={(step + 1) / TOTAL_STEPS * 100} sx={{ height: 6, mb: 3 }} />
      <Card><CardContent sx={{ p: { xs: 2.5, sm: 3.5 } }}>
        <Box component="fieldset" disabled={saving} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
          <Stack spacing={3}>
            {step === 0 && <>
              <TextField label={t('onboarding.about.name')} autoComplete="given-name" autoFocus value={draft.name || ''} onChange={event => update({ name: event.target.value })} required fullWidth slotProps={{ htmlInput: { maxLength: 80 } }} />
              <Box><Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('redesign.onboarding.goal')}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
                  {(['fat_loss', 'muscle_gain', 'endurance', 'general'] as const).map(goal => <Card key={goal} sx={{ borderRadius: 3, boxShadow: 'none', bgcolor: draft.training_goal === goal ? '#f0e9fe' : '#fff', borderColor: draft.training_goal === goal ? 'primary.main' : 'divider' }}><CardActionArea onClick={() => update({ training_goal: goal })} aria-pressed={draft.training_goal === goal} sx={{ p: 2, minHeight: 84, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}><Typography variant="body2" fontWeight={650}>{t('onboarding.exercise.goalOptions.' + goal)}</Typography>{draft.training_goal === goal && <CheckRoundedIcon fontSize="small" color="primary" />}</CardActionArea></Card>)}
                </Box>
              </Box>
            </>}
            {step === 1 && <Step3Exercise draft={draft} onUpdate={update} showGoal={false} />}
            {step === 2 && <>
              <Step5Language draft={draft} onUpdate={update} />
              <TextField select label={t('weightInput.workoutUnit')} value={draft.workout_weight_unit || 'lb'} onChange={event => update({ workout_weight_unit: event.target.value as 'kg' | 'lb' })} helperText={t('redesign.profile.bodyUnits')} fullWidth><MenuItem value="lb">lb</MenuItem><MenuItem value="kg">kg</MenuItem></TextField>
              <Alert severity="info">{t('redesign.onboarding.optionalHint')}</Alert>
            </>}
            {error && <Alert severity="error" role="alert">{error}</Alert>}
          </Stack>
        </Box>
      </CardContent></Card>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 3 }}>
        <Button disabled={step === 0 || saving} startIcon={<ArrowBackRoundedIcon />} onClick={() => { setStep(previous => previous - 1); setError(''); }}>{t('onboarding.back')}</Button>
        <Button variant="contained" disabled={saving} endIcon={step === TOTAL_STEPS - 1 ? <CheckRoundedIcon /> : <ArrowForwardRoundedIcon />} onClick={step === TOTAL_STEPS - 1 ? finish : next}>{saving ? t('redesign.profile.saving') : step === TOTAL_STEPS - 1 ? t('redesign.onboarding.finish') : t('onboarding.next')}</Button>
      </Stack>
    </Container>
  </Box>;
}
