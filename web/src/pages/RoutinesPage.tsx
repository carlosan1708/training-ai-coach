import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import DeleteIcon from '@mui/icons-material/Delete';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import HistoryIcon from '@mui/icons-material/History';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { useAuthStore } from '../store/authStore';
import { getRoutines, addRoutine, deleteRoutine } from '../firebase/firestore';
import { generateRoutineFn } from '../firebase/callables';
import { loadConvention } from '../lib/loadBasis';
import { loadExerciseLibrary, matchExercise } from '../lib/exerciseLibrary';
import ExerciseGif from '../components/ExerciseGif';
import WorkoutWeightPreference from '../components/WorkoutWeightPreference';
import PageHeader from '../components/layout/PageHeader';
import { PreferredRoutineButton } from '../components/routines/RoutineScheduleControls';
import type { Routine, RoutineExercise } from '../types/routine';

export default function RoutinesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // AI generation dialog
  const [aiOpen, setAiOpen] = useState(false);
  const [focus, setFocus] = useState('');
  const [aiNotes, setAiNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState('');

  // Manual creation dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Routine | null>(null);
  const [deleteError, setDeleteError] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setLoadError(false);
    try {
      setRoutines(await getRoutines(currentUser.uid));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleGenerate = async () => {
    if (!currentUser) return;
    setGenerating(true);
    setAiError('');
    try {
      const result = await generateRoutineFn({ focus, notes: aiNotes });
      const generated = result.data.routine;

      // Attach demo images by matching AI names against the library
      let exercises: RoutineExercise[] = generated.exercises.map((e) => ({
        ...loadConvention(e),
        name: e.name,
        muscle_group: e.muscle_group,
        sets: e.sets || 3,
        reps: e.reps || 10,
        weight_kg: e.weight_kg ?? undefined,
        rest_sec: e.rest_sec,
        notes: e.notes,
      }));
      try {
        const library = await loadExerciseLibrary();
        exercises = exercises.map((e) => {
          const match = matchExercise(library, e.name);
          return match
            ? {
                ...e,
                images: match.images,
                library_id: match.id,
                muscle_group: e.muscle_group ?? match.primaryMuscles[0],
                instructions: match.instructions.slice(0, 4),
              }
            : e;
        });
      } catch {
        // library unavailable — routine still works without images
      }

      const id = await addRoutine(currentUser.uid, {
        name: generated.name || t('routines.untitled'),
        description: generated.description ?? '',
        exercises,
        session_count: 0,
      });
      setAiOpen(false);
      navigate(`/routines/${id}`);
    } catch {
      setAiError(t('routines.generateError'));
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!currentUser || !newName.trim()) return;
    setCreating(true);
    setCreateError(false);
    try {
      const id = await addRoutine(currentUser.uid, {
        name: newName.trim(),
        description: '',
        exercises: [],
        session_count: 0,
      });
      setCreateOpen(false);
      navigate(`/routines/${id}`);
    } catch {
      setCreateError(true);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!currentUser || !deleteTarget || deleting) return;
    setDeleting(true); setDeleteError(false);
    try {
      await deleteRoutine(currentUser.uid, deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
    } catch { setDeleteError(true); }
    finally { setDeleting(false); }
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>;
  }

  const creationCard = (
<Card sx={{ bgcolor: '#eee7fc', borderColor: '#e0d5f5' }}><CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Box><Typography component="h2" variant="h6">{t('redesign.train.makeItYours')}</Typography><Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>{t('redesign.train.createHint')}</Typography></Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flexShrink: 0 }}>
          <Button
            variant="contained"
            startIcon={<AutoFixHighIcon />}
            onClick={() => setAiOpen(true)}
            sx={{ flex: 1, whiteSpace: 'nowrap' }}
          >
            {t('routines.generateAi')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => { setNewName(''); setCreateError(false); setCreateOpen(true); }}
            sx={{ flex: 1, whiteSpace: 'nowrap' }}
          >
            {t('routines.createManual')}
          </Button>
        </Stack>
          </Stack>
        </CardContent></Card>
  );

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, sm: 3, md: 4 } }}>
      <Stack spacing={3}>
        <PageHeader eyebrow={t('redesign.train.eyebrow')} title={t('routines.title')} description={t('redesign.train.description')}
          action={<Button variant="outlined" startIcon={<HistoryIcon />} onClick={() => navigate('/workout-history')}>{t('workoutHistory.title')}</Button>} />
        {routines.length === 0 && creationCard}
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between" gap={2}>
          <Typography component="h2" variant="h6">{t('redesign.train.yourRoutines')} <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, fontSize: 15 }}>({routines.length})</Box></Typography>
          <Box sx={{ width: { xs: '100%', sm: 290 } }}><WorkoutWeightPreference /></Box>
        </Stack>

        {loadError && (
          <Alert severity="error" action={<Button color="inherit" onClick={refresh}>{t('routines.retry')}</Button>}>
            {t('routines.loadError')}
          </Alert>
        )}
        {!loadError && routines.length === 0 && (
          <Card variant="outlined" sx={{ textAlign: 'center', py: 6, px: 3 }}>
            <Box sx={{ width: 72, height: 72, bgcolor: '#f0e8fc', borderRadius: '50%', mx: 'auto', display: 'grid', placeItems: 'center', mb: 2 }}><FitnessCenterIcon sx={{ fontSize: 34, color: 'primary.main' }} /></Box>
            <Typography variant="h6">{t('redesign.train.emptyTitle')}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 420, mx: 'auto' }}>
              {t('routines.empty')}
            </Typography>
          </Card>
        )}

        <Grid container spacing={2.5}>{routines.map((routine, index) => {
          const allExercises = routine.days?.length ? routine.days.flatMap(day => day.exercises) : routine.exercises;
          const tint = ['#efe7fc', '#e5f3eb', '#fff0e7'][index % 3];
          return <Grid key={routine.id} size={{ xs: 12, sm: 6, xl: 4 }}><Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', transition: 'transform 160ms, box-shadow 160ms', '&:hover': { transform: 'translateY(-3px)', boxShadow: '0 12px 32px #38225b0b' } }}>
            <CardActionArea onClick={() => navigate(`/routines/${routine.id}`)} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' }}>
              <Box sx={{ px: 3, py: 2.5, bgcolor: tint, display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 115 }}>
                <Stack direction="row" spacing={-1.5}>{allExercises.slice(0, 3).map((ex, i) => <Box key={i} sx={{ border: '3px solid #fff', borderRadius: 3, overflow: 'hidden', zIndex: 3 - i, bgcolor: '#fff' }}><ExerciseGif gifUrl={ex.gif_url} images={ex.images} size={57} animate={false} /></Box>)}</Stack>
                {!allExercises.length && <FitnessCenterIcon sx={{ fontSize: 42, color: 'primary.light' }} />}
                <ArrowForwardRoundedIcon sx={{ color: 'text.secondary' }} />
              </Box>
              <CardContent sx={{ width: '100%' }}>
                <Typography component="h3" variant="h6" sx={{ overflowWrap: 'anywhere', mb: 0.75 }}>{routine.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 44 }}>{routine.description || t('redesign.train.routineHint')}</Typography>
                <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 2 }}>
                  {!!routine.days?.length && <Chip size="small" label={t('routines.dayCount', { count: routine.days.length })} />}
                  <Chip size="small" label={t('routines.exerciseCount', { count: allExercises.length })} />
                  {(routine.session_count ?? 0) > 0 && <Chip size="small" label={t('routines.sessionCount', { count: routine.session_count })} />}
                </Stack>
              </CardContent>
            </CardActionArea>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pl: 3, pr: 1, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
              <Box sx={{ minWidth: 0 }}><PreferredRoutineButton routine={routine} /><Typography variant="caption" color="text.secondary" display="block">{routine.last_session_at ? t('routines.lastDone', { date: routine.last_session_at }) : t('redesign.train.ready')}</Typography></Box>
              <IconButton size="small" aria-label={t('common.delete')} onClick={() => { setDeleteTarget(routine); setDeleteError(false); }} sx={{ color: 'text.secondary', '&:hover': { color: 'error.main', bgcolor: '#fff0ef' } }}><DeleteIcon fontSize="small" /></IconButton>
            </Stack>
          </Card></Grid>;
        })}</Grid>
        {routines.length > 0 && creationCard}
      </Stack>

      {/* ── AI generation dialog ── */}
      <Dialog open={aiOpen} onClose={() => !generating && setAiOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('routines.generateAi')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('routines.generateHint')}
            </Typography>
            <TextField
              label={t('routines.focus')}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder={t('routines.focusPlaceholder')}
              size="small" fullWidth autoFocus
            />
            <TextField
              label={t('exerciseLog.notes')}
              value={aiNotes}
              onChange={(e) => setAiNotes(e.target.value)}
              placeholder={t('routines.notesPlaceholder')}
              size="small" fullWidth multiline rows={2}
            />
            {aiError && <Alert severity="error">{aiError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiOpen(false)} disabled={generating}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={generating}
            startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />}
          >
            {generating ? t('routines.generating') : t('routines.generate')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Manual creation dialog ── */}
      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('routines.createManual')}</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{t('redesign.train.createError')}</Alert>}
          <TextField
            label={t('routines.routineName')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            size="small" fullWidth autoFocus sx={{ mt: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreate} disabled={creating || !newName.trim()}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} fullWidth maxWidth="xs" aria-labelledby="delete-routine-title">
        <DialogTitle id="delete-routine-title">{t('redesign.train.deleteTitle')}</DialogTitle>
        <DialogContent><Typography>{t('routines.deleteConfirm', { name: deleteTarget?.name })}</Typography>{deleteError && <Alert severity="error" sx={{ mt: 2 }}>{t('common.error')}</Alert>}</DialogContent>
        <DialogActions><Button disabled={deleting} onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button><Button color="error" variant="contained" disabled={deleting} onClick={() => { void handleDelete(); }}>{t('common.delete')}</Button></DialogActions>
      </Dialog>
    </Container>
  );
}
