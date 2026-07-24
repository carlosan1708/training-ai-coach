import type { SessionExercise, SessionSet, WorkoutSession } from '../types/routine';

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
export const summarizeSets = (sets: SessionSet[]): string => {
  const done = doneSets(sets);
  if (!done.length) return '—';
  const top = topSetWeight(sets);
  const reps = done.map((s) => s.reps).join('/');
  return top > 0 ? `${done.length}×${reps} @ ${top}kg` : `${done.length}×${reps} BW`;
};

/** Find an exercise (case-insensitive) inside a past session. */
export const findSessionExercise = (
  session: WorkoutSession,
  name: string
): SessionExercise | undefined =>
  session.exercises.find((e) => e.name.toLowerCase() === name.toLowerCase());
