import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Card, CardActionArea, CardContent, Chip, Container, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Skeleton, Stack, TextField, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import RestaurantOutlinedIcon from '@mui/icons-material/RestaurantOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import { useProfileStore } from '../store/profileStore';
import { useAuthStore } from '../store/authStore';
import { useDailyLog } from '../hooks/useDailyLog';
import { getActiveWorkoutSessions, getRoutines, getWorkoutSessions, updateRoutine } from '../firebase/firestore';
import { localDateKey, shiftDateKey } from '../lib/dates';
import { compareWorkoutSessionsNewestFirst } from '../lib/sessionOrder';
import { buildWorkoutDaySwap, getScheduledWorkouts, hasRoutineSchedule, selectTrainingRoutine, workoutMatchesSession } from '../lib/trainingSchedule';
import { startSavedWorkout } from '../lib/startWorkout';
import type { Routine, RoutineDay, WorkoutSession } from '../types/routine';
import WeeklyReportCard from '../components/dashboard/WeeklyReportCard';
import GoalForecastCard from '../components/dashboard/GoalForecastCard';
import NutritionCard from '../components/dashboard/NutritionCard';

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfileStore(state => state.profile);
  const uid = useAuthStore(state => state.currentUser?.uid);
  const [today, setToday] = useState(localDateKey);
  const [starting, setStarting] = useState(false);
  const startLock = useRef(false);
  const [startError, setStartError] = useState(false);
  const [chooseDayOpen, setChooseDayOpen] = useState(false);
  const [chosenDayId, setChosenDayId] = useState('');
  const { log } = useDailyLog(today);
  const [activity, setActivity] = useState<{ uid?: string; sessions: WorkoutSession[]; routines: Routine[]; failed: boolean }>({ sessions: [], routines: [], failed: false });
  const loading = activity.uid !== uid;
  const loadError = !loading && activity.failed;
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDateKey()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    Promise.allSettled([getWorkoutSessions(uid, 100), getRoutines(uid), getActiveWorkoutSessions(uid)]).then(([sessions, routines, activeSessions]) => {
      if (cancelled) return;
      const recent = sessions.status === 'fulfilled' ? sessions.value : [];
      const active = activeSessions.status === 'fulfilled' ? activeSessions.value : [];
      setActivity({ uid, sessions: [...new Map([...recent, ...active].map(session => [session.id, session])).values()], routines: routines.status === 'fulfilled' ? routines.value : [], failed: sessions.status === 'rejected' || routines.status === 'rejected' || activeSessions.status === 'rejected' });
    });
    return () => { cancelled = true; };
  }, [uid]);
  const sessions = [...(loading ? [] : activity.sessions)].sort(compareWorkoutSessionsNewestFirst);
  const active = sessions.find(session => session.status === 'active');
  const nextRoutine = loading ? undefined : selectTrainingRoutine(activity.routines, sessions, profile?.preferred_routine_id);
  const scheduled = nextRoutine ? getScheduledWorkouts(nextRoutine, today) : [];
  const completedToday = sessions.filter(session => session.status === 'completed' && session.date === today);
  const pending = scheduled.filter(workout => !completedToday.some(session => workoutMatchesSession(workout, session)));
  const todayWorkout = pending[0] ?? scheduled[0];
  const hasSchedule = !!nextRoutine && hasRoutineSchedule(nextRoutine);
  const heroRoutine = active ? activity.routines.find(routine => routine.id === active.routine_id) : nextRoutine;
  const heroDay = active
    ? active.day_name ?? heroRoutine?.days?.find(day => day.id === active.day_id)?.name
    : todayWorkout?.day?.name;
  const statusKey = active ? 'redesign.today.inProgress' : scheduled.length
    ? pending.length ? 'schedule.pending' : 'schedule.completed'
    : hasSchedule ? 'schedule.restDay' : 'redesign.today.nextUp';
  const hintKey = active ? 'redesign.today.resumeHint' : scheduled.length
    ? pending.length ? 'schedule.pendingHint' : 'schedule.completedHint'
    : hasSchedule ? 'schedule.restHint' : 'schedule.unscheduledHint';
  const monday = new Date(today + 'T12:00:00');
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = localDateKey(monday);
  const days = Array.from({ length: 7 }, (_, index) => shiftDateKey(weekStart, index));
  const completed = sessions.filter(session => session.status === 'completed' && session.date >= weekStart && session.date <= today);
  const goal = nextRoutine && hasSchedule ? days.reduce((count, day) => count + getScheduledWorkouts(nextRoutine, day).length, 0)
    : profile?.training_days_per_week || 3;
  const name = profile?.name?.trim().split(' ')[0] || '👋';
  const locale = i18n.language.startsWith('es') ? 'es' : 'en';
  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(today + 'T12:00:00'));
  const routinePath = (routine: Routine, dayId?: string) => '/routines/' + encodeURIComponent(routine.id)
    + (dayId ? '?day=' + encodeURIComponent(dayId) : '');
  const chooseDay = () => {
    setChosenDayId(todayWorkout?.day?.id ?? nextRoutine?.days?.find(day => day.exercises.length)?.id ?? '');
    setStartError(false);
    setChooseDayOpen(true);
  };
  const beginWorkout = async (routine: Routine, day?: RoutineDay) => {
    if (!uid) return;
    const sessionId = await startSavedWorkout(uid, routine, day, profile);
    navigate('/routines/' + encodeURIComponent(routine.id) + '/session/' + encodeURIComponent(sessionId));
  };
  const quickStart = async (routine: Routine, day?: RoutineDay) => {
    if (startLock.current) return;
    startLock.current = true; setStarting(true); setStartError(false);
    try { await beginWorkout(routine, day); }
    catch { setStartError(true); }
    finally { startLock.current = false; setStarting(false); }
  };
  const openTraining = () => {
    if (active) { navigate('/routines/' + active.routine_id + '/session/' + active.id); return; }
    if (!nextRoutine) { navigate('/routines'); return; }
    if (scheduled.length && !pending.length) { navigate(routinePath(nextRoutine, todayWorkout?.day?.id)); return; }
    if (!todayWorkout && nextRoutine.days?.length) { chooseDay(); return; }
    void quickStart(nextRoutine, todayWorkout?.day);
  };
  const chosenDay = nextRoutine?.days?.find(day => day.id === chosenDayId);
  const swap = nextRoutine && chosenDay?.exercises.length && !scheduled.some(workout => workout.day?.id === chosenDay.id)
    ? buildWorkoutDaySwap(nextRoutine, today, chosenDay.id, pending[0]?.day?.id) : undefined;
  const confirmDay = async () => {
    if (!uid || !nextRoutine || !chosenDay || startLock.current) return;
    startLock.current = true; setStarting(true); setStartError(false);
    try {
      let routine = nextRoutine;
      if (swap) {
        await updateRoutine(uid, routine.id, { schedule_overrides: swap.overrides });
        routine = { ...routine, schedule_overrides: swap.overrides };
        const updated = routine;
        setActivity(previous => previous.uid === uid ? { ...previous, routines: previous.routines.map(item => item.id === updated.id ? updated : item) } : previous);
      }
      await beginWorkout(routine, chosenDay);
      setChooseDayOpen(false);
    } catch { setStartError(true); }
    finally { startLock.current = false; setStarting(false); }
  };
  const actionKey = active ? 'routines.resumeSession' : !nextRoutine ? 'schedule.chooseRoutine'
    : scheduled.length && !pending.length ? 'schedule.viewRoutine'
    : !todayWorkout && nextRoutine.days?.length ? 'schedule.chooseDay' : 'dashboard.startWorkout';

  return <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, sm: 3, md: 4 } }}>
    <Stack spacing={{ xs: 3, md: 3.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{dateLabel}</Typography>
          <Typography component="h1" variant="h4" sx={{ fontSize: { xs: '1.8rem', sm: '2.15rem' }, mt: 0.5 }}>{t('dashboard.welcome', { name })}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>{t('redesign.today.subtitle')}</Typography>
        </Box>
        <Box sx={{ width: 52, height: 52, display: { xs: 'none', sm: 'grid' }, placeItems: 'center', bgcolor: '#fff0db', color: '#d18a2c', borderRadius: '50%', fontSize: 27 }} aria-hidden="true">☀</Box>
      </Stack>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Card sx={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(115deg, #6d28d9, #854be7)', color: '#fff', minHeight: 250, height: '100%', border: 0 }}>
            <Box aria-hidden="true" sx={{ position: 'absolute', width: 255, height: 255, right: -45, top: -20, border: '36px solid #ffffff09', borderRadius: '50%', transform: 'rotate(-25deg)' }} />
            <Box aria-hidden="true" sx={{ position: 'absolute', width: 158, height: 158, right: 5, top: 28, border: '1px solid #ffffff26', borderRadius: '50%', display: { xs: 'none', sm: 'grid' }, placeItems: 'center' }}><FitnessCenterRoundedIcon sx={{ fontSize: 75, color: '#e4d5ff', transform: 'rotate(-20deg)' }} /></Box>
            <CardContent sx={{ p: { xs: 3, md: 3.5 }, position: 'relative', maxWidth: { xs: '100%', sm: '76%' } }}>
              {loading ? <Skeleton sx={{ bgcolor: '#ffffff20' }} height={28} width={110} /> : <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 2 }}>
                <Chip size="small" label={t(statusKey)} sx={{ bgcolor: '#ffffff20', color: '#fff', border: '1px solid #ffffff25' }} />
                {heroRoutine && <Chip size="small" label={t(heroRoutine.id === profile?.preferred_routine_id ? 'schedule.preferredHint' : 'schedule.activeRoutineHint')} sx={{ bgcolor: '#ffffff20', color: '#fff', border: '1px solid #ffffff25' }} />}
              </Stack>}
              {loading ? <Skeleton sx={{ bgcolor: '#ffffff20' }} height={50} width="70%" /> : <>
                <Typography component="h2" variant="h5" sx={{ mb: 1, maxWidth: 380, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{active?.routine_name || nextRoutine?.name || t('redesign.today.heroTitle')}</Typography>
                {heroDay && <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700, overflowWrap: 'anywhere' }}>{heroDay}</Typography>}
                {active && active.date !== today && <Typography variant="body2" sx={{ mb: 1 }}>{t('schedule.workoutDate', { date: active.date })}</Typography>}
              </>}
              <Typography variant="body2" sx={{ color: '#eee3ff', maxWidth: 380, mb: 2.5 }}>{t(hintKey)}</Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                <Button onClick={openTraining} variant="contained" color="inherit" disabled={loading || starting} startIcon={<PlayArrowRoundedIcon />} sx={{ bgcolor: '#fff', color: 'primary.dark', '&:hover': { bgcolor: '#f0e7ff' } }}>{t(starting ? 'routines.startingSession' : actionKey)}</Button>
                {!!nextRoutine?.days?.length && <Button color="inherit" variant="outlined" onClick={chooseDay} disabled={starting} sx={{ bgcolor: 'transparent', color: '#fff', borderColor: '#ffffff80', '&:hover': { bgcolor: '#ffffff10', borderColor: '#fff' }, '&.Mui-focusVisible': { outline: '2px solid #fff', outlineOffset: 3 } }}>{t('schedule.changeDay')}</Button>}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card sx={{ height: '100%', bgcolor: '#e7f5ee', borderColor: '#d5eadd' }}>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="overline" sx={{ color: '#38715a' }}>{t('redesign.today.checkIn')}</Typography><EditNoteRoundedIcon sx={{ color: '#3b8a67' }} /></Stack>
              <Typography variant="h6" sx={{ mt: 1.5, mb: 0.75 }}>{t(log ? 'redesign.today.checkInDone' : 'redesign.today.checkInTitle')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>{t(log ? 'redesign.today.checkInDoneHint' : 'redesign.today.checkInHint')}</Typography>
              <Button variant="outlined" color="inherit" onClick={() => navigate('/log')} endIcon={<ArrowForwardRoundedIcon />} sx={{ bgcolor: '#ffffff90', borderColor: '#bfdacb' }}>{t('dashboard.logToday')}</Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      {loadError && <Alert severity="warning">{t('redesign.today.activityError')}</Alert>}
      {startError && !chooseDayOpen && <Alert severity="error">{t('schedule.startError')}</Alert>}
      {!loading && (scheduled.length > 1 || (active && todayWorkout && (active.date !== today || !workoutMatchesSession(todayWorkout, active)))) && <Stack spacing={1} aria-label={t('schedule.todayWorkout')}>
        <Typography variant="subtitle2">{t('schedule.todayWorkout')} · {nextRoutine?.name}</Typography>
        {scheduled.map(workout => {
          const done = completedToday.some(session => workoutMatchesSession(workout, session));
          return <Card key={workout.day?.id ?? workout.routine.id}><CardActionArea disabled={starting} onClick={() => done ? navigate(routinePath(workout.routine, workout.day?.id)) : void quickStart(workout.routine, workout.day)}><CardContent sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Typography sx={{ overflowWrap: 'anywhere' }}>{workout.day?.name ?? workout.routine.name}</Typography><Chip size="small" color={done ? 'success' : 'warning'} label={t(done ? 'schedule.completed' : 'schedule.pending')} />
          </CardContent></CardActionArea></Card>;
        })}
      </Stack>}

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 2.5 }}>
              <Box><Typography component="h2" variant="h6">{t('redesign.today.thisWeek')}</Typography><Typography variant="body2" color="text.secondary">{t('redesign.today.weekProgress', { count: completed.length, goal })}</Typography></Box>
              <Button onClick={() => navigate('/progress')} endIcon={<ArrowForwardRoundedIcon />} size="small">{t('redesign.nav.progress')}</Button>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: { xs: 0.75, sm: 1.5 } }}>
              {days.map(day => {
                const planned = nextRoutine ? getScheduledWorkouts(nextRoutine, day) : [];
                const daySessions = completed.filter(session => session.date === day);
                const done = planned.length ? planned.every(workout => daySessions.some(session => workoutMatchesSession(workout, session))) : !!daySessions.length;
                const due = !!planned.length && !done;
                const current = day === today;
                const calendarKey = done ? 'redesign.today.trainedDay' : due
                  ? day <= today ? 'schedule.calendarPending' : 'schedule.calendarPlanned'
                  : hasSchedule ? 'schedule.calendarRest' : 'redesign.today.calendarDay';
                return <Stack key={day} alignItems="center" spacing={1}>
                  <Typography variant="caption" color={current ? 'primary' : 'text.secondary'} sx={{ fontSize: { xs: 10, sm: 12 }, fontWeight: current ? 750 : 500 }}>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(day + 'T12:00:00'))}</Typography>
                  <Box role="img" aria-label={t(calendarKey, { date: day })} sx={{ position: 'relative', width: { xs: 33, sm: 42 }, height: { xs: 38, sm: 46 }, borderRadius: 3, display: 'grid', placeItems: 'center', bgcolor: done ? 'primary.main' : due && day <= today ? '#fff0db' : current ? '#eee7fc' : '#f7f6fb', color: done ? '#fff' : due && day <= today ? '#965b12' : current ? 'primary.main' : 'text.secondary', border: current && !done ? '1px solid #cab2f5' : '1px solid transparent', fontWeight: 700, fontSize: 13 }}>{done ? <CheckRoundedIcon fontSize="small" /> : Number(day.slice(-2))}{due && <Box aria-hidden="true" sx={{ position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: '50%', bgcolor: 'currentColor' }} />}</Box>
                </Stack>;
              })}
            </Box>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="overline" color="text.secondary">{t('redesign.today.yourSnapshot')}</Typography>
            <Stack direction="row" spacing={3} sx={{ mt: 2 }}>
              <Box sx={{ flex: 1 }}><Typography variant="caption" color="text.secondary">{t('dashboard.todayWeight')}</Typography><Typography variant="h5" sx={{ mt: 0.5 }}>{log?.weight_kg != null ? log.weight_kg + ' kg' : '—'}</Typography>{profile?.goal_weight_kg && <Typography variant="caption" color="text.secondary">{t('dashboard.goalWeight', { kg: profile.goal_weight_kg })}</Typography>}</Box>
              <Box sx={{ flex: 1 }}><Typography variant="caption" color="text.secondary">{t('dailyLog.energy')}</Typography><Typography variant="h5" sx={{ mt: 0.5 }}>{log?.energy != null ? log.energy + ' / 5' : '—'}</Typography></Box>
            </Stack>
          </CardContent></Card>
        </Grid>
      </Grid>

      <Box>
        <Typography component="h2" variant="h6" sx={{ mb: 1.5 }}>{t('redesign.today.quickActions')}</Typography>
        <Grid container spacing={1.5}>
          {[
            { label: 'redesign.today.meals', hint: 'redesign.today.mealsHint', path: '/log?tab=3', icon: <RestaurantOutlinedIcon />, color: '#fff0e9', ink: '#cf6845' },
            { label: 'redesign.today.measurements', hint: 'redesign.today.measurementsHint', path: '/progress', icon: <InsightsRoundedIcon />, color: '#eee7fc', ink: '#6d28d9' },
            { label: 'redesign.today.plans', hint: 'redesign.today.plansHint', path: '/plans', icon: <MenuBookOutlinedIcon />, color: '#e8f3f5', ink: '#39858c' },
            { label: 'redesign.today.askCoach', hint: 'redesign.today.askCoachHint', path: '/chat', icon: <AutoAwesomeOutlinedIcon />, color: '#fff4d9', ink: '#ab8326' },
          ].map(action => <Grid key={action.path} size={{ xs: 6, sm: 3 }}><Button fullWidth variant="text" onClick={() => navigate(action.path)}
            startIcon={action.icon} sx={{ minHeight: 44, justifyContent: 'flex-start', textAlign: 'left' }}>{t(action.label)}</Button></Grid>)}
        </Grid>
      </Box>
      <Box><Typography component="h2" variant="h6" sx={{ mb: 1.5 }}>{t('redesign.today.insights')}</Typography>
        <Grid container spacing={2.5}><Grid size={{ xs: 12, md: 6 }}><Stack spacing={2.5}><GoalForecastCard /><NutritionCard /></Stack></Grid><Grid size={{ xs: 12, md: 6 }}><WeeklyReportCard /></Grid></Grid>
      </Box>
    </Stack>
    <Dialog open={chooseDayOpen} onClose={() => !starting && setChooseDayOpen(false)} fullWidth maxWidth="xs" aria-labelledby="choose-training-day-title">
      <DialogTitle id="choose-training-day-title">{t('schedule.changeDay')}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <TextField select fullWidth label={t('routines.trainingDay')} value={chosenDayId} disabled={starting}
          onChange={event => setChosenDayId(event.target.value)}>
          {nextRoutine?.days?.map(day => <MenuItem key={day.id} value={day.id} disabled={!day.exercises.length}>{day.name}</MenuItem>)}
        </TextField>
        <Typography variant="body2" color="text.secondary">{t(swap && pending[0]?.day ? swap.fromDate ? 'schedule.swapHint' : 'schedule.extraDayHint' : 'schedule.chooseDayHint', {
          day: pending[0]?.day?.name, date: swap?.fromDate,
        })}</Typography>
        {startError && <Alert severity="error">{t('schedule.startError')}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={starting} onClick={() => setChooseDayOpen(false)}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={starting || !chosenDay?.exercises.length} onClick={() => { void confirmDay(); }}>
          {t(starting ? 'routines.startingSession' : swap?.fromDate ? 'schedule.swapAndStart' : 'dashboard.startWorkout')}
        </Button></DialogActions>
    </Dialog>
  </Container>;
}
