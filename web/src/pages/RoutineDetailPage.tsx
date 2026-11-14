import LoadBasisGuidance, { RecordedLoadReference } from '../components/workouts/LoadBasisGuidance';
import { loadConvention } from '../lib/loadBasis';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Checkbox,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import TimerIcon from '@mui/icons-material/Timer';
import HistoryIcon from '@mui/icons-material/History';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import {
  getRoutine, updateRoutine, getRoutineSessionsPage, getActiveWorkoutSessions, addWorkoutSession,
} from '../firebase/firestore';
import type { RoutineSessionsCursor } from '../firebase/firestore';
import { planWorkoutSessionFn as planSessionFn } from '../firebase/callables';
import ExerciseGif from '../components/ExerciseGif';
import ExercisePickerDialog from '../components/routines/ExercisePickerDialog';
import ExerciseConfigDialog from '../components/routines/ExerciseConfigDialog';
import ExerciseProgress from '../components/routines/ExerciseProgress';
import RoutineScheduleControls, { PreferredRoutineButton } from '../components/routines/RoutineScheduleControls';
import { summarizeSets } from '../lib/workout';
import { formatWeight, getExerciseWeightUnit, getWorkoutWeightUnit } from '../lib/units';
import { localDateKey } from '../lib/dates';
import { findRecordedExerciseReference, resolveExerciseDefaults, sessionMatchesDay } from '../lib/exerciseDefaults';
import { compareWorkoutSessionsNewestFirst } from '../lib/sessionOrder';
import { getScheduledWeekdays } from '../lib/trainingSchedule';
import { routineProgressChoices } from '../lib/routineProgress';
import { buildWorkoutExercises, prepareSavedWorkout } from '../lib/startWorkout';
import type {
  Routine, RoutineExercise, SessionPlan, WorkoutSession,
} from '../types/routine';

const today = localDateKey;

export default function RoutineDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const progressView = searchParams.get('view') === 'progress';
  const { routineId } = useParams<{ routineId: string }>();
  const { currentUser } = useAuthStore();
  const profile = useProfileStore(state => state.profile);
  const defaultWeightUnit = getWorkoutWeightUnit(profile);

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<RoutineSessionsCursor | null>(null);
  const [hasEarlierSessions, setHasEarlierSessions] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState(false);
  const loadGeneration = useRef(0);
  const selectedDayId = searchParams.get('day') ?? '';
  const selectedDay = routine?.days?.find(day => day.id === selectedDayId) ?? routine?.days?.[0];
  const exercises = selectedDay?.exercises ?? routine?.exercises ?? [];

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDayId, setPickerDayId] = useState<string | undefined>(undefined);
  const [editTarget, setEditTarget] = useState<{ dayId?: string; index: number; exerciseId?: string } | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaName, setMetaName] = useState('');
  const [metaDesc, setMetaDesc] = useState('');
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [addingDay, setAddingDay] = useState(false);
  const [dayName, setDayName] = useState('');
  const [savingDay, setSavingDay] = useState(false);
  const [dayError, setDayError] = useState(false);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [adjustWithAi, setAdjustWithAi] = useState(false);

  const [requestedChartExercise, setChartExercise] = useState('');
  // Browser history changes before React commits the next route render.
  const getCurrentDay = () => {
    const dayId = new URLSearchParams(window.location.search).get('day');
    return routine?.days?.find(day => day.id === dayId) ?? routine?.days?.[0];
  };
  const setSelectedDayId = (id: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set('day', id);
    setSearchParams(params);
  };
  const editExercises = editTarget?.dayId
    ? routine?.days?.find(day => day.id === editTarget.dayId)?.exercises ?? [] : routine?.exercises ?? [];
  const editIndex = editTarget?.exerciseId
    ? editExercises.findIndex(exercise => exercise.id === editTarget.exerciseId) : editTarget?.index;
  const editedExercise = editIndex != null ? editExercises[editIndex] : undefined;
  const editDefaults = routine && editTarget && editedExercise && editIndex != null
    ? resolveExerciseDefaults(routine, editIndex, sessions, editTarget.dayId) : null;
  const editRecorded = routine && editTarget && editedExercise && editIndex != null
    ? findRecordedExerciseReference(routine, editIndex, sessions, editTarget.dayId) : undefined;

  const refresh = useCallback(async () => {
    if (!currentUser || !routineId) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError(false);
    setLoadingEarlier(false);
    setEarlierError(false);
    try {
      const [r, page, active] = await Promise.all([
        getRoutine(currentUser.uid, routineId),
        getRoutineSessionsPage(currentUser.uid, routineId),
        getActiveWorkoutSessions(currentUser.uid),
      ]);
      if (generation !== loadGeneration.current) return;
      setRoutine(r);
      setSessions([...new Map([...page.sessions, ...active.filter(session => session.routine_id === routineId)]
        .map(session => [session.id, session])).values()].sort(compareWorkoutSessionsNewestFirst));
      setHistoryCursor(page.cursor);
      setHasEarlierSessions(page.hasMore);
    } catch {
      if (generation === loadGeneration.current) setLoadError(true);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [currentUser, routineId]);

  useEffect(() => {
    refresh();
    return () => { loadGeneration.current += 1; };
  }, [refresh]);

  const loadEarlierSessions = async () => {
    if (!currentUser || !routineId || !historyCursor || loadingEarlier) return;
    const generation = loadGeneration.current;
    setLoadingEarlier(true);
    setEarlierError(false);
    try {
      const page = await getRoutineSessionsPage(currentUser.uid, routineId, historyCursor);
      if (generation !== loadGeneration.current) return;
      setSessions(current => [...new Map([...current, ...page.sessions].map(session => [session.id, session]))
        .values()].sort(compareWorkoutSessionsNewestFirst));
      setHistoryCursor(page.cursor);
      setHasEarlierSessions(page.hasMore);
    } catch {
      if (generation === loadGeneration.current) setEarlierError(true);
    } finally {
      if (generation === loadGeneration.current) setLoadingEarlier(false);
    }
  };

  const completed = useMemo(
    () => routine ? sessions.filter((s) => s.status === 'completed' && sessionMatchesDay(routine, s, selectedDay?.id)) : [],
    [sessions, routine, selectedDay]
  );
  const progressChoices = routineProgressChoices(exercises, completed);
  const chartExercise = progressChoices.find(choice => choice.key === requestedChartExercise)
    ?? progressChoices[0];
  const activeSession = useMemo(
    () => routine ? sessions.find((s) => s.status === 'active' && sessionMatchesDay(routine, s, selectedDay?.id)) : undefined,
    [sessions, routine, selectedDay]
  );
  const latestCompletedDay = useMemo(() => {
    if (!routine?.days?.length) return undefined;
    const latest = [...sessions].filter(session => session.status === 'completed')
      .sort(compareWorkoutSessionsNewestFirst)
      .find(session => routine.days?.some(day => sessionMatchesDay(routine, session, day.id)));
    return latest && routine.days.find(day => sessionMatchesDay(routine, latest, day.id));
  }, [routine, sessions]);
  const openProgress = (latest = false) => {
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'progress');
    const currentDay = getCurrentDay();
    const hasCompleted = routine && sessions.some(session => session.status === 'completed'
      && sessionMatchesDay(routine, session, currentDay?.id));
    const day = latest || !hasCompleted ? latestCompletedDay ?? currentDay : currentDay;
    if (day) params.set('day', day.id);
    setChartExercise('');
    setSearchParams(params);
  };
  const openExercises = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete('view');
    setSearchParams(params);
  };

  // ── Exercise editing ────────────────────────────────────────────────────────

  const saveExercises = async (nextExercises: RoutineExercise[], dayId?: string) => {
    if (!currentUser || !routine) return;
    if (routine.days?.length) {
      if (!routine.days.some(day => day.id === dayId)) return;
      const days = routine.days.map(day => day.id === dayId ? { ...day, exercises: nextExercises } : day);
      await updateRoutine(currentUser.uid, routine.id, { days });
      setRoutine({ ...routine, days, exercises: days.flatMap(day => day.exercises) });
    } else {
      await updateRoutine(currentUser.uid, routine.id, { exercises: nextExercises });
      setRoutine({ ...routine, exercises: nextExercises });
    }
  };

  const addExercise = (ex: RoutineExercise) => {
    if (!routine) return;
    const targetExercises = pickerDayId
      ? routine.days?.find(day => day.id === pickerDayId)?.exercises : routine.exercises;
    if (targetExercises) saveExercises([...targetExercises, ex], pickerDayId);
  };

  const updateExercise = (ex: RoutineExercise) => {
    if (editTarget && editedExercise && editIndex != null) {
      saveExercises(editExercises.map((exercise, index) => index === editIndex ? ex : exercise), editTarget.dayId);
    }
  };

  const getCurrentExercise = (exercise: RoutineExercise, index: number) => {
    const day = getCurrentDay();
    const currentExercises = day?.exercises ?? routine?.exercises ?? [];
    // An old rendered row must never act on a different exercise at the same index.
    const currentIndex = exercise.id ? currentExercises.findIndex(candidate => candidate.id === exercise.id)
      : day?.id === selectedDay?.id && currentExercises[index] === exercise ? index : -1;
    return currentIndex >= 0 ? { day, exercises: currentExercises, index: currentIndex } : null;
  };

  const openExerciseEditor = (exercise: RoutineExercise, index: number) => {
    const target = getCurrentExercise(exercise, index);
    if (target) setEditTarget({ dayId: target.day?.id, index: target.index, exerciseId: exercise.id });
  };

  const removeExercise = (exercise: RoutineExercise, index: number) => {
    const target = getCurrentExercise(exercise, index);
    if (target) saveExercises(target.exercises.filter((_, i) => i !== target.index), target.day?.id);
  };

  const moveExercise = (exercise: RoutineExercise, index: number, delta: number) => {
    const current = getCurrentExercise(exercise, index);
    if (!current) return;
    const target = current.index + delta;
    if (target < 0 || target >= current.exercises.length) return;
    const next = [...current.exercises];
    [next[current.index], next[target]] = [next[target], next[current.index]];
    saveExercises(next, current.day?.id);
  };

  const saveMeta = async () => {
    if (!currentUser || !routine || !metaName.trim()) return;
    const updated = { ...routine, name: metaName.trim(), description: metaDesc };
    setRoutine(updated);
    setMetaOpen(false);
    await updateRoutine(currentUser.uid, routine.id, {
      name: updated.name,
      description: updated.description,
    });
  };

  const saveDay = async () => {
    if (!currentUser || !routine || (!addingDay && !editingDayId) || !dayName.trim() || savingDay) return;
    setSavingDay(true);
    setDayError(false);
    const existingDays = routine.days?.length ? routine.days : [{
      id: crypto.randomUUID(), name: t('routines.defaultDayName', { number: 1 }), exercises: routine.exercises,
      scheduled_weekdays: getScheduledWeekdays(routine),
      includes_legacy_sessions: true,
    }];
    const newDay = addingDay ? { id: crypto.randomUUID(), name: dayName.trim(), exercises: [] } : null;
    const days = newDay ? [...existingDays, newDay]
      : existingDays.map(day => day.id === editingDayId ? {
        ...day, name: dayName.trim(),
        previous_names: [...new Set([...(day.previous_names ?? []), day.name])],
      } : day);
    try {
      await updateRoutine(currentUser.uid, routine.id, { days });
      setRoutine({ ...routine, days, exercises: days.flatMap(day => day.exercises) });
      if (newDay) {
        setSelectedDayId(newDay.id);
        setChartExercise('');
        setStartError('');
        setAdjustWithAi(false);
      }
      setEditingDayId(null);
      setAddingDay(false);
    } catch {
      setDayError(true);
    } finally {
      setSavingDay(false);
    }
  };

  // ── Start session (AI-adjusted) ─────────────────────────────────────────────

  const startSession = async () => {
    if (!currentUser || !routine || starting) return;

    // A tab updates browser history before React finishes its route transition.
    // Start must honor that latest selection even if its button still has the old render.
    const requestedDay = getCurrentDay();
    setStarting(true);
    setStartError('');
    try {
      const { routine: savedRoutine, day: selectedDay, sessions: savedSessions, active } =
        await prepareSavedWorkout(currentUser.uid, routine, requestedDay);
      if (active) {
        navigate(`/routines/${savedRoutine.id}/session/${active.id}`);
        return;
      }
      const exercises = selectedDay?.exercises ?? savedRoutine.exercises;
      // AI adjustment remains an explicit opt-in after loading saved weights.
      let plan: SessionPlan | null = null;
      if (adjustWithAi) {
        try {
          const result = await planSessionFn({
            routine: { name: savedRoutine.name, exercises: exercises.map((exercise, index) => {
              const defaults = resolveExerciseDefaults(savedRoutine, index, savedSessions, selectedDay?.id);
              return { ...exercise, reps: defaults.sets[0]?.reps ?? exercise.reps,
                weight_kg: defaults.sets[0]?.weight_kg ?? exercise.weight_kg,
                weight_unit: getExerciseWeightUnit(profile, defaults) };
            }) },
            recentSessions: [...new Map([...sessions, ...savedSessions].map(session => [session.id, session]))
              .values()].filter(session => session.status === 'completed'
              && sessionMatchesDay(savedRoutine, session, selectedDay?.id))
              .sort(compareWorkoutSessionsNewestFirst).slice(0, 6).map(session => ({
                date: session.date,
                exercises: session.exercises.map(exercise => ({ name: exercise.name, ...loadConvention(exercise), sets: exercise.sets })),
              })),
          });
          plan = result.data.plan;
        } catch {
          setStartError(t('routines.aiUnavailable'));
        }
      }
      const sessionId = await addWorkoutSession(currentUser.uid, {
        routine_id: savedRoutine.id,
        routine_name: savedRoutine.name,
        ...(selectedDay ? { day_id: selectedDay.id, day_name: selectedDay.name } : {}),
        date: today(),
        status: 'active',
        ...(plan?.insight ? { ai_insight: plan.insight } : {}),
        exercises: buildWorkoutExercises(savedRoutine, savedSessions, selectedDay, profile, plan),
      });
      navigate(`/routines/${savedRoutine.id}/session/${sessionId}`);
    } catch {
      setStartError(t('common.error'));
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>;
  }
  if (loadError) {
    return <Container maxWidth="md" sx={{ py: 4 }}>
      <Alert severity="error" action={<Button color="inherit" onClick={refresh}>{t('routines.retry')}</Button>}>
        {t('routines.loadError')}
      </Alert>
    </Container>;
  }
  if (!routine) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="warning">{t('routines.notFound')}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, sm: 3 }, pb: 6 }}>
      <Stack spacing={3}>

        {/* ── Header ── */}
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton aria-label={t('common.back')} onClick={() => navigate('/routines')}><ArrowBackIcon /></IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" color="primary">{t('redesign.train.yourRoutine')}</Typography>
            <Typography component="h1" variant="h4" sx={{ fontSize: { xs: '1.7rem', sm: '2.1rem' }, overflowWrap: 'anywhere' }}>{routine.name}</Typography>
          </Box>
          <IconButton
            size="small"
            aria-label={t('routines.editRoutine')}
            onClick={() => { setMetaName(routine.name); setMetaDesc(routine.description ?? ''); setMetaOpen(true); }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <PreferredRoutineButton routine={routine} />
          <Button variant={progressView ? 'outlined' : 'contained'} startIcon={progressView ? <FitnessCenterIcon /> : <ShowChartIcon />}
            sx={{ minHeight: 44 }} onClick={() => progressView ? openExercises() : openProgress()}>
            {t(progressView ? 'routines.viewExercises' : 'routines.viewProgress')}
          </Button>
          <Button variant="outlined" startIcon={<HistoryIcon />} sx={{ minHeight: 44 }}
          onClick={() => navigate(`/workout-history?routine=${encodeURIComponent(routine.id)}`)}>
          {t('workoutHistory.title')}
          </Button>
        </Stack>

        {!progressView && routine.description && <Box component="details">
          <Box component="summary" sx={{ cursor: 'pointer', minHeight: 44, py: 1.25 }}>{t('routines.description')}</Box>
          <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>{routine.description}</Typography>
        </Box>}

        <Stack direction="row" alignItems="center" spacing={1}>
          {!!routine.days?.length && (
          <Tabs value={selectedDay?.id} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
            sx={{ flex: 1, minWidth: 0, bgcolor: '#eeebf5', borderRadius: 3, p: 0.5, '& .MuiTabs-indicator': { display: 'none' }, '& .Mui-selected': { bgcolor: '#fff', borderRadius: 2.5, boxShadow: '0 2px 6px #30204c0c' } }}
            aria-label={t('routines.trainingDay')}
            onChange={(_, id: string) => {
              setSelectedDayId(id);
              setChartExercise('');
              setStartError('');
            }}>
            {routine.days.map(day => <Tab key={day.id} value={day.id} label={day.name} />)}
          </Tabs>
          )}
          {!progressView && <Button startIcon={<AddIcon />} sx={{ minHeight: 44, flexShrink: 0 }} onClick={() => {
            setAddingDay(true);
            setEditingDayId(null);
            setDayName(t('routines.defaultDayName', { number: (routine.days?.length || 1) + 1 }));
            setDayError(false);
          }}>{t('routines.addDay')}</Button>}
        </Stack>

        {!progressView && <>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => {
            setPickerDayId(getCurrentDay()?.id);
            setPickerOpen(true);
          }}
            sx={{ minHeight: 44, flex: 1 }}>
            {t('routines.addExercise')}
          </Button>
          {selectedDay && (
            <Button variant="outlined" startIcon={<EditIcon />} sx={{ minHeight: 44, flex: 1 }}
              onClick={() => {
                const day = getCurrentDay();
                if (!day) return;
                setAddingDay(false);
                setEditingDayId(day.id);
                setDayName(day.name);
                setDayError(false);
              }}>
              {t('routines.editDayName')}
            </Button>
          )}
        </Stack>

        {/* ── Start session ── */}
        <Box sx={{ bgcolor: '#efe8fc', border: '1px solid #e3d7f7', p: 2.5, borderRadius: 4 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>{t(activeSession ? 'redesign.train.readyToResume' : 'redesign.train.readyToTrain')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('redesign.train.sessionHint')}</Typography>
        {!activeSession && <FormControlLabel
          control={<Checkbox checked={adjustWithAi} onChange={(_, checked) => setAdjustWithAi(checked)}
            disabled={starting || exercises.length === 0} />}
          label={t('routines.adjustWithAi')}
        />}
        <Button
          variant="contained"
          size="large"
          color="primary"
          startIcon={starting
            ? <CircularProgress size={18} color="inherit" />
            : <PlayArrowIcon />}
          onClick={startSession}
          fullWidth
          disabled={starting || (!activeSession && exercises.length === 0)}
        >
          {starting
            ? t(adjustWithAi ? 'routines.aiPlanning' : 'routines.startingSession')
            : activeSession ? t('routines.resumeSession') : t('routines.startSession')}
        </Button>
        {startError && <Alert severity="info">{startError}</Alert>}
        </Box>

        <RoutineScheduleControls routine={routine} day={selectedDay} onSaved={setRoutine} />

        {/* ── Exercises ── */}
        <Typography variant="subtitle1" fontWeight={600}>
          {t('exerciseLog.exercises')} ({exercises.length})
        </Typography>
        {exercises.length === 0 && <Alert severity="info">{t('routines.emptyDay')}</Alert>}

        {exercises.map((ex, idx) => {
          const defaults = resolveExerciseDefaults(routine, idx, sessions, selectedDay?.id);
          const firstSet = defaults.sets[0];
          return (
          <Card key={`${ex.name}-${idx}`} variant="outlined">
            <CardContent sx={{ '&:last-child': { pb: 2 } }}>
              <Stack direction="row" alignItems="center" sx={{ display: 'grid', gridTemplateColumns: { xs: '56px minmax(0,1fr)', sm: '72px minmax(0,1fr) auto' }, gap: { xs: 1.25, sm: 2 } }}>
                <Box sx={{ bgcolor: '#f6f3fb', borderRadius: 3, overflow: 'hidden', width: { xs: 56, sm: 72 }, height: { xs: 56, sm: 72 } }}><ExerciseGif gifUrl={ex.gif_url} images={ex.images} size="100%" /></Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{ex.name}</Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                    <Chip
                      size="small"
                      label={`${ex.sets}×${firstSet?.reps ?? ex.reps}${firstSet?.weight_kg ? ` · ${formatWeight(firstSet.weight_kg, getExerciseWeightUnit(profile, defaults))}` : ''}`}
                    />
                    {ex.rest_sec != null && ex.rest_sec > 0 && (
                      <Chip size="small" variant="outlined" icon={<TimerIcon />} label={`${ex.rest_sec}s`} />
                    )}
                    {ex.muscle_group && (
                      <Chip size="small" variant="outlined" label={ex.muscle_group} sx={{ textTransform: 'capitalize' }} />
                    )}
                  </Stack>
                  <LoadBasisGuidance exercise={ex} compact />
                  {ex.load_basis_review_required && defaults.recorded && <RecordedLoadReference reference={defaults.recorded} />}
                  {ex.notes && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                      {ex.notes}
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, justifyContent: 'flex-end' }}>
                <Stack direction={{ xs: 'row', sm: 'column' }}>
                  <IconButton aria-label={t('common.moveUp')} size="small" onClick={() => moveExercise(ex, idx, -1)} disabled={idx === 0}>
                    <KeyboardArrowUpIcon fontSize="small" />
                  </IconButton>
                  <IconButton aria-label={t('common.moveDown')} size="small" onClick={() => moveExercise(ex, idx, 1)} disabled={idx === exercises.length - 1}>
                    <KeyboardArrowDownIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <Stack direction={{ xs: 'row', sm: 'column' }}>
                  <IconButton aria-label={t('common.edit')} size="small" onClick={() => openExerciseEditor(ex, idx)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <Tooltip title={t('exerciseLog.remove')}>
                    <IconButton size="small" color="error" aria-label={t('exerciseLog.remove')} onClick={() => removeExercise(ex, idx)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
          );
        })}
        </>}

        {/* ── Progress ── */}
        {(progressView || completed.length > 0) && (
          <>
            <Typography variant="subtitle1" fontWeight={600}>{t('routines.progress')}</Typography>
            <Card variant="outlined">
              <CardContent>
                {progressChoices.length > 0 && <Select
                  value={chartExercise?.key ?? ''}
                  onChange={(e) => setChartExercise(e.target.value)}
                  size="small" fullWidth sx={{ mb: 2 }}
                  inputProps={{ 'aria-label': t('exerciseProgress.exercise') }}
                >
                  {progressChoices.map((choice) => (
                    <MenuItem key={choice.key} value={choice.key}>
                      {choice.historical ? t('routineHistory.historicalExercise', { name: choice.name }) : choice.name}
                    </MenuItem>
                  ))}
                </Select>}
                <ExerciseProgress sessions={completed} exerciseName={chartExercise?.name ?? ''}
                  exerciseId={chartExercise?.id} previousNames={chartExercise?.previousNames}
                  legacyNames={chartExercise?.legacyNames} legacyOnly={chartExercise?.legacyOnly}
                  movementNames={chartExercise?.movementNames} movementLibraryId={chartExercise?.movementLibraryId}
                  defaultWeightUnit={defaultWeightUnit} />
                {hasEarlierSessions && <Stack spacing={1} sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t('routineHistory.loaded', { count: sessions.length })}
                  </Typography>
                  <Button variant="outlined" onClick={loadEarlierSessions} disabled={loadingEarlier} sx={{ minHeight: 44 }}>
                    {t(loadingEarlier ? 'routineHistory.loadingEarlier' : 'routineHistory.loadEarlier')}
                  </Button>
                </Stack>}
                {earlierError && <Alert severity="error" sx={{ mt: 2 }}>{t('routineHistory.loadError')}</Alert>}
                {completed.length === 0 && <Stack spacing={1} sx={{ mt: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('routines.noProgressForDay')}
                  </Typography>
                  {latestCompletedDay && <Button variant="outlined" startIcon={<ShowChartIcon />} sx={{ minHeight: 44 }}
                    onClick={() => openProgress(true)}>{t('routines.viewLatestProgress')}</Button>}
                </Stack>}
              </CardContent>
            </Card>

            {/* ── History ── */}
            {completed.length > 0 && <Typography variant="subtitle1" fontWeight={600}>{t('routines.history')}</Typography>}
            {completed.slice(0, 10).map((s) => (
              <Card key={s.id} variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography fontWeight={600} sx={{ flex: 1 }}>{s.date}</Typography>
                    {s.total_volume_kg != null && (
                      <Chip size="small" label={formatWeight(s.total_volume_kg, defaultWeightUnit)} />
                    )}
                    {s.duration_min != null && (
                      <Chip size="small" variant="outlined" icon={<TimerIcon />} label={`${s.duration_min} min`} />
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {s.exercises.map((e) => `${e.name}: ${summarizeSets(e.sets, profile?.workout_weight_unit ?? e.weight_unit ?? defaultWeightUnit)}`).join(' · ')}
                  </Typography>
                  <Button size="small" sx={{ mt: 1, minHeight: 44 }}
                    onClick={() => navigate(`/workout-history?routine=${encodeURIComponent(routine.id)}&session=${encodeURIComponent(s.id)}`)}>
                    {t('workoutHistory.viewSets')}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </Stack>

      {/* ── Dialogs ── */}
      <Dialog open={addingDay || editingDayId !== null} onClose={() => {
        if (!savingDay) { setEditingDayId(null); setAddingDay(false); }
      }}
        fullWidth maxWidth="xs" aria-labelledby="edit-day-title">
        <Box component="form" onSubmit={(event) => { event.preventDefault(); saveDay(); }}>
          <DialogTitle id="edit-day-title">{t(addingDay ? 'routines.addDay' : 'routines.editDayName')}</DialogTitle>
          <DialogContent>
            <TextField autoFocus fullWidth label={t('routines.dayName')} value={dayName}
              onChange={(event) => setDayName(event.target.value)} disabled={savingDay} sx={{ mt: 1 }} />
            {dayError && <Alert severity="error" sx={{ mt: 2 }}>{t('common.error')}</Alert>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setEditingDayId(null); setAddingDay(false); }} disabled={savingDay}>{t('common.cancel')}</Button>
            <Button variant="contained" type="submit" disabled={savingDay || !dayName.trim()}
              startIcon={savingDay ? <CircularProgress size={16} color="inherit" /> : undefined}>
              {t('common.save')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
      <ExercisePickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={(ex) => { setPickerOpen(false); addExercise(ex); }}
      />

      <ExerciseConfigDialog
        open={editTarget !== null && !!editedExercise}
        initial={editedExercise?.load_basis_review_required ? { ...editedExercise } : editedExercise ? {
          ...editedExercise,
          set_defaults: editDefaults?.sets.map(set => ({ reps: set.reps, weight_kg: set.weight_kg })),
          reps: editDefaults?.sets[0]?.reps ?? editedExercise.reps,
          weight_kg: editDefaults?.sets[0]?.weight_kg ?? editedExercise.weight_kg,
          weight_unit: getExerciseWeightUnit(profile, editDefaults ?? {}),
          weight_unit_override: Boolean(editDefaults?.weight_unit_override),
        } : null}
        recordedReference={editRecorded}
        editableName={!!editedExercise && !editedExercise.library_id}
        onClose={() => setEditTarget(null)}
        onSave={(ex) => { updateExercise(ex); setEditTarget(null); }}
      />

      <Dialog open={metaOpen} onClose={() => setMetaOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('routines.editRoutine')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('routines.routineName')}
              value={metaName}
              onChange={(e) => setMetaName(e.target.value)}
              size="small" fullWidth
            />
            <TextField
              label={t('routines.description')}
              value={metaDesc}
              onChange={(e) => setMetaDesc(e.target.value)}
              size="small" fullWidth multiline rows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMetaOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={saveMeta} disabled={!metaName.trim()}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
