import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Slider,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { serverTimestamp } from 'firebase/firestore';
import { useAuthStore } from '../../store/authStore';
import { upsertDailyLog } from '../../firebase/firestore';
import { useDailyLog } from '../../hooks/useDailyLog';
import WeightField from '../../components/WeightField';

interface Props { date: string }

export default function DailyTab({ date }: Props) {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const { log, loading, error, retry } = useDailyLog(date);

  const [weight, setWeight] = useState<number | undefined>();
  const [energy, setEnergy] = useState(3);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (loading) return;
    setWeight(log?.weight_kg ?? undefined);
    setEnergy(log?.energy ?? 3);
    setNotes(log?.notes ?? '');
  }, [log, loading]);

  const handleSave = async () => {
    if (!currentUser || loading || error) return;
    setSaving(true);
    setSaveError(false);
    try {
      await upsertDailyLog(currentUser.uid, date, {
        date,
        weight_kg: weight ?? null,
        energy,
        notes,
        updated_at: serverTimestamp(),
        ...(!log ? { created_at: serverTimestamp(), measurements: {}, food_log: [], exercise_log: [] } : {}),
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
        <WeightField valueKg={weight} onChange={setWeight} unit="kg" showUnitToggle={false}
          label={t('weightInput.bodyWeight')} preferenceKey="body-weight" />
        <Box>
          <Typography gutterBottom>
            {t('dailyLog.energy')}: <strong>{energy} — {t(`dailyLog.energyLabels.${energy}`)}</strong>
          </Typography>
          <Slider
            min={1} max={5} step={1} marks
            value={energy}
            onChange={(_, v) => setEnergy(v as number)}
          />
        </Box>
        <TextField
          label={t('dailyLog.notes')}
          helperText={t('dailyLog.notesHint')}
          multiline rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          fullWidth
        />
        <Button
          variant="contained" size="large"
          startIcon={saving ? <CircularProgress size={18} /> : <SaveIcon />}
          onClick={handleSave} disabled={saving}
        >
          {t('dailyLog.save')}
        </Button>
      </Stack>

      <Snackbar open={saved} autoHideDuration={3000} onClose={() => setSaved(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setSaved(false)}>{t('dailyLog.saved')}</Alert>
      </Snackbar>
    </Container>
  );
}
