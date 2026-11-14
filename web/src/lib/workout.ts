import type { SessionExercise, SessionSet, WorkoutSession } from '../types/routine';
import { formatWeight, type WeightUnit } from './units';

export const doneSets = (sets: SessionSet[]) => sets.filter((s) => s.done);

/** Total kg lifted across completed sets (weight × reps). */
export const exerciseVolume = (sets: SessionSet[]) =>
  doneSets(sets).reduce((sum, s) => sum + (s.weight_kg || 0) * (s.reps || 0), 0);

export const sessionVolume = (exercises: SessionExercise[]) =>
  exercises.reduce((sum, e) => sum + exerciseVolume(e.sets), 0);

/** Heaviest completed set of an exercise. */
export const topSetWeight = (sets: SessionSet[]) =>
  doneSets(sets).reduce((max, s) => Math.max(max, s.weight_kg || 0), 0);

/** Human summary of what was done, e.g. "3×10 @ 40kg" or "3×12 BW". */
export const summarizeSets = (sets: SessionSet[], unit: WeightUnit = 'kg'): string => {
  const done = doneSets(sets);
  if (!done.length) return '—';
  const top = topSetWeight(sets);
  const reps = done.map((s) => s.reps).join('/');
  return top > 0 ? `${done.length}×${reps} @ ${formatWeight(top, unit)}` : `${done.length}×${reps} BW`;
};

export interface SessionExerciseIdentity {
  id?: string;
  previousNames?: readonly string[];
  /** An explicit empty list disables ambiguous legacy label matching. */
  legacyNames?: readonly string[];
  legacyOnly?: boolean;
  /** Physical replacements share a routine slot, but keep separate progress. */
  movementNames?: readonly string[];
  /** Null selects movement records without a saved library id. */
  movementLibraryId?: string | null;
}

export const matchesSessionExerciseMovement = (
  exercise: SessionExercise, identity?: SessionExerciseIdentity,
): boolean => {
  if (!identity?.movementNames) return true;
  if (identity.movementLibraryId === null && exercise.library_id) return false;
  if (identity.movementLibraryId && exercise.library_id) return identity.movementLibraryId === exercise.library_id;
  const key = exercise.name.trim().toLocaleLowerCase();
  return identity.movementNames.some(name => name.trim().toLocaleLowerCase() === key);
};

/** Stable IDs survive renames; only unidentified legacy entries use old labels. */
export const findSessionExercise = (
  session: WorkoutSession,
  name: string,
  identity?: SessionExerciseIdentity,
): SessionExercise | undefined => {
  if (identity?.id) {
    const identified = session.exercises.find(exercise => exercise.routine_exercise_id === identity.id
      && matchesSessionExerciseMovement(exercise, identity));
    if (identified) return identified;
  }
  const nameKey = (value: string) => value.trim().toLocaleLowerCase();
  const names = new Set((identity?.legacyNames ?? [name, ...(identity?.previousNames ?? [])]).map(nameKey));
  const legacyOnly = !!identity?.id || !!identity?.legacyOnly;
  return session.exercises.find(exercise => (!legacyOnly || !exercise.routine_exercise_id)
    && names.has(nameKey(exercise.name)) && matchesSessionExerciseMovement(exercise, identity));
};
