import LoadBasisGuidance from '../workouts/LoadBasisGuidance';
import type { LoadConvention } from '../../types/routine';
import { useMemo } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { findSessionExercise } from '../../lib/workout';
import { compareWorkoutSessionsNewestFirst } from '../../lib/sessionOrder';
import { formatWeight, type WeightUnit } from '../../lib/units';
import type { WorkoutSession } from '../../types/routine';
import { useProfileStore } from '../../store/profileStore';

interface ProgressSet {
  number: number;
  reps: number;
  weightKg: number;
}

interface ProgressPoint extends LoadConvention {
  id: string;
  date: string;
  unit: WeightUnit;
  sets: ProgressSet[];
  repetitions: Record<number, number>;
}

const colors = ['#1976d2', '#9c27b0', '#008577', '#c45e00', '#d32f2f', '#5d4037'];

export default function ExerciseProgress({ sessions, exerciseName, exerciseId, previousNames, legacyNames, legacyOnly = !exerciseId, movementNames, movementLibraryId, defaultWeightUnit }: {
  sessions: WorkoutSession[];
  exerciseName: string;
  exerciseId?: string;
  previousNames?: readonly string[];
  legacyNames?: readonly string[];
  legacyOnly?: boolean;
  movementNames?: readonly string[];
  movementLibraryId?: string | null;
  defaultWeightUnit: WeightUnit;
}) {
  const { t, i18n } = useTranslation();
  const preferredWorkoutUnit = useProfileStore(state => state.profile?.workout_weight_unit);
  const points = useMemo(() => [...sessions]
    .filter(session => session.status === 'completed')
    .sort(compareWorkoutSessionsNewestFirst)
    .reverse()
    .flatMap(session => {
      const exercise = findSessionExercise(session, exerciseName, { id: exerciseId, previousNames, legacyNames, legacyOnly, movementNames, movementLibraryId });
      if (!exercise) return [];
      const sets = exercise.sets.flatMap((set, index) => set.done && Number.isFinite(set.reps) && set.reps >= 0
        ? [{ number: index + 1, reps: set.reps, weightKg: set.weight_kg }] : []);
      if (!sets.length) return [];
      return [{ id: session.id, date: session.date, load_basis: exercise.load_basis, load_basis_review_required: exercise.load_basis_review_required, unit: preferredWorkoutUnit ?? exercise.weight_unit ?? defaultWeightUnit,
        sets, repetitions: Object.fromEntries(sets.map(set => [set.number, set.reps])) }];
    }), [sessions, exerciseName, exerciseId, previousNames, legacyNames, legacyOnly, movementNames, movementLibraryId, defaultWeightUnit, preferredWorkoutUnit]);
  const latest = points.at(-1);
  const setNumbers = [...new Set(points.flatMap(point => point.sets.map(set => set.number)))].sort((a, b) => a - b);
  const shortDate = (date: string) => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' })
    .format(new Date(`${date}T12:00:00`));

  return <Box component="section" aria-label={t('exerciseProgress.title')}>
    <Typography component="h3" variant="subtitle1" fontWeight={600}>
      {t('exerciseProgress.title')}
    </Typography>
    {!latest ? <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
      {t('exerciseProgress.empty')}
    </Typography> : <>
      <LoadBasisGuidance exercise={latest} compact />
      {points.some(point => !point.load_basis || point.load_basis_review_required || point.load_basis !== latest.load_basis) && <Typography variant="body2" color="text.secondary">{t('loadBasis.mixed')}</Typography>}
      <Stack direction="row" flexWrap="wrap" alignItems="center" gap={1} sx={{ mt: 1, mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t('exerciseProgress.latest')} · {latest.date}
        </Typography>
        <Chip size="small" variant="outlined" label={t('exerciseProgress.total', {
          count: latest.sets.reduce((sum, set) => sum + set.reps, 0),
        })} />
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 1 }}>
        {latest.sets.map(set => <Box key={set.number} role="group"
          aria-label={t('exerciseProgress.set', { number: set.number })}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.25, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {t('exerciseProgress.set', { number: set.number })}
          </Typography>
          <Typography variant="h6" fontWeight={600}>{t('exerciseProgress.reps', { count: set.reps })}</Typography>
          <Typography variant="body2" color="text.secondary">{formatWeight(set.weightKg, latest.unit)}</Typography>
        </Box>)}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, mb: 1 }}>
        {points.length === 1 ? t('exerciseProgress.oneSession') : t('exerciseProgress.compare')}
      </Typography>
      <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{ mb: 1 }}>
        {setNumbers.map((number, index) => <Stack key={number} direction="row" spacing={0.5} alignItems="center">
          <Box aria-hidden="true" sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: colors[index % colors.length] }} />
          <Typography variant="caption">{t('exerciseProgress.set', { number })}</Typography>
        </Stack>)}
      </Stack>
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="id" tickFormatter={id => shortDate(points.find(point => point.id === id)!.date)} fontSize={12} />
          <YAxis allowDecimals={false} domain={[0, 'auto']} fontSize={12} width={30} />
          <Tooltip content={({ active, payload }) => {
            const point = payload?.[0]?.payload as ProgressPoint | undefined;
            if (!active || !point) return null;
            return <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{point.date}</Typography>
              <LoadBasisGuidance exercise={point} compact />
              {point.sets.map(set => <Typography key={set.number} variant="body2">
                {t('exerciseProgress.set', { number: set.number })}: {t('exerciseProgress.reps', { count: set.reps })}
                {' · '}{formatWeight(set.weightKg, point.unit)}
              </Typography>)}
            </Box>;
          }} />
          {setNumbers.map((number, index) => <Line key={number} type="linear"
            dataKey={(point: ProgressPoint) => point.repetitions[number] ?? null}
            name={t('exerciseProgress.set', { number })} stroke={colors[index % colors.length]}
            strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </>}
  </Box>;
}
