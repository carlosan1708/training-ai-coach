import LoadBasisGuidance from '../components/workouts/LoadBasisGuidance';
import LoadBasisControl from '../components/workouts/LoadBasisControl';
import { classifyRecordedLoad } from '../lib/loadBasis';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import HistoryIcon from '@mui/icons-material/History';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseIcon from '@mui/icons-material/Close';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import TimerIcon from '@mui/icons-material/Timer';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import {
  getWorkoutSession, updateWorkoutSession, completeWorkoutSession, deleteWorkoutSession, addExerciseToWorkoutSession,
  substituteWorkoutSessionExercise,
} from '../firebase/firestore';
import ExerciseGif from '../components/ExerciseGif';
import RepsField from '../components/RepsField';
import WorkoutTiming from '../components/workouts/WorkoutTiming';
import WorkoutSessionActions from '../components/workouts/WorkoutSessionActions';
import WorkoutOptions from '../components/workouts/WorkoutOptions';
import RestTimer from '../components/workouts/RestTimer';
import ExerciseSubstitutionDialog from '../components/workouts/ExerciseSubstitutionDialog';
import WorkoutExerciseAdditionDialog from '../components/workouts/WorkoutExerciseAdditionDialog';
import { doneSets } from '../lib/workout';
import { toKilograms, formatWeight, formatWeightValue, getWorkoutWeightUnit, getExerciseWeightUnit, type WeightUnit } from '../lib/units';
import type { LoadBasis, RoutineExercise, SessionChange, SessionExercise, SessionSet, WorkoutSession } from '../types/routine';

const changeIcon: Record<SessionChange, React.ReactElement> = {
  increase: <TrendingUpIcon fontSize="small" color="success" />,
  decrease: <TrendingDownIcon fontSize="small" color="warning" />,
  hold: <TrendingFlatIcon fontSize="small" color="disabled" />,
};

export default function WorkoutSessionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { routineId, sessionId } = useParams<{ routineId: string; sessionId: string }>();
  const { currentUser } = useAuthStore();
  const profile = useProfileStore(state => state.profile);
  const defaultUnit = getWorkoutWeightUnit(profile);

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [leaving, setLeaving] = useState(false);
  const [removedSet, setRemovedSet] = useState<{ noticeId: number; exerciseIndex: number; setIndex: number; set: SessionSet } | null>(null);
  const removedNoticeId = useRef(0);
  const [restEnabled, setRestEnabled] = useState(() => localStorage.getItem('tac_rest_timer_enabled') === 'true');
  const [rest, setRest] = useState({ trigger: 0, seconds: 90 });
  const [substitutionIndex, setSubstitutionIndex] = useState<number | null>(null);
  const [additionRequest, setAdditionRequest] = useState<{ key: string; promotion?: SessionExercise } | null>(null);
  const [addingExercise, setAddingExercise] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  const pendingData = useRef<{ session: WorkoutSession; revision: number } | null>(null);
  const sessionRef = useRef<WorkoutSession | null>(null);
  const exerciseKeys = useRef<string[]>([]);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const mounted = useRef(true);
  const ending = useRef(false);
  const structureBusy = useRef(false);

  useEffect(() => {
    if (!currentUser || !sessionId) return;
    getWorkoutSession(currentUser.uid, sessionId)
      .then(next => {
        exerciseKeys.current = next?.exercises.map(() => crypto.randomUUID()) ?? [];
        sessionRef.current = next; setSession(next);
        setRest({ trigger: 0, seconds: next?.exercises.find(exercise => exercise.sets.some(set => !set.done))?.rest_sec || 90 });
      })
      .catch(() => setSaveError(true))
      .finally(() => setLoading(false));
  }, [currentUser, sessionId]);

  // Serial writes keep an older request from overwriting a newer edit.
  const flushSave = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (!currentUser || !sessionId || ending.current) return;
    const pending = pendingData.current;
    if (!pending) return pendingSave.current;
    pendingData.current = null;
    const write = pendingSave.current.catch(() => {}).then(async () => {
      await updateWorkoutSession(currentUser.uid, sessionId, { exercises: pending.session.exercises });
      savedRevision.current = Math.max(savedRevision.current, pending.revision);
      if (mounted.current && pending.revision === revision.current) {
        setSaveState('saved');
        setSaveError(false);
      }
    });
    pendingSave.current = write;
    try {
      await write;
    } catch (error) {
      if (!pendingData.current && pending.revision === revision.current) pendingData.current = pending;
      if (mounted.current) { setSaveState('error'); setSaveError(true); }
      throw error;
    }
  }, [currentUser, sessionId]);

  useEffect(() => {
    mounted.current = true;
    const warnIfUnsaved = (event: BeforeUnloadEvent) => {
      if (!ending.current && revision.current !== savedRevision.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warnIfUnsaved);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeunload', warnIfUnsaved);
      // Flush on in-app navigation instead of throwing away the debounce timer.
      void flushSave().catch(() => {});
    };
  }, [flushSave]);

  const persist = (next: WorkoutSession) => {
    if (ending.current) return;
    revision.current += 1;
    pendingData.current = { session: next, revision: revision.current };
    setSaveState('saving');
    setSaveError(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushSave().catch(() => {}); }, 800);
  };

  const mutate = (updater: (prev: WorkoutSession) => WorkoutSession) => {
    const previous = sessionRef.current;
    if (ending.current || structureBusy.current || leaving || previous?.status !== 'active') return;
    const next = updater(previous);
    sessionRef.current = next;
    setSession(next);
    persist(next);
  };

  const leaveWorkout = async () => {
    if (ending.current || structureBusy.current || leaving) return;
    setLeaving(true);
    try {
      await flushSave();
      navigate(`/routines/${routineId}`);
    } catch {
      setSaveError(true);
    } finally {
      setLeaving(false);
    }
  };

  const prepareEdit = async () => {
    if (structureBusy.current || ending.current) throw new Error('Workout change in progress');
    setLeaving(true);
    try {
      await flushSave();
      if (!sessionRef.current) throw new Error('Workout not loaded');
      return sessionRef.current;
    } finally { setLeaving(false); }
  };

  const editedSession = (updated: WorkoutSession) => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    pendingData.current = null;
    exerciseKeys.current = updated.exercises.map(() => crypto.randomUUID());
    sessionRef.current = updated;
    setSession(updated);
    savedRevision.current = revision.current;
    setSaveState('saved'); setSaveError(false); setRemovedSet(null);
  };

  const beginAddition = async (exerciseIndex?: number) => {
    if (ending.current || structureBusy.current || leaving || sessionRef.current?.status !== 'active') return;
    structureBusy.current = true;
    setLeaving(true);
    try {
      await flushSave();
      const promotion = exerciseIndex != null ? sessionRef.current?.exercises[exerciseIndex] : undefined;
      if (exerciseIndex != null && (!promotion?.routine_addition || !promotion.routine_defaults_excluded)) return;
      setAdditionRequest({ key: crypto.randomUUID(), ...(promotion ? { promotion } : {}) });
    } catch { setSaveError(true); }
    finally { structureBusy.current = false; setLeaving(false); }
  };

  const saveAddition = async (exercise: RoutineExercise, permanent: boolean) => {
    if (!currentUser || !sessionId || ending.current || structureBusy.current || sessionRef.current?.status !== 'active') {
      throw new Error('Workout is not available for changes');
    }
    structureBusy.current = true;
    setAddingExercise(true);
    try {
      // Finish the serial autosave queue before an atomic structural change.
      await flushSave();
      const updated = await addExerciseToWorkoutSession(currentUser.uid, sessionId, exercise, permanent);
      editedSession(updated);
    } finally { structureBusy.current = false; setAddingExercise(false); }
  };

  const updateSet = (exIdx: number, setIdx: number, field: 'reps' | 'weight_kg' | 'done', value: number | boolean) => {
    const exercise = sessionRef.current?.exercises[exIdx];
    if (field === 'done' && value === true && !exercise?.sets[setIdx]?.done && !ending.current && !leaving) {
      setRest(previous => ({ trigger: previous.trigger + 1, seconds: exercise?.rest_sec || 90 }));
    }
    mutate((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) =>
        i !== exIdx ? ex : {
          ...ex, ...(field === 'weight_kg' ? { load_basis_review_required: false } : {}),
          sets: ex.sets.map((s, j) => (j !== setIdx ? s : { ...s, [field]: value })),
        }
      ),
    }));
  };

  const applySubstitution = async (alternative: RoutineExercise, reason: string, permanent: boolean) => {
    const index = substitutionIndex;
    if (!currentUser || !sessionId || index === null || leaving || ending.current || structureBusy.current
      || sessionRef.current?.status !== 'active') throw new Error('Workout is not available for changes');
    structureBusy.current = true;
    setAddingExercise(true);
    try {
      await flushSave();
      const original = sessionRef.current?.exercises[index];
      if (!original) throw new Error('Exercise is no longer available');
      const updated = await substituteWorkoutSessionExercise(currentUser.uid, sessionId, index, original, {
        ...alternative,
        notes: [t('workoutTools.alternativeFor', { exercise: original.name }), alternative.notes].filter(Boolean).join('\n'),
      }, reason, permanent);
      editedSession(updated);
      setSubstitutionIndex(null);
    } finally { structureBusy.current = false; setAddingExercise(false); }
  };

  const addSet = (exIdx: number) =>
    mutate((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== exIdx) return ex;
        const last = ex.sets[ex.sets.length - 1];
        return {
          ...ex,
          sets: [...ex.sets, {
            reps: last?.reps ?? ex.target_reps,
            weight_kg: last?.weight_kg ?? ex.target_weight_kg ?? 0,
            done: false,
          }],
        };
      }),
    }));

  const removeSet = (exerciseIndex: number, setIndex: number) => {
    const exercise = sessionRef.current?.exercises[exerciseIndex];
    const set = exercise?.sets[setIndex];
    if (!set || exercise.sets.length <= 1) return;
    setRemovedSet({ noticeId: ++removedNoticeId.current, exerciseIndex, setIndex, set });
    mutate(previous => ({ ...previous, exercises: previous.exercises.map((ex, index) =>
      index === exerciseIndex ? { ...ex, sets: ex.sets.filter((_, row) => row !== setIndex) } : ex) }));
  };

  const moveExercise = (from: number, direction: -1 | 1) => {
    const current = sessionRef.current;
    const to = from + direction;
    if (!current || current.status !== 'active' || ending.current || structureBusy.current || leaving
      || finishing || cancelling || to < 0 || to >= current.exercises.length) return;
    // Keep every exercise snapshot and its original routine ownership intact.
    const move = <T,>(items: T[]) => {
      const next = [...items];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    };
    exerciseKeys.current = move(exerciseKeys.current);
    if (removedSet) setRemovedSet({ ...removedSet, exerciseIndex: removedSet.exerciseIndex === from ? to
      : removedSet.exerciseIndex === to ? from : removedSet.exerciseIndex });
    setSubstitutionIndex(null);
    mutate(previous => ({ ...previous, exercises: move(previous.exercises) }));
  };

  const undoRemoveSet = () => {
    if (!removedSet) return;
    mutate(previous => ({ ...previous, exercises: previous.exercises.map((ex, index) => {
      if (index !== removedSet.exerciseIndex) return ex;
      const sets = [...ex.sets];
      sets.splice(removedSet.setIndex, 0, removedSet.set);
      return { ...ex, sets };
    }) }));
    setRemovedSet(null);
  };

  const changeUnit = (exerciseIndex: number, unit: WeightUnit) =>
    mutate(previous => ({ ...previous, exercises: previous.exercises.map((ex, index) =>
      index === exerciseIndex ? { ...ex, weight_unit: unit, weight_unit_override: true } : ex) }));

  const changeBasis = (exerciseIndex: number, basis: LoadBasis | undefined) =>
    mutate(previous => ({ ...previous, exercises: previous.exercises.map((ex, index) =>
      index === exerciseIndex ? classifyRecordedLoad(ex, basis) : ex) }));

  const totalSets = session?.exercises.reduce((count, exercise) => count + exercise.sets.length, 0) ?? 0;
  const completedSets = session?.exercises.reduce((count, exercise) => count + doneSets(exercise.sets).length, 0) ?? 0;

  const progress = useMemo(() => {
    if (!session) return 0;
    const total = session.exercises.reduce((n, e) => n + e.sets.length, 0);
    const done = session.exercises.reduce((n, e) => n + doneSets(e.sets).length, 0);
    return total ? Math.round((done / total) * 100) : 0;
  }, [session]);

  // ── Finish ──────────────────────────────────────────────────────────────────

  const finish = async () => {
    if (!currentUser || !session || !sessionId || !routineId || ending.current || structureBusy.current || session.status !== 'active') return;
    ending.current = true;
    const completedAtMs = Date.now();
    setFinishing(true);
    setSaveError(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingData.current = null;
    setRemovedSet(null);
    try {
      await pendingSave.current.catch(() => {});
      const exercises = session.exercises.map(exercise => ({ ...exercise,
        weight_unit: getExerciseWeightUnit(profile, exercise) }));
      await completeWorkoutSession(currentUser.uid, sessionId, exercises, defaultUnit, completedAtMs);
      const completed = { ...session, status: 'completed' as const };
      sessionRef.current = completed;
      setSession(completed);
      savedRevision.current = revision.current;
      navigate(`/workout-history?session=${encodeURIComponent(sessionId)}&saved=1`);
    } catch {
      if (sessionRef.current && revision.current !== savedRevision.current) {
        pendingData.current = { session: sessionRef.current, revision: revision.current };
        setSaveState('error');
      }
      setSaveError(true);
    } finally {
      ending.current = false;
      setFinishing(false);
    }
  };

  const cancelWorkout = async () => {
    if (!currentUser || !sessionId || !routineId || session?.status !== 'active' || ending.current || structureBusy.current) return;
    ending.current = true;
    setCancelling(true);
    setSaveError(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingData.current = null;
    try {
      // Let any running autosave finish before deletion so it cannot recreate the session.
      await pendingSave.current.catch(() => {});
      await deleteWorkoutSession(currentUser.uid, sessionId);
      navigate(`/routines/${routineId}`);
    } catch {
      if (sessionRef.current && revision.current !== savedRevision.current) {
        pendingData.current = { session: sessionRef.current, revision: revision.current };
        setSaveState('error');
      }
      setSaveError(true);
    } finally {
      ending.current = false;
      setCancelling(false);
    }
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>;
  }
  if (!session) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert severity="warning">{t('routines.notFound')}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 2, pb: 4, px: { xs: 2, sm: 3 } }}>
      <Stack spacing={1.5}>

        {/* ── Header ── */}
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton aria-label={t('common.back')} disabled={finishing || cancelling || leaving || addingExercise}
            sx={{ minWidth: 44, minHeight: 44 }} onClick={() => { void leaveWorkout(); }}><ArrowBackIcon /></IconButton>
          <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <Typography component="h1" variant="h5" fontWeight={750}>{session.routine_name}</Typography>
            {session.day_name && <Typography variant="body2">{session.day_name}</Typography>}
            {session.status !== 'active' && <Typography variant="caption" color="text.secondary">{session.date}</Typography>}
          </Box>
          <Chip label={`${progress}%`} color={progress === 100 ? 'success' : 'default'} />
        </Stack>
        <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: 2, height: 4 }} />
        <WorkoutTiming session={session} compact={session.status === 'active'} />
        {session.status === 'active' && <Box sx={{ position: 'sticky', top: 'max(8px, env(safe-area-inset-top))', zIndex: 10 }}>
          <RestTimer key={session.id} sessionId={session.id} durationSeconds={rest.seconds} trigger={rest.trigger} enabled={restEnabled}
            onEnabledChange={enabled => { setRestEnabled(enabled); localStorage.setItem('tac_rest_timer_enabled', String(enabled)); }} />
        </Box>}
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Typography variant="body2">{t('workoutSessionUx.setProgress', { done: completedSets, total: totalSets })}</Typography>
          {session.status === 'active' && <Stack direction="row" spacing={0.5} alignItems="center" role="status" aria-live="polite">
            {saveState === 'saving' ? <CircularProgress size={14} /> : saveState === 'saved' ? <CloudDoneIcon color="success" fontSize="small" /> : null}
            <Typography variant="caption" color={saveState === 'error' ? 'error' : 'text.secondary'}>
              {t(`workoutSessionUx.${saveState}`)}
            </Typography>
          </Stack>}
        </Stack>
        {session.status === 'completed' && <Alert severity="success">{t('workoutSessionUx.readOnly')}</Alert>}
        {session.status === 'active' && progress < 100 && <Button data-usage-action="finish_clicked" variant="text" onClick={finish}
          sx={{ alignSelf: 'flex-end', minHeight: 44, color: 'text.secondary' }}
          disabled={finishing || cancelling || leaving || addingExercise}
          startIcon={finishing ? <CircularProgress size={16} /> : undefined}>{t('routines.finishSession')}</Button>}
        <WorkoutOptions label={t('workoutSessionUx.workoutOptions')} testId="workout-options">
        {session.status === 'active' && <Button variant="text" startIcon={<AddIcon />} sx={{ minHeight: 44 }}
          disabled={finishing || cancelling || leaving || addingExercise} onClick={() => { void beginAddition(); }}>
          {t('routines.addExercise')}
        </Button>}
        <WorkoutSessionActions session={session} preferredUnit={defaultUnit} beforeEdit={prepareEdit}
          disabled={finishing || cancelling || leaving || addingExercise} allowDelete={session.status === 'completed'} onSaved={editedSession}
          onDeleted={() => { ending.current = true; navigate('/workout-history?deleted=1'); }} />
        {session.status === 'active' && <Button variant="text" color="error" sx={{ minHeight: 44 }}
          disabled={finishing || cancelling || leaving || addingExercise} onClick={() => setCancelOpen(true)}>
          {t('routines.cancelSession')}
        </Button>}
        </WorkoutOptions>
        {saveError && <Alert severity="error" action={saveState === 'error' && session.status === 'active' && !finishing && !cancelling
          ? <Button color="inherit" sx={{ minHeight: 44 }} onClick={() => { setSaveState('saving'); void flushSave().catch(() => {}); }}>
            {t('workoutSessionUx.retrySave')}</Button> : undefined}>{t('workoutSessionUx.saveError')}</Alert>}

        {/* ── AI insight ── */}
        {session.ai_insight && (
          <Alert severity="info" icon={<AutoFixHighIcon />}>
            <Typography variant="body2">{session.ai_insight}</Typography>
          </Alert>
        )}

        {/* ── Exercises ── */}
        {session.exercises.map((ex, exIdx) => (
          <ExerciseCard
            key={exerciseKeys.current[exIdx]}
            exercise={ex}
            unit={session.status === 'active' ? getExerciseWeightUnit(profile, ex)
              : profile?.workout_weight_unit ?? ex.weight_unit ?? defaultUnit}
            readOnly={session.status !== 'active'}
            disabled={finishing || cancelling || leaving || addingExercise || session.status !== 'active'}
            onNotesChange={notes => mutate(previous => ({ ...previous, exercises: previous.exercises.map((exercise, index) =>
              index === exIdx ? { ...exercise, notes } : exercise) }))}
            onSetChange={(setIdx, field, value) => updateSet(exIdx, setIdx, field, value)}
            onAddSet={() => addSet(exIdx)}
            onRemoveSet={setIdx => removeSet(exIdx, setIdx)}
            onUnitChange={unit => changeUnit(exIdx, unit)}
            onBasisChange={basis => changeBasis(exIdx, basis)}
            onSubstitute={() => setSubstitutionIndex(exIdx)}
            onSaveInRoutine={() => { void beginAddition(exIdx); }}
            canMoveUp={exIdx > 0}
            canMoveDown={exIdx < session.exercises.length - 1}
            onMove={direction => moveExercise(exIdx, direction)}
          />
        ))}

        {/* ── Finish ── */}
        {session.status === 'active' && progress === 100 && <Box sx={{ display: 'flex', justifyContent: 'center' }}><Button
          variant="contained"
          color="primary"
          size="large"
          startIcon={finishing ? <CircularProgress size={18} color="inherit" /> : <CheckCircleIcon />}
          data-usage-action="finish_clicked"
          onClick={finish}
          sx={{ minHeight: 44, boxShadow: 'none', borderRadius: 3 }}
          disabled={finishing || cancelling || leaving || addingExercise}
        >
          {t('routines.finishSession')}
        </Button></Box>}
      </Stack>
      {additionRequest && session.status === 'active' && <WorkoutExerciseAdditionDialog key={additionRequest.key}
        promotion={additionRequest.promotion} dayName={session.day_name} onClose={() => setAdditionRequest(null)} onSave={saveAddition} />}
      {substitutionIndex !== null && session.status === 'active' && session.exercises[substitutionIndex] && <ExerciseSubstitutionDialog
        key={`${session.id}-${substitutionIndex}`}
        exercise={session.exercises[substitutionIndex]} onClose={() => setSubstitutionIndex(null)} onApply={applySubstitution} />}
      <Snackbar key={removedSet?.noticeId} open={removedSet !== null && session.status === 'active'}
        autoHideDuration={8000} resumeHideDuration={8000} onClose={(_, reason) => {
        if (reason !== 'clickaway') setRemovedSet(null);
      }} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} sx={{ bottom: { xs: 152, md: 90 } }}>
        <Alert severity="info" sx={{ alignItems: 'center', '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' } }}
          action={<Stack direction="row" alignItems="center">
            <Button color="inherit" disabled={finishing || cancelling || leaving}
              sx={{ minWidth: 44, minHeight: 44 }} onClick={undoRemoveSet}>{t('workoutSessionUx.undo')}</Button>
            <IconButton color="inherit" aria-label={t('workoutSessionUx.dismissNotice')}
              sx={{ minWidth: 44, minHeight: 44 }} onClick={() => setRemovedSet(null)}><CloseIcon fontSize="small" /></IconButton>
          </Stack>}>
          {t('workoutSessionUx.setRemoved', { number: (removedSet?.setIndex ?? 0) + 1,
            exercise: session.exercises[removedSet?.exerciseIndex ?? 0]?.name })}
        </Alert>
      </Snackbar>
      <Dialog open={cancelOpen} onClose={() => !cancelling && setCancelOpen(false)} fullWidth maxWidth="xs"
        aria-labelledby="cancel-workout-title">
        <DialogTitle id="cancel-workout-title">{t('routines.cancelSessionTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('routines.cancelSessionHint')}</Typography>
          {saveError && <Alert severity="error" sx={{ mt: 2 }}>{t('common.error')}</Alert>}
        </DialogContent>
        <DialogActions disableSpacing sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1,
          alignItems: { xs: 'stretch', sm: 'center' } }}>
          <Button sx={{ minHeight: 44 }} disabled={cancelling} onClick={() => setCancelOpen(false)}>{t('routines.keepSession')}</Button>
          <Button variant="contained" color="error" sx={{ minHeight: 44 }} disabled={cancelling} onClick={cancelWorkout}
            startIcon={cancelling ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {t('routines.discardSession')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

// ─── Exercise card ────────────────────────────────────────────────────────────

interface CardProps {
  exercise: SessionExercise;
  unit: WeightUnit;
  readOnly: boolean;
  disabled: boolean;
  onSetChange: (setIdx: number, field: 'reps' | 'weight_kg' | 'done', value: number | boolean) => void;
  onNotesChange: (notes: string) => void;
  onAddSet: () => void;
  onRemoveSet: (setIdx: number) => void;
  onUnitChange: (unit: WeightUnit) => void;
  onBasisChange: (basis: LoadBasis | undefined) => void;
  onSubstitute: () => void;
  onSaveInRoutine: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
}

function ExerciseCard({ exercise: ex, unit, readOnly, disabled, onSetChange, onNotesChange, onAddSet, onRemoveSet, onUnitChange, onBasisChange, onSubstitute, onSaveInRoutine, canMoveUp, canMoveDown, onMove }: CardProps) {
  const { t } = useTranslation();
  const allDone = ex.sets.length > 0 && ex.sets.every((s) => s.done);
  const equivalentUnit: WeightUnit = unit === 'kg' ? 'lb' : 'kg';

  return (
    <Card component="section" aria-label={ex.name} variant="outlined" sx={{ borderColor: allDone ? '#77c6a7' : 'divider', borderTop: '3px solid', borderTopColor: allDone ? 'success.main' : '#d8c4fa' }}>
      <CardContent sx={{ p: { xs: 1.75, sm: 2.5 }, '&:last-child': { pb: { xs: 1.75, sm: 2.5 } } }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ flexShrink: 0 }}><ExerciseGif gifUrl={ex.gif_url} images={ex.images} size={48} /></Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography component="h2" fontWeight={750} sx={{ overflowWrap: 'anywhere', mb: 0.75 }}>{ex.name}</Typography>
              <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }}
                  label={`${t('routines.target')}: ${ex.target_sets}×${ex.target_reps}${
                    ex.target_weight_kg ? ` · ${formatWeight(ex.target_weight_kg, unit)}` : ''}`}
                />
                {!!ex.rest_sec && ex.rest_sec > 0 && <Chip size="small" variant="outlined" icon={<TimerIcon />}
                  label={t('workoutSessionUx.rest', { seconds: ex.rest_sec })} />}
                {ex.change && changeIcon[ex.change]}
              </Stack>
              {!!ex.target_weight_kg && <Typography variant="caption" color="text.secondary">
                {t('workoutSessionUx.targetEquivalent', { weight: formatWeight(ex.target_weight_kg, equivalentUnit) })}
              </Typography>}
              {ex.ai_note && (
                <Typography variant="caption" color="primary.main" display="block">
                  <AutoFixHighIcon sx={{ fontSize: 12, mr: 0.5, verticalAlign: 'middle' }} />
                  {ex.ai_note}
                </Typography>
              )}
              {ex.last_summary && (
                <Typography variant="caption" color="text.secondary" display="block">
                  <HistoryIcon sx={{ fontSize: 12, mr: 0.5, verticalAlign: 'middle' }} />
                  {t('routines.lastTime')}: {ex.last_summary}
                </Typography>
              )}
            </Box>
          </Stack>

          <LoadBasisGuidance exercise={ex} compact={!ex.load_basis_review_required && !!ex.load_basis} />
          {!readOnly && ex.routine_addition && <Chip size="small" variant="outlined" sx={{ alignSelf: 'flex-start' }}
            label={t(ex.routine_defaults_excluded ? 'sessionAdd.onlyThisWorkout' : 'sessionAdd.inRoutine')} />}

          {/* Set rows */}
          {ex.sets.map((set, setIdx) => (
            <Box key={setIdx} data-testid="workout-set"
              sx={{ border: 1, borderColor: set.done ? '#b9dfcd' : 'divider', borderRadius: 2, px: 0.75, py: 1.25, display: 'grid', alignItems: 'start',
                gridTemplateColumns: readOnly ? '24px minmax(0, 1fr) 44px' : '20px minmax(0, 1fr) minmax(0, 1fr) 44px', gap: 0.75,
                bgcolor: set.done ? '#edf8f2' : '#faf9fd', transition: 'background-color 140ms' }}>
              <Typography variant="caption" aria-label={t('workoutSessionUx.setNumber', { number: setIdx + 1 })}
                sx={{ pt: 1.5, textAlign: 'center' }}>{setIdx + 1}</Typography>
                <Checkbox
                  disabled={disabled}
                  checked={set.done}
                  onChange={(e) => onSetChange(setIdx, 'done', e.target.checked)}
                  slotProps={{ input: { 'aria-label': t('workoutSessionUx.completeSet', { number: setIdx + 1, exercise: ex.name }), ...{ 'data-usage-action': 'set_completion_toggled' } } }}
                  sx={{ minWidth: 44, minHeight: 44, gridColumn: readOnly ? 3 : 4, gridRow: 1 }}
                  icon={<CheckCircleIcon color="disabled" />}
                  checkedIcon={<CheckCircleIcon color="success" />}
                />
              {readOnly ? <Stack direction="row" spacing={2} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ gridColumn: 2, gridRow: 1 }}>
                <Typography fontWeight={600}>{formatWeight(set.weight_kg, unit)} × {set.reps}</Typography>
                <Typography variant="caption" color="text.secondary">≈ {formatWeight(set.weight_kg, equivalentUnit)}</Typography>
              </Stack> : <Box sx={{ display: 'contents' }}>
                <SessionWeightInput
                  valueKg={set.weight_kg}
                  unit={unit}
                  disabled={disabled}
                  onChange={kilograms => onSetChange(setIdx, 'weight_kg', kilograms)}
                />
                <RepsField
                  value={set.reps}
                  onChange={reps => onSetChange(setIdx, 'reps', reps)}
                  disabled={disabled}
                  centered
                  label={t('exerciseLog.reps')}
                  usageAction="reps_edited"
                />
              </Box>}
              {!readOnly && <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '2 / -1', lineHeight: 1.2 }}>
                ≈ {formatWeight(set.weight_kg, equivalentUnit)}
              </Typography>}
            </Box>
          ))}

          {!readOnly && <Button size="small" disabled={disabled} startIcon={<AddIcon />} onClick={onAddSet}
            sx={{ alignSelf: 'flex-start', minHeight: 44 }}>
            {t('routines.addSet')}
          </Button>}
          {!readOnly && <Box component="details" data-testid="exercise-notes" sx={{ borderTop: 1, borderColor: 'divider' }}>
            <Box component="summary" sx={{ minHeight: 44, py: 1.25, cursor: 'pointer', fontSize: '0.875rem' }}>
              {t('workoutSessionUx.exerciseNotes')}
            </Box>
            <TextField label={t('sessionEditor.exerciseNotes')} value={ex.notes ?? ''}
            onChange={event => onNotesChange(event.target.value)} disabled={disabled} fullWidth multiline minRows={2}
            size="small" helperText={t(ex.routine_defaults_excluded ? 'workoutTools.notesSessionHint' : 'workoutTools.notesHint')}
            slotProps={{ htmlInput: { maxLength: 5000 } }} />
          </Box>}
          {readOnly && ex.notes && <Box component="details" sx={{ borderTop: 1, borderColor: 'divider' }}>
            <Box component="summary" sx={{ minHeight: 44, py: 1.25, cursor: 'pointer', fontSize: '0.875rem' }}>
              {t('workoutSessionUx.exerciseNotes')}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ pb: 1, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
              {ex.notes}
            </Typography>
          </Box>}

          {!readOnly && <WorkoutOptions label={t('workoutSessionUx.exerciseOptions')} testId="exercise-options">
          <Typography variant="caption" color="text.secondary">{t('workoutTools.orderHint')}</Typography>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Button startIcon={<ArrowUpwardIcon />} disabled={disabled || !canMoveUp} sx={{ minHeight: 44 }}
              onClick={() => onMove(-1)}>{t('workoutTools.moveUp')}</Button>
            <Button startIcon={<ArrowDownwardIcon />} disabled={disabled || !canMoveDown} sx={{ minHeight: 44 }}
              onClick={() => onMove(1)}>{t('workoutTools.moveDown')}</Button>
          </Stack>
          {!readOnly && ex.routine_addition && <Stack spacing={1}>
            {ex.routine_defaults_excluded && <Button variant="outlined" disabled={disabled} sx={{ minHeight: 44 }}
              onClick={onSaveInRoutine}>{t('sessionAdd.saveInRoutine')}</Button>}
          </Stack>}

          {!readOnly && <Button variant="text" startIcon={<AutoFixHighIcon />} sx={{ alignSelf: 'flex-start', minHeight: 44 }}
            disabled={disabled || allDone} onClick={onSubstitute}>{t('workoutTools.substitute')}</Button>}

          {!readOnly && <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography variant="body2" color="text.secondary">{t('workoutSessionUx.machineUnit')}</Typography>
            <ToggleButtonGroup value={unit} exclusive disabled={disabled} size="small"
              aria-label={t('workoutSessionUx.unitFor', { exercise: ex.name })}
              onChange={(_, next: WeightUnit | null) => { if (next) onUnitChange(next); }}>
              <ToggleButton value="kg" sx={{ minHeight: 44, minWidth: 48 }}>kg</ToggleButton>
              <ToggleButton value="lb" sx={{ minHeight: 44, minWidth: 48 }}>lb</ToggleButton>
            </ToggleButtonGroup>
          </Stack>}

          {!readOnly && <LoadBasisControl exercise={ex} disabled={disabled} onChange={onBasisChange}
            hint={t('loadBasis.activeChoiceHint')} />}

            <Stack direction="row" gap={1} flexWrap="wrap">
              {ex.sets.map((_, setIdx) => <Button key={setIdx} color="error" disabled={disabled || ex.sets.length <= 1}
                startIcon={<DeleteOutlineIcon fontSize="small" />} sx={{ minHeight: 44 }} onClick={() => onRemoveSet(setIdx)}>
                {t('workoutSessionUx.removeSet', { number: setIdx + 1 })}
              </Button>)}
            </Stack>
          </WorkoutOptions>}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Keep the entered decimal text while storing its exact kilogram conversion. */
function SessionWeightInput({ valueKg, unit, disabled, onChange }: {
  valueKg: number;
  unit: WeightUnit;
  disabled: boolean;
  onChange: (kilograms: number) => void;
}) {
  const [draft, setDraft] = useState<{ valueKg: number; unit: WeightUnit; text: string } | null>(null);
  const value = draft?.valueKg === valueKg && draft.unit === unit
    ? draft.text : Number.isFinite(valueKg) ? formatWeightValue(valueKg, unit) : '';
  return <TextField
    type="number" size="small" disabled={disabled}
    value={value}
    onChange={event => {
      const text = event.target.value;
      const kilograms = text === '' ? 0 : toKilograms(Number(text), unit);
      if (!Number.isFinite(kilograms) || kilograms < 0) return;
      setDraft({ valueKg: kilograms, unit, text });
      onChange(kilograms);
    }}
    inputProps={{ 'data-usage-action': 'weight_edited', min: 0, step: 'any', inputMode: 'decimal', style: { textAlign: 'center', minHeight: 24, fontSize: 16 } }}
    sx={{ minWidth: 0, scrollMarginBlock: '100px', '& input': { px: 0.5 }, '& input::-webkit-inner-spin-button': { display: 'none' }, '& .MuiInputBase-root': { minHeight: 44 } }}
    label={unit}
  />;
}
