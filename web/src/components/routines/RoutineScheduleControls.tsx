import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import { setProfile, updateRoutine } from '../../firebase/firestore';
import { getScheduledWeekdays } from '../../lib/trainingSchedule';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import type { Routine, RoutineDay, Weekday } from '../../types/routine';

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const weekdaysKey = (weekdays: Weekday[]) => [...weekdays].sort().join(',');

/** An account preference, shared by the dashboard and every routine view. */
export function PreferredRoutineButton({ routine }: { routine: Routine }) {
  const { t } = useTranslation();
  const currentUser = useAuthStore(state => state.currentUser);
  const profile = useProfileStore(state => state.profile);
  const profileUid = useProfileStore(state => state.profileUid);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const preferred = profile?.preferred_routine_id === routine.id;

  const choose = async () => {
    if (!currentUser || !profile || profileUid !== currentUser.uid || saving) return;
    const preferredRoutineId = preferred ? null : routine.id;
    setSaving(true);
    setError(false);
    try {
      await setProfile(currentUser.uid, { preferred_routine_id: preferredRoutineId });
      // Demo subscriptions do not stream writes; update mounted views after saving.
      const latest = useProfileStore.getState();
      if (latest.profileUid === currentUser.uid && latest.profile) {
        latest.setProfile({ ...latest.profile, preferred_routine_id: preferredRoutineId }, currentUser.uid);
      }
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return <Stack spacing={1} sx={{ minWidth: 0 }}>
    <Button
      size="small"
      variant={preferred ? 'outlined' : 'text'}
      startIcon={preferred ? <StarRoundedIcon /> : <StarOutlineRoundedIcon />}
      aria-pressed={preferred}
      disabled={saving || !currentUser || !profile || profileUid !== currentUser.uid}
      onClick={event => { event.stopPropagation(); void choose(); }}
      sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}
    >
      {t(preferred ? 'schedule.preferred' : 'schedule.makePreferred')}
    </Button>
    {error && <Alert severity="error">{t('schedule.saveError')}</Alert>}
  </Stack>;
}

/** Explicit weekdays also allow an empty selection to override a legacy day name. */
export default function RoutineScheduleControls({ routine, day, onSaved }: {
  routine: Routine;
  day?: RoutineDay;
  onSaved: (routine: Routine) => void;
}) {
  const { t, i18n } = useTranslation();
  const currentUser = useAuthStore(state => state.currentUser);
  const controlId = useId();
  const savedWeekdays = getScheduledWeekdays(day ?? routine);
  const savedKey = weekdaysKey(savedWeekdays);
  const [weekdays, setWeekdays] = useState<Weekday[]>(savedWeekdays);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setWeekdays(savedKey ? savedKey.split(',').map(Number) as Weekday[] : []);
    setError(false);
  }, [routine.id, day?.id, savedKey]);

  const labels = useMemo(() => {
    const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
    const full = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
    const short = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    return WEEKDAYS.map(value => {
      const date = new Date(Date.UTC(2024, 0, 7 + value));
      return { value, full: full.format(date), short: short.format(date) };
    });
  }, [i18n.resolvedLanguage, i18n.language]);

  const save = async () => {
    if (!currentUser || saving || weekdaysKey(weekdays) === savedKey) return;
    setSaving(true);
    setError(false);
    const scheduledWeekdays = WEEKDAYS.filter(value => weekdays.includes(value));
    try {
      if (day) {
        if (!routine.days?.some(item => item.id === day.id)) throw new Error('Routine day unavailable');
        const days = routine.days.map(item => item.id === day.id
          ? { ...item, scheduled_weekdays: scheduledWeekdays }
          : item);
        await updateRoutine(currentUser.uid, routine.id, { days });
        onSaved({ ...routine, days });
      } else {
        await updateRoutine(currentUser.uid, routine.id, { scheduled_weekdays: scheduledWeekdays });
        onSaved({ ...routine, scheduled_weekdays: scheduledWeekdays });
      }
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const summary = labels.filter(label => savedWeekdays.includes(label.value)).map(label => label.short).join(', ');

  return <Accordion disableGutters elevation={0} sx={{
    minWidth: 0,
    border: '1px solid',
    borderColor: 'divider',
    borderRadius: '12px !important',
    '&:before': { display: 'none' },
  }}>
    <AccordionSummary
      expandIcon={<ExpandMoreRoundedIcon />}
      aria-controls={`${controlId}-content`}
      id={`${controlId}-heading`}
      sx={{ minHeight: 44, px: 1.5, '& .MuiAccordionSummary-content': { minWidth: 0, my: 1 } }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, width: '100%', pr: 1 }}>
        <Typography variant="body2" fontWeight={600} sx={{ flexShrink: 0 }}>{t('schedule.scheduleTitle')}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>{summary || t('schedule.notScheduled')}</Typography>
      </Stack>
    </AccordionSummary>
    <AccordionDetails sx={{ px: 1.5, pt: 0 }}>
      <Stack spacing={1.5}>
        <Typography id={`${controlId}-hint`} variant="body2" color="text.secondary">
          {t('schedule.scheduleHint')}
        </Typography>
        <Box role="group" aria-label={t('schedule.scheduleTitle')} aria-describedby={`${controlId}-hint`}
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {labels.map(label => <Button
            key={label.value}
            size="small"
            variant={weekdays.includes(label.value) ? 'contained' : 'outlined'}
            aria-label={label.full}
            aria-pressed={weekdays.includes(label.value)}
            disabled={saving || !currentUser}
            onClick={() => setWeekdays(previous => previous.includes(label.value)
              ? previous.filter(value => value !== label.value)
              : [...previous, label.value])}
            sx={{ minWidth: 48, px: 1, textTransform: 'none' }}
          >{label.short}</Button>)}
        </Box>
        {error && <Alert severity="error">{t('schedule.saveError')}</Alert>}
        <Button size="small" variant="contained" sx={{ alignSelf: 'flex-start' }}
          disabled={saving || !currentUser || weekdaysKey(weekdays) === savedKey}
          onClick={() => { void save(); }}>
          {t(saving ? 'schedule.saving' : 'schedule.saveSchedule')}
        </Button>
      </Stack>
    </AccordionDetails>
  </Accordion>;
}
