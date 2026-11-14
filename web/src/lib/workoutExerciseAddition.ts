import { loadConvention } from './loadBasis';
import type {
  Routine, RoutineDay, RoutineExercise, SessionExercise, WorkoutExerciseSubstitutionSource, WorkoutSession,
} from '../types/routine';
import { sessionMatchesDay } from './exerciseDefaults';

/** Firestore maps can return in a different key order without changing their values. */
const metadataSignature = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    : item);

/** Already saved request signatures used insertion order; accept those same values. */
const sameRequestSignature = (saved: string, current: string): boolean => {
  if (saved === current) return true;
  try { return metadataSignature(JSON.parse(saved)) === current; }
  catch { return false; }
};

/** Retain applied IDs across removal and learn older marker-only manual entries. */
export function rememberWorkoutExerciseAdditions(
  saved: WorkoutSession, exercises: SessionExercise[] = saved.exercises,
): Record<string, boolean> {
  const additions = Object.fromEntries(Object.entries(saved.exercise_additions ?? {})
    .filter(([, permanent]) => typeof permanent === 'boolean'));
  for (const exercise of [...saved.exercises, ...exercises]) {
    if (exercise.routine_addition && exercise.routine_exercise_id) {
      const id = exercise.routine_exercise_id;
      const permanent = Object.prototype.hasOwnProperty.call(additions, id) && additions[id] === true;
      Object.defineProperty(additions, id, {
        value: permanent || !exercise.routine_defaults_excluded, enumerable: true, configurable: true, writable: true,
      });
    }
  }
  return additions;
}

/** Autosave/completion cannot erase an addition or undo its separately saved scope. */
export function assertWorkoutAdditionsPreserved(saved: WorkoutSession, exercises: SessionExercise[]): void {
  const stale = () => new Error('This workout changed. Reload before saving to preserve its added exercises and their scope.');
  for (const addition of saved.exercises.filter(exercise => exercise.routine_addition && exercise.routine_exercise_id)) {
    const candidates = exercises.filter(exercise => exercise.routine_addition
      && exercise.routine_exercise_id === addition.routine_exercise_id);
    const candidate = candidates[0];
    if (candidates.length !== 1 || candidate.routine_addition !== true
      || Boolean(candidate.routine_defaults_excluded) !== Boolean(addition.routine_defaults_excluded)
      || candidate.targets_revision !== addition.targets_revision) {
      throw stale();
    }
  }
  for (const addition of exercises.filter(exercise => exercise.routine_addition && exercise.routine_exercise_id)) {
    if (!saved.exercises.some(exercise => exercise.routine_addition
      && exercise.routine_exercise_id === addition.routine_exercise_id)) throw stale();
  }
  const structure = (exercise: SessionExercise) => metadataSignature([
    exercise.name, exercise.library_id ?? null, exercise.routine_exercise_id ?? null,
    exercise.routine_exercise_index ?? null, exercise.targets_revision ?? null,
    Boolean(exercise.routine_addition), Boolean(exercise.routine_defaults_excluded), exercise.exercise_substitution,
  ]);
  for (const substituted of saved.exercises.filter(exercise => exercise.exercise_substitution)) {
    const marker = substituted.exercise_substitution!;
    const candidates = exercises.filter(exercise => exercise.exercise_substitution?.request_id === marker.request_id
      && exercise.exercise_substitution.role === marker.role);
    if (candidates.length !== 1 || structure(candidates[0]) !== structure(substituted)) throw stale();
  }
  for (const substituted of exercises.filter(exercise => exercise.exercise_substitution)) {
    const marker = substituted.exercise_substitution!;
    if (!saved.exercises.some(exercise => exercise.exercise_substitution?.request_id === marker.request_id
      && exercise.exercise_substitution.role === marker.role)) throw stale();
  }
}

/** Carry input only: unchanged rows are excluded without moving legacy positions. */
export function exercisesWithChangedDefaults(before: SessionExercise[], after: SessionExercise[]): SessionExercise[] {
  const values = (exercise: SessionExercise) => JSON.stringify([
    exercise.load_basis ?? null, Boolean(exercise.load_basis_confirmed), Boolean(exercise.load_basis_review_required),
    exercise.load_basis_note ?? null, exercise.weight_unit ?? null, Boolean(exercise.weight_unit_override),
    exercise.sets.map(set => [set.reps, set.weight_kg]),
  ]);
  return after.map((exercise, index) => {
    if (exercise.routine_defaults_excluded) return exercise;
    let previous: SessionExercise | undefined;
    if (exercise.routine_exercise_id) {
      previous = before.find(candidate => !candidate.routine_defaults_excluded
        && candidate.routine_exercise_id === exercise.routine_exercise_id);
    } else {
      const candidates = before.filter(candidate => !candidate.routine_exercise_id
        && candidate.name === exercise.name && (exercise.routine_exercise_index == null
          || candidate.routine_exercise_index === exercise.routine_exercise_index));
      previous = candidates.length === 1 ? candidates[0]
        : candidates.includes(before[index]) ? before[index] : undefined;
    }
    return previous && values(previous) === values(exercise)
      ? { ...exercise, routine_defaults_excluded: true } : exercise;
  });
}

/** Generate once before a transaction; callers can keep the id for safe retries. */
export function prepareWorkoutExerciseAddition(exercise: RoutineExercise): RoutineExercise {
  const id = exercise.id?.trim() || crypto.randomUUID();
  const configured: RoutineExercise = {
    ...exercise, id, name: exercise.name.trim(),
    targets_revision: exercise.targets_revision || `addition:${id}`,
  };
  delete configured.defaults_session_id;
  if (!configured.name || !Number.isInteger(configured.sets) || configured.sets < 1
    || !Number.isInteger(configured.reps) || configured.reps < 0
    || (configured.weight_kg != null && (!Number.isFinite(configured.weight_kg) || configured.weight_kg < 0))
    || (configured.rest_sec != null && (!Number.isFinite(configured.rest_sec) || configured.rest_sec < 0))) {
    throw new Error('An exercise needs a name, positive whole-number sets and valid working values');
  }
  if (configured.set_defaults?.some(set => !Number.isInteger(set.reps) || set.reps < 0
    || !Number.isFinite(set.weight_kg) || set.weight_kg < 0)) {
    throw new Error('Exercise defaults require whole-number repetitions and finite weights');
  }
  return configured;
}

function matchingDay(routine: Routine, session: WorkoutSession): RoutineDay | undefined {
  if (session.day_id) return routine.days?.find(day => day.id === session.day_id);
  const candidates = routine.days?.filter(day => sessionMatchesDay(routine, session, day.id));
  return candidates?.length === 1 ? candidates[0] : undefined;
}

function appendConfiguration(routine: Routine, exercise: RoutineExercise, day?: RoutineDay): Partial<Routine> {
  return day ? withCanonicalMirror(routine, routine.days!.map(candidate => candidate.id === day.id
    ? { ...candidate, exercises: [...candidate.exercises, exercise] } : candidate))
    : { exercises: [...(routine.exercises ?? []), exercise] };
}

/** Some older flat arrays own independent legacy data and must not be replaced by a day mirror. */
function withCanonicalMirror(routine: Routine, days: RoutineDay[]): Partial<Routine> {
  const canonical = metadataSignature(routine.exercises) === metadataSignature(routine.days?.flatMap(day => day.exercises));
  return { days, ...(canonical ? { exercises: days.flatMap(day => day.exercises) } : {}) };
}

/** Keep an explicit template addition when this draft's later working edits are discarded. */
function rebaseDefaultsBackup(
  before: Routine, current: Routine, exercise: RoutineExercise, day: RoutineDay | undefined, timestamp: unknown,
): Routine {
  if (!day) return { ...before, exercises: [...(before.exercises ?? []), exercise], updated_at: timestamp };
  let days = before.days;
  if (!days?.length) {
    days = current.days?.filter(candidate => candidate.includes_legacy_sessions)
      .map(candidate => ({ ...candidate, exercises: [...(before.exercises ?? [])] })) ?? [];
  }
  const previousDay = days.find(candidate => candidate.id === day.id);
  return {
    ...before, updated_at: timestamp,
    days: previousDay ? days.map(candidate => candidate.id === day.id
      ? { ...candidate, exercises: [...candidate.exercises, exercise] } : candidate)
      : [...days, { ...day, exercises: [exercise] }],
  };
}

function sessionExercise(exercise: RoutineExercise, index: number, permanent: boolean): SessionExercise {
  const defaults = exercise.set_defaults;
  const sets = Array.from({ length: exercise.sets }, (_, position) => {
    const saved = defaults?.[position] ?? defaults?.at(-1);
    return { reps: saved?.reps ?? exercise.reps, weight_kg: saved?.weight_kg ?? exercise.weight_kg ?? 0, done: false };
  });
  return {
    name: exercise.name, ...loadConvention(exercise), routine_addition: true, routine_exercise_id: exercise.id,
    ...(permanent ? { routine_exercise_index: index } : { routine_defaults_excluded: true }),
    targets_revision: exercise.targets_revision,
    ...(exercise.weight_unit ? { weight_unit: exercise.weight_unit } : {}),
    ...(exercise.weight_unit_override != null ? { weight_unit_override: exercise.weight_unit_override } : {}),
    ...(exercise.notes ? { notes: exercise.notes } : {}),
    ...(exercise.gif_url ? { gif_url: exercise.gif_url } : {}),
    ...(exercise.images ? { images: [...exercise.images] } : {}),
    ...(exercise.library_id ? { library_id: exercise.library_id } : {}),
    ...(exercise.rest_sec != null ? { rest_sec: exercise.rest_sec } : {}),
    target_sets: exercise.sets, target_reps: sets[0].reps, target_weight_kg: sets[0].weight_kg, sets,
  };
}

export interface WorkoutExerciseAddition {
  session: WorkoutSession;
  sessionData: Partial<Omit<WorkoutSession, 'id'>> | null;
  routineData: Partial<Routine> | null;
}

/** Pure atomic patch shared by Firestore and the offline demo. */
export function buildWorkoutExerciseAddition(
  saved: WorkoutSession, routine: Routine | null, exercise: RoutineExercise, permanent: boolean, timestamp: unknown,
): WorkoutExerciseAddition {
  if (saved.status !== 'active') throw new Error('Only an active workout can receive an exercise');
  const configured = prepareWorkoutExerciseAddition(exercise);
  const day = routine ? matchingDay(routine, saved) : undefined;
  if (permanent && (!routine || (routine.days?.length || saved.day_id) && !day)) {
    throw new Error('The workout routine or its training day is no longer available');
  }
  const additions = rememberWorkoutExerciseAdditions(saved);
  const applied = Object.prototype.hasOwnProperty.call(additions, configured.id!) ? additions[configured.id!] : undefined;
  const target = day?.exercises ?? routine?.exercises ?? [];
  const unchanged = (): WorkoutExerciseAddition => {
    const previous = saved.exercise_additions ?? {};
    const same = Object.keys(previous).length === Object.keys(additions).length
      && Object.keys(additions).every(id => Object.prototype.hasOwnProperty.call(previous, id) && previous[id] === additions[id]);
    return same ? { session: saved, sessionData: null, routineData: null } : {
      session: { ...saved, exercise_additions: additions }, sessionData: { exercise_additions: additions }, routineData: null,
    };
  };
  // A lost response may be retried after this entry was promoted or deliberately removed.
  if (typeof applied === 'boolean' && !permanent) return unchanged();
  if (applied === true && permanent) {
    if (!target.some(candidate => candidate.id === configured.id)) throw new Error('The saved routine exercise is no longer available');
    return unchanged();
  }
  const existing = saved.exercises.find(candidate => candidate.routine_exercise_id === configured.id);
  if (applied === false && permanent && (!existing?.routine_addition || !existing.routine_defaults_excluded)) {
    throw new Error('The temporary exercise is no longer available to save in the routine');
  }
  if (existing && !existing.routine_addition) throw new Error('The exercise id belongs to an existing workout exercise');
  const configuredExercises = routine?.days?.length
    ? routine.days.flatMap(candidate => candidate.exercises) : routine?.exercises ?? [];
  const collision = configuredExercises.find(candidate => candidate.id === configured.id);
  if (existing && !existing.routine_defaults_excluded) {
    if (!permanent) throw new Error('This exercise is already saved in the routine');
    if (!target.some(candidate => candidate.id === configured.id)) throw new Error('The saved routine exercise is no longer available');
    return unchanged();
  }
  if (collision) throw new Error('The exercise id already belongs to the routine');
  if (existing && !permanent) return unchanged();

  // Promotion uses fresh saved values and never discards an entered or completed set.
  const permanentConfig: RoutineExercise = existing ? prepareWorkoutExerciseAddition({
    ...configured, name: existing.name, sets: existing.sets.length,
    reps: existing.target_reps, weight_kg: existing.target_weight_kg ?? existing.sets[0]?.weight_kg ?? 0,
    targets_revision: existing.targets_revision || configured.targets_revision,
    set_defaults: existing.sets.map(set => ({ reps: set.reps, weight_kg: set.weight_kg })),
    ...(existing.weight_unit ? { weight_unit: existing.weight_unit } : {}),
    ...(existing.weight_unit_override != null ? { weight_unit_override: existing.weight_unit_override } : {}),
    ...(existing.notes != null ? { notes: existing.notes } : {}),
    ...(existing.gif_url != null ? { gif_url: existing.gif_url } : {}),
    ...(existing.images ? { images: [...existing.images] } : {}),
    ...(existing.library_id != null ? { library_id: existing.library_id } : {}),
    ...(existing.rest_sec != null ? { rest_sec: existing.rest_sec } : {}),
  }) : configured;
  const index = day?.exercises.length ?? routine?.exercises?.length ?? 0;
  const added = existing ? { ...existing, routine_exercise_index: index,
    targets_revision: permanentConfig.targets_revision } : sessionExercise(configured, index, permanent);
  if (permanent) delete added.routine_defaults_excluded;
  Object.defineProperty(additions, configured.id!, {
    value: permanent, enumerable: true, configurable: true, writable: true,
  });
  const sessionData: Partial<Omit<WorkoutSession, 'id'>> = {
    exercises: existing ? saved.exercises.map(candidate => candidate === existing ? added : candidate)
      : [...saved.exercises, added],
    updated_at: timestamp,
    exercise_additions: additions,
    ...(!saved.day_id && day ? { day_id: day.id, day_name: saved.day_name ?? day.name } : {}),
  };
  if (permanent && routine && saved.routine_defaults_before?.id === routine.id) {
    sessionData.routine_defaults_before = rebaseDefaultsBackup(
      saved.routine_defaults_before, routine, permanentConfig, day, timestamp,
    );
  }
  const routineData = permanent && routine
    ? { ...appendConfiguration(routine, permanentConfig, day), updated_at: timestamp } : null;
  return { session: { ...saved, ...sessionData }, sessionData, routineData };
}

/** An explicit structural edit keeps completed sets and leaves every template untouched. */
export function buildWorkoutExerciseSubstitution(
  saved: WorkoutSession, exerciseIndex: number, expected: SessionExercise,
  alternative: RoutineExercise, reason: string, timestamp: unknown,
): WorkoutSession {
  if (saved.status !== 'active') throw new Error('Only an active workout can replace an exercise');
  const original = saved.exercises[exerciseIndex];
  const signature = (exercise: SessionExercise) => JSON.stringify([
    exercise.name, exercise.routine_exercise_id ?? null, exercise.routine_exercise_index ?? null,
    exercise.targets_revision ?? null, Boolean(exercise.routine_addition), Boolean(exercise.routine_defaults_excluded),
    exercise.load_basis ?? null, exercise.weight_unit ?? null, Boolean(exercise.weight_unit_override),
    exercise.target_sets, exercise.target_reps, exercise.target_weight_kg ?? null,
    exercise.sets.map(set => [set.reps, set.weight_kg, Boolean(set.done)]),
  ]);
  if (!Number.isInteger(exerciseIndex) || exerciseIndex < 0 || !original || signature(original) !== signature(expected)) {
    throw new Error('This exercise changed. Reload the workout before choosing an alternative.');
  }
  const completed = original.sets.filter(set => set.done);
  const remaining = original.sets.length - completed.length;
  if (!remaining) throw new Error('This exercise has no unfinished sets to replace');
  const configured = prepareWorkoutExerciseAddition(alternative);
  const retained = { ...original, sets: completed, routine_defaults_excluded: true };
  delete retained.routine_addition;
  const rest = configured.rest_sec ?? original.rest_sec;
  const replacement: SessionExercise = {
    name: configured.name, ...loadConvention(configured), routine_defaults_excluded: true,
    target_sets: remaining, target_reps: configured.reps, target_weight_kg: configured.weight_kg ?? 0,
    ...(original.weight_unit ? { weight_unit: original.weight_unit } : {}),
    ...(original.weight_unit_override != null ? { weight_unit_override: original.weight_unit_override } : {}),
    ...(configured.notes ? { notes: configured.notes } : {}),
    ...(configured.gif_url ? { gif_url: configured.gif_url } : {}),
    ...(configured.images ? { images: [...configured.images] } : {}),
    ...(configured.library_id ? { library_id: configured.library_id } : {}),
    ...(rest != null ? { rest_sec: rest } : {}),
    ...(reason.trim() ? { ai_note: reason.trim() } : {}),
    sets: Array.from({ length: remaining }, () => ({ reps: configured.reps, weight_kg: configured.weight_kg ?? 0, done: false })),
  };
  const exercises = [...saved.exercises];
  exercises.splice(exerciseIndex, 1, ...(completed.length ? [retained, replacement] : [replacement]));
  const additions = rememberWorkoutExerciseAdditions(saved);
  return { ...saved, exercises, updated_at: timestamp,
    ...(Object.keys(additions).length ? { exercise_additions: additions } : {}),
  };
}

const substitutionSnapshot = (exercise: SessionExercise) => metadataSignature([
  exercise.name, exercise.library_id ?? null, exercise.routine_exercise_id ?? null,
  exercise.routine_exercise_index ?? null, exercise.targets_revision ?? null,
  Boolean(exercise.routine_addition), Boolean(exercise.routine_defaults_excluded),
  exercise.load_basis ?? null, Boolean(exercise.load_basis_review_required),
  exercise.weight_unit ?? null, Boolean(exercise.weight_unit_override),
  exercise.target_sets, exercise.target_reps, exercise.target_weight_kg ?? null,
  exercise.sets.map(set => [set.reps, set.weight_kg, Boolean(set.done)]), exercise.exercise_substitution ?? null,
]);

function substitutionSource(
  exercise: SessionExercise, dayId?: string,
): WorkoutExerciseSubstitutionSource {
  return exercise.exercise_substitution?.source ?? {
    name: exercise.name, target_sets: exercise.target_sets, ...loadConvention(exercise),
    ...(dayId ? { day_id: dayId } : {}),
    ...(exercise.routine_exercise_id ? { routine_exercise_id: exercise.routine_exercise_id } : {}),
    ...(exercise.routine_exercise_index != null ? { routine_exercise_index: exercise.routine_exercise_index } : {}),
    ...(exercise.targets_revision ? { targets_revision: exercise.targets_revision } : {}),
    ...(exercise.library_id ? { library_id: exercise.library_id } : {}),
    ...(exercise.routine_addition ? { routine_addition: true } : {}),
    ...(exercise.routine_defaults_excluded ? { routine_defaults_excluded: true } : {}),
  };
}

function replaceConfiguration(
  routine: Routine, exercise: RoutineExercise, day: RoutineDay | undefined, index: number,
): Partial<Routine> {
  const replace = (exercises: RoutineExercise[]) => exercises.map((candidate, position) => position === index ? exercise : candidate);
  return day ? withCanonicalMirror(routine, routine.days!.map(candidate => candidate.id === day.id
    ? { ...candidate, exercises: replace(candidate.exercises) } : candidate))
    : { exercises: replace(routine.exercises) };
}

/** A later draft discard must restore this explicitly accepted template, including its new identity. */
function rebaseSubstitutionBackup(
  before: Routine, current: Routine, original: RoutineExercise, replacement: RoutineExercise,
  day: RoutineDay | undefined, index: number, timestamp: unknown,
): Routine {
  const names = new Set([original.name, ...(original.previous_names ?? [])]);
  const replace = (exercises: RoutineExercise[], insert: boolean) => {
    const position = original.id ? exercises.findIndex(candidate => candidate.id === original.id) : -1;
    const legacy = position < 0 && !exercises[index]?.id && names.has(exercises[index]?.name) ? index : position;
    if (legacy >= 0) return exercises.map((candidate, candidateIndex) => candidateIndex === legacy ? replacement : candidate);
    if (!insert) return exercises;
    const result = [...exercises];
    result.splice(Math.min(index, result.length), 0, replacement);
    return result;
  };
  if (!day) return { ...before, exercises: replace(before.exercises ?? [], true), updated_at: timestamp };
  const days = before.days?.length ? before.days : current.days?.filter(candidate => candidate.includes_legacy_sessions)
    .map(candidate => ({ ...candidate, exercises: [...(before.exercises ?? [])] })) ?? [];
  const previousDay = days.find(candidate => candidate.id === day.id);
  const canonical = metadataSignature(before.exercises) === metadataSignature(before.days?.flatMap(candidate => candidate.exercises));
  const legacyOwner = !before.days?.length && day.includes_legacy_sessions;
  return {
    ...before, updated_at: timestamp,
    ...(Array.isArray(before.exercises) && (canonical || legacyOwner) ? { exercises: replace(before.exercises, false) } : {}),
    days: previousDay ? days.map(candidate => candidate.id === day.id
      ? { ...candidate, exercises: replace(candidate.exercises, true) } : candidate)
      : [...days, { ...day, exercises: [replacement] }],
  };
}

/** Accept a one-workout alternative, or atomically replace its exact current template ownership. */
export function buildWorkoutExerciseSubstitutionChanges(
  saved: WorkoutSession, routine: Routine | null, exerciseIndex: number, expected: SessionExercise,
  alternative: RoutineExercise, reason: string, permanent: boolean, timestamp: unknown,
): WorkoutExerciseAddition {
  const configured = prepareWorkoutExerciseAddition(alternative);
  const requestId = configured.id!;
  const sourceSignature = substitutionSnapshot(expected);
  const alternativeSignature = metadataSignature([
    configured.name, configured.library_id ?? null, configured.sets, configured.reps, configured.weight_kg ?? null,
    loadConvention(configured), configured.weight_unit ?? null, Boolean(configured.weight_unit_override),
    configured.set_defaults ?? null, configured.rest_sec ?? null, configured.notes ?? null,
    configured.gif_url ?? null, configured.images ?? null, reason.trim(),
  ]);
  const requests = { ...(saved.exercise_substitutions ?? {}) };
  const applied = Object.prototype.hasOwnProperty.call(requests, requestId) ? requests[requestId] : undefined;
  if (applied) {
    if (applied.permanent !== permanent || applied.source_index !== exerciseIndex
      || !sameRequestSignature(applied.source_signature, sourceSignature) || !sameRequestSignature(applied.alternative_signature, alternativeSignature)) {
      throw new Error('This alternative request was already used. Reload before choosing another alternative.');
    }
    return { session: saved, sessionData: null, routineData: null };
  }
  const original = saved.exercises[exerciseIndex];
  if (!original || substitutionSnapshot(original) !== sourceSignature) {
    throw new Error('This exercise changed. Reload the workout before choosing an alternative.');
  }
  const inferredDay = routine?.id === saved.routine_id ? matchingDay(routine, saved) : undefined;
  const source = substitutionSource(original, saved.day_id ?? inferredDay?.id);
  const next = buildWorkoutExerciseSubstitution(saved, exerciseIndex, expected, configured, reason, timestamp);
  const completedCount = original.sets.filter(set => set.done).length;
  const replacementIndex = exerciseIndex + (completedCount ? 1 : 0);
  let replacement = next.exercises[replacementIndex];
  let routineData: Partial<Routine> | null = null;
  let permanentConfig: RoutineExercise | undefined;
  let owner: RoutineExercise | undefined;
  let ownerIndex = -1;
  let day = inferredDay;
  const append = source.routine_addition === true && source.routine_defaults_excluded === true;

  if (permanent) {
    if (!routine || routine.id !== saved.routine_id) throw new Error('The workout routine is no longer available');
    if (source.day_id) day = routine.days?.find(candidate => candidate.id === source.day_id);
    if ((routine.days?.length || saved.day_id || source.day_id) && !day) {
      throw new Error('The workout training day is no longer available');
    }
    if (saved.day_id && day?.id !== saved.day_id) throw new Error('This exercise no longer belongs to the workout training day');
    const target = day?.exercises ?? routine.exercises;
    const all = routine.days?.length ? routine.days.flatMap(candidate => candidate.exercises) : routine.exercises;
    if (!append) {
      if (source.routine_defaults_excluded) {
        throw new Error('This temporary alternative has no confirmed routine ownership. Reload the routine before saving a replacement.');
      }
      const matches = target.map((candidate, index) => ({ candidate, index })).filter(({ candidate, index }) =>
        source.routine_exercise_id ? candidate.id === source.routine_exercise_id
          : (source.routine_exercise_index == null || source.routine_exercise_index === index)
            && candidate.name === source.name && candidate.library_id === source.library_id);
      if (matches.length !== 1) throw new Error('The original routine exercise was removed, moved or is ambiguous');
      ({ candidate: owner, index: ownerIndex } = matches[0]);
      if ((!source.routine_exercise_id && source.routine_exercise_index != null && source.routine_exercise_index !== ownerIndex)
        || (owner.id && all.filter(candidate => candidate.id === owner!.id).length !== 1)
        || owner.name !== source.name || owner.library_id !== source.library_id
        || owner.targets_revision !== source.targets_revision || owner.load_basis !== source.load_basis
        || Boolean(owner.load_basis_review_required) !== Boolean(source.load_basis_review_required)) {
        throw new Error('The original routine exercise changed. Reload before replacing it permanently.');
      }
    } else {
      ownerIndex = target.length;
    }
    const stableId = owner?.id ?? requestId;
    if (all.some(candidate => candidate.id === stableId && candidate !== owner)) {
      throw new Error('The alternative exercise id already belongs to the routine');
    }
    const fullSets = owner?.sets ?? source.target_sets;
    const previousNames = [...new Set([
      ...(owner?.previous_names ?? []), ...(configured.previous_names ?? []), ...(owner ? [owner.name] : []),
    ].filter(name => name && name !== configured.name))];
    const weightUnit = configured.weight_unit ?? original.weight_unit ?? owner?.weight_unit;
    const unitOverride = configured.weight_unit != null ? configured.weight_unit_override
      : original.weight_unit != null ? original.weight_unit_override : owner?.weight_unit_override;
    const previousExercises = [...(owner?.progress_previous_exercises ?? [])];
    if (owner && (owner.name !== configured.name || owner.library_id !== configured.library_id)) {
      const earlierNames = new Set(previousExercises.flatMap(previous => [previous.name, ...(previous.previous_names ?? [])]));
      const aliases = owner.previous_names?.filter(name => !earlierNames.has(name));
      previousExercises.push({ name: owner.name, ...(owner.library_id ? { library_id: owner.library_id } : {}),
        ...(aliases?.length ? { previous_names: aliases } : {}) });
    }
    permanentConfig = prepareWorkoutExerciseAddition({
      ...configured, id: stableId, sets: fullSets, targets_revision: `substitution:${requestId}`,
      ...(previousNames.length ? { previous_names: previousNames } : {}),
      ...(previousExercises.length ? { progress_previous_exercises: previousExercises } : {}),
      ...(weightUnit ? { weight_unit: weightUnit } : {}),
      ...(unitOverride != null ? { weight_unit_override: unitOverride } : {}),
      ...(configured.rest_sec == null && (owner?.rest_sec ?? original.rest_sec) != null
        ? { rest_sec: owner?.rest_sec ?? original.rest_sec } : {}),
      set_defaults: Array.from({ length: fullSets }, (_, index) => ({
        reps: configured.set_defaults?.[index]?.reps ?? configured.set_defaults?.at(-1)?.reps ?? configured.reps,
        weight_kg: configured.set_defaults?.[index]?.weight_kg ?? configured.set_defaults?.at(-1)?.weight_kg ?? configured.weight_kg ?? 0,
      })),
    });
    replacement = { ...replacement, routine_exercise_id: stableId, routine_exercise_index: ownerIndex,
      targets_revision: permanentConfig.targets_revision,
      ...(weightUnit ? { weight_unit: weightUnit } : {}),
      ...(unitOverride != null ? { weight_unit_override: unitOverride } : {}),
      ...(append || source.routine_addition ? { routine_addition: true } : {}),
    };
    delete replacement.routine_defaults_excluded;
    routineData = { ...(append ? appendConfiguration(routine, permanentConfig, day)
      : replaceConfiguration(routine, permanentConfig, day, ownerIndex)), updated_at: timestamp };
  }

  const replacementSource = permanent && permanentConfig ? substitutionSource({
    ...replacement, name: permanentConfig.name, target_sets: permanentConfig.sets, ...loadConvention(permanentConfig),
  }, day?.id) : source;
  replacement = { ...replacement, exercise_substitution: {
    request_id: requestId, role: 'replacement', permanent, source: replacementSource,
  } };
  next.exercises[replacementIndex] = replacement;
  if (completedCount) next.exercises[exerciseIndex] = { ...next.exercises[exerciseIndex], exercise_substitution: {
    request_id: requestId, role: 'retained', permanent, source,
  } };
  Object.defineProperty(requests, requestId, { value: {
    permanent, source_index: exerciseIndex, source_signature: sourceSignature, alternative_signature: alternativeSignature,
  }, enumerable: true, configurable: true, writable: true });
  const additions = rememberWorkoutExerciseAdditions(next);
  if (permanent && permanentConfig?.id && replacement.routine_addition) Object.defineProperty(additions, permanentConfig.id, {
    value: true, enumerable: true, configurable: true, writable: true,
  });
  const sessionData: Partial<Omit<WorkoutSession, 'id'>> = {
    exercises: next.exercises, updated_at: timestamp, exercise_substitutions: requests,
    ...(Object.keys(additions).length ? { exercise_additions: additions } : {}),
    ...(permanent && !saved.day_id && day ? { day_id: day.id, day_name: saved.day_name ?? day.name } : {}),
  };
  if (permanent && routine && permanentConfig && saved.routine_defaults_before?.id === routine.id) {
    sessionData.routine_defaults_before = append
      ? rebaseDefaultsBackup(saved.routine_defaults_before, routine, permanentConfig, day, timestamp)
      : rebaseSubstitutionBackup(saved.routine_defaults_before, routine, owner!, permanentConfig, day, ownerIndex, timestamp);
  }
  return { session: { ...saved, ...sessionData }, sessionData, routineData };
}
