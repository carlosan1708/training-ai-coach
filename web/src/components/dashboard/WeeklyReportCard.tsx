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
import { appEnvironment } from '../../firebase/config';
import { isDemoMode } from '../../demo';
import { isQaAiPaused } from '../../lib/aiErrors';
import { weeklyReportForDisplay } from '../../lib/weeklyReportCopy';

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
  const manualQa = appEnvironment === 'qa' && !isDemoMode();

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const result = await generateWeeklyReportFn({});
      setReport(result.data.report);
    } catch (failure) {
      setError(t(isQaAiPaused(failure) ? 'redesign.qa.aiPaused' : 'report.error'));
    } finally {
      setGenerating(false);
    }
  };

  // QA browsing only reads saved reports. A model request needs a deliberate
  // click and the server's temporary QA test window, even after a failed read.
  // Production and the local demo retain their automatic weekly refresh.
  // Keyed on the uid, not the User object: firebase hands out a new User
  // instance on every token refresh, which re-ran this effect mid-flight and
  // cancelled a request that was about to succeed.
  const uid = currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      let latest: WeeklyReport | null = null;
      try {
        latest = await getLatestWeeklyReport(uid);
      } catch {
        // ignore — we'll just offer manual generation
      }
      if (cancelled) return;
      setReport(latest);
      setLoading(false);

      if (manualQa) {
        setGenerating(false);
        return;
      }

      const stale = !latest || latest.week_end <= isoDaysAgo(7);
      if (!stale) {
        setGenerating(false);
        return;
      }
      setGenerating(true);
      try {
        const result = await generateWeeklyReportFn({});
        if (!cancelled) setReport(result.data.report);
      } catch (failure) {
        if (!cancelled) setError(t(isQaAiPaused(failure) ? 'redesign.qa.aiPaused' : 'report.error'));
      } finally {
        // Unconditional: bailing out here on `cancelled` left the card stuck
        // on "Analyzing your week..." forever, even after the call succeeded.
        setGenerating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uid, t, manualQa]);

  if (loading) return null;

  const displayReport = report && weeklyReportForDisplay(report, t);
  const stats = displayReport?.stats;

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
                <IconButton size="small" aria-label={t('report.refresh')} onClick={generate} disabled={generating}>
                  {generating
                    ? <CircularProgress size={16} />
                    : <RefreshIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            )}
          </Stack>

          {manualQa && <Typography variant="caption" color="text.secondary">{t('redesign.report.manualQa')}</Typography>}

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

          {displayReport && (
            <>
              <Box>
                <Typography fontWeight={700}>{displayReport.headline}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('report.week', { start: displayReport.week_start, end: displayReport.week_end })}
                </Typography>
              </Box>

              {stats && (
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    icon={<FitnessCenterIcon />}
                    label={t('report.sessions', { count: stats.sessions })}
                  />
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

              {displayReport.summary && (
                <Typography variant="body2">{displayReport.summary}</Typography>
              )}

              {displayReport.wins.length > 0 && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="success.main">
                    {t('report.wins')}
                  </Typography>
                  {displayReport.wins.map((w, i) => (
                    <Stack key={i} direction="row" spacing={0.75} alignItems="flex-start">
                      <CheckCircleOutlineIcon sx={{ fontSize: 15, mt: 0.35 }} color="success" />
                      <Typography variant="body2">{w}</Typography>
                    </Stack>
                  ))}
                </Box>
              )}

              {displayReport.focus_next_week.length > 0 && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="primary.main">
                    {t('report.focus')}
                  </Typography>
                  {displayReport.focus_next_week.map((f, i) => (
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
