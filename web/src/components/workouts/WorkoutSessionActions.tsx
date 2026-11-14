import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useAuthStore } from '../../store/authStore';
import { deleteWorkoutSession, editWorkoutSession } from '../../firebase/firestore';
import { sessionVolume } from '../../lib/workout';
import { elapsedSeconds } from '../../lib/workoutTime';
import type { WeightUnit } from '../../lib/units';
import type { WorkoutSession, WorkoutSessionEdit } from '../../types/routine';
import WorkoutSessionEditor from './WorkoutSessionEditor';

interface Props {
  session: WorkoutSession;
  preferredUnit: WeightUnit;
  disabled?: boolean;
  allowDelete?: boolean;
  showSuccess?: boolean;
  beforeEdit?: () => Promise<WorkoutSession>;
  onSaved: (session: WorkoutSession) => void;
  onDeleted: () => void;
}

/** Explicit buffered edits leave completed records unchanged until Save. */
export default function WorkoutSessionActions({ session, preferredUnit, disabled, allowDelete = true,
  showSuccess = true, beforeEdit, onSaved, onDeleted }: Props) {
  const { t } = useTranslation();
  const uid = useAuthStore(state => state.currentUser?.uid);
  const [editing, setEditing] = useState<WorkoutSession | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const edit = async () => {
    setBusy(true); setError(''); setSuccess(false);
    try { setEditing(beforeEdit ? await beforeEdit() : session); }
    catch { setError(t('workoutManagement.saveError')); }
    finally { setBusy(false); }
  };
  const save = async (data: WorkoutSessionEdit) => {
    if (!uid || busy || !editing) return;
    setBusy(true); setError('');
    try {
      await editWorkoutSession(uid, session.id, data, preferredUnit);
      const next = { ...editing, ...data, total_volume_kg: sessionVolume(data.exercises) };
      const duration = elapsedSeconds(next);
      onSaved({ ...next, ...(next.status === 'completed' && duration != null
        ? { duration_sec: duration, duration_min: Math.round(duration / 60) } : {}) });
      setEditing(null); setSuccess(true);
    } catch { setError(t('workoutManagement.saveError')); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!uid || busy) return;
    setBusy(true); setError('');
    try {
      await deleteWorkoutSession(uid, session.id, preferredUnit);
      setConfirmDelete(false); onDeleted();
    } catch { setError(t('workoutManagement.deleteError')); }
    finally { setBusy(false); }
  };
  return <Stack spacing={1.25}>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
      <Button variant="outlined" startIcon={<EditIcon />} disabled={disabled || busy}
        sx={{ minHeight: 44, flex: 1 }} onClick={() => { void edit(); }}>{t('workoutManagement.edit')}</Button>
      {allowDelete && <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} disabled={disabled || busy}
        sx={{ minHeight: 44, flex: 1 }} onClick={() => { setError(''); setSuccess(false); setConfirmDelete(true); }}>
        {t('workoutManagement.delete')}</Button>}
    </Stack>
    {success && showSuccess && <Alert severity="success" onClose={() => setSuccess(false)}>{t('workoutManagement.saved')}</Alert>}
    {error && !editing && !confirmDelete && <Alert severity="error">{error}</Alert>}
    {editing && <WorkoutSessionEditor open session={editing} defaultUnit={preferredUnit} saving={busy}
      error={error} onClose={() => { if (!busy) { setEditing(null); setError(''); } }}
      onSave={data => { void save(data); }} />}
    <Dialog open={confirmDelete} onClose={() => { if (!busy) setConfirmDelete(false); }} fullWidth maxWidth="xs"
      aria-labelledby={`delete-workout-${session.id}`}>
      <DialogTitle id={`delete-workout-${session.id}`}>{t('workoutManagement.deleteTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography fontWeight={600}>{session.routine_name}</Typography>
          <Typography variant="body2">{[session.day_name, session.date].filter(Boolean).join(' · ')}</Typography>
          <Typography>{t('workoutManagement.deleteHint')}</Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1,
        alignItems: { xs: 'stretch', sm: 'center' } }}>
        <Button disabled={busy} sx={{ minHeight: 44 }} onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
        <Button color="error" variant="contained" disabled={busy} sx={{ minHeight: 44 }} onClick={() => { void remove(); }}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineIcon />}>{t('workoutManagement.delete')}</Button>
      </DialogActions>
    </Dialog>
  </Stack>;
}
