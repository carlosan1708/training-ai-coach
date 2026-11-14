import { loadConvention } from './loadBasis';
import { addWorkoutSession, getActiveWorkoutSessions, getRoutine, getWorkoutSession, getWorkoutSessionsPage } from '../firebase/firestore';
import type { RoutineSessionsCursor } from '../firebase/firestore';
import type { Routine, RoutineDay, SessionExercise, SessionPlan, WorkoutSession } from '../types/routine';
import type { UserProfile } from '../types/user';
import { localDateKey } from './dates';
import { findPreviousExercise, findRecordedExerciseReference, resolveExerciseDefaults, sessionMatchesDay } from './exerciseDefaults';
import { compareWorkoutSessionsNewestFirst } from './sessionOrder';
import { getExerciseWeightUnit } from './units';
import { summarizeSets } from './workout';

/** Read fresh prescriptions and return active drafts before attempting any prefill. */
export async function prepareSavedWorkout(
  uid: string,
  routine: Routine,
  day?: RoutineDay,
): Promise<{ routine: Routine; day?: RoutineDay; sessions: WorkoutSession[]; active?: WorkoutSession }> {
  const [savedRoutine, activeSessions] = await Promise.all([
    getRoutine(uid, routine.id),
    getActiveWorkoutSessions(uid),
  ]);
  if (!savedRoutine) throw new Error('Routine unavailable');
  const savedDay = day
    ? savedRoutine.days?.find(candidate => candidate.id === day.id)
    : savedRoutine.days?.[0];
  if (day && !savedDay) throw new Error('Routine day unavailable');

  const active = [...activeSessions].sort(compareWorkoutSessionsNewestFirst)
    .find(session => session.status === 'active' && sessionMatchesDay(savedRoutine, session, savedDay?.id));
  if (active) return { routine: savedRoutine, day: savedDay, sessions: [], active };

  const exercises = savedDay?.exercises ?? savedRoutine.exercises;
  if (!exercises.length) throw new Error('Routine has no exercises');
  // Source snapshots let explicit prescription changes and historical corrections
  // retain their existing precedence over automatically carried working values.
  const sourceIds = [...new Set(exercises.flatMap(exercise =>
    exercise.defaults_session_id ? [exercise.defaults_session_id] : []))];
  const sources = await Promise.all(sourceIds.map(id => getWorkoutSession(uid, id)));
  const sessions: WorkoutSession[] = [];
  let cursor: RoutineSessionsCursor | undefined;
  const needsHistory = exercises.map((exercise, index) => ({ exercise, index }))
    .filter(({ exercise, index }) => exercise.load_basis_review_required
      ? !findRecordedExerciseReference(savedRoutine, index, [], savedDay?.id)
      : !exercise.set_defaults?.length || !!exercise.defaults_session_id);
  while (needsHistory.length) {
    const page = await getWorkoutSessionsPage(uid, cursor);
    sessions.push(...page.sessions);
    const foundDates = needsHistory.map(({ exercise, index }) => exercise.load_basis_review_required
      ? findRecordedExerciseReference(savedRoutine, index, sessions, savedDay?.id)?.date
      : findPreviousExercise(savedRoutine, index, sessions, savedDay?.id)?.session.date);
    // A date can cross page boundaries. Finish it before deciding which
    // completion timestamp supplied the newest weights on that date.
    if (!page.hasMore || !page.cursor) break;
    if (foundDates.every(date => date && date > page.cursor!.date)) break;
    cursor = page.cursor;
  }
  return { routine: savedRoutine, day: savedDay,
    sessions: [...new Map([...sessions, ...sources.filter(source => source != null)]
      .map(session => [session.id, session])).values()] };
}

/** Both start buttons build a new snapshot with all completion flags reset. */
export function buildWorkoutExercises(
  routine: Routine,
  sessions: WorkoutSession[],
  day?: RoutineDay,
  profile?: UserProfile | null,
  plan?: SessionPlan | null,
): SessionExercise[] {
  const exercises = day?.exercises ?? routine.exercises;
  return exercises.map((exercise, exerciseIndex) => {
    const defaults = resolveExerciseDefaults(routine, exerciseIndex, sessions, day?.id);
    const planned = plan?.exercises.find(candidate => candidate.name.toLowerCase() === exercise.name.toLowerCase());
    const weightUnit = getExerciseWeightUnit(profile, defaults);
    const sets = planned?.sets ?? exercise.sets;
    const reps = planned?.reps ?? defaults.sets[0]?.reps ?? exercise.reps;
    const weight = planned?.weight_kg ?? defaults.sets[0]?.weight_kg ?? 0;
    return {
      name: exercise.name, ...loadConvention(exercise),
      ...(exercise.id ? { routine_exercise_id: exercise.id } : {}),
      routine_exercise_index: exerciseIndex,
      ...(exercise.targets_revision ? { targets_revision: exercise.targets_revision } : {}),
      weight_unit: weightUnit,
      ...(defaults.weight_unit_override != null ? { weight_unit_override: defaults.weight_unit_override } : {}),
      ...(exercise.notes ? { notes: exercise.notes } : {}),
      ...(exercise.gif_url ? { gif_url: exercise.gif_url } : {}),
      ...(exercise.images ? { images: exercise.images } : {}),
      ...(exercise.library_id ? { library_id: exercise.library_id } : {}),
      ...(exercise.rest_sec != null ? { rest_sec: exercise.rest_sec } : {}),
      target_sets: sets,
      target_reps: reps,
      target_weight_kg: weight,
      ...(planned?.change ? { change: planned.change } : {}),
      ...(planned?.note ? { ai_note: planned.note } : {}),
      ...(defaults.previous ? { last_summary: summarizeSets(defaults.previous.sets, weightUnit) } : {}),
      sets: Array.from({ length: sets }, (_, index) => ({
        reps: planned ? reps : defaults.sets[index]?.reps ?? reps,
        weight_kg: planned ? weight : defaults.sets[index]?.weight_kg ?? weight,
        done: false,
      })),
    };
  });
}

/** Start with current saved targets, or resume the newest matching active draft. */
export async function startSavedWorkout(
  uid: string,
  routine: Routine,
  day?: RoutineDay,
  profile?: UserProfile | null,
): Promise<string> {
  const prepared = await prepareSavedWorkout(uid, routine, day);
  if (prepared.active) return prepared.active.id;
  const { routine: savedRoutine, day: savedDay, sessions } = prepared;

  return addWorkoutSession(uid, {
    routine_id: savedRoutine.id,
    routine_name: savedRoutine.name,
    ...(savedDay ? { day_id: savedDay.id, day_name: savedDay.name } : {}),
    date: localDateKey(),
    status: 'active',
    exercises: buildWorkoutExercises(savedRoutine, sessions, savedDay, profile),
  });
}
