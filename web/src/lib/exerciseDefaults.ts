import { compatibleLoadBasis, isRecordedLoadConfirmed, loadConvention } from './loadBasis';
import type { LoadConvention, Routine, RoutineExercise, SessionExercise, SessionSet, WorkoutSession } from '../types/routine';
import type { WeightUnit } from './units';
import { compareWorkoutSessionsNewestFirst } from './sessionOrder';
import { timestampMillis } from './workoutTime';

const nameKey = (name: string) => name.trim().toLocaleLowerCase();
type SetDefault = Pick<SessionSet, 'reps' | 'weight_kg'>;
const validSets = (sets: SetDefault[] | undefined) => sets?.filter(set =>
  Number.isFinite(set.reps) && Number.isFinite(set.weight_kg));

/** Legacy sessions without a day id are used only when their day is unambiguous. */
export function sessionMatchesDay(routine: Routine, session: WorkoutSession, dayId?: string): boolean {
  if (session.routine_id !== routine.id) return false;
  if (!dayId) return !routine.days?.length || !session.day_id;
  if (session.day_id) return session.day_id === dayId;
  const day = routine.days?.find(candidate => candidate.id === dayId);
  if (!day) return false;
  const legacyDays = routine.days?.filter(candidate => candidate.includes_legacy_sessions === true);
  if (legacyDays?.length === 1) return legacyDays[0].id === dayId;
  if (session.day_name) {
    const namedDays = routine.days?.filter(candidate => [candidate.name,
      ...(Array.isArray(candidate.previous_names) ? candidate.previous_names : [])]
      .some(name => nameKey(session.day_name!) === nameKey(name)));
    if (namedDays?.length) return namedDays.length === 1 && namedDays[0].id === dayId;
  }
  if (!session.exercises.length) return false;
  const candidates = routine.days?.filter(candidate => session.exercises.every(exercise =>
    candidate.exercises.some(configured => {
      if (exercise.routine_exercise_id && configured.id) return exercise.routine_exercise_id === configured.id;
      return [configured.name, ...(Array.isArray(configured.previous_names) ? configured.previous_names : [])]
        .some(name => nameKey(name) === nameKey(exercise.name));
    })));
  return candidates?.length === 1 && candidates[0].id === dayId;
}

const configuredExercises = (routine: Routine, dayId?: string) =>
  dayId ? routine.days?.find(day => day.id === dayId)?.exercises ?? [] : routine.exercises;

function movementNames(exercise: RoutineExercise): Set<string> {
  const retired = exercise.progress_previous_exercises?.filter(previous => exercise.library_id && previous.library_id
    ? exercise.library_id !== previous.library_id : nameKey(exercise.name) !== nameKey(previous.name)) ?? [];
  const retiredNames = new Set(retired.flatMap(previous => [previous.name, ...(previous.previous_names ?? [])]).map(nameKey));
  return new Set([exercise.name, ...(exercise.previous_names ?? [])].map(nameKey).filter(name => !retiredNames.has(name)));
}

function samePhysicalExercise(exercise: RoutineExercise, previous: SessionExercise): boolean {
  if (exercise.library_id && previous.library_id) return exercise.library_id === previous.library_id;
  return movementNames(exercise).has(nameKey(previous.name));
}

function matchingExercise(exercise: RoutineExercise, index: number, sessionExercises: SessionExercise[]) {
  const exercises = sessionExercises.filter(candidate => !candidate.routine_defaults_excluded);
  if (exercise.id) {
    const identified = exercises.find(previous => previous.routine_exercise_id === exercise.id);
    if (identified) return identified;
  }
  const names = new Set([exercise.name, ...(exercise.previous_names ?? [])].map(nameKey));
  const named = exercises.filter(previous => names.has(nameKey(previous.name)));
  // Never let a deleted/replaced identified exercise fall back to another exercise's name.
  const legacy = named.filter(previous => !previous.routine_exercise_id);
  return legacy.find(previous => previous.routine_exercise_index === index)
    ?? (!legacy.some(previous => previous.routine_exercise_index != null) && legacy.includes(sessionExercises[index])
      ? sessionExercises[index] : undefined)
    ?? (legacy.length === 1 && named.length === 1 ? legacy[0] : undefined);
}

export interface RecordedExerciseReference extends LoadConvention {
  sets: SetDefault[];
  weight_unit?: WeightUnit;
  weight_unit_override?: boolean;
  date?: string;
  source: 'current' | 'history';
}

export interface ExerciseDefaults {
  sets: SessionSet[];
  weight_unit?: WeightUnit;
  weight_unit_override?: boolean;
  previous?: SessionExercise;
  /** Read-only recorded numbers; these are never substituted for blocked working values. */
  recorded?: RecordedExerciseReference;
}

export interface PreviousExercise {
  session: WorkoutSession;
  exercise: SessionExercise;
}

/** Retained values remain visible even when their convention prevents automatic reuse. */
export function findRecordedExerciseReference(
  routine: Routine, exerciseIndex: number, sessions: WorkoutSession[], dayId?: string,
): RecordedExerciseReference | undefined {
  const exercise = configuredExercises(routine, dayId)[exerciseIndex];
  if (!exercise) return undefined;
  const current = validSets(exercise.set_defaults);
  if (current?.length || typeof exercise.weight_kg === 'number' && Number.isFinite(exercise.weight_kg)) {
    return { sets: current?.length ? current.map(set => ({ reps: set.reps, weight_kg: set.weight_kg }))
      : [{ reps: exercise.reps, weight_kg: exercise.weight_kg! }], ...loadConvention(exercise),
      ...(exercise.weight_unit ? { weight_unit: exercise.weight_unit } : {}),
      ...(exercise.weight_unit_override != null ? { weight_unit_override: exercise.weight_unit_override } : {}), source: 'current' };
  }
  const names = movementNames(exercise);
  const configurations = routine.days?.length ? routine.days.flatMap(day => day.exercises) : routine.exercises;
  const legacyNames = new Set([...names].filter(name => configurations.filter(configured =>
    movementNames(configured).has(name)).length === 1));
  for (const session of [...sessions].sort(compareWorkoutSessionsNewestFirst)) {
    if (session.status !== 'completed') continue;
    const candidates = session.exercises.filter(previous => samePhysicalExercise(exercise, previous)
      && previous.sets.some(set => set.done && Number.isFinite(set.reps) && Number.isFinite(set.weight_kg)));
    let matched: SessionExercise | undefined;
    if (sessionMatchesDay(routine, session, dayId)) {
      const owned = matchingExercise(exercise, exerciseIndex, session.exercises);
      if (owned && candidates.includes(owned)) matched = owned;
    }
    if (!matched && exercise.library_id) {
      const libraryMatches = candidates.filter(previous => previous.library_id === exercise.library_id);
      if (libraryMatches.length === 1) matched = libraryMatches[0];
    }
    if (!matched) {
      const legacy = candidates.filter(previous => (!exercise.id || !previous.routine_exercise_id)
        && (!exercise.library_id || !previous.library_id || exercise.library_id === previous.library_id)
        && legacyNames.has(nameKey(previous.name)));
      if (legacy.length === 1) matched = legacy[0];
    }
    const sets = validSets(matched?.sets.filter(set => set.done));
    if (matched && sets?.length) return {
      sets: sets.map(set => ({ reps: set.reps, weight_kg: set.weight_kg })), ...loadConvention(matched),
      ...(matched.weight_unit ? { weight_unit: matched.weight_unit } : {}),
      ...(matched.weight_unit_override != null ? { weight_unit_override: matched.weight_unit_override } : {}),
      date: session.date, source: 'history',
    };
  }
  return undefined;
}

/** Own working values retain their identity; other days need a completed, exact match. */
export function findPreviousExercise(
  routine: Routine, exerciseIndex: number, sessions: WorkoutSession[], dayId?: string,
): PreviousExercise | undefined {
  const exercise = configuredExercises(routine, dayId)[exerciseIndex];
  if (!exercise) return undefined;
  const names = new Set([exercise.name, ...(exercise.previous_names ?? [])].map(nameKey));
  const configurations = routine.days?.length
    ? routine.days.flatMap(day => day.exercises) : routine.exercises;
  const legacyNames = new Set([...names].filter(name => configurations.filter(configured =>
    [configured.name, ...(configured.previous_names ?? [])].some(label => nameKey(label) === name)).length === 1));
  for (const session of [...sessions].sort(compareWorkoutSessionsNewestFirst)) {
    if (sessionMatchesDay(routine, session, dayId)) {
      const previous = matchingExercise(exercise, exerciseIndex, session.exercises);
      if (previous && previous.targets_revision === exercise.targets_revision
        && compatibleLoadBasis(exercise, previous) && validSets(previous.sets)?.length) {
        return { session, exercise: previous };
      }
      // A replacement or explicit prescription change cannot reuse its old same-day identity.
      continue;
    }
    if (session.status !== 'completed') continue;
    const candidates = session.exercises.filter(previous => !previous.routine_defaults_excluded
      && compatibleLoadBasis(exercise, previous)
      && validSets(previous.sets.filter(set => set.done))?.length);
    const identified = exercise.id
      ? candidates.find(previous => previous.routine_exercise_id === exercise.id
        && previous.targets_revision === exercise.targets_revision)
      : undefined;
    if (identified) return { session, exercise: identified };
    const libraryMatches = exercise.library_id ? candidates.filter(previous =>
      previous.library_id === exercise.library_id
      && (!exercise.id || previous.routine_exercise_id !== exercise.id)) : [];
    if (libraryMatches.length === 1) return { session, exercise: libraryMatches[0] };
    if (libraryMatches.length > 1) continue;
    const legacyMatches = candidates.filter(previous =>
      (!exercise.id || !previous.routine_exercise_id)
      && (!exercise.library_id || !previous.library_id || exercise.library_id === previous.library_id)
      && legacyNames.has(nameKey(previous.name)));
    if (legacyMatches.length === 1) return { session, exercise: legacyMatches[0] };
  }
  return undefined;
}

/** Last entered values are reused per set, including zero and lower loads/reps. */
export function resolveExerciseDefaults(
  routine: Routine, exerciseIndex: number, sessions: WorkoutSession[], dayId?: string
): ExerciseDefaults {
  const exercise = configuredExercises(routine, dayId)[exerciseIndex];
  if (!exercise) return { sets: [] };
  const match = findPreviousExercise(routine, exerciseIndex, sessions, dayId);
  const previous = match?.exercise;
  const savedDefaults = validSets(exercise.set_defaults);
  let usePrevious = !!match;
  if (savedDefaults?.length && !exercise.defaults_session_id) usePrevious = false;
  if (exercise.defaults_session_id) {
    const source = sessions.find(session => session.id === exercise.defaults_session_id);
    const sourceExercise = source && sessionMatchesDay(routine, source, dayId)
      ? matchingExercise(exercise, exerciseIndex, source.exercises) : undefined;
    // A historical correction is not permission to rewrite current working defaults.
    usePrevious = !!match && match.session.id !== exercise.defaults_session_id
      && !!source && !!sourceExercise
      && sourceExercise.targets_revision === exercise.targets_revision
      && compatibleLoadBasis(exercise, sourceExercise)
      && compareWorkoutSessionsNewestFirst(match.session, source) < 0;
  }
  const foreign = !!match && !sessionMatchesDay(routine, match.session, dayId);
  const defaults = usePrevious && !foreign ? validSets(previous?.sets) : savedDefaults;
  const foreignWeights = usePrevious && foreign
    ? validSets(previous?.sets.filter(set => set.done)) : undefined;
  const sets = Array.from({ length: exercise.sets }, (_, index) => {
    const saved = defaults?.[index] ?? defaults?.at(-1);
    const foreignWeight = foreignWeights?.[index] ?? foreignWeights?.at(-1);
    return { reps: saved?.reps ?? exercise.reps,
      weight_kg: exercise.load_basis_review_required ? 0 : foreignWeight?.weight_kg ?? saved?.weight_kg ?? exercise.weight_kg ?? 0,
      done: false };
  });
  const explicitDefaults = !!exercise.targets_revision || !!savedDefaults?.length || !!exercise.defaults_session_id;
  const unitSource = usePrevious && previous?.weight_unit ? previous : explicitDefaults
    ? (exercise.weight_unit ? exercise : previous)
    : (previous?.weight_unit ? previous : exercise);
  return { sets, weight_unit: unitSource?.weight_unit,
    weight_unit_override: unitSource?.weight_unit_override, previous,
    ...(exercise.load_basis_review_required ? { recorded: findRecordedExerciseReference(routine, exerciseIndex, sessions, dayId) } : {}),
  };
}

/** Atomic session saves use this patch; explicit routine edits invalidate older sessions. */
export function carrySessionDefaults(
  routine: Routine, session: WorkoutSession
): Partial<Pick<Routine, 'days' | 'exercises'>> | null {
  if (routine.id !== session.routine_id) return null;
  const dayId = routine.days?.length
    ? session.day_id ?? routine.days.find(day => sessionMatchesDay(routine, session, day.id))?.id
    : undefined;
  if (routine.days?.length && !dayId) return null;
  const exercises = configuredExercises(routine, dayId);
  let changed = false;
  const nextExercises = exercises.map((exercise, index) => {
    const saved = matchingExercise(exercise, index, session.exercises);
    if (!saved || saved.targets_revision !== exercise.targets_revision) return exercise;
    if (exercise.library_id && saved.library_id && exercise.library_id !== saved.library_id) return exercise;
    const confirmed = isRecordedLoadConfirmed(saved);
    if (saved.load_basis !== exercise.load_basis && !confirmed) return exercise;
    if (saved.load_basis !== exercise.load_basis && exercise.id && saved.routine_exercise_id !== exercise.id) return exercise;
    if (saved.load_basis_review_required && !saved.sets.some(set => set.done)) return exercise;
    if (exercise.load_basis_review_required && !confirmed && !saved.sets.some(set => set.done)) return exercise;
    const defaults = validSets(saved.sets);
    if (!defaults?.length) return exercise;
    const oldDefaults = validSets(exercise.set_defaults);
    const sameSets = oldDefaults?.length === defaults.length
      ? defaults.every((set, i) => set.reps === oldDefaults[i].reps && set.weight_kg === oldDefaults[i].weight_kg)
      : !oldDefaults?.length && defaults.length === exercise.sets
        && defaults.every(set => set.reps === exercise.reps && set.weight_kg === (exercise.weight_kg ?? 0));
    const sameUnit = !saved.weight_unit || (saved.weight_unit === exercise.weight_unit
      && Boolean(saved.weight_unit_override) === Boolean(exercise.weight_unit_override));
    const sameConvention = !exercise.load_basis_review_required && (!confirmed || (
      exercise.load_basis === saved.load_basis && exercise.load_basis_confirmed === true
      && (!saved.load_basis_note || exercise.load_basis_note === saved.load_basis_note)));
    if (sameSets && sameUnit && sameConvention && exercise.defaults_session_id === session.id) return exercise;
    changed = true;
    return {
      ...exercise,
      ...(!sameSets ? { set_defaults: defaults.map(set => ({ reps: set.reps, weight_kg: set.weight_kg })) } : {}),
      ...(saved.weight_unit ? { weight_unit: saved.weight_unit,
        weight_unit_override: Boolean(saved.weight_unit_override) } : {}),
      ...(confirmed ? { load_basis: saved.load_basis, load_basis_confirmed: true,
        ...(saved.load_basis_note ? { load_basis_note: saved.load_basis_note } : {}) } : {}),
      ...(exercise.load_basis_review_required ? { load_basis_review_required: false } : {}),
      defaults_session_id: session.id,
    };
  });
  if (!changed) return null;
  return dayId && routine.days
    ? { days: routine.days.map(day => day.id === dayId ? { ...day, exercises: nextExercises } : day) }
    : { exercises: nextExercises };
}

/** Capture before the first write, including AI starts and explicit draft edits. */
export function rememberSessionDefaults(routine: Routine, session: WorkoutSession, writtenAt: unknown) {
  return {
    routine_defaults_before: session.routine_defaults_before ?? routine,
    routine_defaults_written_at: writtenAt,
  };
}

const sameValue = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftObject = left as Record<string, unknown>, rightObject = right as Record<string, unknown>;
  const keys = Object.keys(leftObject).filter(key => leftObject[key] !== undefined);
  return keys.length === Object.keys(rightObject).filter(key => rightObject[key] !== undefined).length
    && keys.every(key => sameValue(leftObject[key], rightObject[key]));
};

/** Revert only this draft's defaults; newer sessions and explicit target revisions win. */
export function rollbackSessionDefaults(routine: Routine, session: WorkoutSession) {
  const before = session.routine_defaults_before;
  if (!before || before.id !== routine.id) return null;
  let changed = false;
  const restore = (exercises: RoutineExercise[], originals: RoutineExercise[]) => exercises.map((exercise, index) => {
    if (exercise.defaults_session_id !== session.id) return exercise;
    const original = exercise.id ? originals.find(candidate => candidate.id === exercise.id)
      : originals[index]?.name === exercise.name && !originals[index]?.id ? originals[index] : undefined;
    if (!original || original.targets_revision !== exercise.targets_revision) return exercise;
    const restored = { ...exercise };
    for (const key of ['set_defaults', 'weight_unit', 'weight_unit_override', 'defaults_session_id',
      'load_basis', 'load_basis_note', 'load_basis_confirmed', 'load_basis_review_required'] as const) {
      delete restored[key];
      if (original[key] !== undefined) Object.assign(restored, { [key]: original[key] });
    }
    changed = true;
    return restored;
  });
  // Older multi-day documents may omit the flat mirror entirely.
  const exercises = Array.isArray(routine.exercises) ? restore(routine.exercises, before.exercises ?? []) : undefined;
  const days = routine.days?.map(day => Array.isArray(day.exercises) ? { ...day,
    exercises: restore(day.exercises, before.days?.find(original => original.id === day.id)?.exercises ?? []),
  } : day);
  if (!changed) return null;
  const defaults: Partial<Pick<Routine, 'exercises' | 'days' | 'updated_at'>> = {
    ...(exercises ? { exercises } : {}), ...(days ? { days } : {}),
  };
  const { updated_at: currentUpdated, ...currentState } = { ...routine, ...defaults };
  const { updated_at: previousUpdated, ...previousState } = before;
  const restoreTimestamp = timestampMillis(currentUpdated) === timestampMillis(session.routine_defaults_written_at)
    && sameValue(currentState, previousState);
  if (restoreTimestamp && previousUpdated !== undefined) defaults.updated_at = previousUpdated;
  return { defaults, removeUpdatedAt: restoreTimestamp && previousUpdated === undefined };
}

/** Carry only explicitly edited notes to the same current routine exercise. */
export function carryExerciseNotes(routine: Routine, before: WorkoutSession, exercises: SessionExercise[]) {
  const dayId = routine.days?.length
    ? before.day_id ?? routine.days.find(day => sessionMatchesDay(routine, before, day.id))?.id : undefined;
  if (routine.id !== before.routine_id || (routine.days?.length && !dayId)) return null;
  let changed = false;
  const next = configuredExercises(routine, dayId).map((exercise, index) => {
    const old = matchingExercise(exercise, index, before.exercises);
    const edited = matchingExercise(exercise, index, exercises);
    if (!old || !edited || (old.notes ?? '') === (edited.notes ?? '')
      || edited.targets_revision !== exercise.targets_revision || !samePhysicalExercise(exercise, edited)) return exercise;
    changed = true;
    return { ...exercise, notes: edited.notes ?? '' };
  });
  return !changed ? null : dayId && routine.days
    ? { days: routine.days.map(day => day.id === dayId ? { ...day, exercises: next } : day) }
    : { exercises: next };
}
