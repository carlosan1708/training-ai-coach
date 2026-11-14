import { expect, test } from '@playwright/test';
import type { DailyLog, ExerciseLogEntry } from '../src/types/log';
import type { Routine, WorkoutSession, WorkoutSessionEdit } from '../src/types/routine';
import { buildCompletionChanges, buildSessionLogEntries } from '../src/lib/sessionCompletion';
import { carrySessionDefaults, rememberSessionDefaults, rollbackSessionDefaults } from '../src/lib/exerciseDefaults';
import {
  buildEditedSessionLog, buildEditedSessionRoutine, buildWorkoutSessionEdit,
  removeSessionLogEntries, validateWorkoutSessionEdit,
} from '../src/lib/sessionHistoryChanges';

const workout = (patch: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 'session-a', routine_id: 'upper', routine_name: 'Upper body', date: '2026-10-16', status: 'completed',
  started_at: 100000, completed_at: 175000, duration_sec: 75, duration_min: 1.25,
  exercises: [{ name: 'Bench Press', weight_unit: 'lb', target_sets: 2, target_reps: 8,
    sets: [{ reps: 8, weight_kg: 45.359237, done: true }, { reps: 6, weight_kg: 40.8233133, done: false }] }],
  ...patch,
});
const log = (entries: ExerciseLogEntry[]): DailyLog => ({
  date: '2026-10-16', measurements: { waist_cm: 80 }, energy: 4, notes: 'Keep my health notes',
  food_log: [{ meal: 'Breakfast', description: 'Eggs', adherent: true, timestamp: '08:00' }],
  exercise_log: entries,
});
const edit = (saved: WorkoutSession, patch: Partial<WorkoutSessionEdit> = {}): WorkoutSessionEdit => ({
  routine_name: saved.routine_name, date: saved.date, notes: saved.notes, exercises: saved.exercises,
  started_at: 100000, completed_at: 175000, ...patch,
});

test('completion appends its own provenance and preserves same-name manual and other session rows', () => {
  const saved = workout({ status: 'active', completed_at: undefined });
  const manual: ExerciseLogEntry = { exercise: 'Bench Press', sets: 1, reps: 8, weight_kg: 45.359237, notes: 'Manual entry' };
  const other = { ...buildSessionLogEntries(saved, 'kg')[0], workout_session_id: 'another-workout' };
  const changes = buildCompletionChanges(saved, saved.exercises, null, log([manual, other]), 'kg', 175000, 175000)!;
  expect(changes.completed.duration_sec).toBe(75);
  expect(changes.completed.duration_min).toBe(1);
  expect(changes.dailyLogData?.exercise_log).toEqual([manual, other, ...buildSessionLogEntries(saved, 'kg')]);
  expect(buildCompletionChanges(changes.completed, saved.exercises, null, log([]), 'kg', 176000)).toBeNull();
});

test('legacy completion without a known start keeps its duration and never invents a timestamp', () => {
  const saved = workout({ status: 'active', started_at: undefined, duration_sec: undefined, duration_min: 45 });
  const changes = buildCompletionChanges(saved, saved.exercises, null, null, 'kg', 175000, 175000)!;
  expect(changes.completed.started_at).toBeUndefined();
  expect(changes.completed.duration_min).toBe(45);
  expect(changes.completed.duration_sec).toBeUndefined();
});

test('history edits recalculate exact duration and volume while preserving session identity and status', () => {
  const saved = workout();
  const data = edit(saved, { date: '2026-10-15', started_at: 120000, completed_at: 245000, notes: '  Corrected  ',
    exercises: [{ ...saved.exercises[0], sets: [{ reps: 10, weight_kg: 50, done: true }] }] });
  const edited = buildWorkoutSessionEdit(saved, data, 'edited-now', milliseconds => ({ milliseconds }));
  expect(edited).toMatchObject({ id: saved.id, status: 'completed', date: '2026-10-15', notes: 'Corrected',
    started_at: { milliseconds: 120000 }, completed_at: { milliseconds: 245000 }, duration_sec: 125,
    total_volume_kg: 500, updated_at: 'edited-now' });
  expect(edited.duration_min).toBe(2);
});

test('moving a completed workout cleans only its source rows and adds tagged corrected rows to its new date', () => {
  const saved = workout();
  const mirror = buildSessionLogEntries(saved, 'kg')[0];
  const { workout_session_id: ignoredId, ...legacyLookalike } = mirror;
  void ignoredId;
  const manual = { ...legacyLookalike, notes: 'User entered this manually' };
  const sourceLog = log([mirror, legacyLookalike, manual]);
  const destinationLog = { ...log([{ exercise: 'Walk', duration_min: 20 }]), date: '2026-10-15' };
  const edited = buildWorkoutSessionEdit(saved, edit(saved, { date: '2026-10-15' }), 180000);
  const source = buildEditedSessionLog(sourceLog, saved, edited, 'kg', 180000, saved.date)!;
  const destination = buildEditedSessionLog(destinationLog, saved, edited, 'kg', 180000, edited.date)!;
  expect(source.exercise_log).toEqual([legacyLookalike, manual]);
  expect(destination.exercise_log).toEqual([...destinationLog.exercise_log, ...buildSessionLogEntries(edited, 'kg')]);
  expect(Object.keys(source).sort()).toEqual(['exercise_log', 'updated_at']);
  expect(sourceLog.measurements).toEqual({ waist_cm: 80 });
  expect(sourceLog.food_log).toHaveLength(1);
  expect(sourceLog.notes).toBe('Keep my health notes');
});

test('legacy cleanup requires exact generated provenance and preserves ambiguous collisions', () => {
  const saved = workout();
  const { workout_session_id: ignoredId, ...legacy } = buildSessionLogEntries(saved, 'kg')[0];
  void ignoredId;
  const differentUnit = { ...legacy, weight_unit: 'kg' as const };
  const differentWeight = { ...legacy, weight_kg: 50 };
  const differentNote = { ...legacy, notes: 'Manual Bench Press' };
  expect(removeSessionLogEntries([legacy, differentUnit, differentWeight, differentNote], saved, 'kg'))
    .toEqual([differentUnit, differentWeight, differentNote]);
  expect(removeSessionLogEntries([legacy, { ...legacy }], saved, 'kg')).toEqual([legacy, legacy]);
  expect(removeSessionLogEntries([legacy], workout({ exercises: [saved.exercises[0], saved.exercises[0]] }), 'kg')).toEqual([legacy]);
});

test('earliest mirrors without units or bodyweight values reconcile only their exact generated kg notes', () => {
  const saved = workout();
  const { workout_session_id: ignoredId, weight_unit: ignoredUnit, ...oldKg } = buildSessionLogEntries({ ...saved,
    exercises: saved.exercises.map(exercise => ({ ...exercise, weight_unit: 'kg' })),
  }, 'kg')[0];
  void ignoredId;
  void ignoredUnit;
  const manual = { ...oldKg, notes: 'My manually recorded set' };
  expect(removeSessionLogEntries([oldKg, manual], saved, 'lb')).toEqual([manual]);
  const bodyweight = workout({ exercises: [{ ...saved.exercises[0], sets: [{ weight_kg: 0, reps: 10, done: true }] }] });
  const { workout_session_id: ignoredBodyweightId, weight_unit: ignoredBodyweightUnit, weight_kg: ignoredWeight, ...oldBodyweight }
    = buildSessionLogEntries(bodyweight, 'kg')[0];
  void ignoredBodyweightId;
  void ignoredBodyweightUnit;
  void ignoredWeight;
  expect(removeSessionLogEntries([oldBodyweight], bodyweight, 'lb')).toEqual([]);
});

test('original compact kg summaries reconcile the pre-migration workout without changing manual records', () => {
  const saved = workout({ routine_name: 'Rutina de Hipertrofia - 5 días', exercises: [{
    ...workout().exercises[0], sets: [
      { reps: 10, weight_kg: 36, done: true }, { reps: 9, weight_kg: 36, done: true }, { reps: 8, weight_kg: 36, done: true },
    ],
  }] });
  const legacy: ExerciseLogEntry = { exercise: 'Bench Press', sets: 3, reps: 10, weight_kg: 36,
    notes: 'Rutina de Hipertrofia - 5 días — 3×10/9/8 @ 36kg' };
  const manual = { ...legacy, notes: '36 kg bench manually logged' };
  expect(removeSessionLogEntries([legacy, manual], saved, 'lb')).toEqual([manual]);
  const precisionSession = workout({ exercises: [{ ...workout().exercises[0], sets: [{ reps: 8, weight_kg: 13.63579, done: true }] }] });
  const precisionLegacy: ExerciseLogEntry = { exercise: 'Bench Press', sets: 1, reps: 8, weight_kg: 13.63579,
    notes: 'Upper body — 1×8 @ 13.63579kg' };
  expect(removeSessionLogEntries([precisionLegacy], precisionSession, 'lb')).toEqual([]);
});

test('deleting a completion decrements once, derives last workout from all remaining dates, and retains working defaults', () => {
  const saved = workout();
  const routine: Routine = { id: saved.routine_id, name: saved.routine_name, session_count: 2,
    last_session_at: saved.date, exercises: [{ name: 'Bench Press', sets: 2, reps: 10, weight_kg: 55 }] };
  const remaining = Array.from({ length: 40 }, (_, index) => workout({ id: `old-${index}`, date: '2026-10-01' }));
  remaining.push(workout({ id: 'remaining-latest', date: '2026-10-15' }));
  const patch = buildEditedSessionRoutine(routine, saved, null, remaining, 180000)!;
  expect(patch).toEqual({ session_count: 41, last_session_at: '2026-10-15', updated_at: 180000 });
  expect(patch.exercises).toBeUndefined();
  expect(buildEditedSessionRoutine({ ...routine, session_count: 0 }, saved, null, [], 180000))
    .toEqual({ session_count: 0, last_session_at: null, updated_at: 180000 });
  expect(buildEditedSessionRoutine(routine, workout({ status: 'active' }), null, remaining, 180000)).toBeNull();
});

test('only active explicit edits carry working values into the next workout', () => {
  const saved = workout({ status: 'active', completed_at: null });
  const routine: Routine = { id: saved.routine_id, name: saved.routine_name,
    exercises: [{ name: 'Bench Press', sets: 2, reps: 8, weight_kg: 20 }] };
  const corrected = buildWorkoutSessionEdit(saved, edit(saved, { completed_at: null,
    exercises: [{ ...saved.exercises[0], sets: [{ reps: 12, weight_kg: 30, done: true }] }] }), 180000);
  expect(buildEditedSessionRoutine(routine, saved, corrected, [], 180000)?.exercises?.[0].set_defaults)
    .toEqual([{ reps: 12, weight_kg: 30 }]);
  expect(buildEditedSessionRoutine(routine, { ...saved, status: 'completed' }, { ...corrected, status: 'completed' }, [], 180000)?.exercises)
    .toBeUndefined();
});

test('invalid edits reject negative loads, fractional reps, impossible dates, and reversed times', () => {
  const saved = workout();
  expect(() => validateWorkoutSessionEdit(edit(saved, { started_at: 200000, completed_at: 100000 }))).toThrow(/after the start/);
  expect(() => validateWorkoutSessionEdit(edit(saved, { date: '2026-02-30' }))).toThrow(/valid workout date/);
  expect(() => validateWorkoutSessionEdit(edit(saved, { exercises: [] }))).toThrow(/At least one exercise/);
  for (const set of [{ weight_kg: -5, reps: 10, done: true }, { weight_kg: 20, reps: 2.5, done: true }]) {
    expect(() => validateWorkoutSessionEdit(edit(saved, { exercises: [{ ...saved.exercises[0], sets: [set] }] })))
      .toThrow(/nonnegative weights/);
  }
  expect(() => buildWorkoutSessionEdit(workout({ status: 'active' }), edit(saved), 180000)).toThrow(/Finish the workout/);
  const futureStart = workout({ status: 'active', started_at: 200000 });
  expect(() => buildCompletionChanges(futureStart, futureStart.exercises, null, null, 'kg', 175000, 175000))
    .toThrow(/after the start/);
});

test('discarding an autosaved draft restores its original defaults and timestamp after repeated saves', () => {
  const before: Routine = { id: 'upper', name: 'Upper', exercises: [{ id: 'bench', name: 'Bench Press', sets: 2,
    reps: 8, weight_kg: 20 }], updated_at: 10 };
  let session = workout({ status: 'active', exercises: [{ ...workout().exercises[0], routine_exercise_id: 'bench' }] });
  session = { ...session, ...rememberSessionDefaults(before, session, 20) };
  const first = { ...before, ...carrySessionDefaults(before, session), updated_at: 20 };
  session = { ...session, exercises: [{ ...session.exercises[0], sets: [{ reps: 12, weight_kg: 30, done: true }] }],
    ...rememberSessionDefaults(first, session, 30) };
  const saved = { ...first, ...carrySessionDefaults(first, session), updated_at: 30 };
  const rollback = rollbackSessionDefaults(saved, session)!;
  expect({ ...saved, ...rollback.defaults }).toEqual(before);
  expect(rollback.removeUpdatedAt).toBe(false);
});

test('discarding a draft preserves newer routine targets, other-day edits and metadata', () => {
  const before: Routine = { id: 'upper', name: 'Upper', exercises: [], days: [
    { id: 'upper', name: 'Upper day', exercises: [{ id: 'bench', name: 'Bench Press', sets: 2, reps: 8, weight_kg: 20 }] },
    { id: 'lower', name: 'Lower day', exercises: [{ id: 'squat', name: 'Squat', sets: 3, reps: 10, weight_kg: 50 }] },
  ] };
  const session = workout({ status: 'active', day_id: 'upper',
    exercises: [{ ...workout().exercises[0], routine_exercise_id: 'bench' }],
    ...rememberSessionDefaults(before, workout(), 20) });
  const saved = { ...before, ...carrySessionDefaults(before, session), updated_at: 20 };
  const newer: Routine = { ...saved, name: 'Renamed while training', updated_at: 30,
    days: saved.days!.map(day => day.id === 'lower' ? { ...day, exercises: [{ ...day.exercises[0], weight_kg: 60 }] } : day) };
  const rollback = rollbackSessionDefaults(newer, session)!;
  const restored = { ...newer, ...rollback.defaults };
  expect(restored.name).toBe(newer.name);
  expect(restored.updated_at).toBe(30);
  expect(restored.days![0]).toEqual(before.days![0]);
  expect(restored.days![1]).toEqual(newer.days![1]);
  const manualEdit = { ...newer, days: newer.days!.map(day => day.id === 'upper'
    ? { ...day, exercises: [{ ...day.exercises[0], targets_revision: 'manual-edit', weight_kg: 70 }] } : day) };
  expect(rollbackSessionDefaults(manualEdit, session)).toBeNull();
});

test('another completed workout owns its defaults even when it kept identical working values', () => {
  const before: Routine = { id: 'upper', name: 'Upper', exercises: [{ name: 'Bench Press', sets: 2, reps: 8, weight_kg: 20 }] };
  const draft = workout({ status: 'active', ...rememberSessionDefaults(before, workout(), 20) });
  const saved = { ...before, ...carrySessionDefaults(before, draft), updated_at: 20 };
  const completed = workout({ id: 'newer-workout', status: 'completed', exercises: draft.exercises });
  const newer = { ...saved, ...carrySessionDefaults(saved, completed), updated_at: 30 };
  expect(newer.exercises[0].defaults_session_id).toBe(completed.id);
  expect(rollbackSessionDefaults(newer, draft)).toBeNull();
});
