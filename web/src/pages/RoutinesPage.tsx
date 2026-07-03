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
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import DeleteIcon from '@mui/icons-material/Delete';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import { useAuthStore } from '../store/authStore';
import { getRoutines, addRoutine, deleteRoutine } from '../firebase/firestore';
import { loadExerciseLibrary, matchExercise } from '../lib/exerciseLibrary';
import ExerciseGif from '../components/ExerciseGif';
import type { GeneratedRoutine, Routine, RoutineExercise } from '../types/routine';

const generateRoutineFn = httpsCallable<
  { focus: string; notes?: string },
  { routine: GeneratedRoutine }
>(functions, 'generate_routine');

export default function RoutinesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);

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

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      setRoutines(await getRoutines(currentUser.uid));
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
    try {
      const id = await addRoutine(currentUser.uid, {
        name: newName.trim(),
        description: '',
        exercises: [],
        session_count: 0,
      });
      setCreateOpen(false);
      navigate(`/routines/${id}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (routine: Routine) => {
    if (!currentUser) return;
    if (!window.confirm(t('routines.deleteConfirm', { name: routine.name }))) return;
    await deleteRoutine(currentUser.uid, routine.id);
    refresh();
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>;
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h5" fontWeight={700}>{t('routines.title')}</Typography>
        </Stack>

        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            startIcon={<AutoFixHighIcon />}
            onClick={() => setAiOpen(true)}
            sx={{ flex: 1 }}
          >
            {t('routines.generateAi')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => { setNewName(''); setCreateOpen(true); }}
            sx={{ flex: 1 }}
          >
            {t('routines.createManual')}
          </Button>
        </Stack>

        {routines.length === 0 && (
          <Card variant="outlined" sx={{ textAlign: 'center', py: 6 }}>
            <FitnessCenterIcon sx={{ fontSize: 48, color: 'grey.400' }} />
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {t('routines.empty')}
            </Typography>
          </Card>
        )}

        {routines.map((routine) => (
          <Card key={routine.id} variant="outlined">
            <CardActionArea onClick={() => navigate(`/routines/${routine.id}`)}>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={2}>
                  <Stack direction="row" spacing={-1.5}>
                    {routine.exercises.slice(0, 3).map((ex, i) => (
                      <Box key={i} sx={{ border: '2px solid white', borderRadius: 2, zIndex: 3 - i }}>
                        <ExerciseGif gifUrl={ex.gif_url} images={ex.images} size={52} animate={false} />
                      </Box>
                    ))}
                  </Stack>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight={600} noWrap>
                      {routine.name}
                    </Typography>
                    {routine.description && (
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {routine.description}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                      <Chip size="small" label={t('routines.exerciseCount', { count: routine.exercises.length })} />
                      {(routine.session_count ?? 0) > 0 && (
                        <Chip size="small" label={t('routines.sessionCount', { count: routine.session_count })} />
                      )}
                      {routine.last_session_at && (
                        <Chip size="small" variant="outlined" label={t('routines.lastDone', { date: routine.last_session_at })} />
                      )}
                    </Stack>
                  </Box>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={(e) => { e.stopPropagation(); handleDelete(routine); }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
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
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('routines.createManual')}</DialogTitle>
        <DialogContent>
          <TextField
            label={t('routines.routineName')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            size="small" fullWidth autoFocus sx={{ mt: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreate} disabled={creating || !newName.trim()}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
