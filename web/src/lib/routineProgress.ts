import type { RoutineExercise, WorkoutSession } from '../types/routine';
import { matchesSessionExerciseMovement } from './workout';

export interface ProgressExerciseChoice {
  key: string;
  name: string;
  id?: string;
  previousNames?: string[];
  /** Only unambiguous labels may connect unidentified snapshots to this choice. */
  legacyNames?: readonly string[];
  legacyOnly?: boolean;
  movementNames?: readonly string[];
  movementLibraryId?: string | null;
  historical: boolean;
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase();
const labels = (exercise: { name: string; previousNames?: readonly string[] }) =>
  [...new Set([exercise.name, ...(exercise.previousNames ?? [])])];
const movementKey = (libraryId: string | null | undefined, name: string) => libraryId ?? `legacy:${nameKey(name)}`;

/** Current prescriptions and historical snapshots share stable identities, not labels. */
export function routineProgressChoices(exercises: RoutineExercise[], sessions: WorkoutSession[]): ProgressExerciseChoice[] {
  const choices: ProgressExerciseChoice[] = [];
  for (const [index, exercise] of exercises.entries()) {
    const previous = exercise.progress_previous_exercises ?? [];
    const sameMovement = (candidate: typeof previous[number]) => exercise.library_id && candidate.library_id
      ? exercise.library_id === candidate.library_id : nameKey(exercise.name) === nameKey(candidate.name);
    const inherited = previous.filter(sameMovement).flatMap(candidate => [candidate.name, ...(candidate.previous_names ?? [])]);
    const retired = previous.filter(candidate => !sameMovement(candidate));
    const retiredNames = new Set(retired.flatMap(candidate => [candidate.name, ...(candidate.previous_names ?? [])]).map(nameKey));
    const current: ProgressExerciseChoice = {
      key: exercise.id ? `id:${exercise.id}` : `current:${index}:${nameKey(exercise.name)}`,
      name: exercise.name,
      ...(exercise.id ? { id: exercise.id } : {}),
      previousNames: [...new Set([...(exercise.previous_names ?? []).filter(name => !retiredNames.has(nameKey(name))), ...inherited])],
      legacyOnly: !exercise.id,
      historical: false,
    };
    if (previous.length) {
      current.movementNames = labels(current);
      current.movementLibraryId = exercise.library_id;
    }
    choices.push(current);
    for (const descriptor of retired) {
      const key = `${current.key}:movement:${movementKey(descriptor.library_id, descriptor.name)}`;
      const existing = choices.find(choice => choice.key === key);
      if (existing) {
        existing.previousNames = [...new Set([...(existing.previousNames ?? []), descriptor.name, ...(descriptor.previous_names ?? [])])];
        existing.movementNames = labels(existing);
      } else choices.push({
        key, name: descriptor.name, ...(exercise.id ? { id: exercise.id } : {}),
        previousNames: [...(descriptor.previous_names ?? [])], legacyOnly: !exercise.id,
        movementNames: [descriptor.name, ...(descriptor.previous_names ?? [])],
        movementLibraryId: descriptor.library_id, historical: true,
      });
    }
  }
  const historical = sessions.filter(session => session.status === 'completed').flatMap(session => session.exercises);
  const replacedIds = new Set(historical.filter(exercise => exercise.exercise_substitution?.permanent)
    .map(exercise => exercise.routine_exercise_id).filter((id): id is string => !!id));
  // Removed slots can still carry their replacement boundary in completed snapshots.
  for (const id of replacedIds) {
    if (choices.some(choice => choice.id === id)) continue;
    const snapshots = historical.filter(candidate => candidate.routine_exercise_id === id)
      .sort((left, right) => Number(!!right.library_id) - Number(!!left.library_id));
    for (const exercise of snapshots) {
      const key = `id:${id}:movement:${movementKey(exercise.library_id, exercise.name)}`;
      const named = !exercise.library_id ? choices.filter(choice => choice.id === id
        && matchesSessionExerciseMovement(exercise, choice)) : [];
      const existing = choices.find(choice => choice.key === key) ?? (named.length === 1 ? named[0] : undefined);
      if (existing) {
        existing.previousNames = [...new Set([...(existing.previousNames ?? []), exercise.name])];
        existing.movementNames = labels(existing);
      } else choices.push({
        key, name: exercise.name, id, previousNames: [], movementNames: [exercise.name],
        movementLibraryId: exercise.library_id ?? null, historical: true,
      });
    }
  }
  // Physical replacements retain their slot id. Match their movement before adding old aliases.
  for (const exercise of historical.filter(exercise => exercise.routine_exercise_id)) {
    const id = exercise.routine_exercise_id!;
    const owned = choices.filter(choice => choice.id === id);
    const matching = owned.filter(choice => matchesSessionExerciseMovement(exercise, choice));
    const existing = matching.length === 1 ? matching[0] : undefined;
    if (existing) {
      existing.previousNames = [...new Set([...(existing.previousNames ?? []), exercise.name])];
      if (existing.movementNames) existing.movementNames = labels(existing);
    } else if (!owned.length) choices.push({
      key: `id:${id}`, name: exercise.name, id, previousNames: [], historical: true,
    });
    else {
      // Ambiguous snapshots stay accessible without assigning their weights to a movement.
      const key = `id:${id}:movement:${movementKey(exercise.library_id, exercise.name)}`;
      if (!choices.some(choice => choice.key === key)) choices.push({
        key, name: exercise.name, id, previousNames: [], movementNames: [exercise.name],
        movementLibraryId: exercise.library_id ?? null, historical: true,
      });
    }
  }
  // A missing library id cannot resolve a label shared by different movements in one slot.
  for (const choice of choices.filter(choice => choice.movementNames && choice.movementLibraryId !== null)) {
    choice.movementNames = labels(choice).filter(name => !choices.some(other => other !== choice
      && other.id === choice.id && other.movementNames && labels(other).some(label => nameKey(label) === nameKey(name))));
  }
  const owners = new Map<string, Set<string>>();
  for (const choice of choices) {
    for (const name of labels(choice)) {
      const key = nameKey(name);
      const identified = owners.get(key) ?? new Set<string>();
      identified.add(choice.key);
      owners.set(key, identified);
    }
  }
  for (const choice of choices) {
    choice.legacyNames = labels(choice).filter(name => owners.get(nameKey(name))?.size === 1);
  }
  for (const exercise of historical.filter(exercise => !exercise.routine_exercise_id)) {
    const matching = choices.filter(choice => choice.legacyNames?.some(name => nameKey(name) === nameKey(exercise.name))
      && matchesSessionExerciseMovement(exercise, choice));
    if (matching.length === 1) continue;
    const key = `legacy:${nameKey(exercise.name)}`;
    if (!choices.some(choice => choice.key === key)) choices.push({
      key, name: exercise.name, legacyNames: [exercise.name], legacyOnly: true, historical: true,
    });
  }
  return choices;
}
