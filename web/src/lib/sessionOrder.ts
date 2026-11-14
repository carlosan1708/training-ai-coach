import type { WorkoutSession } from '../types/routine';

/** Firestore timestamps, serialized timestamps, and demo dates share one order. */
const timestampMillis = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (value instanceof Date) return value.getTime() || 0;
  if (!value || typeof value !== 'object') return 0;
  const timestamp = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  if (typeof timestamp.toMillis === 'function') {
    const millis = timestamp.toMillis();
    return Number.isFinite(millis) ? millis : 0;
  }
  return typeof timestamp.seconds === 'number' && Number.isFinite(timestamp.seconds)
    ? timestamp.seconds * 1000 + (timestamp.nanoseconds ?? 0) / 1_000_000
    : 0;
};

export const compareWorkoutSessionsNewestFirst = (a: WorkoutSession, b: WorkoutSession): number =>
  (b.date ?? '').localeCompare(a.date ?? '')
  || (timestampMillis(b.completed_at) || timestampMillis(b.started_at))
    - (timestampMillis(a.completed_at) || timestampMillis(a.started_at))
  || b.id.localeCompare(a.id);
