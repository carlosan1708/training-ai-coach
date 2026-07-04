import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import FlagIcon from '@mui/icons-material/Flag';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { getRecentDailyLogs } from '../../firebase/firestore';
import { forecastGoal, type WeightPoint } from '../../lib/forecast';

export default function GoalForecastCard() {
  const { t, i18n } = useTranslation();
  const { currentUser } = useAuthStore();
  const { profile } = useProfileStore();

  const [points, setPoints] = useState<WeightPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    getRecentDailyLogs(currentUser.uid, 30)
      .then((logs) =>
        setPoints(
          logs
            .filter((l) => l.weight_kg != null)
            .map((l) => ({ date: l.date, weight: l.weight_kg as number }))
        )
      )
      .finally(() => setLoading(false));
  }, [currentUser]);

  const goal = profile?.goal_weight_kg ?? null;
  const forecast = useMemo(() => forecastGoal(points, goal), [points, goal]);

  // i18n.language comes from the browser and can be an invalid BCP-47 tag
  // (e.g. "en-US@posix"), which makes toLocaleDateString throw.
  const dateLocale = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(i18n.language).resolvedOptions().locale;
    } catch {
      return 'en';
    }
  }, [i18n.language]);

  if (loading) return null;

  const trendLabel =
    forecast.trendPerWeekKg != null
      ? t('forecast.trend', {
          kg: `${forecast.trendPerWeekKg > 0 ? '+' : ''}${forecast.trendPerWeekKg}`,
        })
      : null;

  const trendIcon =
    forecast.trendPerWeekKg == null || Math.abs(forecast.trendPerWeekKg) < 0.1 ? (
      <TrendingFlatIcon />
    ) : forecast.trendPerWeekKg < 0 ? (
      <TrendingDownIcon />
    ) : (
      <TrendingUpIcon />
    );

  const message = (() => {
    switch (forecast.status) {
      case 'insufficient':
        return t('forecast.insufficient');
      case 'no_goal':
        return t('forecast.noGoal');
      case 'reached':
        return t('forecast.reached');
      case 'on_track':
        return t('forecast.eta', {
          goal,
          date: forecast.etaDate?.toLocaleDateString(dateLocale, {
            month: 'long',
            day: 'numeric',
          }),
        });
      case 'stalled':
        return t('forecast.stalled');
      case 'moving_away':
        return t('forecast.movingAway', { kg: forecast.trendPerWeekKg });
    }
  })();

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <FlagIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
              {t('forecast.title')}
            </Typography>
            {trendLabel && (
              <Chip
                size="small"
                icon={trendIcon}
                label={trendLabel}
                color={forecast.status === 'moving_away' ? 'warning' : 'default'}
                variant="outlined"
              />
            )}
          </Stack>

          {points.length >= 2 && (
            <Box sx={{ height: 56 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <YAxis domain={['dataMin - 0.3', 'dataMax + 0.3']} hide />
                  <Line
                    type="monotone"
                    dataKey="weight"
                    stroke="#1976d2"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          )}

          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {forecast.currentWeight != null && (
              <Chip size="small" label={`${t('forecast.current')}: ${forecast.currentWeight} kg`} />
            )}
            {goal != null && (
              <Chip size="small" variant="outlined" label={`${t('forecast.goal')}: ${goal} kg`} />
            )}
          </Stack>

          <Typography
            variant="body2"
            color={forecast.status === 'moving_away' || forecast.status === 'stalled'
              ? 'warning.main'
              : 'text.secondary'}
          >
            {message}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
