import { loadConvention } from '../../lib/loadBasis';
import LoadBasisGuidance from './LoadBasisGuidance';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Stack, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import { substituteExerciseFn } from '../../firebase/callables';
import { isQaAiPaused } from '../../lib/aiErrors';
import { formatWeight, getExerciseWeightUnit } from '../../lib/units';
import { prepareWorkoutExerciseAddition } from '../../lib/workoutExerciseAddition';
import { useProfileStore } from '../../store/profileStore';
import type { RoutineExercise, SessionExercise } from '../../types/routine';

interface Props {
  exercise: SessionExercise;
  onClose: () => void;
  onApply: (exercise: RoutineExercise, reason: string, permanent: boolean) => Promise<void>;
}

/** Suggestions are requested and reviewed explicitly before changing the draft. */
export default function ExerciseSubstitutionDialog({ exercise, onClose, onApply }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const profile = useProfileStore(state => state.profile);
  const titleId = useId();
  const scopeLabelId = useId();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [permanent, setPermanent] = useState(false);
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState<{ exercise: RoutineExercise; reason: string } | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const remaining = exercise.sets.filter(set => !set.done);
  const unit = getExerciseWeightUnit(profile, exercise);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const request = async () => {
    if (busy.current || loading || applying || !remaining.length) return;
    busy.current = true;
    setLoading(true);
    setError('');
    setSuggestion(null);
    try {
      const weight = remaining[0]?.weight_kg ?? exercise.target_weight_kg;
      const result = await substituteExerciseFn({ substitution: {
        exercise: {
          name: exercise.name, ...loadConvention(exercise),
          sets: remaining.length,
          reps: remaining[0]?.reps ?? exercise.target_reps,
          ...(weight != null ? { weight_kg: weight } : {}),
          ...(exercise.rest_sec != null ? { rest_sec: exercise.rest_sec } : {}),
        },
        reason: reason.trim(),
      } });
      if (!result.data.substitution?.name?.trim()) throw new Error('No alternative returned');
      if (mounted.current) setSuggestion({
        exercise: prepareWorkoutExerciseAddition(result.data.substitution), reason: result.data.reason,
      });
    } catch (failure) {
      if (mounted.current) setError(isQaAiPaused(failure) ? 'redesign.qa.aiPaused' : 'workoutTools.substitutionError');
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  };

  const apply = async () => {
    if (!suggestion || busy.current || loading || applying || !remaining.length) return;
    busy.current = true;
    setApplying(true);
    setError('');
    try {
      await onApply(suggestion.exercise, suggestion.reason, permanent);
    } catch {
      if (mounted.current) setError('workoutTools.substitutionApplyError');
    } finally {
      busy.current = false;
      if (mounted.current) setApplying(false);
    }
  };

  return <Dialog open onClose={applying ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}
    scroll="paper" aria-labelledby={titleId}
    slotProps={{ paper: { sx: { minWidth: 0, maxWidth: '100%', m: { xs: 0, sm: 3 } } } }}>
    <DialogTitle id={titleId}>{t('workoutTools.substitutionTitle')}</DialogTitle>
    <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, minWidth: 0 }}>
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{exercise.name}</Typography>
        <Typography variant="body2" color="text.secondary">{t('workoutTools.substitutionHint')}</Typography>
        <FormControl component="fieldset" fullWidth disabled={loading || applying}>
          <FormLabel component="legend" id={scopeLabelId}>{t('workoutTools.substitutionScope')}</FormLabel>
          <RadioGroup aria-labelledby={scopeLabelId} value={permanent ? 'routine' : 'session'}
            onChange={event => setPermanent(event.target.value === 'routine')}>
            <FormControlLabel value="session" control={<Radio />} label={t('workoutTools.substitutionSessionScope')}
              disabled={loading || applying} sx={{ minHeight: 44, mx: 0 }} />
            <FormControlLabel value="routine" control={<Radio />} label={t('workoutTools.substitutionRoutineScope')}
              disabled={loading || applying} sx={{ minHeight: 44, mx: 0 }} />
          </RadioGroup>
        </FormControl>
        <Alert severity="info">
          {t(permanent ? 'workoutTools.substitutionRoutineHint' : 'workoutTools.sessionOnly')}
          {(permanent || exercise.sets.some(set => set.done)) && <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
            {t('workoutTools.completedSetsHint')}
          </Box>}
        </Alert>
        <TextField fullWidth multiline minRows={2} label={t('workoutTools.substitutionReason')}
          placeholder={t('workoutTools.substitutionPlaceholder')} value={reason} disabled={loading || applying}
          onChange={event => setReason(event.target.value)} slotProps={{ htmlInput: { maxLength: 800 } }} />
        <Button variant="outlined" startIcon={loading ? <CircularProgress size={18} /> : <AutoFixHighRoundedIcon />}
          disabled={loading || applying || !remaining.length} onClick={() => { void request(); }} sx={{ minHeight: 44 }}>
          {t(loading ? 'workoutTools.requestingAlternatives' : suggestion ? 'workoutTools.requestAnother' : 'workoutTools.requestAlternatives')}
        </Button>
        {error && <Alert severity="error">{t(error)}</Alert>}
        {suggestion && <Box component="section" aria-label={t('workoutTools.suggestedExercise')}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 3, p: 2, minWidth: 0 }}>
          <Stack spacing={1}>
            <Typography component="h2" variant="h6" sx={{ overflowWrap: 'anywhere' }}>{suggestion.exercise.name}</Typography>
            <LoadBasisGuidance exercise={suggestion.exercise} />
            <Typography variant="body2">{t('workoutTools.alternativePrescription', {
              sets: suggestion.exercise.sets, reps: suggestion.exercise.reps,
            })}</Typography>
            {suggestion.exercise.weight_kg != null && <Typography variant="body2">
              {t('workoutTools.alternativeLoad', { weight: formatWeight(suggestion.exercise.weight_kg, unit) })}
            </Typography>}
            {suggestion.exercise.rest_sec != null && <Typography variant="body2">
              {t('workoutTools.alternativeRest', { seconds: suggestion.exercise.rest_sec })}
            </Typography>}
            {suggestion.reason && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {suggestion.reason}
            </Typography>}
            {suggestion.exercise.notes && <Typography variant="body2" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
              {suggestion.exercise.notes}
            </Typography>}
          </Stack>
        </Box>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ p: 2, gap: 1, flexDirection: { xs: 'column-reverse', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' } }}>
      <Button onClick={onClose} disabled={applying} sx={{ minHeight: 44 }}>{t('workoutTools.close')}</Button>
      {suggestion && <Button variant="contained" disabled={loading || applying || !remaining.length} sx={{ minHeight: 44 }}
        onClick={() => { void apply(); }}>{t(applying ? 'workoutTools.applyingAlternative' : 'workoutTools.useAlternative')}</Button>}
    </DialogActions>
  </Dialog>;
}
