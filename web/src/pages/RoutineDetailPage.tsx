import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Stack,
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
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import TimerIcon from '@mui/icons-material/Timer';
import {
  LineChart, Line, XAxis, YAxis, Tooltip as ChartTooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import { useAuthStore } from '../store/authStore';
import {
  getRoutine, updateRoutine, getRoutineSessions, addWorkoutSession,
} from '../firebase/firestore';
import ExerciseGif from '../components/ExerciseGif';
import ExercisePickerDialog from '../components/routines/ExercisePickerDialog';
import ExerciseConfigDialog from '../components/routines/ExerciseConfigDialog';
import { findSessionExercise, summarizeSets, topSetWeight, exerciseVolume } from '../lib/workout';
import type {
  Routine, RoutineExercise, SessionExercise, SessionPlan, WorkoutSession,
} from '../types/routine';

const planSessionFn = httpsCallable<
  { routine: { name: string; exercises: RoutineExercise[] }; recentSessions: unknown[] },
  { plan: SessionPlan }
>(functions, 'plan_workout_session');

const today = () => new Date().toISOString().split('T')[0];

export default function RoutineDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { routineId } = useParams<{ routineId: string }>();
  const { currentUser } = useAuthStore();

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaName, setMetaName] = useState('');
  const [metaDesc, setMetaDesc] = useState('');

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  const [chartExercise, setChartExercise] = useState('');

  const refresh = useCallback(async () => {
    if (!currentUser || !routineId) return;
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        getRoutine(currentUser.uid, routineId),
        getRoutineSessions(currentUser.uid, routineId),
      ]);
      setRoutine(r);
      setSessions(s);
      if (r && r.exercises.length && !chartExercise) setChartExercise(r.exercises[0].name);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, routineId]);

  useEffect(() => { refresh(); }, [refresh]);

  const completed = useMemo(
    () => sessions.filter((s) => s.status === 'completed'),
    [sessions]
  );
  const activeSession = useMemo(
    () => sessions.find((s) => s.status === 'active'),
    [sessions]
  );

  // ── Exercise editing ────────────────────────────────────────────────────────

  const saveExercises = async (exercises: RoutineExercise[]) => {
    if (!currentUser || !routine) return;
    setRoutine({ ...routine, exercises });
    await updateRoutine(currentUser.uid, routine.id, { exercises });
  };

  const addExercise = (ex: RoutineExercise) =>
    routine && saveExercises([...routine.exercises, ex]);

  const updateExercise = (index: number, ex: RoutineExercise) =>
    routine && saveExercises(routine.exercises.map((e, i) => (i === index ? ex : e)));

  const removeExercise = (index: number) =>
    routine && saveExercises(routine.exercises.filter((_, i) => i !== index));

  const moveExercise = (index: number, delta: number) => {
    if (!routine) return;
    const target = index + delta;
    if (target < 0 || target >= routine.exercises.length) return;
    const next = [...routine.exercises];
    [next[index], next[target]] = [next[target], next[index]];
    saveExercises(next);
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

  // ── Start session (AI-adjusted) ─────────────────────────────────────────────

  const startSession = async () => {
    if (!currentUser || !routine || !routine.exercises.length) return;

    if (activeSession) {
      navigate(`/routines/${routine.id}/session/${activeSession.id}`);
      return;
    }

    setStarting(true);
    setStartError('');

    const lastSession = completed[0];

    // AI plan — falls back to routine/last-session targets when unavailable
    let plan: SessionPlan | null = null;
    try {
      const result = await planSessionFn({
        routine: { name: routine.name, exercises: routine.exercises },
        recentSessions: completed.slice(0, 4).map((s) => ({
          date: s.date,
          exercises: s.exercises.map((e) => ({ name: e.name, sets: e.sets })),
        })),
      });
      plan = result.data.plan;
    } catch {
      setStartError(t('routines.aiUnavailable'));
    }

    const exercises: SessionExercise[] = routine.exercises.map((ex) => {
      const planned = plan?.exercises.find(
        (p) => p.name.toLowerCase() === ex.name.toLowerCase()
      );
      const previous = lastSession && findSessionExercise(lastSession, ex.name);

      const sets = planned?.sets ?? ex.sets;
      const reps = planned?.reps ?? ex.reps;
      const weight = planned?.weight_kg ?? ex.weight_kg ?? (previous ? topSetWeight(previous.sets) : 0);

      return {
        name: ex.name,
        ...(ex.gif_url ? { gif_url: ex.gif_url } : {}),
        ...(ex.images ? { images: ex.images } : {}),
        ...(ex.rest_sec != null ? { rest_sec: ex.rest_sec } : {}),
        target_sets: sets,
        target_reps: reps,
        target_weight_kg: weight ?? 0,
        ...(planned?.change ? { change: planned.change } : {}),
        ...(planned?.note ? { ai_note: planned.note } : {}),
        ...(previous ? { last_summary: summarizeSets(previous.sets) } : {}),
        sets: Array.from({ length: sets }, () => ({
          reps,
          weight_kg: weight ?? 0,
          done: false,
        })),
      };
    });

    try {
      const sessionId = await addWorkoutSession(currentUser.uid, {
        routine_id: routine.id,
        routine_name: routine.name,
        date: today(),
        status: 'active',
        ...(plan?.insight ? { ai_insight: plan.insight } : {}),
        exercises,
      });
      navigate(`/routines/${routine.id}/session/${sessionId}`);
    } catch {
      setStartError(t('common.error'));
    } finally {
      setStarting(false);
    }
  };

  // ── Progress chart data ─────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    if (!chartExercise) return [];
    return [...completed]
      .reverse()
      .map((s) => {
        const ex = findSessionExercise(s, chartExercise);
        if (!ex) return null;
        const top = topSetWeight(ex.sets);
        const volume = exerciseVolume(ex.sets);
        if (!top && !volume) return null;
        return { date: s.date.slice(5), topWeight: top, volume };
      })
      .filter(Boolean) as { date: string; topWeight: number; volume: number }[];
  }, [completed, chartExercise]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>;
  }
  if (!routine) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="warning">{t('routines.notFound')}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={3}>

        {/* ── Header ── */}
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton onClick={() => navigate('/routines')}><ArrowBackIcon /></IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={700} noWrap>{routine.name}</Typography>
            {routine.description && (
              <Typography variant="body2" color="text.secondary">{routine.description}</Typography>
            )}
          </Box>
          <IconButton
            size="small"
            onClick={() => { setMetaName(routine.name); setMetaDesc(routine.description ?? ''); setMetaOpen(true); }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Stack>

        {/* ── Start session ── */}
        <Button
          variant="contained"
          size="large"
          color={activeSession ? 'warning' : 'primary'}
          startIcon={starting
            ? <CircularProgress size={18} color="inherit" />
            : activeSession ? <PlayArrowIcon /> : <AutoFixHighIcon />}
          onClick={startSession}
          disabled={starting || routine.exercises.length === 0}
        >
          {starting
            ? t('routines.aiPlanning')
            : activeSession ? t('routines.resumeSession') : t('routines.startSession')}
        </Button>
        {startError && <Alert severity="info">{startError}</Alert>}

        {/* ── Exercises ── */}
        <Typography variant="subtitle1" fontWeight={600}>
          {t('exerciseLog.exercises')} ({routine.exercises.length})
        </Typography>

        {routine.exercises.map((ex, idx) => (
          <Card key={`${ex.name}-${idx}`} variant="outlined">
            <CardContent sx={{ '&:last-child': { pb: 2 } }}>
              <Stack direction="row" spacing={2} alignItems="center">
                <ExerciseGif gifUrl={ex.gif_url} images={ex.images} size={72} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={600} noWrap>{ex.name}</Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                    <Chip
                      size="small"
                      label={`${ex.sets}×${ex.reps}${ex.weight_kg ? ` · ${ex.weight_kg}kg` : ''}`}
                    />
                    {ex.rest_sec != null && ex.rest_sec > 0 && (
                      <Chip size="small" variant="outlined" icon={<TimerIcon />} label={`${ex.rest_sec}s`} />
                    )}
                    {ex.muscle_group && (
                      <Chip size="small" variant="outlined" label={ex.muscle_group} sx={{ textTransform: 'capitalize' }} />
                    )}
                  </Stack>
                  {ex.notes && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                      {ex.notes}
                    </Typography>
                  )}
                </Box>
                <Stack>
                  <IconButton size="small" onClick={() => moveExercise(idx, -1)} disabled={idx === 0}>
                    <KeyboardArrowUpIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => moveExercise(idx, 1)} disabled={idx === routine.exercises.length - 1}>
                    <KeyboardArrowDownIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <Stack>
                  <IconButton size="small" onClick={() => setEditIndex(idx)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <Tooltip title={t('exerciseLog.remove')}>
                    <IconButton size="small" color="error" onClick={() => removeExercise(idx)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        ))}

        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setPickerOpen(true)}>
          {t('routines.addExercise')}
        </Button>

        {/* ── Progress ── */}
        {completed.length > 0 && (
          <>
            <Typography variant="subtitle1" fontWeight={600}>{t('routines.progress')}</Typography>
            <Card variant="outlined">
              <CardContent>
                <Select
                  value={chartExercise}
                  onChange={(e) => setChartExercise(e.target.value)}
                  size="small" fullWidth sx={{ mb: 2 }}
                >
                  {routine.exercises.map((ex) => (
                    <MenuItem key={ex.name} value={ex.name}>{ex.name}</MenuItem>
                  ))}
                </Select>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="date" fontSize={12} />
                      <YAxis yAxisId="w" fontSize={12} />
                      <YAxis yAxisId="v" orientation="right" fontSize={12} width={45} />
                      <ChartTooltip />
                      <Line yAxisId="w" type="monotone" dataKey="topWeight" name={t('routines.topSetKg')} stroke="#1976d2" strokeWidth={2} dot />
                      <Line yAxisId="v" type="monotone" dataKey="volume" name={t('routines.volumeKg')} stroke="#9c27b0" strokeWidth={2} dot />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('routines.noChartData')}
                  </Typography>
                )}
              </CardContent>
            </Card>

            {/* ── History ── */}
            <Typography variant="subtitle1" fontWeight={600}>{t('routines.history')}</Typography>
            {completed.slice(0, 10).map((s) => (
              <Card key={s.id} variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography fontWeight={600} sx={{ flex: 1 }}>{s.date}</Typography>
                    {s.total_volume_kg != null && (
                      <Chip size="small" label={`${Math.round(s.total_volume_kg)} kg`} />
                    )}
                    {s.duration_min != null && (
                      <Chip size="small" variant="outlined" icon={<TimerIcon />} label={`${s.duration_min} min`} />
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {s.exercises.map((e) => `${e.name}: ${summarizeSets(e.sets)}`).join(' · ')}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </Stack>

      {/* ── Dialogs ── */}
      <ExercisePickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={(ex) => { setPickerOpen(false); addExercise(ex); }}
      />

      <ExerciseConfigDialog
        open={editIndex !== null}
        initial={editIndex !== null ? routine.exercises[editIndex] : null}
        editableName={editIndex !== null && !routine.exercises[editIndex]?.library_id}
        onClose={() => setEditIndex(null)}
        onSave={(ex) => { if (editIndex !== null) updateExercise(editIndex, ex); setEditIndex(null); }}
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
