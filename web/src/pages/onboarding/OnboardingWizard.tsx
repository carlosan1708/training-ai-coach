import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Container,
  LinearProgress,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { serverTimestamp } from 'firebase/firestore';
import { useAuthStore } from '../../store/authStore';
import { setProfile } from '../../firebase/firestore';
import type { UserProfile } from '../../types/user';
import Step1About from './Step1About';
import Step2Diet from './Step2Diet';
import Step3Exercise from './Step3Exercise';
import Step4Health from './Step4Health';
import Step5Language from './Step5Language';

const STORAGE_KEY = 'onboarding_draft';
const TOTAL_STEPS = 5;

const defaultDraft: Partial<UserProfile> = {
  dietary_style: 'omnivore',
  intolerances: [],
  disliked_foods: [],
  preferred_cuisines: [],
  meals_per_day: 3,
  caloric_target: 'auto',
  training_goal: 'general',
  equipment: 'gym',
  training_days_per_week: 3,
  session_length_min: 45,
  movement_restrictions: '',
  health_notes: '',
  units: 'metric',
  ui_language: 'en',
  response_language: 'en',
  coaching_tone: 'friendly',
};

export default function OnboardingWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Partial<UserProfile>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...defaultDraft, ...JSON.parse(saved) } : defaultDraft;
    } catch {
      return defaultDraft;
    }
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  const update = (partial: Partial<UserProfile>) =>
    setDraft((prev) => ({ ...prev, ...partial }));

  const handleNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const handleBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleFinish = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      await setProfile(currentUser.uid, {
        ...draft,
        onboarding_complete: true,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      localStorage.removeItem(STORAGE_KEY);
      navigate('/dashboard');
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const stepLabels = [
    t('onboarding.steps.about'),
    t('onboarding.steps.diet'),
    t('onboarding.steps.exercise'),
    t('onboarding.steps.health'),
    t('onboarding.steps.language'),
  ];

  const stepComponents = [
    <Step1About draft={draft} onUpdate={update} />,
    <Step2Diet draft={draft} onUpdate={update} />,
    <Step3Exercise draft={draft} onUpdate={update} />,
    <Step4Health draft={draft} onUpdate={update} />,
    <Step5Language draft={draft} onUpdate={update} />,
  ];

  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={700} textAlign="center">
          {t('onboarding.title')}
        </Typography>

        <Typography variant="body2" textAlign="center" color="text.secondary">
          {t('onboarding.step', { current: step + 1, total: TOTAL_STEPS })}
        </Typography>

        {isMobile ? (
          <LinearProgress
            variant="determinate"
            value={((step + 1) / TOTAL_STEPS) * 100}
            sx={{ borderRadius: 2, height: 6 }}
          />
        ) : (
          <Stepper activeStep={step} alternativeLabel>
            {stepLabels.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        )}

        <Box sx={{ minHeight: 300 }}>{stepComponents[step]}</Box>

        <Stack direction="row" justifyContent="space-between" spacing={2}>
          <Button
            variant="text"
            onClick={handleBack}
            disabled={step === 0}
          >
            {t('onboarding.back')}
          </Button>

          <Stack direction="row" spacing={1}>
            <Button
              variant="text"
              color="inherit"
              onClick={isLastStep ? handleFinish : handleNext}
            >
              {t('onboarding.skip')}
            </Button>
            <Button
              variant="contained"
              onClick={isLastStep ? handleFinish : handleNext}
              disabled={saving}
            >
              {isLastStep ? t('onboarding.finish') : t('onboarding.next')}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Container>
  );
}
