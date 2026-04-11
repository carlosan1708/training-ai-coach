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
import { useAuthStore } from '../store/authStore';
import { upsertDailyLog } from '../firebase/firestore';
import { useDailyLog } from '../hooks/useDailyLog';

const today = new Date().toISOString().split('T')[0];

export default function DailyLogPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const { log, loading } = useDailyLog(today);

  const [weight, setWeight] = useState('');
  const [energy, setEnergy] = useState<number>(3);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (log) {
      setWeight(log.weight_kg != null ? String(log.weight_kg) : '');
      setEnergy(log.energy ?? 3);
      setNotes(log.notes ?? '');
    }
  }, [log]);

  const handleSave = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      await upsertDailyLog(currentUser.uid, today, {
        date: today,
        weight_kg: weight ? parseFloat(weight) : undefined,
        energy,
        notes,
        measurements: log?.measurements ?? {},
        food_log: log?.food_log ?? [],
        exercise_log: log?.exercise_log ?? [],
        updated_at: serverTimestamp(),
        ...(!log ? { created_at: serverTimestamp() } : {}),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const energyLabel = t(`dailyLog.energyLabels.${energy}`);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={700}>
          {t('dailyLog.title')}
        </Typography>

        <Typography variant="body2" color="text.secondary">
          {today}
        </Typography>

        <TextField
          label={t('dailyLog.weight')}
          type="number"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          fullWidth
          inputProps={{ min: 20, max: 500, step: 0.1 }}
        />

        <Box>
          <Typography gutterBottom>
            {t('dailyLog.energy')}: <strong>{energy} — {energyLabel}</strong>
          </Typography>
          <Slider
            min={1}
            max={5}
            step={1}
            marks={[1, 2, 3, 4, 5].map((v) => ({
              value: v,
              label: t(`dailyLog.energyLabels.${v}`),
            }))}
            value={energy}
            onChange={(_, v) => setEnergy(v as number)}
          />
        </Box>

        <TextField
          label={t('dailyLog.notes')}
          helperText={t('dailyLog.notesHint')}
          multiline
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          fullWidth
        />

        <Button
          variant="contained"
          size="large"
          startIcon={saving ? <CircularProgress size={18} /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving}
        >
          {t('dailyLog.save')}
        </Button>
      </Stack>

      <Snackbar
        open={saved}
        autoHideDuration={3000}
        onClose={() => setSaved(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSaved(false)}>
          {t('dailyLog.saved')}
        </Alert>
      </Snackbar>
    </Container>
  );
}
