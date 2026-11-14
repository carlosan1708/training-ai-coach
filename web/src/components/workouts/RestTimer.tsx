import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Box, Button, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import { useTranslation } from 'react-i18next';
import { formatElapsedTime } from '../../lib/workoutTime';

interface Props {
  sessionId: string;
  durationSeconds: number;
  trigger: number;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

/** One optional wall-clock countdown for the current workout. */
export default function RestTimer({ sessionId, durationSeconds, trigger, enabled, onEnabledChange }: Props) {
  const { t } = useTranslation();
  const seconds = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.min(3600, Math.max(1, Math.round(durationSeconds))) : 90;
  const [deadline, setDeadline] = useState<number | null>(null);
  const [pausedSeconds, setPausedSeconds] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [status, setStatus] = useState<'ready' | 'complete' | 'skipped'>('ready');
  const previous = useRef({ sessionId, trigger });

  const synchronizeTimer = useEffectEvent(() => {
    const old = previous.current;
    previous.current = { sessionId, trigger };
    if (old.sessionId !== sessionId || !enabled) {
      setDeadline(null);
      setPausedSeconds(null);
      setStatus('ready');
      return;
    }
    // Enabling alone never starts a timer. A newly completed set does.
    if (old.trigger !== trigger) {
      const started = Date.now();
      setNow(started);
      setDeadline(started + seconds * 1000);
      setPausedSeconds(null);
      setStatus('ready');
    }
  });

  useEffect(() => {
    synchronizeTimer();
  }, [sessionId, trigger, enabled, seconds]);

  useEffect(() => {
    if (deadline === null) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) {
        setDeadline(null);
        setPausedSeconds(0);
        setStatus('complete');
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const remaining = deadline === null ? pausedSeconds ?? seconds : Math.max(0, Math.ceil((deadline - now) / 1000));
  const paused = deadline === null && pausedSeconds !== null && pausedSeconds > 0;
  const start = (duration: number) => {
    const started = Date.now();
    setNow(started);
    setDeadline(started + duration * 1000);
    setPausedSeconds(null);
    setStatus('ready');
  };
  const pause = () => {
    if (deadline === null) return;
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setDeadline(null);
    setPausedSeconds(left);
    if (!left) setStatus('complete');
  };

  return <Box component="section" aria-label={t('workoutTools.restTimer')} data-testid="rest-timer"
    sx={{ border: 1, borderColor: enabled ? 'primary.main' : 'divider', bgcolor: 'background.paper', boxShadow: enabled ? 4 : 1, borderRadius: 3, p: 1.5, minWidth: 0 }}>
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <FormControlLabel sx={{ minHeight: 44, m: 0, minWidth: 0 }}
          label={t('workoutTools.restTimer')}
          control={<Switch checked={enabled} onChange={event => onEnabledChange(event.target.checked)} />} />
        {enabled && <Typography component="p" variant="h6" fontWeight={700} role="timer" aria-live="off"
          aria-label={t('workoutTools.restRemaining')} sx={{ fontVariantNumeric: 'tabular-nums', fontSize: { xs: '2rem', sm: '2.5rem' }, lineHeight: 1.1, color: 'primary.main', flexShrink: 0 }}>
          {formatElapsedTime(remaining)}
        </Typography>}
      </Stack>
      {enabled && <>
        {status !== 'ready' && <Typography role="status" aria-live="polite" variant="body2"
          color={status === 'complete' ? 'success.main' : 'text.secondary'}>
          {t(status === 'complete' ? 'workoutTools.restComplete' : 'workoutTools.restSkipped')}
        </Typography>}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {deadline !== null
            ? <Button data-usage-action="rest_paused" variant="outlined" startIcon={<PauseRoundedIcon />} onClick={pause} sx={{ minHeight: 44 }}>
              {t('workoutTools.pause')}
            </Button>
            : <Button variant="outlined" startIcon={<PlayArrowRoundedIcon />}
              onClick={() => start(paused ? pausedSeconds! : seconds)} sx={{ minHeight: 44 }}>
              {t(paused ? 'workoutTools.resume' : 'workoutTools.startRest')}
            </Button>}
          {(deadline !== null || paused) && <Button data-usage-action="rest_skipped" startIcon={<SkipNextRoundedIcon />} sx={{ minHeight: 44 }}
            onClick={() => { setDeadline(null); setPausedSeconds(null); setStatus('skipped'); }}>
            {t('workoutTools.skip')}
          </Button>}
        </Stack>
      </>}
    </Stack>
  </Box>;
}
