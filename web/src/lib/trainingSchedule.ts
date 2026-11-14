import type { Routine, RoutineDay, Weekday, WorkoutSession } from '../types/routine';
import { isDateKey, shiftDateKey } from './dates';
import { sessionMatchesDay } from './exerciseDefaults';
import { compareWorkoutSessionsNewestFirst } from './sessionOrder';

const WEEKDAY_NAMES: readonly (readonly string[])[] = [
  ['sunday', 'domingo'],
  ['monday', 'lunes'],
  ['tuesday', 'martes'],
  ['wednesday', 'miercoles'],
  ['thursday', 'jueves'],
  ['friday', 'viernes'],
  ['saturday', 'sabado'],
];

/** Existing weekday names work immediately; explicit schedules take priority. */
export function getScheduledWeekdays(item: { name: string; scheduled_weekdays?: Weekday[] }): Weekday[] {
  if (Array.isArray(item.scheduled_weekdays)) {
    return [...new Set(item.scheduled_weekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
      .sort((a, b) => a - b);
  }
  const words = item.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/);
  return WEEKDAY_NAMES.flatMap((names, index) => names.some(name => words.includes(name)) ? [index as Weekday] : []);
}

export interface ScheduledWorkout {
  routine: Routine;
  day?: RoutineDay;
}

/** Malformed overrides must not erase a valid weekly assignment. */
function getDateOverride(routine: Routine, date: string): string[] | undefined {
  const overrides = routine.schedule_overrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
    || !Object.prototype.hasOwnProperty.call(overrides, date)) return undefined;
  const ids = overrides[date];
  return Array.isArray(ids) && ids.every(id => typeof id === 'string') ? [...new Set(ids)] : undefined;
}

export function getScheduledWorkouts(routine: Routine, date: string): ScheduledWorkout[] {
  if (!isDateKey(date)) return [];
  const weekday = new Date(date + 'T12:00:00').getDay() as Weekday;
  if (routine.days?.length) {
    const override = getDateOverride(routine, date);
    if (override) return override.flatMap(id => {
      const day = routine.days?.find(candidate => candidate.id === id);
      return day ? [{ routine, day }] : [];
    });
    return routine.days.filter(day => getScheduledWeekdays(day).includes(weekday))
      .map(day => ({ routine, day }));
  }
  return getScheduledWeekdays(routine).includes(weekday) ? [{ routine }] : [];
}

export function hasRoutineSchedule(routine: Routine): boolean {
  return routine.days?.length
    ? routine.days.some(day => getScheduledWeekdays(day).length > 0)
      || Object.keys(routine.schedule_overrides ?? {}).some(date => {
        if (!isDateKey(date)) return false;
        const ids = getDateOverride(routine, date);
        return !!ids && (!ids.length || ids.some(id => routine.days?.some(day => day.id === id)));
      })
    : getScheduledWeekdays(routine).length > 0;
}

/** Swap this date with the chosen workout's next occurrence, preserving the weekly plan. */
export function buildWorkoutDaySwap(
  routine: Routine, date: string, chosenDayId: string, displacedDayId?: string,
): { overrides: Record<string, string[]>; fromDate?: string } {
  if (!isDateKey(date)) throw new Error('A valid workout date is required');
  const chosen = routine.days?.find(day => day.id === chosenDayId);
  if (!chosen || !Array.isArray(chosen.exercises) || !chosen.exercises.length) {
    throw new Error('Choose a routine day with exercises');
  }
  const overrides = { ...routine.schedule_overrides };
  const todayIds = getScheduledWorkouts(routine, date).flatMap(workout => workout.day ? [workout.day.id] : []);
  overrides[date] = [...todayIds.filter(id => id !== displacedDayId && id !== chosenDayId), chosenDayId];
  const displaced = routine.days?.find(day => day.id === displacedDayId && day.exercises?.length);
  for (let offset = 1; offset <= 7; offset++) {
    const fromDate = shiftDateKey(date, offset);
    const futureIds = getScheduledWorkouts(routine, fromDate).flatMap(workout => workout.day ? [workout.day.id] : []);
    if (!futureIds.includes(chosenDayId)) continue;
    const swappedIds = futureIds.filter(id => id !== chosenDayId);
    if (displaced && !swappedIds.includes(displaced.id)) swappedIds.push(displaced.id);
    overrides[fromDate] = swappedIds;
    return { overrides, fromDate };
  }
  // An unscheduled choice has no date to exchange: keep today's other work pending.
  overrides[date] = [...todayIds.filter(id => id !== chosenDayId), chosenDayId];
  return { overrides };
}

/** A saved choice wins; legacy accounts default to the routine last trained. */
export function selectTrainingRoutine(
  routines: Routine[], sessions: WorkoutSession[], preferredId?: string | null,
): Routine | undefined {
  const preferred = routines.find(routine => routine.id === preferredId);
  if (preferred) return preferred;
  for (const session of [...sessions].sort(compareWorkoutSessionsNewestFirst)) {
    const routine = routines.find(candidate => candidate.id === session.routine_id);
    if (routine) return routine;
  }
  return routines[0];
}

/** Reuse legacy day matching so old session records are not counted twice. */
export function workoutMatchesSession(workout: ScheduledWorkout, session: WorkoutSession): boolean {
  return sessionMatchesDay(workout.routine, session, workout.day?.id);
}
