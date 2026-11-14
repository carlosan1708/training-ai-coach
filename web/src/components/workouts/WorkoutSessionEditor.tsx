import LoadBasisGuidance from './LoadBasisGuidance';
import LoadBasisControl from './LoadBasisControl';
import { classifyRecordedLoad } from '../../lib/loadBasis';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, Paper, Stack, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import WeightField from '../WeightField';
import ExerciseAutocomplete from '../ExerciseAutocomplete';
import { getExerciseWeightUnit, type WeightUnit } from '../../lib/units';
import { useProfileStore } from '../../store/profileStore';
import {
  elapsedSeconds, formatElapsedTime, parseLocalDateTimeInput, toLocalDateTimeInput, timestampMillis,
} from '../../lib/workoutTime';
import type { SessionExercise, SessionSet, WorkoutSession, WorkoutSessionEdit } from '../../types/routine';

interface Props {
  open: boolean;
  session: WorkoutSession;
  defaultUnit: WeightUnit;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onSave: (data: WorkoutSessionEdit) => void;
}

interface EditorExercise {
  key: string;
  value: SessionExercise;
  setKeys: string[];
}

const cloneExercises = (exercises: SessionExercise[]): EditorExercise[] => exercises.map(exercise => ({
  key: crypto.randomUUID(),
  value: { ...exercise, sets: (exercise.sets ?? []).map(set => ({ ...set })) },
  setKeys: (exercise.sets ?? []).map(() => crypto.randomUUID()),
}));

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime()) && parsed.getFullYear() === Number(value.slice(0, 4))
    && parsed.getMonth() + 1 === Number(value.slice(5, 7)) && parsed.getDate() === Number(value.slice(8, 10));
};

/** Edits a saved workout in a draft; closing never changes its recorded data. */
export default function WorkoutSessionEditor({ open, session, defaultUnit, saving, error, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const profile = useProfileStore(state => state.profile);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();
  const [name, setName] = useState(session.routine_name ?? '');
  const [dayName, setDayName] = useState(session.day_name ?? '');
  const [date, setDate] = useState(session.date ?? '');
  const [notes, setNotes] = useState(session.notes ?? '');
  const [start, setStart] = useState(toLocalDateTimeInput(session.started_at));
  const [end, setEnd] = useState(toLocalDateTimeInput(session.completed_at));
  const [exercises, setExercises] = useState<EditorExercise[]>(() => cloneExercises(session.exercises ?? []));
  const [validationError, setValidationError] = useState('');
  const [seed, setSeed] = useState({ open, id: session.id });

  // Re-seed on opening, without replacing unsaved edits when a parent re-renders.
  if (seed.open !== open || seed.id !== session.id) {
    setSeed({ open, id: session.id });
    if (open) {
      setName(session.routine_name ?? '');
      setDayName(session.day_name ?? '');
      setDate(session.date ?? '');
      setNotes(session.notes ?? '');
      setStart(toLocalDateTimeInput(session.started_at));
      setEnd(toLocalDateTimeInput(session.completed_at));
      setExercises(cloneExercises(session.exercises ?? []));
      setValidationError('');
    }
  }

  const updateExercise = (index: number, update: Partial<SessionExercise>) => {
    setExercises(previous => previous.map((exercise, exerciseIndex) => exerciseIndex === index
      ? { ...exercise, value: { ...exercise.value, ...update } } : exercise));
  };
  const updateSet = (exerciseIndex: number, setIndex: number, update: Partial<SessionSet>) => {
    setExercises(previous => previous.map((exercise, index) => index === exerciseIndex ? {
      ...exercise, value: { ...exercise.value, sets: exercise.value.sets.map((set, index) => index === setIndex ? { ...set, ...update } : set) },
    } : exercise));
  };
  const addSet = (exerciseIndex: number) => {
    setExercises(previous => previous.map((exercise, index) => index === exerciseIndex ? {
      ...exercise,
      setKeys: [...exercise.setKeys, crypto.randomUUID()],
      value: { ...exercise.value, target_sets: exercise.value.sets.length + 1, sets: [...exercise.value.sets, {
        reps: exercise.value.sets.at(-1)?.reps ?? exercise.value.target_reps ?? 10,
        weight_kg: exercise.value.sets.at(-1)?.weight_kg ?? exercise.value.target_weight_kg ?? 0,
        done: false,
      }] },
    } : exercise));
  };
  const removeSet = (exerciseIndex: number, setIndex: number) => {
    setExercises(previous => previous.map((exercise, index) => index === exerciseIndex ? {
      ...exercise,
      setKeys: exercise.setKeys.filter((_, index) => index !== setIndex),
      value: { ...exercise.value, target_sets: exercise.value.sets.length - 1,
        sets: exercise.value.sets.filter((_, index) => index !== setIndex) },
    } : exercise));
  };
  const startedAt = start === toLocalDateTimeInput(session.started_at)
    ? timestampMillis(session.started_at) : parseLocalDateTimeInput(start);
  const completedAt = session.status === 'completed' ? end === toLocalDateTimeInput(session.completed_at)
    ? timestampMillis(session.completed_at) : parseLocalDateTimeInput(end) : null;
  const invalidOrder = startedAt != null && completedAt != null && completedAt < startedAt;
  const changedTimes = start !== toLocalDateTimeInput(session.started_at)
    || (session.status === 'completed' && end !== toLocalDateTimeInput(session.completed_at));
  const duration = !invalidOrder ? elapsedSeconds({
    ...session, started_at: startedAt, completed_at: completedAt,
    ...(changedTimes ? { duration_sec: undefined, duration_min: undefined } : {}),
  }) : null;

  const save = () => {
    let failure = '';
    if (!name.trim() || exercises.some(exercise => !exercise.value.name.trim())) failure = 'invalidName';
    else if (!validDate(date)) failure = 'invalidDate';
    else if ((start && (startedAt == null || startedAt < 0))
      || (session.status === 'completed' && end && (completedAt == null || completedAt < 0))) failure = 'invalidTime';
    else if (invalidOrder) failure = 'invalidOrder';
    else if (!exercises.length) failure = 'emptyWorkout';
    else if (exercises.some(({ value }) => !value.sets.length || value.sets.some(set =>
      !Number.isFinite(set.reps) || !Number.isInteger(set.reps) || set.reps < 0
      || !Number.isFinite(set.weight_kg) || set.weight_kg < 0))) failure = 'invalidSets';
    setValidationError(failure);
    if (failure) return;
    onSave({
      routine_name: name.trim(), day_name: dayName.trim(), date, notes: notes.trim(),
      started_at: startedAt, completed_at: completedAt,
      exercises: exercises.map(({ value }) => ({
        ...value, name: value.name.trim(),
        sets: value.sets.map(set => ({ ...set })),
      })),
    });
  };

  return <Dialog open={open} onClose={() => { if (!saving) onClose(); }} fullWidth maxWidth="md"
    fullScreen={fullScreen} scroll="paper" aria-labelledby={titleId}
    slotProps={{ paper: { sx: { maxWidth: '100%', m: { xs: 0, sm: 3 }, minWidth: 0 } } }}>
    <DialogTitle id={titleId}>{t('sessionEditor.title')}</DialogTitle>
    <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, minWidth: 0,
      '& .MuiTextField-root, & input': { minWidth: 0 }, '& .MuiInputBase-root': { minHeight: 44 } }}>
      <Stack spacing={2.5} sx={{ pt: 0.5, minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">{t(session.status === 'active' ? 'sessionEditor.activeDefaults' : 'sessionEditor.historyOnly')}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {validationError && <Alert severity="error" role="alert">{t(`sessionEditor.${validationError}`)}</Alert>}
        <TextField label={t('sessionEditor.workoutName')} value={name} disabled={saving} fullWidth size="small"
          onChange={event => setName(event.target.value)} required />
        <TextField label={t('sessionEditor.dayName')} value={dayName} disabled={saving} fullWidth size="small"
          onChange={event => setDayName(event.target.value)} />
        <TextField label={t('sessionEditor.date')} type="date" value={date} disabled={saving} fullWidth size="small"
          onChange={event => setDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }}>
          <TextField label={t('sessionEditor.startedAt')} type="datetime-local" value={start} disabled={saving} fullWidth size="small"
            onChange={event => setStart(event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1 } }} />
          {session.status === 'completed' && <TextField label={t('sessionEditor.completedAt')} type="datetime-local" value={end}
            disabled={saving} fullWidth size="small" onChange={event => setEnd(event.target.value)}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1 } }} />}
        </Stack>
        <Typography variant="caption" color="text.secondary">{t('sessionEditor.timeHint')}</Typography>
        {session.status === 'completed' && Boolean(start) !== Boolean(end) && <Alert severity="warning">
          {t('sessionEditor.partialTime')}
        </Alert>}
        {invalidOrder && <Alert severity="error">{t('sessionEditor.invalidOrder')}</Alert>}
        <Typography variant="body2" fontWeight={700} data-testid="editor-duration">
          {t('sessionEditor.duration')}: {duration == null ? t('sessionEditor.unknownDuration') : formatElapsedTime(duration)}
        </Typography>
        <TextField label={t('sessionEditor.notes')} value={notes} disabled={saving} fullWidth multiline minRows={2} size="small"
          onChange={event => setNotes(event.target.value)} />
        <Divider />
        {!exercises.length && <Alert severity="info">{t('sessionEditor.noExercises')}</Alert>}
        {exercises.map(({ key, value: exercise, setKeys }, exerciseIndex) => <Paper key={key} variant="outlined" component="section"
          aria-label={t('sessionEditor.exercise', { number: exerciseIndex + 1 })} sx={{ p: 1.5, minWidth: 0 }}>
          <Stack spacing={2} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle2">{t('sessionEditor.exercise', { number: exerciseIndex + 1 })}</Typography>
              <Button color="error" disabled={saving} startIcon={<DeleteOutlineIcon />}
                aria-label={t('sessionEditor.removeExercise', { number: exerciseIndex + 1 })}
                onClick={() => setExercises(previous => previous.filter((_, index) => index !== exerciseIndex))}
                sx={{ minHeight: 44, flexShrink: 0 }}>
                {t('common.delete')}
              </Button>
            </Stack>
            <ExerciseAutocomplete label={t('sessionEditor.exerciseName')} value={exercise.name} disabled={saving} required
              gifUrl={exercise.gif_url} images={exercise.images}
              onChange={name => updateExercise(exerciseIndex, {
                name, ...(name !== exercise.name ? { library_id: undefined, gif_url: undefined, images: undefined } : {}),
              })}
              onSelect={selected => updateExercise(exerciseIndex, {
                name: selected.name, library_id: selected.id, images: [...selected.images], gif_url: undefined,
              })} />
            <LoadBasisControl exercise={exercise} disabled={saving}
              hint={session.status === 'active' ? t('loadBasis.activeChoiceHint') : undefined} onChange={basis =>
              updateExercise(exerciseIndex, classifyRecordedLoad(exercise, basis))} />
            <LoadBasisGuidance exercise={exercise} />
            <TextField label={t('sessionEditor.exerciseNotes')} value={exercise.notes ?? ''} disabled={saving} fullWidth size="small" multiline
              onChange={event => updateExercise(exerciseIndex, { notes: event.target.value })} />
            {!exercise.sets.length && <Alert severity="info">{t('sessionEditor.noSets')}</Alert>}
            {exercise.sets.map((set, setIndex) => <Box key={setKeys[setIndex]} component="section"
              aria-label={t('sessionEditor.set', { number: setIndex + 1 })} sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" fontWeight={700}>{t('sessionEditor.set', { number: setIndex + 1 })}</Typography>
                  <Button color="error" disabled={saving} startIcon={<DeleteOutlineIcon />}
                    aria-label={t('sessionEditor.removeSet', { number: setIndex + 1 })}
                    onClick={() => removeSet(exerciseIndex, setIndex)} sx={{ minHeight: 44, flexShrink: 0 }}>
                    {t('common.delete')}
                  </Button>
                </Stack>
                <TextField label={t('sessionEditor.reps')} type="number" value={Number.isFinite(set.reps) ? set.reps : ''}
                  disabled={saving} fullWidth size="small" onChange={event => updateSet(exerciseIndex, setIndex, {
                    reps: event.target.value === '' ? Number.NaN : Number(event.target.value),
                  })} slotProps={{ htmlInput: { min: 0, step: 1, inputMode: 'numeric' } }} />
                <WeightField label={t('sessionEditor.weight')} valueKg={Number.isFinite(set.weight_kg) ? set.weight_kg : undefined}
                  unit={getExerciseWeightUnit(profile, exercise)} disabled={saving}
                  onUnitChange={weight_unit => updateExercise(exerciseIndex, { weight_unit, weight_unit_override: true })}
                  onChange={kilograms => updateSet(exerciseIndex, setIndex, { weight_kg: kilograms ?? Number.NaN })} />
                <FormControlLabel sx={{ minHeight: 44, m: 0 }} label={t('sessionEditor.done')}
                  control={<Checkbox checked={Boolean(set.done)} disabled={saving}
                    onChange={event => updateSet(exerciseIndex, setIndex, { done: event.target.checked })} />} />
              </Stack>
            </Box>)}
            <Button disabled={saving} startIcon={<AddIcon />} variant="outlined"
              onClick={() => addSet(exerciseIndex)} sx={{ minHeight: 44 }}>{t('sessionEditor.addSet')}</Button>
          </Stack>
        </Paper>)}
        <Button disabled={saving} variant="outlined" startIcon={<AddIcon />} sx={{ minHeight: 44 }}
          onClick={() => setExercises(previous => [...previous, {
            key: crypto.randomUUID(), setKeys: [crypto.randomUUID()],
            value: { name: '', routine_exercise_id: crypto.randomUUID(), routine_defaults_excluded: true, routine_addition: true,
              target_sets: 1, target_reps: 10, weight_unit: defaultUnit,
              sets: [{ reps: 10, weight_kg: 0, done: false }] },
          }])}>{t('sessionEditor.addExercise')}</Button>
        {session.status === 'active' && <Typography variant="caption" color="text.secondary">
          {t('sessionAdd.editorHint')}
        </Typography>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ p: 2, gap: 1, flexWrap: 'wrap' }}>
      <Button disabled={saving} onClick={onClose} sx={{ minHeight: 44 }}>{t('sessionEditor.cancel')}</Button>
      <Button disabled={saving} onClick={save} variant="contained" sx={{ minHeight: 44 }}>
        {t(saving ? 'sessionEditor.saving' : 'sessionEditor.save')}
      </Button>
    </DialogActions>
  </Dialog>;
}
