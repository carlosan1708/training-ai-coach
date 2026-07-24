import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExerciseGif from '../ExerciseGif';
import type { RoutineExercise } from '../../types/routine';

interface Props {
  open: boolean;
  /** Existing values when editing, or pre-filled values from the picker. */
  initial: RoutineExercise | null;
  /** Allow editing name / custom GIF URL (custom exercises). */
  editableName?: boolean;
  onClose: () => void;
  onSave: (exercise: RoutineExercise) => void;
}

const DEFAULTS: RoutineExercise = { name: '', sets: 3, reps: 10 };

/** Configure sets / reps / weight / rest for a routine exercise. */
export default function ExerciseConfigDialog({ open, initial, editableName, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [ex, setEx] = useState<RoutineExercise>(DEFAULTS);

  // Re-seed the form each time the dialog opens (render-time state adjustment)
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setEx({ ...DEFAULTS, ...(initial ?? {}) });
  }

  const set = (field: keyof RoutineExercise, value: unknown) =>
    setEx((prev) => ({ ...prev, [field]: value }));

  const numField = (field: keyof RoutineExercise, value: string) =>
    set(field, value === '' ? undefined : Number(value));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{editableName ? t('routines.customExercise') : ex.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <ExerciseGif gifUrl={ex.gif_url} images={ex.images} size={96} />
            {ex.muscle_group && (
              <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                {ex.muscle_group}
              </Typography>
            )}
          </Stack>

          {editableName && (
            <>
              <TextField
                label={t('routines.exerciseName')}
                value={ex.name}
                onChange={(e) => set('name', e.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label={t('routines.gifUrl')}
                value={ex.gif_url ?? ''}
                onChange={(e) => set('gif_url', e.target.value || undefined)}
                size="small"
                fullWidth
                placeholder="https://…/exercise.gif"
                helperText={t('routines.gifUrlHint')}
              />
            </>
          )}

          <Grid container spacing={1}>
            <Grid size={{ xs: 6 }}>
              <TextField
                label={t('exerciseLog.sets')}
                type="number"
                value={ex.sets ?? ''}
                onChange={(e) => numField('sets', e.target.value)}
                size="small" fullWidth inputProps={{ min: 1 }}
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                label={t('exerciseLog.reps')}
                type="number"
                value={ex.reps ?? ''}
                onChange={(e) => numField('reps', e.target.value)}
                size="small" fullWidth inputProps={{ min: 1 }}
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                label={t('exerciseLog.weightKg')}
                type="number"
                value={ex.weight_kg ?? ''}
                onChange={(e) => numField('weight_kg', e.target.value)}
                size="small" fullWidth inputProps={{ min: 0, step: 0.5 }}
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                label={t('routines.restSec')}
                type="number"
                value={ex.rest_sec ?? ''}
                onChange={(e) => numField('rest_sec', e.target.value)}
                size="small" fullWidth inputProps={{ min: 0, step: 15 }}
              />
            </Grid>
          </Grid>

          <TextField
            label={t('exerciseLog.notes')}
            value={ex.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            size="small" fullWidth multiline
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!ex.name.trim() || !ex.sets || !ex.reps}
          onClick={() => onSave({ ...ex, name: ex.name.trim() })}
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
