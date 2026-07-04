import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import MonitorWeightOutlinedIcon from '@mui/icons-material/MonitorWeightOutlined';
import { useAuthStore } from '../../store/authStore';
import { getLatestWeeklyReport } from '../../firebase/firestore';
import { generateWeeklyReportFn } from '../../firebase/callables';
import type { WeeklyReport } from '../../types/report';

const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

export default function WeeklyReportCard() {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();

  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const result = await generateWeeklyReportFn({});
      setReport(result.data.report);
    } catch {
      setError(t('report.error'));
    } finally {
      setGenerating(false);
    }
  };

  // On login: show the latest report, and refresh it automatically when it's
  // missing or covers a week that ended 7+ days ago.
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      let latest: WeeklyReport | null = null;
      try {
        latest = await getLatestWeeklyReport(currentUser.uid);
      } catch {
        // ignore — we'll just offer manual generation
      }
      if (cancelled) return;
      setReport(latest);
      setLoading(false);

      const stale = !latest || latest.week_end <= isoDaysAgo(7);
      if (!stale) return;
      setGenerating(true);
      try {
        const result = await generateWeeklyReportFn({});
        if (!cancelled) setReport(result.data.report);
      } catch {
        // silent — the manual Generate button stays available
      } finally {
        if (!cancelled) setGenerating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  if (loading) return null;

  const stats = report?.stats;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <AutoAwesomeIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
              {t('report.title')}
            </Typography>
            {report && (
              <Tooltip title={t('report.refresh')}>
                <IconButton size="small" onClick={generate} disabled={generating}>
                  {generating
                    ? <CircularProgress size={16} />
                    : <RefreshIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            )}
          </Stack>

          {!report && (
            <>
              <Typography variant="body2" color="text.secondary">
                {t('report.empty')}
              </Typography>
              <Button
                variant="contained"
                onClick={generate}
                disabled={generating}
                startIcon={generating
                  ? <CircularProgress size={16} color="inherit" />
                  : <AutoAwesomeIcon />}
                sx={{ alignSelf: 'flex-start' }}
              >
                {generating ? t('report.generating') : t('report.generate')}
              </Button>
            </>
          )}

          {report && (
            <>
              <Box>
                <Typography fontWeight={700}>{report.headline}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('report.week', { start: report.week_start, end: report.week_end })}
                </Typography>
              </Box>

              {stats && (
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    icon={<FitnessCenterIcon />}
                    label={t('report.sessions', { count: stats.sessions })}
                  />
                  {stats.total_volume_kg > 0 && (
                    <Chip
                      size="small"
                      label={t('report.volume', { kg: stats.total_volume_kg.toLocaleString() })}
                      color={stats.volume_change_pct != null && stats.volume_change_pct > 0 ? 'success' : 'default'}
                      variant="outlined"
                    />
                  )}
                  {stats.weight_delta_kg != null && (
                    <Chip
                      size="small"
                      icon={<MonitorWeightOutlinedIcon />}
                      label={`${stats.weight_delta_kg > 0 ? '+' : ''}${stats.weight_delta_kg} kg`}
                      variant="outlined"
                    />
                  )}
                </Stack>
              )}

              {report.summary && (
                <Typography variant="body2">{report.summary}</Typography>
              )}

              {report.wins.length > 0 && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="success.main">
                    {t('report.wins')}
                  </Typography>
                  {report.wins.map((w, i) => (
                    <Stack key={i} direction="row" spacing={0.75} alignItems="flex-start">
                      <CheckCircleOutlineIcon sx={{ fontSize: 15, mt: 0.35 }} color="success" />
                      <Typography variant="body2">{w}</Typography>
                    </Stack>
                  ))}
                </Box>
              )}

              {report.focus_next_week.length > 0 && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="primary.main">
                    {t('report.focus')}
                  </Typography>
                  {report.focus_next_week.map((f, i) => (
                    <Stack key={i} direction="row" spacing={0.75} alignItems="flex-start">
                      <FlagOutlinedIcon sx={{ fontSize: 15, mt: 0.35 }} color="primary" />
                      <Typography variant="body2">{f}</Typography>
                    </Stack>
                  ))}
                </Box>
              )}
            </>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}
