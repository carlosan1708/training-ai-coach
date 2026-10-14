import type { Routine } from '../types/routine';

/** Read both stored formats without migrating or writing back user data. */
export function normalizeRoutine(routine: Routine): Routine {
  const days = Array.isArray(routine.days)
    ? routine.days.map(day => ({
        ...day,
        exercises: Array.isArray(day.exercises) ? day.exercises : [],
      }))
    : undefined;
  return {
    ...routine,
    ...(days ? { days } : {}),
    exercises: days?.length
      ? days.flatMap(day => day.exercises)
      : Array.isArray(routine.exercises) ? routine.exercises : [],
  };
}
