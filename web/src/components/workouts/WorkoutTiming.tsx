import { useEffect, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { elapsedSeconds, formatElapsedTime, timestampMillis } from '../../lib/workoutTime';
import type { WorkoutSession } from '../../types/routine';

interface Props {
  session: WorkoutSession;
  compact?: boolean;
}

export default function WorkoutTiming({ session, compact = false }: Props) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(Date.now);
  const start = timestampMillis(session.started_at);
  const end = timestampMillis(session.completed_at);
  const active = session.status === 'active';
  useEffect(() => {
    if (!active || start === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, start]);
  const elapsed = elapsedSeconds(session, now);
  const formatDate = (millis: number): string => new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(millis));
  const recordedTime = (millis: number | null) => millis === null ? t('workoutTime.notRecorded') : (
    <Box component="time" dateTime={new Date(millis).toISOString()}>{formatDate(millis)}</Box>
  );

  return (
    <Box component="section" aria-label={t('workoutTime.title')} data-testid="workout-timing"
      sx={{ minWidth: 0, py: compact ? 0 : 1 }}>
      <Stack direction={compact ? 'row' : { xs: 'column', sm: 'row' }}
        gap={compact ? 1.5 : 2} flexWrap="wrap" alignItems="flex-start">
        <Box sx={{ minWidth: 0 }}>
          <Typography component="p" variant="caption" color="text.secondary">
            {t(active ? 'workoutTime.elapsed' : 'workoutTime.duration')}
          </Typography>
          <Typography component="p" variant={compact ? 'body2' : 'h5'} fontWeight={700}
            role="timer" aria-live="off" aria-label={t(active ? 'workoutTime.elapsed' : 'workoutTime.duration')}
            data-testid="workout-elapsed" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {elapsed === null ? t('workoutTime.notRecorded') : formatElapsedTime(elapsed)}
          </Typography>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="p" variant="caption" color="text.secondary">{t('workoutTime.started')}</Typography>
          <Typography component="p" variant="body2" data-testid="workout-started" sx={{ overflowWrap: 'anywhere' }}>
            {recordedTime(start)}
          </Typography>
        </Box>
        {!active && <Box sx={{ minWidth: 0 }}>
          <Typography component="p" variant="caption" color="text.secondary">{t('workoutTime.completed')}</Typography>
          <Typography component="p" variant="body2" data-testid="workout-completed" sx={{ overflowWrap: 'anywhere' }}>
            {recordedTime(end)}
          </Typography>
        </Box>}
      </Stack>
    </Box>
  );
}
