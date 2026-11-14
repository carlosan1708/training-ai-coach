import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Grid,
  IconButton,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import SaveIcon from '@mui/icons-material/Save';
import { serverTimestamp } from 'firebase/firestore';
import { useAuthStore } from '../../store/authStore';
import { upsertDailyLog } from '../../firebase/firestore';
import { parseExercisePhotoFn as parseExercisePhoto } from '../../firebase/callables';
import { useDailyLog } from '../../hooks/useDailyLog';
import type { ExerciseLogEntry } from '../../types/log';
import WeightField from '../../components/WeightField';
import RepsField from '../../components/RepsField';
import ExerciseAutocomplete from '../../components/ExerciseAutocomplete';
import { useProfileStore } from '../../store/profileStore';
import { getExerciseWeightUnit } from '../../lib/units';

interface Props { date: string }

const emptyExercise = (): ExerciseLogEntry => ({
  exercise: '',
  sets: undefined,
  reps: undefined,
  duration_min: undefined,
  notes: '',
});

export default function ExerciseTab({ date }: Props) {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const profile = useProfileStore(state => state.profile);
  const { log, loading, error, retry } = useDailyLog(date);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<ExerciseLogEntry[]>([emptyExercise()]);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (!loading) setEntries(log?.exercise_log?.length ? log.exercise_log : [emptyExercise()]);
  }, [log, loading]);

  // ── Photo handling ────────────────────────────────────────────────────────

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!photoPreview) return;
    setAnalyzing(true);
    setAnalyzeError('');
    try {
      // photoPreview is "data:image/jpeg;base64,..."
      const [header, imageData] = photoPreview.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
      const result = await parseExercisePhoto({ imageData, mimeType });
      if (result.data.exercises.length > 0) {
        setEntries(result.data.exercises);
      } else {
        setAnalyzeError(t('exerciseLog.noDataFound'));
      }
    } catch {
      setAnalyzeError(t('exerciseLog.analyzeError'));
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Entry editing ─────────────────────────────────────────────────────────

  const updateEntry = (index: number, field: keyof ExerciseLogEntry, value: string | number) =>
    setEntries((prev) => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));

  const addEntry = () => setEntries((prev) => [...prev, emptyExercise()]);

  const removeEntry = (index: number) =>
    setEntries((prev) => prev.filter((_, i) => i !== index));

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!currentUser || loading || error) return;
    setSaving(true);
    setSaveError(false);
    try {
      const validEntries = entries.filter((e) => e.exercise.trim());
      await upsertDailyLog(currentUser.uid, date, {
        exercise_log: validEntries,
        updated_at: serverTimestamp(),
        ...(!log ? { date, created_at: serverTimestamp() } : {}),
      });
      setSaved(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>;
  if (error) return <Container maxWidth="sm" sx={{ py: 3 }}><Alert severity="error"
    action={<Button onClick={retry}>{t('routines.retry')}</Button>}>{t('common.error')}</Alert></Container>;

  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Stack spacing={3}>
        {saveError && <Alert severity="error">{t('common.error')}</Alert>}

        {/* ── Photo capture section ── */}
        <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="subtitle1" fontWeight={600}>
                <AutoFixHighIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                {t('exerciseLog.photoTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('exerciseLog.photoHint')}
              </Typography>

              {/* Photo preview */}
              {photoPreview && (
                <Box
                  component="img"
                  src={photoPreview}
                  alt="workout"
                  sx={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 2 }}
                />
              )}

              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<CameraAltIcon />}
                  onClick={() => fileInputRef.current?.click()}
                  sx={{ flex: 1 }}
                >
                  {photoPreview ? t('exerciseLog.changePhoto') : t('exerciseLog.takePhoto')}
                </Button>

                {photoPreview && (
                  <Button
                    variant="contained"
                    startIcon={analyzing ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />}
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    sx={{ flex: 1 }}
                  >
                    {analyzing ? t('exerciseLog.analyzing') : t('exerciseLog.analyzePhoto')}
                  </Button>
                )}
              </Stack>

              {analyzeError && <Alert severity="warning">{analyzeError}</Alert>}
            </Stack>
          </CardContent>
        </Card>

        {/* Hidden file input — capture="environment" opens camera on mobile */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handlePhotoChange}
        />

        {/* ── Exercise entries ── */}
        <Typography variant="subtitle1" fontWeight={600}>
          {t('exerciseLog.exercises')} ({entries.length})
        </Typography>

        {entries.map((entry, idx) => (
          <Card key={idx} variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <ExerciseAutocomplete
                    label={t('exerciseLog.exercise')}
                    value={entry.exercise}
                    disabled={saving}
                    gifUrl={entry.gif_url} images={entry.images}
                    onChange={exercise => setEntries(previous => previous.map((item, index) => index === idx
                      ? { ...item, exercise,
                        ...(exercise !== item.exercise ? { library_id: undefined, gif_url: undefined, images: undefined } : {}) }
                      : item))}
                    onSelect={selected => setEntries(previous => previous.map((item, index) => index === idx
                      ? { ...item, exercise: selected.name, library_id: selected.id, images: [...selected.images], gif_url: undefined }
                      : item))}
                  />
                  <Tooltip title={t('exerciseLog.remove')}>
                    <IconButton size="small" color="error" onClick={() => removeEntry(idx)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>

                <Grid container spacing={1}>
                  <Grid size={{ xs: 6 }}>
                    <TextField
                      label={t('exerciseLog.sets')}
                      type="number"
                      value={entry.sets ?? ''}
                      onChange={(e) => updateEntry(idx, 'sets', Number(e.target.value))}
                      size="small" fullWidth
                      inputProps={{ min: 0 }}
                    />
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <RepsField
                      label={t('exerciseLog.reps')}
                      value={entry.reps}
                      onChange={reps => updateEntry(idx, 'reps', reps)}
                    />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <WeightField valueKg={entry.weight_kg}
                      unit={getExerciseWeightUnit(profile, entry)}
                      onUnitChange={unit => setEntries(previous => previous.map((item, index) =>
                        index === idx ? { ...item, weight_unit: unit, weight_unit_override: true } : item))}
                      onChange={kilograms => setEntries(previous => previous.map((item, index) =>
                        index === idx ? { ...item, weight_kg: kilograms } : item))} />
                  </Grid>
                </Grid>

                <TextField
                  label={t('exerciseLog.notes')}
                  value={entry.notes ?? ''}
                  onChange={(e) => updateEntry(idx, 'notes', e.target.value)}
                  size="small" fullWidth
                  placeholder={t('exerciseLog.notesHint')}
                />
              </Stack>
            </CardContent>
          </Card>
        ))}

        <Button variant="outlined" startIcon={<AddIcon />} onClick={addEntry}>
          {t('exerciseLog.addExercise')}
        </Button>

        <Button
          variant="contained" size="large"
          startIcon={saving ? <CircularProgress size={18} /> : <SaveIcon />}
          onClick={handleSave} disabled={saving}
        >
          {t('exerciseLog.save')}
        </Button>
      </Stack>

      <Snackbar open={saved} autoHideDuration={3000} onClose={() => setSaved(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setSaved(false)}>{t('exerciseLog.saved')}</Alert>
      </Snackbar>
    </Container>
  );
}
