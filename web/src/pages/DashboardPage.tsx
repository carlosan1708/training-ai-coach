import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ChatIcon from '@mui/icons-material/Chat';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import { useProfileStore } from '../store/profileStore';
import { useDailyLog } from '../hooks/useDailyLog';
import WeeklyReportCard from '../components/dashboard/WeeklyReportCard';
import GoalForecastCard from '../components/dashboard/GoalForecastCard';
import NutritionCard from '../components/dashboard/NutritionCard';

const today = new Date().toISOString().split('T')[0];

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profile } = useProfileStore();
  const { log } = useDailyLog(today);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={700}>
          {t('dashboard.welcome', { name: profile?.name ?? '👋' })}
        </Typography>

        <Grid container spacing={2}>
          {/* Weight card */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  {t('dashboard.todayWeight')}
                </Typography>
                <Typography variant="h4" fontWeight={700}>
                  {log?.weight_kg != null
                    ? `${log.weight_kg} kg`
                    : t('dashboard.noWeight')}
                </Typography>
                {profile?.goal_weight_kg && (
                  <Typography variant="body2" color="text.secondary">
                    Goal: {profile.goal_weight_kg} kg
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Energy card */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  {t('dailyLog.energy')}
                </Typography>
                <Typography variant="h4" fontWeight={700}>
                  {log?.energy != null ? `${log.energy} / 5` : '—'}
                </Typography>
                {log?.notes && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      mt: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {log.notes}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {!log && (
          <Box
            sx={{
              p: 3,
              borderRadius: 2,
              bgcolor: 'primary.50',
              border: '1px dashed',
              borderColor: 'primary.200',
              textAlign: 'center',
            }}
          >
            <Typography color="text.secondary">{t('dashboard.noData')}</Typography>
          </Box>
        )}

        <GoalForecastCard />
        <NutritionCard />
        <WeeklyReportCard />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Button
            variant="contained"
            size="large"
            startIcon={<EditNoteIcon />}
            onClick={() => navigate('/log')}
            fullWidth
          >
            {t('dashboard.logToday')}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            size="large"
            startIcon={<FitnessCenterIcon />}
            onClick={() => navigate('/routines')}
            fullWidth
          >
            {t('dashboard.startWorkout')}
          </Button>
          <Button
            variant="outlined"
            size="large"
            startIcon={<ChatIcon />}
            onClick={() => navigate('/chat')}
            fullWidth
          >
            {t('dashboard.openChat')}
          </Button>
        </Stack>
      </Stack>
    </Container>
  );
}
