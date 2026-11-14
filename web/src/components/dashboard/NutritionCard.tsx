import { useTranslation } from 'react-i18next';
import { Box, Card, CardContent, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import { useProfileStore } from '../../store/profileStore';
import { useDailyLog } from '../../hooks/useDailyLog';
import { isDemoMode } from '../../demo';
import { sumNutrition, calorieTarget, proteinTarget } from '../../lib/nutrition';
import { localDateKey } from '../../lib/dates';

/** At-a-glance nutrition for today. Real-backend feature — hidden in demo. */
export default function NutritionCard() {
  const { t } = useTranslation();
  const { profile } = useProfileStore();
  const today = localDateKey();
  const { log } = useDailyLog(today);

  if (isDemoMode()) return null;

  const meals = (log?.food_log ?? []).filter((f) => f.calories != null || f.items?.length);
  if (meals.length === 0) return null;

  const totals = sumNutrition(meals);
  const calGoal = calorieTarget(profile);
  const proGoal = proteinTarget(profile);
  const calPct = calGoal ? Math.min(100, Math.round((totals.calories / calGoal) * 100)) : 0;
  const proPct = proGoal ? Math.min(100, Math.round((totals.protein_g / proGoal) * 100)) : 0;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <RestaurantIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
              {t('meals.todayNutrition')}
            </Typography>
            <Chip size="small" variant="outlined" label={t('meals.mealCount', { count: meals.length })} />
          </Stack>

          <Box>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" fontWeight={600}>{t('meals.calories')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {Math.round(totals.calories)}{calGoal ? ` / ${calGoal}` : ''} kcal
              </Typography>
            </Stack>
            {calGoal != null && (
              <LinearProgress variant="determinate" value={calPct}
                sx={{ mt: 0.5, height: 7, borderRadius: 1, '& .MuiLinearProgress-bar': { bgcolor: '#2e7d32' } }} />
            )}
          </Box>

          <Box>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" fontWeight={600}>{t('meals.protein')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {Math.round(totals.protein_g)}{proGoal ? ` / ${proGoal}` : ''} g
              </Typography>
            </Stack>
            {proGoal != null && (
              <LinearProgress variant="determinate" value={proPct}
                sx={{ mt: 0.5, height: 7, borderRadius: 1, '& .MuiLinearProgress-bar': { bgcolor: '#1976d2' } }} />
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
