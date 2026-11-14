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
import ExerciseAutocomplete from '../ExerciseAutocomplete';
import WeightField from '../WeightField';
import LoadBasisGuidance, { RecordedLoadReference } from '../workouts/LoadBasisGuidance';
import LoadBasisControl from '../workouts/LoadBasisControl';
import { classifyRecordedLoad, suggestedLoadBasis, validLoadBasis } from '../../lib/loadBasis';
import type { RecordedExerciseReference } from '../../lib/exerciseDefaults';
import { useProfileStore } from '../../store/profileStore';
import { getExerciseWeightUnit } from '../../lib/units';
import type { RoutineExercise } from '../../types/routine';

interface Props {
  open: boolean;
  /** Existing values when editing, or pre-filled values from the picker. */
  initial: RoutineExercise | null;
  /** Read-only evidence; adopted only by the explicit confirmation action. */
  recordedReference?: RecordedExerciseReference;
  /** Allow editing name / custom GIF URL (custom exercises). */
  editableName?: boolean;
  onClose: () => void;
  onSave: (exercise: RoutineExercise) => void;
}

const DEFAULTS: RoutineExercise = { name: '', sets: 3, reps: 10 };

/** Configure sets / reps / weight / rest for a routine exercise. */
export default function ExerciseConfigDialog({ open, initial, recordedReference, editableName, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const profile = useProfileStore(state => state.profile);
  const [ex, setEx] = useState<RoutineExercise>(DEFAULTS);
  const [adoptedReference, setAdoptedReference] = useState(false);

  // Re-seed the form each time the dialog opens (render-time state adjustment)
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setAdoptedReference(false);
    if (open) setEx({ ...DEFAULTS, ...(initial ?? {}),
      ...(!initial?.id && !initial?.targets_revision && !initial?.set_defaults && initial?.weight_kg == null
        ? { load_basis: initial?.load_basis ?? suggestedLoadBasis(initial ?? DEFAULTS) } : {}) });
  }

  const set = (field: keyof RoutineExercise, value: unknown) =>
    setEx((prev) => ({ ...prev, [field]: value }));

  const numField = (field: keyof RoutineExercise, value: string) =>
    set(field, value === '' ? undefined : Number(value));

  const editorUnit = initial?.load_basis_review_required && ex.weight_unit
    ? ex.weight_unit : getExerciseWeightUnit(profile, ex);
  const confirmRecordedWeights = () => {
    if (!validLoadBasis(ex.load_basis) || !recordedReference?.sets.length) return;
    setAdoptedReference(recordedReference.source === 'history');
    setEx(previous => {
      if (!validLoadBasis(previous.load_basis)) return previous;
      const adopted = recordedReference.source === 'history' ? {
        ...previous,
        weight_kg: recordedReference.sets[0].weight_kg,
        set_defaults: Array.from({ length: previous.sets }, (_, index) => ({
          reps: previous.set_defaults?.[index]?.reps ?? previous.set_defaults?.at(-1)?.reps ?? previous.reps,
          weight_kg: (recordedReference.sets[index] ?? recordedReference.sets.at(-1)!).weight_kg,
        })),
        ...(recordedReference.weight_unit ? { weight_unit: recordedReference.weight_unit,
          weight_unit_override: true } : {}),
      } : previous;
      return classifyRecordedLoad(adopted, previous.load_basis);
    });
  };

  const save = () => {
    const name = ex.name.trim();
    const renamed = initial?.name && initial.name.trim() !== name;
    const previousNames = [...new Set([
      ...(initial?.previous_names ?? []), ...(ex.previous_names ?? []), ...(renamed ? [initial.name] : []),
    ].map(previous => previous.trim()).filter(previous => previous && previous !== name))];
    const unit = editorUnit;
    const changedReps = ex.reps !== initial?.reps;
    const changedWeight = ((ex.weight_kg ?? 0) !== (initial?.weight_kg ?? 0)
      || typeof ex.weight_kg === 'number' && initial?.weight_kg == null)
      && !(adoptedReference && ex.weight_kg === recordedReference?.sets[0]?.weight_kg);
    const changedValues = changedReps || changedWeight;
    const changedTargets = changedValues || ex.sets !== initial?.sets
      || ex.weight_unit !== initial?.weight_unit
      || Boolean(ex.weight_unit_override) !== Boolean(initial?.weight_unit_override)
      || ex.load_basis !== initial?.load_basis
      || Boolean(ex.load_basis_review_required) !== Boolean(initial?.load_basis_review_required);
    const configured = changedWeight && typeof ex.weight_kg === 'number' && validLoadBasis(ex.load_basis)
      ? classifyRecordedLoad(ex, ex.load_basis) : ex;
    onSave({
      ...configured,
      id: ex.id ?? initial?.id ?? crypto.randomUUID(),
      name,
      ...(previousNames.length || ex.previous_names ? { previous_names: previousNames } : {}),
      weight_unit: unit,
      ...(changedTargets ? { targets_revision: crypto.randomUUID() } : {}),
      ...(changedValues ? { set_defaults: Array.from({ length: ex.sets }, (_, index) => {
        const previous = ex.set_defaults?.[index] ?? ex.set_defaults?.at(-1);
        return { reps: changedReps ? ex.reps : previous?.reps ?? ex.reps,
          weight_kg: changedWeight ? ex.weight_kg ?? 0 : previous?.weight_kg ?? ex.weight_kg ?? 0 };
      }) } : {}),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{editableName ? t('routines.customExercise') : ex.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {!editableName && <Stack direction="row" spacing={2} alignItems="center">
            <ExerciseGif gifUrl={ex.gif_url} images={ex.images} size={96} />
            {ex.muscle_group && (
              <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                {ex.muscle_group}
              </Typography>
            )}
          </Stack>}

          {editableName && (
            <>
              <ExerciseAutocomplete
                label={t('routines.exerciseName')}
                value={ex.name}
                gifUrl={ex.gif_url} images={ex.images}
                onChange={name => setEx(previous => {
                  if (previous.name === name) return previous;
                  const next = { ...previous, name };
                  delete next.library_id;
                  delete next.images;
                  delete next.gif_url;
                  delete next.instructions;
                  delete next.muscle_group;
                  delete next.equipment;
                  return next;
                })}
                onSelect={exercise => setEx(previous => {
                  const next = { ...previous, name: exercise.name, library_id: exercise.id,
                    images: [...exercise.images], instructions: exercise.instructions.slice(0, 4) };
                  delete next.gif_url;
                  if (exercise.primaryMuscles[0]) next.muscle_group = exercise.primaryMuscles[0];
                  else delete next.muscle_group;
                  if (exercise.equipment) next.equipment = exercise.equipment;
                  else delete next.equipment;
                  return next;
                })}
                required
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

          <LoadBasisControl exercise={ex} hint={t('loadBasis.changeHint')}
            onChange={basis => setEx(previous => ({ ...previous, load_basis: basis,
              load_basis_review_required: previous.load_basis_review_required || previous.load_basis !== basis,
              ...(previous.load_basis !== basis ? { load_basis_confirmed: false } : {}) }))} />
          <LoadBasisGuidance exercise={ex} />
          {ex.load_basis_review_required && recordedReference && <RecordedLoadReference reference={recordedReference} />}
          {ex.load_basis_review_required && <Button variant="outlined" sx={{ minHeight: 44 }}
            disabled={!validLoadBasis(ex.load_basis) || !recordedReference?.sets.length}
            onClick={confirmRecordedWeights}>{t('loadBasis.useRecordedWeights')}</Button>}
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
                label={t('routines.restSec')}
                type="number"
                value={ex.rest_sec ?? ''}
                onChange={(e) => numField('rest_sec', e.target.value)}
                size="small" fullWidth inputProps={{ min: 0, step: 15 }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <WeightField valueKg={ex.weight_kg ?? ex.set_defaults?.[0]?.weight_kg}
                unit={editorUnit}
                onUnitChange={unit => setEx(previous => ({ ...previous, weight_unit: unit, weight_unit_override: true }))}
                onChange={kilograms => set('weight_kg', kilograms)} />
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
          onClick={save}
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
