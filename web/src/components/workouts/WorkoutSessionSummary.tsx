import LoadBasisGuidance from './LoadBasisGuidance';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Divider,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { formatWeight, fromKilograms, type WeightUnit } from '../../lib/units';
import { doneSets, sessionVolume } from '../../lib/workout';
import type { WorkoutSession } from '../../types/routine';
import WorkoutTiming from './WorkoutTiming';
import WorkoutSessionActions from './WorkoutSessionActions';
import { useProfileStore } from '../../store/profileStore';
import ExerciseGif from '../ExerciseGif';

interface Props {
  session: WorkoutSession;
  preferredUnit: WeightUnit;
  initiallyExpanded?: boolean;
  onSaved: (session: WorkoutSession) => void;
  onDeleted: (session: WorkoutSession) => void;
}

export default function WorkoutSessionSummary({ session, preferredUnit, initiallyExpanded = false, onSaved, onDeleted }: Props) {
  const { t, i18n } = useTranslation();
  const configuredUnit = useProfileStore(state => state.profile?.workout_weight_unit);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // A selected history entry must settle before its touch controls can be used.
    if (initiallyExpanded) summaryRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [initiallyExpanded]);
  const exercises = session.exercises ?? [];
  const completedCount = exercises.reduce((sum, exercise) => sum + doneSets(exercise.sets ?? []).length, 0);
  const volume = sessionVolume(exercises.map((exercise) => ({ ...exercise, sets: exercise.sets ?? [] })));
  const formattedVolume = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 })
    .format(fromKilograms(volume, preferredUnit));
  const routineName = session.routine_name || t('workoutHistory.unnamedRoutine');
  const active = session.status === 'active';
  const formattedDate = useMemo(() => {
    // Date-only values are local calendar days, not UTC instants.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date ?? '')) return session.date || t('workoutHistory.unknownDate');
    const date = new Date(`${session.date}T12:00:00`);
    return Number.isNaN(date.getTime()) ? session.date
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(date);
  }, [session.date, i18n.language, t]);

  return (
    <Accordion ref={summaryRef} defaultExpanded={initiallyExpanded} onChange={(_, next) => setExpanded(next)} disableGutters data-testid={`session-${session.id}`} sx={{
      border: 1, borderColor: 'divider', borderRadius: '12px !important', overflow: 'hidden',
      '&::before': { display: 'none' }, boxShadow: 'none', scrollMarginTop: 96,
    }}>
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        aria-label={t('workoutHistory.viewSession', { routine: routineName, day: session.day_name || '', date: formattedDate })}
        aria-controls={`workout-history-${session.id}-details`}
        id={`workout-history-${session.id}-summary`}
        sx={{ px: 2, minHeight: 88, '& .MuiAccordionSummary-content': { my: 1.75, minWidth: 0 },
          '& .MuiAccordionSummary-expandIconWrapper': { ml: 0.5 } }}
      >
        <Stack spacing={0.75} sx={{ minWidth: 0, width: '100%' }}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Typography component="h2" variant="subtitle1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
              {routineName}
            </Typography>
            <Chip size="small" color={active ? 'warning' : 'success'} variant="outlined"
              label={t(active ? 'workoutHistory.active' : 'workoutHistory.completed')} />
          </Stack>
          {session.day_name && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{session.day_name}</Typography>}
          <Typography variant="body2" color="text.secondary">
            <Box component="time" dateTime={session.date}>{formattedDate}</Box>
            {' · '}{t('workoutHistory.loggedSets', { count: completedCount })}
          </Typography>
          <Typography variant="caption" color="primary.main">{t('workoutHistory.viewSets')}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 2, pt: 0, pb: 2 }}>
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ mb: 2 }}><WorkoutTiming session={session} compact /></Box>
        <Box sx={{ mb: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">{t('workoutHistory.volume')}</Typography>
            <Typography variant="body2" fontWeight={700} data-testid="session-volume">
              {formattedVolume} {preferredUnit}·{t('workoutHistory.repUnit')}
            </Typography>
          </Box>
        </Box>
        <Stack spacing={1.25} sx={{ mb: 2 }}>
          {active && session.routine_id && <Button component={RouterLink}
            to={`/routines/${encodeURIComponent(session.routine_id)}/session/${encodeURIComponent(session.id)}`}
            variant="contained" fullWidth startIcon={<PlayArrowIcon />} sx={{ minHeight: 48 }}>
            {t('workoutHistory.resume')}
          </Button>}
          <WorkoutSessionActions session={session} preferredUnit={preferredUnit} showSuccess={false}
            onSaved={onSaved} onDeleted={() => onDeleted(session)} />
        </Stack>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 2 }}>
          {t('workoutHistory.completedOnly')}
        </Typography>
        <Stack spacing={2.5}>
          {!exercises.length && <Typography color="text.secondary" variant="body2">{t('workoutHistory.noExerciseData')}</Typography>}
          {exercises.map((exercise, exerciseIndex) => {
            const sets = exercise.sets ?? [];
            const completedSets = sets.map((set, index) => ({ ...set, number: index + 1 })).filter((set) => set.done);
            const unit = configuredUnit ?? exercise.weight_unit ?? preferredUnit;
            const incomplete = sets.length - completedSets.length;
            return (
              <Box key={`${exercise.name}-${exerciseIndex}`} component="section" aria-label={exercise.name}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, mb: 0.5 }}>
                  {expanded && Boolean(exercise.gif_url || exercise.images?.length) && <ExerciseGif gifUrl={exercise.gif_url} images={exercise.images} size={56} />}
                  <Typography component="h3" variant="subtitle2" fontWeight={700} sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                    {exercise.name}
                  </Typography>
                </Stack>
                <LoadBasisGuidance exercise={exercise} compact />
                {completedSets.length ? (
                  <Table size="small" aria-label={t('workoutHistory.exerciseSets', { exercise: exercise.name })}
                    sx={{ tableLayout: 'fixed', '& th, & td': { px: 0.75, py: 1, overflowWrap: 'anywhere' }, '& th': { color: 'text.secondary' } }}>
                    <TableHead><TableRow>
                      <TableCell>{t('workoutHistory.set')}</TableCell>
                      <TableCell align="right">{t('workoutHistory.reps')}</TableCell>
                      <TableCell align="right">{t('workoutHistory.weight')}</TableCell>
                    </TableRow></TableHead>
                    <TableBody>{completedSets.map((set) => (
                      <TableRow key={set.number}>
                        <TableCell component="th" scope="row">{set.number}</TableCell>
                        <TableCell align="right">{Number.isFinite(set.reps) ? set.reps : '—'}</TableCell>
                        <TableCell align="right">{Number.isFinite(set.weight_kg) ? formatWeight(set.weight_kg, unit) : '—'}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                ) : <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t('workoutHistory.noCompletedSets')}</Typography>}
                {incomplete > 0 && <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>
                  {t('workoutHistory.incompleteSets', { count: incomplete })}
                </Typography>}
              </Box>
            );
          })}
        </Stack>
        {session.notes && <Typography variant="body2" sx={{ mt: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{session.notes}</Typography>}
      </AccordionDetails>
    </Accordion>
  );
}
