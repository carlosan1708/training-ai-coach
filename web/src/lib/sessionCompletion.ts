import { loadConvention } from './loadBasis';
import type { DailyLog, ExerciseLogEntry } from '../types/log';
import type { Routine, SessionExercise, WorkoutSession } from '../types/routine';
import { carrySessionDefaults } from './exerciseDefaults';
import { doneSets, sessionVolume, summarizeSets, topSetWeight } from './workout';
import type { WeightUnit } from './units';
import { timestampMillis } from './workoutTime';

/** Stable provenance lets a correction touch only its own daily-log entries. */
export function buildSessionLogEntries(session: WorkoutSession, defaultUnit: WeightUnit): ExerciseLogEntry[] {
  return session.exercises.filter(ex => doneSets(ex.sets).length > 0).map(ex => ({
    workout_session_id: session.id, ...loadConvention(ex),
    exercise: ex.name,
    sets: doneSets(ex.sets).length,
    reps: doneSets(ex.sets)[0]?.reps,
    weight_kg: topSetWeight(ex.sets),
    weight_unit: ex.weight_unit ?? defaultUnit,
    ...(ex.weight_unit_override ? { weight_unit_override: true } : {}),
    ...(ex.gif_url ? { gif_url: ex.gif_url } : {}),
    ...(ex.images ? { images: [...ex.images] } : {}),
    ...(ex.library_id ? { library_id: ex.library_id } : {}),
    notes: `${session.routine_name} — ${summarizeSets(ex.sets, ex.weight_unit ?? defaultUnit)}`,
  }));
}

/** Pure changes used by both the Firestore transaction and the offline demo. */
export function buildCompletionChanges(
  saved: WorkoutSession,
  exercises: SessionExercise[],
  routine: Routine | null,
  existingLog: DailyLog | null,
  defaultUnit: WeightUnit,
  timestamp: unknown,
  now = Date.now(),
) {
  // Retrying after an acknowledged completion must never count it twice.
  if (saved.status === 'completed') return null;
  const started = timestampMillis(saved.started_at);
  if (started != null && now < started) throw new Error('Completion time must be after the start time');
  const duration = started != null ? Math.floor((now - started) / 1000) : null;
  const completed: WorkoutSession = {
    ...saved, exercises, status: 'completed', total_volume_kg: sessionVolume(exercises),
    completed_at: timestamp,
    ...(duration != null ? { duration_sec: duration, duration_min: Math.round(duration / 60) } : {}),
  };
  const routineData = routine ? {
    ...carrySessionDefaults(routine, completed),
    session_count: (routine.session_count ?? 0) + 1,
    last_session_at: [routine.last_session_at ?? '', saved.date].sort().at(-1),
    updated_at: timestamp,
  } : null;
  const entries = buildSessionLogEntries(completed, defaultUnit);
  const dailyLogData: Partial<DailyLog> | null = entries.length ? {
    exercise_log: [
      ...(existingLog?.exercise_log ?? []).filter(previous => previous.workout_session_id !== saved.id),
      ...entries,
    ],
    updated_at: timestamp,
    ...(!existingLog ? { date: saved.date, created_at: timestamp } : {}),
  } : null;
  return { completed, routineData, dailyLogData };
}

/** Checkboxes alone don't change the next workout's prescribed loads or reps. */
export function exerciseTargetsChanged(before: SessionExercise[], after: SessionExercise[]) {
  const values = (exercise: SessionExercise) => [exercise.name, exercise.load_basis,
    Boolean(exercise.load_basis_confirmed), Boolean(exercise.load_basis_review_required), exercise.load_basis_note ?? null,
    exercise.weight_unit, Boolean(exercise.weight_unit_override), exercise.sets.map(set => [set.weight_kg, set.reps])];
  return JSON.stringify(before.map(values)) !== JSON.stringify(after.map(values));
}
