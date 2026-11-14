import { test, expect, type Page } from '@playwright/test';
import { enterDemo } from './helpers';
import type { DemoDb } from '../src/demo/db';
import { resolveExerciseDefaults } from '../src/lib/exerciseDefaults';
import type { Routine, RoutineExercise, WorkoutSession } from '../src/types/routine';

test.use({ timezoneId: 'America/Costa_Rica' });

const TODAY = '2026-10-22';
const ROUTINE_ID = 'preload-current-plan';
const DAY_ID = 'thursday-push';
const BENCH_LIBRARY_ID = 'Barbell_Bench_Press_-_Medium_Grip';
const CURRENT_EXERCISE: RoutineExercise = {
  id: 'current-bench', name: 'Bench Press', library_id: BENCH_LIBRARY_ID,
  load_basis: 'total', sets: 3, reps: 12, weight_kg: 10,
  weight_unit: 'kg', weight_unit_override: true, targets_revision: 'current-prescription',
};

function currentRoutine(exercise: RoutineExercise = CURRENT_EXERCISE): Routine {
  return {
    id: ROUTINE_ID, name: 'Current strength plan', exercises: [], days: [
      { id: 'earlier-push', name: 'Earlier push', scheduled_weekdays: [], exercises: [
        { ...CURRENT_EXERCISE, id: 'earlier-bench', sets: 2, reps: 8 },
      ] },
      { id: DAY_ID, name: 'Thursday push', scheduled_weekdays: [4], exercises: [{ ...exercise }] },
    ],
  };
}

function priorBenchSession(routineId = 'previous-plan'): WorkoutSession {
  return {
    id: 'recorded-bench', routine_id: routineId, routine_name: 'Previous strength plan',
    day_id: 'earlier-push', day_name: 'Earlier push', date: '2026-10-01', status: 'completed',
    started_at: Date.parse('2026-10-01T15:00:00Z'), completed_at: Date.parse('2026-10-01T16:00:00Z'),
    notes: 'Original completed session must remain unchanged.', total_volume_kg: 920,
    exercises: [{
      name: 'Bench Press', routine_exercise_id: 'earlier-bench', library_id: BENCH_LIBRARY_ID,
      targets_revision: 'previous-prescription', load_basis: 'total',
      target_sets: 2, target_reps: 8, target_weight_kg: 62.5,
      weight_unit: 'kg', weight_unit_override: true,
      sets: [{ reps: 8, weight_kg: 62.5, done: true }, { reps: 7, weight_kg: 60, done: true }],
    }],
  };
}

async function readDb(page: Page): Promise<DemoDb> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);
}

async function seedHistory(page: Page, source: 'another-day' | 'another-routine') {
  await page.clock.install({ time: new Date(`${TODAY}T16:00:00Z`) });
  await enterDemo(page);
  const routine = currentRoutine();
  const previous = priorBenchSession(source === 'another-day' ? ROUTINE_ID : 'previous-plan');
  if (source === 'another-routine') {
    // Also exercise a pagination boundary within one date: the cursor needs the session id.
    previous.date = '2026-10-21';
    previous.started_at = Date.parse('2026-10-21T08:00:00Z');
    previous.completed_at = Date.parse('2026-10-21T09:00:00Z');
  }
  await page.evaluate(({ routine, previous, today }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.profile.preferred_routine_id = routine.id;
    db.profile.workout_weight_unit = 'kg';
    db.routines = [routine, { id: 'previous-plan', name: 'Previous strength plan', exercises: [] }];
    // The relevant lift is older than the default first page of 30 workouts.
    db.sessions = Array.from({ length: 40 }, (_, index): WorkoutSession => ({
      id: `unrelated-${index}`, routine_id: 'unrelated-plan', routine_name: 'Other training',
      date: '2026-10-21', status: 'completed', notes: `Preserve unrelated workout ${index}`,
      started_at: Date.parse('2026-10-21T10:00:00Z') + index * 120_000,
      completed_at: Date.parse('2026-10-21T10:01:00Z') + index * 120_000,
      exercises: [{
        name: 'Cable Row', routine_exercise_id: 'unrelated-row', library_id: 'Seated_Cable_Rows',
        load_basis: 'machine_display', target_sets: 1, target_reps: 10,
        sets: [{ reps: 10, weight_kg: 100 + index, done: true }],
      }],
    }));
    if (previous.date === '2026-10-21') {
      // The first ID-ordered page contains an older bench completion. A newer
      // completion on the same date sorts into the next page by document id.
      db.sessions.push({ ...previous, id: 'z-first-page-bench',
        completed_at: Date.parse('2026-10-21T07:00:00Z'),
        exercises: [{ ...previous.exercises[0], sets: [
          { reps: 8, weight_kg: 45, done: true }, { reps: 7, weight_kg: 40, done: true },
        ] }],
      });
    }
    db.sessions.push(previous);
    db.logs = {
      [previous.date]: {
        date: previous.date, measurements: { waist_cm: 81 }, energy: 4,
        notes: 'Original daily log', food_log: [], exercise_log: [{
          workout_session_id: previous.id, exercise: 'Bench Press', library_id: previous.exercises[0].library_id,
          load_basis: 'total', sets: 2, reps: 8, weight_kg: 62.5,
        }, { exercise: 'Walking', duration_min: 25, notes: 'Keep manual entry' }],
      },
      [today]: {
        date: today, measurements: { arms_cm: 34 }, weight_kg: 72.5, energy: 4,
        notes: 'Keep today’s measurements and manual exercise', food_log: [],
        exercise_log: [{ exercise: 'Walking', duration_min: 15 }],
      },
    };
    db.logs['2026-10-21'] ??= {
      date: '2026-10-21', measurements: {}, energy: 3, notes: 'Other workout mirrors', food_log: [], exercise_log: [],
    };
    db.logs['2026-10-21'].exercise_log.push(...db.sessions.filter(session => session.id !== previous.id).map(session => ({
      workout_session_id: session.id, exercise: 'Cable Row', sets: 1, reps: 10,
      weight_kg: session.exercises[0].sets[0].weight_kg, load_basis: 'machine_display' as const,
    })));
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { routine, previous, today: TODAY });
  return readDb(page);
}

async function expectFreshBench(page: Page) {
  await expect(page).toHaveURL(new RegExp(`/routines/${ROUTINE_ID}/session/[^/?]+$`));
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  await expect(bench.getByTestId('workout-set')).toHaveCount(3);
  for (const [index, weight] of ['62.5', '60', '60'].entries()) {
    await expect(bench.getByLabel('kg', { exact: true }).nth(index)).toHaveValue(weight);
    await expect(bench.getByLabel('Reps', { exact: true }).nth(index)).toHaveValue('12');
    await expect(bench.getByRole('checkbox').nth(index)).not.toBeChecked();
  }
}

async function expectHistoryPreserved(page: Page, before: DemoDb) {
  const after = await readDb(page);
  expect(after.sessions.filter(session => session.status === 'completed')).toEqual(before.sessions);
  expect(after.logs).toEqual(before.logs);
  return after;
}

test('routine detail preloads older weights from another day while retaining the selected day’s reps and set count', async ({ page }) => {
  const before = await seedHistory(page, 'another-day');
  await page.goto(`/routines/${ROUTINE_ID}?day=${DAY_ID}`);
  await expect(page.getByRole('tab', { name: 'Thursday push', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await expectFreshBench(page);
  const after = await expectHistoryPreserved(page, before);
  const active = after.sessions.filter(session => session.status === 'active');
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({
    routine_id: ROUTINE_ID, day_id: DAY_ID, date: TODAY,
    exercises: [{ routine_exercise_id: 'current-bench', library_id: BENCH_LIBRARY_ID, load_basis: 'total',
      target_sets: 3, target_reps: 12, sets: [
        { reps: 12, weight_kg: 62.5, done: false },
        { reps: 12, weight_kg: 60, done: false },
        { reps: 12, weight_kg: 60, done: false },
      ] }],
  });
});

test('Dashboard quick start finds a completed library exercise in a previous routine beyond 30 newer workouts', async ({ page }) => {
  const before = await seedHistory(page, 'another-routine');
  await page.goto('/dashboard');
  await expect(page.getByText('Thursday push', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await expectFreshBench(page);
  await expectHistoryPreserved(page, before);
});

test('resuming today’s active workout preserves every set including completed and edited values', async ({ page }) => {
  await seedHistory(page, 'another-routine');
  const active: WorkoutSession = {
    id: 'existing-active', routine_id: ROUTINE_ID, routine_name: 'Current strength plan',
    day_id: DAY_ID, day_name: 'Thursday push', date: TODAY, status: 'active',
    started_at: Date.parse(`${TODAY}T15:30:00Z`), notes: 'Already working on this workout',
    exercises: [{
      name: 'Bench Press', routine_exercise_id: 'current-bench', library_id: BENCH_LIBRARY_ID,
      targets_revision: 'current-prescription', load_basis: 'total', weight_unit: 'kg',
      target_sets: 3, target_reps: 12, target_weight_kg: 70,
      sets: [{ reps: 9, weight_kg: 70, done: true }, { reps: 10, weight_kg: 67.5, done: false },
        { reps: 11, weight_kg: 65, done: false }],
    }],
  };
  await page.evaluate(active => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.sessions.unshift(active);
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, active);
  const before = await readDb(page);
  await page.goto(`/routines/${ROUTINE_ID}?day=${DAY_ID}`);
  await page.getByRole('button', { name: 'Resume workout in progress', exact: true }).click();
  await expect(page).toHaveURL(`/routines/${ROUTINE_ID}/session/${active.id}`);
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  for (const [index, set] of active.exercises[0].sets.entries()) {
    await expect(bench.getByLabel('kg', { exact: true }).nth(index)).toHaveValue(String(set.weight_kg));
    await expect(bench.getByLabel('Reps', { exact: true }).nth(index)).toHaveValue(String(set.reps));
    await expect(bench.getByRole('checkbox').nth(index)).toBeChecked({ checked: set.done });
  }
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Resume workout in progress', exact: true }).click();
  await expect(page).toHaveURL(`/routines/${ROUTINE_ID}/session/${active.id}`);
  const after = await readDb(page);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.logs).toEqual(before.logs);
});

test('newer compatible history replaces stale defaults that identify their older source session', () => {
  const older = priorBenchSession(ROUTINE_ID);
  older.day_id = DAY_ID;
  older.exercises[0].routine_exercise_id = CURRENT_EXERCISE.id;
  older.exercises[0].targets_revision = CURRENT_EXERCISE.targets_revision;
  const latest: WorkoutSession = {
    ...older, id: 'newer-recorded-bench', date: '2026-10-20', completed_at: Date.parse('2026-10-20T16:00:00Z'),
    exercises: [{ ...older.exercises[0], sets: [
      { reps: 12, weight_kg: 67.5, done: true }, { reps: 12, weight_kg: 65, done: true },
    ] }],
  };
  const routine = currentRoutine({ ...CURRENT_EXERCISE, defaults_session_id: older.id,
    set_defaults: [{ reps: 12, weight_kg: 62.5 }, { reps: 12, weight_kg: 60 }] });
  expect(resolveExerciseDefaults(routine, 0, [older, latest], DAY_ID).sets).toEqual([
    { reps: 12, weight_kg: 67.5, done: false },
    { reps: 12, weight_kg: 65, done: false },
    { reps: 12, weight_kg: 65, done: false },
  ]);
});

test('a renamed exercise retains its unambiguous legacy alias without rewriting historical values', () => {
  const routine: Routine = { id: ROUTINE_ID, name: 'Renamed routine', exercises: [{
    id: 'stable-press', name: 'Barbell Press', previous_names: ['Original Press'],
    sets: 2, reps: 10, weight_kg: 15, weight_unit: 'kg',
  }] };
  const legacy: WorkoutSession = {
    id: 'legacy-press', routine_id: ROUTINE_ID, routine_name: 'Original routine', date: '2026-01-02',
    status: 'completed', exercises: [{ name: 'Original Press', target_sets: 2, target_reps: 8,
      sets: [{ reps: 9, weight_kg: 45, done: true }, { reps: 8, weight_kg: 42.5, done: true }] }],
  };
  const original = structuredClone(legacy);
  expect(resolveExerciseDefaults(routine, 0, [legacy]).sets).toEqual([
    { reps: 9, weight_kg: 45, done: false }, { reps: 8, weight_kg: 42.5, done: false },
  ]);
  expect(legacy).toEqual(original);
});

test('explicit set defaults without a historical source retain their working values', () => {
  const routine = currentRoutine({ ...CURRENT_EXERCISE,
    set_defaults: [{ reps: 14, weight_kg: 30 }, { reps: 13, weight_kg: 27.5 }] });
  expect(resolveExerciseDefaults(routine, 0, [priorBenchSession()], DAY_ID).sets).toEqual([
    { reps: 14, weight_kg: 30, done: false },
    { reps: 13, weight_kg: 27.5, done: false },
    { reps: 13, weight_kg: 27.5, done: false },
  ]);
});

test('different stable exercise identities require a shared library id and compatible load basis', () => {
  const routine = currentRoutine();
  const incompatible = priorBenchSession();
  incompatible.exercises[0].load_basis = 'per_side';
  const sameName = priorBenchSession();
  sameName.id = 'same-name-different-library';
  sameName.exercises[0].library_id = 'Dumbbell_Bench_Press';
  const noLibrary = priorBenchSession();
  noLibrary.id = 'same-name-without-library';
  delete noLibrary.exercises[0].library_id;
  expect(resolveExerciseDefaults(routine, 0, [incompatible, sameName, noLibrary], DAY_ID).sets).toEqual([
    { reps: 12, weight_kg: 10, done: false },
    { reps: 12, weight_kg: 10, done: false },
    { reps: 12, weight_kg: 10, done: false },
  ]);
});
