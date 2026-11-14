import type { DailyLog, ExerciseLogEntry } from '../types/log';
import { validLoadBasis } from './loadBasis';
import type { Routine, WorkoutSession, WorkoutSessionEdit } from '../types/routine';
import type { WeightUnit } from './units';
import { carrySessionDefaults } from './exerciseDefaults';
import { buildSessionLogEntries, exerciseTargetsChanged } from './sessionCompletion';
import { doneSets, sessionVolume, topSetWeight } from './workout';
import { exercisesWithChangedDefaults, rememberWorkoutExerciseAdditions } from './workoutExerciseAddition';

const sameLegacyEntry = (entry: ExerciseLogEntry, expected: ExerciseLogEntry) =>
  !entry.workout_session_id
  && entry.exercise === expected.exercise
  && entry.sets === expected.sets
  && entry.reps === expected.reps
  && (entry.weight_kg ?? 0) === expected.weight_kg
  && (entry.weight_unit == null || entry.weight_unit === expected.weight_unit)
  && entry.load_basis === expected.load_basis
  && entry.notes === expected.notes
  && entry.duration_min == null;

/**
 * Old mirrors lack an id. Remove them only when the exact generated provenance
 * and working values have one unambiguous match. Identical collisions stay put.
 */
export function removeSessionLogEntries(
  entries: ExerciseLogEntry[], session: WorkoutSession, defaultUnit: WeightUnit,
): ExerciseLogEntry[] {
  const remaining = entries.filter(entry => entry.workout_session_id !== session.id);
  if (remaining.length !== entries.length) return remaining;
  const expected = buildSessionLogEntries(session, defaultUnit);
  // Earliest app releases always summarized in kg and omitted the unit field.
  const legacyKg = buildSessionLogEntries({ ...session,
    exercises: session.exercises.map(exercise => ({ ...exercise, weight_unit: 'kg' })),
  }, 'kg');
  const completedExercises = session.exercises.filter(exercise => doneSets(exercise.sets).length > 0);
  const groups = expected.map((entry, index) => {
    const exercise = completedExercises[index];
    const done = doneSets(exercise.sets);
    const top = topSetWeight(exercise.sets);
    const originalSummary = `${done.length}×${done.map(set => set.reps).join('/')}`
      + (top > 0 ? ` @ ${top}kg` : ' BW');
    return [entry, legacyKg[index], { ...legacyKg[index], notes: `${session.routine_name} — ${originalSummary}` }];
  });
  const matchesGroup = (entry: ExerciseLogEntry, group: ExerciseLogEntry[]) => sameLegacyEntry(entry, group[0])
    || (entry.weight_unit == null && group.slice(1).some(expected => sameLegacyEntry(entry, expected)));
  const remove = new Set<number>();
  for (const group of groups) {
    const matches = remaining.flatMap((entry, index) => matchesGroup(entry, group) ? [index] : []);
    if (matches.length === 1 && groups.filter(candidate => matchesGroup(remaining[matches[0]], candidate)).length === 1) {
      remove.add(matches[0]);
    }
  }
  return remaining.filter((_, index) => !remove.has(index));
}

/** Reject invalid edits before a write, including invalid calendar dates. */
export function validateWorkoutSessionEdit(data: WorkoutSessionEdit) {
  if (typeof data.routine_name !== 'string' || !data.routine_name.trim()) throw new Error('A workout name is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)
    || !Number.isFinite(Date.parse(`${data.date}T00:00:00Z`))
    || new Date(`${data.date}T00:00:00Z`).toISOString().slice(0, 10) !== data.date) throw new Error('A valid workout date is required');
  for (const value of [data.started_at, data.completed_at]) {
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 253402300799999)) throw new Error('Invalid workout time');
  }
  if (data.started_at != null && data.completed_at != null && data.completed_at < data.started_at) {
    throw new Error('Completion time must be after the start time');
  }
  if (!Array.isArray(data.exercises) || !data.exercises.length) throw new Error('At least one exercise is required');
  for (const exercise of data.exercises) {
    if (exercise.load_basis != null && !validLoadBasis(exercise.load_basis)) throw new Error('Invalid weight recording convention');
    if (!exercise.name?.trim() || !Array.isArray(exercise.sets) || !exercise.sets.length) throw new Error('Each exercise needs a name and at least one set');
    for (const set of exercise.sets) {
      if (!Number.isInteger(set.reps) || set.reps < 0 || !Number.isFinite(set.weight_kg) || set.weight_kg < 0 || typeof set.done !== 'boolean') {
        throw new Error('Sets require nonnegative weights and whole-number repetitions');
      }
    }
  }
}

/** Shared patch for a deliberate edit, distinct from delayed active autosaves. */
export function buildWorkoutSessionEdit(
  saved: WorkoutSession, data: WorkoutSessionEdit, timestamp: unknown,
  encodeTime: (millis: number) => unknown = millis => millis,
): WorkoutSession {
  validateWorkoutSessionEdit(data);
  if (saved.status === 'active' && data.completed_at != null) throw new Error('Finish the workout to set its completion time');
  const duration = data.started_at != null && data.completed_at != null
    ? Math.floor((data.completed_at - data.started_at) / 1000) : null;
  return {
    ...saved,
    routine_name: data.routine_name.trim(),
    day_name: data.day_name?.trim() ?? '',
    date: data.date,
    notes: data.notes?.trim() ?? '',
    exercises: data.exercises,
    exercise_additions: rememberWorkoutExerciseAdditions(saved, data.exercises),
    started_at: data.started_at != null ? encodeTime(data.started_at) : null,
    completed_at: saved.status === 'completed' && data.completed_at != null ? encodeTime(data.completed_at) : null,
    total_volume_kg: sessionVolume(data.exercises),
    ...(duration != null ? { duration_sec: duration, duration_min: Math.round(duration / 60) } : {}),
    updated_at: timestamp,
  };
}

/** Update the daily mirror without touching body measurements, food, or notes. */
export function buildEditedSessionLog(
  log: DailyLog | null, previous: WorkoutSession, edited: WorkoutSession | null,
  defaultUnit: WeightUnit, timestamp: unknown, date = edited?.date ?? previous.date,
): Partial<DailyLog> | null {
  const existing = log?.exercise_log ?? [];
  const remaining = date === previous.date ? removeSessionLogEntries(existing, previous, defaultUnit)
    : existing.filter(entry => entry.workout_session_id !== previous.id);
  const additions = edited?.status === 'completed' && edited.date === date ? buildSessionLogEntries(edited, defaultUnit) : [];
  const entries = [...remaining, ...additions];
  if (!additions.length && existing.length === entries.length) return null;
  return {
    exercise_log: entries,
    updated_at: timestamp,
    ...(!log ? { date, created_at: timestamp } : {}),
  };
}

/** Completed-history corrections never overwrite the current working defaults. */
export function buildEditedSessionRoutine(
  routine: Routine | null, previous: WorkoutSession, edited: WorkoutSession | null,
  remaining: WorkoutSession[], timestamp: unknown,
): Partial<Routine> | null {
  if (!routine) return null;
  if (previous.status === 'active') {
    if (!edited || !exerciseTargetsChanged(previous.exercises, edited.exercises)) return null;
    const defaults = carrySessionDefaults(routine, {
      ...edited,
      exercises: exercisesWithChangedDefaults(previous.exercises, edited.exercises),
    });
    return defaults ? { ...defaults, updated_at: timestamp } : null;
  }
  const completed = [...remaining.filter(session => session.id !== previous.id), ...(edited ? [edited] : [])]
    .filter(session => session.routine_id === routine.id && session.status === 'completed');
  const latest = completed.map(session => session.date).sort().at(-1) ?? null;
  return {
    session_count: completed.length,
    last_session_at: latest,
    updated_at: timestamp,
  };
}
