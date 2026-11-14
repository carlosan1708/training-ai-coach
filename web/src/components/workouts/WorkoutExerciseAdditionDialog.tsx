import { loadConvention } from '../../lib/loadBasis';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Radio, RadioGroup, Stack, Typography,
} from '@mui/material';
import ExercisePickerDialog from '../routines/ExercisePickerDialog';
import type { RoutineExercise, SessionExercise } from '../../types/routine';

interface Props {
  promotion?: SessionExercise;
  dayName?: string;
  onClose: () => void;
  onSave: (exercise: RoutineExercise, permanent: boolean) => Promise<void>;
}

function configuredExercise(exercise: SessionExercise): RoutineExercise {
  return {
    id: exercise.routine_exercise_id, name: exercise.name, ...loadConvention(exercise),
    ...(exercise.library_id ? { library_id: exercise.library_id } : {}),
    sets: exercise.sets.length, reps: exercise.sets[0]?.reps ?? exercise.target_reps,
    weight_kg: exercise.sets[0]?.weight_kg ?? exercise.target_weight_kg ?? 0,
    set_defaults: exercise.sets.map(set => ({ reps: set.reps, weight_kg: set.weight_kg })),
    ...(exercise.weight_unit ? { weight_unit: exercise.weight_unit } : {}),
    ...(exercise.weight_unit_override != null ? { weight_unit_override: exercise.weight_unit_override } : {}),
    ...(exercise.targets_revision ? { targets_revision: exercise.targets_revision } : {}),
    ...(exercise.rest_sec != null ? { rest_sec: exercise.rest_sec } : {}),
    ...(exercise.notes ? { notes: exercise.notes } : {}),
    ...(exercise.images ? { images: exercise.images } : {}),
    ...(exercise.gif_url ? { gif_url: exercise.gif_url } : {}),
  };
}

/** Choosing an exercise is a draft; only the final action writes either scope. */
export default function WorkoutExerciseAdditionDialog({ promotion, dayName, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [exercise, setExercise] = useState<RoutineExercise | null>(() => promotion ? configuredExercise(promotion) : null);
  const [permanent, setPermanent] = useState(Boolean(promotion));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const submit = async () => {
    if (!exercise || saving) return;
    setSaving(true); setError(false);
    try {
      await onSave(exercise, permanent);
      onClose();
    } catch { setError(true); }
    finally { setSaving(false); }
  };

  return <>
    {!exercise && <ExercisePickerDialog open onClose={onClose} onAdd={configured => {
      // Retain one request identity across retries and repeated confirmation.
      setExercise({ ...configured, id: configured.id ?? crypto.randomUUID() });
      setPermanent(false);
    }} />}
    <Dialog open={exercise !== null} onClose={() => { if (!saving) onClose(); }} fullWidth maxWidth="xs"
      aria-labelledby="add-workout-exercise-title">
      <DialogTitle id="add-workout-exercise-title">{t(promotion ? 'sessionAdd.promoteTitle' : 'sessionAdd.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{exercise?.name}</Typography>
          {promotion ? <Typography>{t('sessionAdd.promoteHint')}</Typography> : <RadioGroup
            aria-label={t('sessionAdd.scope')} value={permanent ? 'routine' : 'session'}
            onChange={(_, value) => setPermanent(value === 'routine')}>
            <FormControlLabel value="session" disabled={saving} sx={{ minHeight: 48 }} control={<Radio />}
              label={t('sessionAdd.onlyThisWorkout')} />
            <FormControlLabel value="routine" disabled={saving} sx={{ minHeight: 48 }} control={<Radio />}
              label={t('sessionAdd.alsoInRoutine')} />
          </RadioGroup>}
          <Typography variant="body2" color="text.secondary">
            {t(permanent ? dayName ? 'sessionAdd.dayHint' : 'sessionAdd.routineHint' : 'sessionAdd.temporaryHint', { day: dayName })}
          </Typography>
          {error && <Alert severity="error">{t('sessionAdd.saveError')}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button disabled={saving} sx={{ minHeight: 44 }} onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={saving} sx={{ minHeight: 44 }} onClick={() => { void submit(); }}
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : undefined}>
          {t(saving ? 'sessionEditor.saving' : promotion ? 'sessionAdd.saveInRoutine' : 'routines.addExercise')}
        </Button>
      </DialogActions>
    </Dialog>
  </>;
}
