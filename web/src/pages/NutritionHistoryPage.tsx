import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Container, Divider,
  Grid, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import { getRecentDailyLogs } from '../firebase/firestore';
import { calorieTarget } from '../lib/nutrition';
import { buildDailyNutrition, summarizeTrends, type DailyNutrition } from '../lib/nutritionHistory';

// Same palette as MealsTab; the calorie bar turns green once it crosses target.
const macroColor = { protein: '#1976d2', carbs: '#f59e0b', fat: '#9c27b0' };
const CAL_BASE = '#42a5f5';
const CAL_OVER = '#2e7d32';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

/** YYYY-MM-DD -> MM/DD for compact chart axes. */
const shortDate = (d: string) => d.slice(5).replace('-', '/');

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ py: 1.5 }}>
        <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
        <Typography variant="h6" fontWeight={700}>{value}</Typography>
      </CardContent>
    </Card>
  );
}

export default function NutritionHistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { profile } = useProfileStore();

  const [range, setRange] = useState<Range>(30);
  const [days, setDays] = useState<DailyNutrition[] | null>(null);
  const [loading, setLoading] = useState(true);

  const calGoal = calorieTarget(profile);

  // Fetch on user/range only; trend math is cheap and reruns when the target
  // (from the profile) resolves, without a refetch.
  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    setLoading(true);
    getRecentDailyLogs(currentUser.uid, range)
      .then((logs) => { if (active) setDays(buildDailyNutrition(logs)); })
      .catch(() => { if (active) setDays([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentUser, range]);

  const trends = useMemo(
    () => (days ? summarizeTrends(days, calGoal) : null),
    [days, calGoal],
  );

  const chartData = useMemo(
    () => (trends?.days ?? []).filter((d) => d.logged).map((d) => ({ ...d, label: shortDate(d.date) })),
    [trends],
  );

  const handleRange = (_: React.MouseEvent<HTMLElement>, val: Range | null) => {
    if (val) setRange(val);
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" spacing={1} sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>{t('nutritionHistory.title')}</Typography>
        <ToggleButtonGroup size="small" exclusive value={range} onChange={handleRange} aria-label={t('nutritionHistory.title')}>
          <ToggleButton value={7}>{t('nutritionHistory.range7')}</ToggleButton>
          <ToggleButton value={30}>{t('nutritionHistory.range30')}</ToggleButton>
          <ToggleButton value={90}>{t('nutritionHistory.range90')}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : !trends || trends.loggedDays === 0 ? (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={() => navigate('/log?tab=3')}>
              {t('meals.logMeal')}
            </Button>
          }
        >
          {t('nutritionHistory.empty')}
        </Alert>
      ) : (
        <Stack spacing={3}>
          {/* Summary strip */}
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatTile label={t('nutritionHistory.avgCalories')} value={`${Math.round(trends.avg.calories)}`} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatTile label={t('nutritionHistory.avgProtein')} value={`${Math.round(trends.avg.protein_g)} g`} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatTile label={t('nutritionHistory.daysLogged')} value={`${trends.loggedDays}`} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatTile label={t('nutritionHistory.daysOnTarget')} value={`${trends.daysOnCalorieTarget}`} />
            </Grid>
          </Grid>

          {/* Calories vs target */}
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                {t('nutritionHistory.caloriesChart')}
              </Typography>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  {calGoal != null && (
                    <ReferenceLine y={calGoal} stroke="#2e7d32" strokeDasharray="4 4"
                      label={{ value: t('nutritionHistory.target'), position: 'insideTopRight', fontSize: 11 }} />
                  )}
                  <Bar dataKey="calories" name={t('meals.calories')} isAnimationActive={false} radius={[3, 3, 0, 0]}>
                    {chartData.map((d) => (
                      <Cell key={d.date} fill={calGoal != null && d.calories > calGoal ? CAL_OVER : CAL_BASE} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Macros */}
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                {t('nutritionHistory.macrosChart')}
              </Typography>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="protein_g" stackId="m" name={t('meals.protein')} fill={macroColor.protein} isAnimationActive={false} />
                  <Bar dataKey="carbs_g" stackId="m" name={t('meals.carbs')} fill={macroColor.carbs} isAnimationActive={false} />
                  <Bar dataKey="fat_g" stackId="m" name={t('meals.fat')} fill={macroColor.fat} isAnimationActive={false} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Past days, newest first */}
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                {t('nutritionHistory.pastDays')}
              </Typography>
              <Stack divider={<Divider flexItem />}>
                {[...chartData].reverse().map((d) => (
                  <Stack key={d.date} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 1 }}>
                    <Box>
                      <Typography variant="body2" fontWeight={600}>{d.date}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {`${t('meals.protein')} ${Math.round(d.protein_g)} g · ${t('meals.carbs')} ${Math.round(d.carbs_g)} g · ${t('meals.fat')} ${Math.round(d.fat_g)} g`}
                      </Typography>
                    </Box>
                    <Typography variant="body2" fontWeight={600}>
                      {`${Math.round(d.calories)} ${t('meals.calories')}`}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      )}
    </Container>
  );
}
