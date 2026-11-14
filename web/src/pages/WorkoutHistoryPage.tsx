import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Container, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HistoryIcon from '@mui/icons-material/History';
import FilterListIcon from '@mui/icons-material/FilterList';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import { getWorkoutSession, getWorkoutSessions } from '../firebase/firestore';
import { getWorkoutWeightUnit } from '../lib/units';
import { compareWorkoutSessionsNewestFirst } from '../lib/sessionOrder';
import WorkoutSessionSummary from '../components/workouts/WorkoutSessionSummary';
import WorkoutWeightPreference from '../components/WorkoutWeightPreference';
import type { WorkoutSession } from '../types/routine';

const normalize = (value: string) => value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function WorkoutHistoryPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const { profile } = useProfileStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRoutine = searchParams.get('routine') || '';
  const selectedDay = searchParams.get('day') || '';
  const selectedSession = searchParams.get('session') || '';
  const justSaved = searchParams.get('saved') === '1';
  const justDeleted = searchParams.get('deleted') === '1';
  const [loaded, setLoaded] = useState<{ uid: string; sessions: WorkoutSession[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedMissing, setSelectedMissing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [requestedCount, setRequestedCount] = useState(100);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editSaved, setEditSaved] = useState(false);
  const uid = currentUser?.uid;
  const preferredUnit = getWorkoutWeightUnit(profile);
  const invalidRange = Boolean(fromDate && toDate && fromDate > toDate);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      setError(false);
      setSelectedMissing(false);
      try {
        const next = await getWorkoutSessions(uid, requestedCount);
        // A completion link always resolves its exact session, even when the
        // current history page is limited to the most recent 100 workouts.
        if (selectedSession && !next.some(session => session.id === selectedSession)) {
          const selected = await getWorkoutSession(uid, selectedSession);
          if (selected) next.push(selected);
          else if (!cancelled) setSelectedMissing(true);
        }
        if (!cancelled) setLoaded({ uid, sessions: next });
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [uid, requestedCount, retry, selectedSession]);

  const sessions = useMemo(() => loaded?.uid === uid ? loaded?.sessions ?? [] : [], [loaded, uid]);
  const savedSession = justSaved && selectedSession && sessions.find(session => session.id === selectedSession && session.status === 'completed');
  const routines = useMemo(() => {
    const names = new Map<string, string>();
    for (const session of sessions) {
      if (session.routine_id && !names.has(session.routine_id)) names.set(session.routine_id, session.routine_name || t('workoutHistory.unnamedRoutine'));
    }
    return names;
  }, [sessions, t]);
  const days = useMemo(() => {
    const names = new Map<string, string>();
    for (const session of sessions) {
      if ((!selectedRoutine || session.routine_id === selectedRoutine) && session.day_id && !names.has(session.day_id)) {
        names.set(session.day_id, session.day_name || t('workoutHistory.selectedDay'));
      }
    }
    return names;
  }, [sessions, selectedRoutine, t]);
  const filtered = useMemo(() => {
    const query = normalize(search.trim());
    return sessions.filter((session) => {
      if (selectedRoutine && session.routine_id !== selectedRoutine) return false;
      if (selectedDay && session.day_id !== selectedDay) return false;
      if (status !== 'all' && session.status !== status) return false;
      if (fromDate && session.date < fromDate) return false;
      if (toDate && session.date > toDate) return false;
      return !query || normalize([session.routine_name, session.day_name,
        ...(session.exercises ?? []).map((exercise) => exercise.name)].filter(Boolean).join(' ')).includes(query);
    }).sort(compareWorkoutSessionsNewestFirst);
  }, [sessions, search, status, fromDate, toDate, selectedRoutine, selectedDay]);
  const hasFilters = Boolean(search || status !== 'all' || fromDate || toDate || selectedRoutine || selectedDay || selectedSession);
  const clearFilters = () => { setSearch(''); setStatus('all'); setFromDate(''); setToDate(''); setSearchParams({}); };
  const initialLoading = loading && !sessions.length;
  const advancedFilterCount = [selectedRoutine, selectedDay, status !== 'all', fromDate, toDate].filter(Boolean).length;

  return (
    <Container maxWidth="sm" sx={{ py: 3, pb: 12 }}>
      <Stack spacing={2.5}>
        <Stack direction="row" justifyContent="space-between" gap={1}>
          <Button component={RouterLink} to="/routines" startIcon={<ArrowBackIcon />}
            sx={{ minHeight: 44 }}>{t('workoutHistory.back')}</Button>
          <Button startIcon={<RefreshIcon />} onClick={() => setRetry(value => value + 1)} disabled={loading}
            sx={{ minHeight: 44 }}>{t('workoutHistory.refresh')}</Button>
        </Stack>
        <Box>
          <Typography variant="h5" component="h1" fontWeight={800}>{t('workoutHistory.title')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{t('workoutHistory.description')}</Typography>
        </Box>
        <WorkoutWeightPreference />
        {savedSession && <Alert severity="success">{t('workoutHistory.workoutSaved')}</Alert>}
        {justDeleted && <Alert severity="success">{t('workoutManagement.deleted')}</Alert>}
        {editSaved && <Alert severity="success" onClose={() => setEditSaved(false)}>{t('workoutManagement.saved')}</Alert>}
        {selectedMissing && !error && <Alert severity="warning">{t('workoutHistory.sessionMissing')}</Alert>}
        {error && <Alert severity="error" action={<Button color="inherit" onClick={() => setRetry((value) => value + 1)} sx={{ minHeight: 44 }}>
          {t('workoutHistory.retry')}
        </Button>}>{t('workoutHistory.loadError')}</Alert>}
        {initialLoading ? <Stack alignItems="center" spacing={2} sx={{ py: 5 }} role="status">
          <CircularProgress aria-label={t('workoutHistory.loading')} />
          <Typography variant="body2">{t('workoutHistory.loading')}</Typography>
        </Stack> : !sessions.length && !error ? <Box sx={{ textAlign: 'center', py: 4, px: 1 }}>
          <HistoryIcon color="disabled" sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="h6" component="h2">{t('workoutHistory.emptyTitle')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>{t('workoutHistory.emptyDescription')}</Typography>
          <Button component={RouterLink} to="/routines" variant="contained" sx={{ minHeight: 48 }}>{t('workoutHistory.browseRoutines')}</Button>
        </Box> : sessions.length > 0 && <>
          <Box component="section" aria-label={t('workoutHistory.filters')}>
            <Stack spacing={1.25}>
              <TextField label={t('workoutHistory.search')} value={search} fullWidth
                onChange={(event) => setSearch(event.target.value)} type="search" />
              <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                <Typography variant="body2" color="text.secondary" role="status" aria-live="polite">
                  {t('workoutHistory.resultCount', { count: filtered.length })}
                </Typography>
                <Button onClick={() => setFiltersOpen((value) => !value)} startIcon={<FilterListIcon />}
                  endIcon={filtersOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  aria-label={t('workoutHistory.filtersButton')} aria-expanded={filtersOpen}
                  aria-controls="workout-history-filters" sx={{ minHeight: 44, flexShrink: 0 }}>
                  {t('workoutHistory.filtersButton')}{advancedFilterCount ? ` (${advancedFilterCount})` : ''}
                </Button>
              </Stack>
              {hasFilters && <Stack direction="row" gap={0.75} alignItems="center" flexWrap="wrap">
                {selectedRoutine && <Chip size="small" variant="outlined" sx={{ maxWidth: '100%' }}
                  label={routines.get(selectedRoutine) || t('workoutHistory.selectedRoutine')} />}
                {selectedDay && <Chip size="small" variant="outlined" sx={{ maxWidth: '100%' }}
                  label={days.get(selectedDay) || t('workoutHistory.selectedDay')} />}
                {status !== 'all' && <Chip size="small" variant="outlined" label={t(`workoutHistory.${status === 'active' ? 'active' : 'completed'}`)} />}
                {(fromDate || toDate) && <Chip size="small" variant="outlined" label={`${fromDate || '…'} – ${toDate || '…'}`} />}
                <Button onClick={clearFilters} size="small" sx={{ minHeight: 44 }}>{t('workoutHistory.clearFilters')}</Button>
              </Stack>}
              <Collapse in={filtersOpen} unmountOnExit id="workout-history-filters">
              <Stack spacing={1.75} sx={{ pt: 0.5, pb: 1 }}>
              <TextField label={t('workoutHistory.routine')} select value={selectedRoutine} fullWidth
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams);
                  if (event.target.value) next.set('routine', event.target.value); else next.delete('routine');
                  next.delete('day');
                  setSearchParams(next);
                }}>
                <MenuItem value="" sx={{ minHeight: 44 }}>{t('workoutHistory.allRoutines')}</MenuItem>
                {selectedRoutine && !routines.has(selectedRoutine) && <MenuItem value={selectedRoutine}>{t('workoutHistory.selectedRoutine')}</MenuItem>}
                {[...routines].map(([id, name]) => <MenuItem key={id} value={id} sx={{ minHeight: 44, whiteSpace: 'normal' }}>{name}</MenuItem>)}
              </TextField>
              {(selectedRoutine || selectedDay) && <TextField label={t('workoutHistory.day')} select value={selectedDay} fullWidth
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams);
                  if (event.target.value) next.set('day', event.target.value); else next.delete('day');
                  setSearchParams(next);
                }}>
                <MenuItem value="" sx={{ minHeight: 44 }}>{t('workoutHistory.allDays')}</MenuItem>
                {selectedDay && !days.has(selectedDay) && <MenuItem value={selectedDay}>{t('workoutHistory.selectedDay')}</MenuItem>}
                {[...days].map(([id, name]) => <MenuItem key={id} value={id} sx={{ minHeight: 44, whiteSpace: 'normal' }}>{name}</MenuItem>)}
              </TextField>}
              <TextField label={t('workoutHistory.status')} select value={status} fullWidth
                onChange={(event) => setStatus(event.target.value)}>
                <MenuItem value="all" sx={{ minHeight: 44 }}>{t('workoutHistory.allStatuses')}</MenuItem>
                <MenuItem value="completed" sx={{ minHeight: 44 }}>{t('workoutHistory.completed')}</MenuItem>
                <MenuItem value="active" sx={{ minHeight: 44 }}>{t('workoutHistory.active')}</MenuItem>
              </TextField>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
                <TextField label={t('workoutHistory.fromDate')} type="date" value={fromDate} fullWidth
                  onChange={(event) => setFromDate(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: toDate || undefined, style: { minWidth: 0 } } }}
                  sx={{ '& .MuiInputBase-input': { px: 1.25 } }} />
                <TextField label={t('workoutHistory.toDate')} type="date" value={toDate} fullWidth error={invalidRange}
                  onChange={(event) => setToDate(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: fromDate || undefined, style: { minWidth: 0 } } }}
                  sx={{ '& .MuiInputBase-input': { px: 1.25 } }} />
              </Box>
              {invalidRange && <Alert severity="warning">{t('workoutHistory.invalidRange')}</Alert>}
              </Stack>
              </Collapse>
            </Stack>
          </Box>
          {!filtered.length && <Alert severity="info">{t('workoutHistory.noResults')}</Alert>}
          <Stack spacing={1.5}>
            {filtered.map((session) => <WorkoutSessionSummary key={`${session.id}-${selectedSession === session.id ? 'selected' : ''}`}
              session={session} preferredUnit={preferredUnit} initiallyExpanded={selectedSession === session.id}
              onSaved={updated => {
                setLoaded(previous => previous ? { ...previous,
                  sessions: previous.sessions.map(saved => saved.id === updated.id ? updated : saved) } : previous);
                setSearch(''); setStatus('all'); setFromDate(''); setToDate('');
                setSearchParams({ session: updated.id }); setEditSaved(true);
              }}
              onDeleted={deleted => {
                setLoaded(previous => previous ? { ...previous,
                  sessions: previous.sessions.filter(saved => saved.id !== deleted.id) } : previous);
                const next = new URLSearchParams(searchParams);
                if (next.get('session') === deleted.id) next.delete('session');
                next.delete('saved'); next.set('deleted', '1'); setSearchParams(next);
                setEditSaved(false);
              }} />)}
          </Stack>
          {sessions.length >= requestedCount && <Button variant="outlined" disabled={loading}
            onClick={() => setRequestedCount((value) => value + 100)} sx={{ minHeight: 48 }}>
            {t(loading ? 'workoutHistory.loading' : 'workoutHistory.loadMore')}
          </Button>}
        </>}
      </Stack>
    </Container>
  );
}
