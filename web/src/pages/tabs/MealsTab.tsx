import { useState, useEffect, useRef } from 'react';
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
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import DeleteIcon from '@mui/icons-material/Delete';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import ScienceIcon from '@mui/icons-material/Science';
import { serverTimestamp } from 'firebase/firestore';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { upsertDailyLog } from '../../firebase/firestore';
import { uploadMealPhoto } from '../../firebase/storage';
import { analyzeMealPhotoFn } from '../../firebase/callables';
import { useDailyLog } from '../../hooks/useDailyLog';
import { isDemoMode } from '../../demo';
import { sumNutrition, calorieTarget, proteinTarget } from '../../lib/nutrition';
import type { FoodLogEntry, MealAnalysis } from '../../types/log';

interface Props { date: string }

const macroColor = { protein: '#1976d2', carbs: '#f59e0b', fat: '#9c27b0' };

export default function MealsTab({ date }: Props) {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const { profile } = useProfileStore();
  const { log, loading } = useDailyLog(date);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [meals, setMeals] = useState<FoodLogEntry[]>([]);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<FoodLogEntry | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (log?.food_log) setMeals(log.food_log.filter((f) => f.calories != null || f.items?.length));
  }, [log]);

  const persist = async (next: FoodLogEntry[]) => {
    if (!currentUser) return;
    // Preserve any non-nutrition food_log entries that existed before
    const others = (log?.food_log ?? []).filter((f) => f.calories == null && !f.items?.length);
    await upsertDailyLog(currentUser.uid, date, {
      food_log: [...others, ...next],
      updated_at: serverTimestamp(),
      ...(!log ? { date, created_at: serverTimestamp() } : {}),
    });
  };

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setError('');
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    if (!photoPreview || !photoFile) return;
    setAnalyzing(true);
    setError('');
    try {
      const [header, imageData] = photoPreview.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
      const result = await analyzeMealPhotoFn({ imageData, mimeType });
      const m: MealAnalysis = result.data.meal;
      setDraft({
        meal: m.name || t('meals.meal'),
        description: (m.items ?? []).map((i) => i.name).join(', '),
        adherent: true,
        timestamp: new Date().toISOString(),
        calories: m.total_calories,
        protein_g: m.total_protein_g,
        carbs_g: m.total_carbs_g,
        fat_g: m.total_fat_g,
        items: m.items,
      });
    } catch {
      setError(t('meals.analyzeError'));
    } finally {
      setAnalyzing(false);
    }
  };

  const saveDraft = async () => {
    if (!draft || !currentUser) return;
    setSaving(true);
    try {
      let entry = draft;
      if (photoFile) {
        try {
          const { downloadUrl } = await uploadMealPhoto(currentUser.uid, photoFile);
          entry = { ...draft, photo_url: downloadUrl };
        } catch {
          // photo upload is best-effort — keep the meal even if it fails
        }
      }
      const next = [...meals, entry];
      setMeals(next);
      await persist(next);
      setDraft(null);
      setPhotoPreview(null);
      setPhotoFile(null);
    } finally {
      setSaving(false);
    }
  };

  const removeMeal = async (index: number) => {
    const next = meals.filter((_, i) => i !== index);
    setMeals(next);
    await persist(next);
  };

  const editDraft = (field: keyof FoodLogEntry, value: string) =>
    setDraft((d) => (d ? { ...d, [field]: field === 'meal' ? value : value === '' ? undefined : Number(value) } : d));

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>;

  // ── Demo mode: feature is real-backend only ──
  if (isDemoMode()) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Alert severity="info" icon={<ScienceIcon />}>
          {t('meals.demoUnavailable')}
        </Alert>
      </Container>
    );
  }

  const totals = sumNutrition(meals);
  const calGoal = calorieTarget(profile);
  const proGoal = proteinTarget(profile);

  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Stack spacing={3}>

        {/* ── Daily totals ── */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              {t('meals.todayTotals')}
            </Typography>
            <Stack spacing={1.5}>
              <TotalBar
                label={t('meals.calories')}
                value={Math.round(totals.calories)}
                goal={calGoal}
                unit="kcal"
                color="#2e7d32"
              />
              <TotalBar
                label={t('meals.protein')}
                value={Math.round(totals.protein_g)}
                goal={proGoal}
                unit="g"
                color={macroColor.protein}
              />
              <Stack direction="row" spacing={1}>
                <Chip size="small" label={`${t('meals.carbs')}: ${Math.round(totals.carbs_g)} g`} sx={{ bgcolor: `${macroColor.carbs}22` }} />
                <Chip size="small" label={`${t('meals.fat')}: ${Math.round(totals.fat_g)} g`} sx={{ bgcolor: `${macroColor.fat}22` }} />
                <Chip size="small" variant="outlined" label={t('meals.mealCount', { count: meals.length })} />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* ── Photo capture ── */}
        <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="subtitle1" fontWeight={600}>
                <AutoFixHighIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                {t('meals.snapTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('meals.snapHint')}
              </Typography>

              {photoPreview && (
                <Box component="img" src={photoPreview} alt="meal"
                  sx={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 2 }} />
              )}

              <Stack direction="row" spacing={1}>
                <Button variant="outlined" startIcon={<CameraAltIcon />}
                  onClick={() => fileInputRef.current?.click()} sx={{ flex: 1 }}>
                  {photoPreview ? t('meals.changePhoto') : t('meals.takePhoto')}
                </Button>
                {photoPreview && !draft && (
                  <Button variant="contained" sx={{ flex: 1 }}
                    startIcon={analyzing ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />}
                    onClick={analyze} disabled={analyzing}>
                    {analyzing ? t('meals.analyzing') : t('meals.analyze')}
                  </Button>
                )}
              </Stack>
              {error && <Alert severity="warning">{error}</Alert>}
            </Stack>
          </CardContent>
        </Card>

        <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
          style={{ display: 'none' }} onChange={handlePhoto} />

        {/* ── Draft (review AI estimate before saving) ── */}
        {draft && (
          <Card variant="outlined" sx={{ borderColor: 'primary.main' }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="subtitle2" color="primary.main">
                  {t('meals.reviewEstimate')}
                </Typography>
                <TextField label={t('meals.meal')} value={draft.meal}
                  onChange={(e) => editDraft('meal', e.target.value)} size="small" fullWidth />
                {draft.items && draft.items.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {draft.items.map((i) => `${i.name}${i.portion ? ` (${i.portion})` : ''}`).join(' · ')}
                  </Typography>
                )}
                <Stack direction="row" spacing={1}>
                  <TextField label={t('meals.calories')} type="number" value={draft.calories ?? ''}
                    onChange={(e) => editDraft('calories', e.target.value)} size="small" fullWidth />
                  <TextField label={`${t('meals.protein')} (g)`} type="number" value={draft.protein_g ?? ''}
                    onChange={(e) => editDraft('protein_g', e.target.value)} size="small" fullWidth />
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField label={`${t('meals.carbs')} (g)`} type="number" value={draft.carbs_g ?? ''}
                    onChange={(e) => editDraft('carbs_g', e.target.value)} size="small" fullWidth />
                  <TextField label={`${t('meals.fat')} (g)`} type="number" value={draft.fat_g ?? ''}
                    onChange={(e) => editDraft('fat_g', e.target.value)} size="small" fullWidth />
                </Stack>
                <Stack direction="row" spacing={1}>
                  <Button onClick={() => setDraft(null)} sx={{ flex: 1 }}>{t('common.cancel')}</Button>
                  <Button variant="contained" onClick={saveDraft} disabled={saving} sx={{ flex: 1 }}
                    startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <RestaurantIcon />}>
                    {t('meals.logMeal')}
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* ── Today's meals ── */}
        {meals.length > 0 && (
          <>
            <Typography variant="subtitle1" fontWeight={600}>{t('meals.loggedToday')}</Typography>
            {meals.map((m, idx) => (
              <Card key={idx} variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    {m.photo_url
                      ? <Box component="img" src={m.photo_url} alt="" sx={{ width: 52, height: 52, borderRadius: 1.5, objectFit: 'cover' }} />
                      : <RestaurantIcon color="disabled" />}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={600} noWrap>{m.meal}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {m.calories ?? 0} kcal · {m.protein_g ?? 0}g P · {m.carbs_g ?? 0}g C · {m.fat_g ?? 0}g F
                      </Typography>
                    </Box>
                    <Tooltip title={t('exerciseLog.remove')}>
                      <IconButton size="small" color="error" onClick={() => removeMeal(idx)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </Stack>
    </Container>
  );
}

// ── Total bar with optional goal ──
function TotalBar({ label, value, goal, unit, color }: {
  label: string; value: number; goal: number | null; unit: string; color: string;
}) {
  const pct = goal ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="body2" fontWeight={600}>{label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {value}{goal ? ` / ${goal}` : ''} {unit}
        </Typography>
      </Stack>
      {goal != null && (
        <LinearProgress variant="determinate" value={pct}
          sx={{ mt: 0.5, height: 7, borderRadius: 1, '& .MuiLinearProgress-bar': { bgcolor: color } }} />
      )}
    </Box>
  );
}
