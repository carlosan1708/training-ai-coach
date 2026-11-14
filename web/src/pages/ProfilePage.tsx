import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Avatar, Box, Button, Card, CardContent, Container, Grid, MenuItem, Snackbar, Stack, TextField, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import RestaurantOutlinedIcon from '@mui/icons-material/RestaurantOutlined';
import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { serverTimestamp } from 'firebase/firestore';
import PageHeader from '../components/layout/PageHeader';
import Step1About from './onboarding/Step1About';
import Step2Diet from './onboarding/Step2Diet';
import Step3Exercise from './onboarding/Step3Exercise';
import Step4Health from './onboarding/Step4Health';
import Step5Language from './onboarding/Step5Language';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import { setProfile } from '../firebase/firestore';
import type { UserProfile } from '../types/user';
import { getWorkoutWeightUnit } from '../lib/units';

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const currentUser = useAuthStore(state => state.currentUser);
  const profile = useProfileStore(state => state.profile);
  const [draft, setDraft] = useState<Partial<UserProfile>>(() => ({ ...profile }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const update = (partial: Partial<UserProfile>) => { setDraft(previous => ({ ...previous, ...partial })); setSaved(false); };
  const save = async () => {
    if (!currentUser || saving) return;
    const invalidOptional = (value: number | undefined, min: number, max: number) => value != null && (!Number.isFinite(value) || value < min || value > max);
    if (!draft.name?.trim() || draft.name.trim().length > 80) { setError(t('redesign.onboarding.nameError')); return; }
    if (invalidOptional(draft.age, 10, 120) || invalidOptional(draft.height_cm, 50, 300) || invalidOptional(draft.goal_weight_kg, 20, 500)) { setError(t('redesign.profile.invalidNumbers')); return; }
    const cleanList = (items?: string[]) => (items || []).map(item => item.trim()).filter(Boolean);
    const patch: Partial<UserProfile> = {
      ...draft, name: draft.name.trim(), units: 'metric',
      ui_language: i18n.language.startsWith('es') ? 'es' : 'en',
      intolerances: cleanList(draft.intolerances), disliked_foods: cleanList(draft.disliked_foods), preferred_cuisines: cleanList(draft.preferred_cuisines),
      updated_at: serverTimestamp(),
    };
    setSaving(true); setError('');
    try {
      await setProfile(currentUser.uid, patch);
      const latest = useProfileStore.getState();
      if (latest.profileUid === currentUser.uid && latest.profile) latest.setProfile({ ...latest.profile, ...patch }, currentUser.uid);
      setDraft(previous => ({ ...previous, ...patch }));
      setSaved(true);
    } catch { setError(t('redesign.profile.saveError')); }
    finally { setSaving(false); }
  };
  const sections = [
    { id: 'about', icon: <PersonOutlineRoundedIcon />, title: 'redesign.profile.about', hint: 'redesign.profile.aboutHint', body: <Step1About draft={draft} onUpdate={update} /> },
    { id: 'training', icon: <FitnessCenterRoundedIcon />, title: 'redesign.profile.training', hint: 'redesign.profile.trainingHint', body: <Stack spacing={3}><Step3Exercise draft={draft} onUpdate={update} /><TextField select fullWidth label={t('weightInput.workoutUnit')} value={getWorkoutWeightUnit(draft)} helperText={t('redesign.profile.bodyUnits')} onChange={event => update({ workout_weight_unit: event.target.value as 'kg' | 'lb' })}><MenuItem value="lb">lb</MenuItem><MenuItem value="kg">kg</MenuItem></TextField></Stack> },
    { id: 'diet', icon: <RestaurantOutlinedIcon />, title: 'redesign.profile.nutrition', hint: 'redesign.profile.nutritionHint', body: <Step2Diet draft={draft} onUpdate={update} /> },
    { id: 'health', icon: <FavoriteBorderRoundedIcon />, title: 'redesign.profile.health', hint: 'redesign.profile.healthHint', body: <Step4Health draft={draft} onUpdate={update} /> },
    { id: 'coach', icon: <AutoAwesomeOutlinedIcon />, title: 'redesign.profile.coach', hint: 'redesign.profile.coachHint', body: <Step5Language draft={draft} onUpdate={update} /> },
  ];
  return <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, sm: 3, md: 4 } }}>
    <Stack spacing={3}>
      <PageHeader eyebrow={t('redesign.profile.eyebrow')} title={t('redesign.profile.title')} description={t('redesign.profile.description')} />
      <Grid container spacing={3} alignItems="flex-start">
        <Grid size={{ xs: 12, md: 4 }}>
          <Card><CardContent>
            <Avatar sx={{ width: 64, height: 64, bgcolor: '#eee3fe', color: 'primary.main', fontWeight: 750, fontSize: 26, mb: 2 }}>{draft.name?.charAt(0).toUpperCase() || <PersonOutlineRoundedIcon />}</Avatar>
            <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{draft.name || currentUser?.displayName}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere', mt: 0.5 }}>{currentUser?.email}</Typography>
            <Box sx={{ mt: 3, p: 2, bgcolor: '#f7f4fc', borderRadius: 3 }}><Typography variant="body2" fontWeight={650}>{t('redesign.profile.yourPace')}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>{t('redesign.profile.yourPaceHint')}</Typography></Box>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack spacing={2}>
            {error && <Alert severity="error" role="alert">{error}</Alert>}
            <Box inert={saving} sx={{ opacity: saving ? 0.65 : 1 }}>
              {sections.map((section, index) => <Accordion key={section.id} defaultExpanded={index === 0} disableGutters elevation={0} sx={{ mb: 1.5, border: 1, borderColor: 'divider', borderRadius: '18px !important', '&:before': { display: 'none' }, overflow: 'hidden' }}>
                <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} sx={{ px: { xs: 2, sm: 3 }, py: 1, minHeight: 82 }} id={'profile-' + section.id} aria-controls={'profile-' + section.id + '-content'}>
                  <Stack direction="row" spacing={1.5} alignItems="center"><Box sx={{ color: 'primary.main', bgcolor: '#f1eafb', borderRadius: 2.5, width: 38, height: 38, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{section.icon}</Box><Box><Typography fontWeight={700} variant="body2">{t(section.title)}</Typography><Typography variant="caption" color="text.secondary">{t(section.hint)}</Typography></Box></Stack>
                </AccordionSummary>
                <AccordionDetails id={'profile-' + section.id + '-content'} sx={{ px: { xs: 2, sm: 3 }, pb: 3 }}>{section.body}</AccordionDetails>
              </Accordion>)}
            </Box>
            <Box sx={{ position: 'sticky', bottom: { xs: 82, md: 16 }, border: 1, borderColor: 'divider', bgcolor: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(12px)', p: 2, borderRadius: 3, zIndex: 10 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1.5}>
                <Typography variant="caption" color="text.secondary">{t('redesign.profile.saveHint')}</Typography>
                <Button variant="contained" disabled={saving} startIcon={!saving && <CheckRoundedIcon />} onClick={() => { void save(); }} sx={{ flexShrink: 0 }}>{t(saving ? 'redesign.profile.saving' : 'redesign.profile.save')}</Button>
              </Stack>
            </Box>
          </Stack>
        </Grid>
      </Grid>
    </Stack>
    <Snackbar open={saved} autoHideDuration={3500} onClose={() => setSaved(false)} sx={{ bottom: { xs: 150, md: 24 } }}><Alert severity="success" onClose={() => setSaved(false)}>{t('redesign.profile.saved')}</Alert></Snackbar>
  </Container>;
}
