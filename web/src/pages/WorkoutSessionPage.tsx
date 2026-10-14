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
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import HistoryIcon from '@mui/icons-material/History';
import { serverTimestamp } from 'firebase/firestore';
import { useAuthStore } from '../store/authStore';
import {
  getWorkoutSession, updateWorkoutSession, updateRoutine, getRoutine,
  upsertDailyLog, getDailyLog,
} from '../firebase/firestore';
import ExerciseGif from '../components/ExerciseGif';
import { doneSets, sessionVolume, summarizeSets, topSetWeight } from '../lib/workout';
import type { SessionChange, SessionExercise, WorkoutSession } from '../types/routine';
import type { ExerciseLogEntry } from '../types/log';

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

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentUser || !sessionId) return;
    getWorkoutSession(currentUser.uid, sessionId)
      .then(setSession)
      .finally(() => setLoading(false));
  }, [currentUser, sessionId]);

  // Debounced autosave so mid-workout progress is never lost
  const persist = useCallback((next: WorkoutSession) => {
    if (!currentUser || !sessionId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateWorkoutSession(currentUser.uid, sessionId, { exercises: next.exercises });
    }, 800);
  }, [currentUser, sessionId]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const mutate = (updater: (prev: WorkoutSession) => WorkoutSession) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      persist(next);
      return next;
    });
  };

  const updateSet = (exIdx: number, setIdx: number, field: 'reps' | 'weight_kg' | 'done', value: number | boolean) =>
    mutate((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) =>
        i !== exIdx ? ex : {
          ...ex,
          sets: ex.sets.map((s, j) => (j !== setIdx ? s : { ...s, [field]: value })),
        }
      ),
    }));

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

  const progress = useMemo(() => {
    if (!session) return 0;
    const total = session.exercises.reduce((n, e) => n + e.sets.length, 0);
    const done = session.exercises.reduce((n, e) => n + doneSets(e.sets).length, 0);
    return total ? Math.round((done / total) * 100) : 0;
  }, [session]);

  // ── Finish ──────────────────────────────────────────────────────────────────

  const finish = async () => {
    if (!currentUser || !session || !sessionId || !routineId) return;
    setFinishing(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      const volume = sessionVolume(session.exercises);
      const startedAt = (session.started_at as { toDate?: () => Date } | undefined)?.toDate?.();
      const duration = startedAt
        ? Math.max(1, Math.round((Date.now() - startedAt.getTime()) / 60000))
        : undefined;

      await updateWorkoutSession(currentUser.uid, sessionId, {
        exercises: session.exercises,
        status: 'completed',
        total_volume_kg: volume,
        ...(duration != null ? { duration_min: duration } : {}),
        completed_at: serverTimestamp(),
      });

      // Bump routine stats
      const routine = await getRoutine(currentUser.uid, routineId);
      await updateRoutine(currentUser.uid, routineId, {
        session_count: (routine?.session_count ?? 0) + 1,
        last_session_at: session.date,
      });

      // Mirror into the daily log so the AI chat agents see today's training
      const entries: ExerciseLogEntry[] = session.exercises
        .filter((e) => doneSets(e.sets).length > 0)
        .map((e) => ({
          exercise: e.name,
          sets: doneSets(e.sets).length,
          reps: doneSets(e.sets)[0]?.reps,
          weight_kg: topSetWeight(e.sets) || undefined,
          notes: `${session.routine_name} — ${summarizeSets(e.sets)}`,
        }));
      if (entries.length) {
        const existing = await getDailyLog(currentUser.uid, session.date);
        const kept = (existing?.exercise_log ?? []).filter(
          (prev) => !entries.some((e) => e.exercise === prev.exercise)
        );
        await upsertDailyLog(currentUser.uid, session.date, {
          exercise_log: [...kept, ...entries],
          updated_at: serverTimestamp(),
          ...(!existing ? { date: session.date, created_at: serverTimestamp() } : {}),
        });
      }

      navigate(`/routines/${routineId}`);
    } finally {
      setFinishing(false);
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
    <Container maxWidth="sm" sx={{ py: 3, pb: 12 }}>
      <Stack spacing={2.5}>

        {/* ── Header ── */}
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton onClick={() => navigate(`/routines/${routineId}`)}><ArrowBackIcon /></IconButton>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" fontWeight={700}>{session.routine_name}</Typography>
            {session.day_name && <Typography variant="body2">{session.day_name}</Typography>}
            <Typography variant="caption" color="text.secondary">{session.date}</Typography>
          </Box>
          <Chip label={`${progress}%`} color={progress === 100 ? 'success' : 'default'} />
        </Stack>
        <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: 1, height: 6 }} />

        {/* ── AI insight ── */}
        {session.ai_insight && (
          <Alert severity="info" icon={<AutoFixHighIcon />}>
            <Typography variant="body2">{session.ai_insight}</Typography>
          </Alert>
        )}

        {/* ── Exercises ── */}
        {session.exercises.map((ex, exIdx) => (
          <ExerciseCard
            key={`${ex.name}-${exIdx}`}
            exercise={ex}
            onSetChange={(setIdx, field, value) => updateSet(exIdx, setIdx, field, value)}
            onAddSet={() => addSet(exIdx)}
          />
        ))}

        {/* ── Finish ── */}
        <Button
          variant="contained"
          color="success"
          size="large"
          startIcon={finishing ? <CircularProgress size={18} color="inherit" /> : <CheckCircleIcon />}
          onClick={finish}
          disabled={finishing || session.status === 'completed'}
        >
          {t('routines.finishSession')}
        </Button>
      </Stack>
    </Container>
  );
}

// ─── Exercise card ────────────────────────────────────────────────────────────

interface CardProps {
  exercise: SessionExercise;
  onSetChange: (setIdx: number, field: 'reps' | 'weight_kg' | 'done', value: number | boolean) => void;
  onAddSet: () => void;
}

function ExerciseCard({ exercise: ex, onSetChange, onAddSet }: CardProps) {
  const { t } = useTranslation();
  const allDone = ex.sets.length > 0 && ex.sets.every((s) => s.done);

  return (
    <Card variant="outlined" sx={allDone ? { borderColor: 'success.main' } : undefined}>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2} alignItems="center">
            <ExerciseGif gifUrl={ex.gif_url} images={ex.images} size={64} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={600}>{ex.name}</Typography>
              <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={`${t('routines.target')}: ${ex.target_sets}×${ex.target_reps}${
                    ex.target_weight_kg ? ` @ ${ex.target_weight_kg}kg` : ''}`}
                />
                {ex.change && changeIcon[ex.change]}
              </Stack>
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

          {/* Set rows */}
          {ex.sets.map((set, setIdx) => (
            <Stack key={setIdx} direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary" sx={{ width: 24 }}>
                {setIdx + 1}
              </Typography>
              <TextField
                type="number"
                size="small"
                value={set.weight_kg || ''}
                onChange={(e) => onSetChange(setIdx, 'weight_kg', Number(e.target.value))}
                inputProps={{ min: 0, step: 0.5, style: { textAlign: 'center' } }}
                sx={{ width: 90 }}
                label="kg"
              />
              <TextField
                type="number"
                size="small"
                value={set.reps || ''}
                onChange={(e) => onSetChange(setIdx, 'reps', Number(e.target.value))}
                inputProps={{ min: 0, style: { textAlign: 'center' } }}
                sx={{ width: 90 }}
                label={t('exerciseLog.reps')}
              />
              <Box sx={{ flex: 1 }} />
              <Checkbox
                checked={set.done}
                onChange={(e) => onSetChange(setIdx, 'done', e.target.checked)}
                icon={<CheckCircleIcon color="disabled" />}
                checkedIcon={<CheckCircleIcon color="success" />}
              />
            </Stack>
          ))}

          <Button size="small" startIcon={<AddIcon />} onClick={onAddSet} sx={{ alignSelf: 'flex-start' }}>
            {t('routines.addSet')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
