import { test, expect, type Page } from '@playwright/test';
import { enterDemo, revealTrainingOptions } from './helpers';
import type { DemoDb } from '../src/demo/db';
import type { Routine, RoutineExercise, WorkoutSession } from '../src/types/routine';
import { assertWorkoutAdditionsPreserved, buildWorkoutExerciseSubstitutionChanges } from '../src/lib/workoutExerciseAddition';
import { routineProgressChoices } from '../src/lib/routineProgress';
import { findSessionExercise } from '../src/lib/workout';

test.use({ timezoneId: 'America/Costa_Rica', locale: 'en-US', viewport: { width: 420, height: 850 } });

const ROUTINE_ID = 'permanent-alternative-plan';
const SESSION_ID = 'permanent-alternative-active';
const SESSION_PATH = `/routines/${ROUTINE_ID}/session/${SESSION_ID}`;
const EXERCISE_ID = 'selected-bench';
const ALT = 'Incline Push-Up';

function fixture() {
  const bench: RoutineExercise = {
    id: EXERCISE_ID, name: 'Bench Press', previous_names: ['Original Bench'],
    library_id: 'Barbell_Bench_Press_-_Medium_Grip', load_basis: 'total',
    sets: 3, reps: 10, weight_kg: 60, weight_unit: 'kg', weight_unit_override: true,
    targets_revision: 'original-bench-prescription', rest_sec: 75,
    set_defaults: [{ reps: 10, weight_kg: 60 }, { reps: 9, weight_kg: 57.5 }, { reps: 8, weight_kg: 55 }],
  };
  const row: RoutineExercise = { id: 'row-before', name: 'Cable Row', sets: 1, reps: 10, weight_kg: 30 };
  const triceps: RoutineExercise = { id: 'triceps-after', name: 'Triceps Extension', sets: 1, reps: 10, weight_kg: 15 };
  const routine: Routine = {
    id: ROUTINE_ID, name: 'Permanent alternatives plan', exercises: [], session_count: 3, last_session_at: '2026-10-16',
    days: [{ id: 'selected-day', name: 'Selected day', exercises: [row, bench, triceps] },
      { id: 'other-day', name: 'Other day', exercises: [{ ...bench, id: 'other-day-bench', weight_kg: 20 }] }],
  };
  const active: WorkoutSession = {
    id: SESSION_ID, routine_id: ROUTINE_ID, routine_name: routine.name,
    day_id: 'selected-day', day_name: 'Selected day', date: '2026-10-18', status: 'active',
    started_at: Date.parse('2026-10-18T15:55:00Z'), notes: 'Keep these workout notes.',
    exercises: [
      { name: row.name, routine_exercise_id: row.id, routine_exercise_index: 0, target_sets: 1, target_reps: 10,
        sets: [{ reps: 10, weight_kg: 30, done: false }] },
      { name: bench.name, routine_exercise_id: bench.id, routine_exercise_index: 1,
        library_id: bench.library_id, targets_revision: bench.targets_revision, load_basis: 'total',
        weight_unit: 'kg', weight_unit_override: true, target_sets: 3, target_reps: 10, target_weight_kg: 60, rest_sec: 75,
        sets: [{ reps: 10, weight_kg: 60, done: true }, { reps: 9, weight_kg: 57.5, done: false },
          { reps: 8, weight_kg: 55, done: false }] },
      { name: triceps.name, routine_exercise_id: triceps.id, routine_exercise_index: 2, target_sets: 1, target_reps: 10,
        sets: [{ reps: 10, weight_kg: 15, done: false }] },
    ],
  };
  const history: WorkoutSession[] = [
    { id: 'identified-bench-history', routine_id: ROUTINE_ID, routine_name: routine.name,
      day_id: 'selected-day', day_name: 'Selected day', date: '2026-10-16', status: 'completed',
      completed_at: Date.parse('2026-10-16T16:00:00Z'), notes: 'Original identified history', exercises: [{
        name: 'Bench Press', routine_exercise_id: EXERCISE_ID, routine_exercise_index: 1,
        targets_revision: bench.targets_revision, load_basis: 'total', target_sets: 2, target_reps: 10,
        sets: [{ reps: 10, weight_kg: 55, done: true }, { reps: 9, weight_kg: 52.5, done: true }],
      }] },
    { id: 'legacy-bench-history', routine_id: ROUTINE_ID, routine_name: routine.name,
      day_id: 'selected-day', day_name: 'Selected day', date: '2026-10-09', status: 'completed',
      completed_at: Date.parse('2026-10-09T16:00:00Z'), notes: 'Original alias history', exercises: [{
        name: 'Original Bench', routine_exercise_index: 1, load_basis: 'total', target_sets: 2, target_reps: 9,
        sets: [{ reps: 9, weight_kg: 50, done: true }, { reps: 8, weight_kg: 47.5, done: true }],
      }] },
    { id: 'other-day-history', routine_id: ROUTINE_ID, routine_name: routine.name,
      day_id: 'other-day', day_name: 'Other day', date: '2026-10-15', status: 'completed', exercises: [{
        name: 'Bench Press', routine_exercise_id: 'other-day-bench', load_basis: 'total', target_sets: 1, target_reps: 10,
        sets: [{ reps: 10, weight_kg: 20, done: true }],
      }] },
  ];
  return { routine, active, history };
}

async function openSession(page: Page) {
  const cloudRequests: string[] = [];
  await page.route(/cloudfunctions\.net|\.a\.run\.app|api\.openai\.com|generativelanguage\.googleapis\.com/, route => {
    cloudRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.route('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json', route =>
    route.fulfill({ json: [] }));
  await page.clock.install({ time: new Date('2026-10-18T16:00:00Z') });
  await enterDemo(page);
  await page.evaluate(({ routine, active, history }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.profile.units = 'metric';
    db.profile.workout_weight_unit = 'kg';
    db.routines = [routine];
    db.sessions = [...history, active];
    db.logs = Object.fromEntries(history.map(session => [session.date, {
      date: session.date, measurements: { waist_cm: 81 }, energy: 4, notes: `Keep ${session.id}`, food_log: [],
      exercise_log: [{ workout_session_id: session.id, exercise: session.exercises[0].name,
        sets: session.exercises[0].sets.length, reps: session.exercises[0].sets[0].reps,
        weight_kg: session.exercises[0].sets[0].weight_kg }, { exercise: 'Manual walk', duration_min: 20 }],
    }]));
    db.logs[active.date] = { date: active.date, measurements: { arms_cm: 34 }, energy: 3,
      notes: 'Keep today’s measurements and manual entry', food_log: [], exercise_log: [{ exercise: 'Manual walk', duration_min: 15 }] };
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, fixture());
  await page.goto(SESSION_PATH);
  await expect(page.getByRole('region', { name: 'Bench Press', exact: true })).toBeVisible();
  return cloudRequests;
}

const readDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);
const activeSession = (db: DemoDb) => db.sessions.find(session => session.id === SESSION_ID)!;
const day = (db: DemoDb, id = 'selected-day') => db.routines[0].days!.find(item => item.id === id)!;

function expectHistoryPreserved(after: DemoDb, before: DemoDb, finished = false) {
  for (const historical of before.sessions.filter(session => session.status === 'completed')) {
    expect(after.sessions.find(session => session.id === historical.id)).toEqual(historical);
  }
  for (const [date, log] of Object.entries(before.logs)) {
    if (finished && date === '2026-10-18') {
      expect(after.logs[date]).toMatchObject({ ...log, exercise_log: expect.any(Array) });
      expect(after.logs[date].exercise_log.filter(entry => !entry.workout_session_id)).toEqual(log.exercise_log);
    } else expect(after.logs[date]).toEqual(log);
  }
}

async function preview(page: Page, spanish = false) {
  await revealTrainingOptions(page);
  await page.getByRole('region', { name: 'Bench Press', exact: true }).getByRole('button', {
    name: spanish ? 'Buscar alternativa con IA' : 'Find an alternative with AI', exact: true,
  }).click();
  const dialog = page.getByRole('dialog', { name: spanish ? 'Alternativas de ejercicio' : 'Exercise alternatives', exact: true });
  await dialog.getByRole('button', { name: spanish ? 'Sugerir alternativa' : 'Suggest alternative', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: ALT, exact: true })).toBeVisible();
  return dialog;
}

async function applyPermanent(page: Page) {
  const dialog = await preview(page);
  await dialog.getByRole('radio', { name: 'Also replace in routine', exact: true }).check();
  await dialog.getByRole('button', { name: 'Use this exercise', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: ALT, exact: true })).toBeVisible();
}

async function viewProgress(page: Page, exercise: string) {
  await page.goto(`/routines/${ROUTINE_ID}?day=selected-day`);
  await page.getByRole('button', { name: 'View progress', exact: true }).click();
  await selectProgress(page, exercise);
  return page.getByRole('region', { name: 'Repetitions per set', exact: true });
}

async function selectProgress(page: Page, exercise: string) {
  await page.getByRole('combobox', { name: 'Exercise', exact: true }).click();
  await page.getByRole('option', { name: exercise, exact: true }).click();
}

test('alternative scope defaults to this workout in English and Spanish, and cancelling either scope changes no training data', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  for (const spanish of [false, true]) {
    if (spanish) {
      await page.getByRole('button', { name: 'Language', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Español', exact: true }).click();
    }
    await page.setViewportSize({ width: 320, height: 780 });
    const dialog = await preview(page, spanish);
    await expect(dialog.getByRole('radiogroup', { name: spanish ? 'Dónde aplicar el cambio' : 'Where to apply this change', exact: true })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: spanish ? 'Solo este entrenamiento' : 'Only this workout', exact: true })).toBeChecked();
    const permanent = dialog.getByRole('radio', { name: spanish ? 'Reemplazar también en la rutina' : 'Also replace in routine', exact: true });
    await expect(permanent).not.toBeChecked();
    await permanent.check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`alternative-scope-${spanish ? 'es' : 'en'}-320.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(dialog.getByRole('button', { name: spanish ? 'Usar este ejercicio' : 'Use this exercise', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`alternative-scope-${spanish ? 'es' : 'en'}-desktop.png`), animations: 'disabled' });
    await dialog.getByRole('button', { name: spanish ? 'Cerrar' : 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    const reset = await preview(page, spanish);
    await revealTrainingOptions(page);
    await expect(reset.getByRole('radio', { name: spanish ? 'Solo este entrenamiento' : 'Only this workout', exact: true })).toBeChecked();
    await reset.getByRole('button', { name: spanish ? 'Cerrar' : 'Close', exact: true }).click();
    const after = await readDb(page);
    expect(after.routines).toEqual(before.routines);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.logs).toEqual(before.logs);
  }
  expect(cloudRequests).toEqual([]);
});

test('accepting the default alternative affects only unfinished sets in this workout', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  const original = activeSession(before).exercises[1];
  const dialog = await preview(page);
  await expect(dialog.getByRole('radio', { name: 'Only this workout', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Use this exercise', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: ALT, exact: true })).toBeVisible();
  const after = await readDb(page);
  expect(after.routines).toEqual(before.routines);
  expectHistoryPreserved(after, before);
  expect(activeSession(after).exercises[0]).toEqual(activeSession(before).exercises[0]);
  expect(activeSession(after).exercises[3]).toEqual(activeSession(before).exercises[2]);
  expect(activeSession(after).exercises[1]).toMatchObject({
    name: original.name, routine_exercise_id: EXERCISE_ID, routine_defaults_excluded: true,
    sets: original.sets.filter(set => set.done),
  });
  expect(activeSession(after).exercises[2]).toMatchObject({ name: ALT, routine_defaults_excluded: true, target_sets: 2,
    sets: [{ reps: 9, weight_kg: 0, done: false }, { reps: 9, weight_kg: 0, done: false }] });
  expect(activeSession(after).exercises[2].routine_exercise_id).toBeUndefined();
  expect(cloudRequests).toEqual([]);
});

test('a permanent alternative replaces its exact day in place, preserves completed sets and history, and starts future workouts with all configured sets', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  const original = activeSession(before).exercises[1];
  await applyPermanent(page);
  const after = await readDb(page);
  const replacement = day(after).exercises[1];
  expect(day(after).id).toBe(day(before).id);
  expect(day(after).exercises.map(exercise => exercise.id)).toEqual(day(before).exercises.map(exercise => exercise.id));
  expect(day(after).exercises[0]).toEqual(day(before).exercises[0]);
  expect(day(after).exercises[2]).toEqual(day(before).exercises[2]);
  expect(day(after, 'other-day')).toEqual(day(before, 'other-day'));
  expect(replacement).toMatchObject({ id: EXERCISE_ID, name: ALT, sets: 3, reps: 9, weight_kg: 0 });
  expect(replacement.targets_revision).not.toBe(original.targets_revision);
  expect(replacement.previous_names).toEqual(expect.arrayContaining(['Bench Press', 'Original Bench']));
  expect(activeSession(after).exercises[1]).toMatchObject({
    name: 'Bench Press', routine_exercise_id: EXERCISE_ID, routine_defaults_excluded: true,
    sets: original.sets.filter(set => set.done),
  });
  expect(activeSession(after).exercises[2]).toMatchObject({ name: ALT, routine_exercise_id: EXERCISE_ID,
    targets_revision: replacement.targets_revision, target_sets: 2,
    sets: [{ reps: 9, weight_kg: 0, done: false }, { reps: 9, weight_kg: 0, done: false }] });
  expect(activeSession(after).exercises[2].routine_defaults_excluded).not.toBe(true);
  expectHistoryPreserved(after, before);

  const progress = await viewProgress(page, ALT);
  await expect(progress.getByText('Complete a set to see your repetitions here.', { exact: true })).toBeVisible();
  await selectProgress(page, 'Bench Press · History');
  await expect(progress.getByText('Latest session · 2026-10-16', { exact: true })).toBeVisible();
  await expect(progress.getByText('19 total reps', { exact: true })).toBeVisible();
  await expect(progress.locator('.recharts-line-dots circle')).toHaveCount(4);
  await page.goto(SESSION_PATH);
  const alternative = page.getByRole('region', { name: ALT, exact: true });
  await expect(alternative.getByTestId('workout-set')).toHaveCount(2);
  for (const checkbox of await alternative.getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page).toHaveURL(`/workout-history?session=${SESSION_ID}&saved=1`);
  const completed = await readDb(page);
  expect(activeSession(completed).exercises[1].sets).toEqual(original.sets.filter(set => set.done));
  expectHistoryPreserved(completed, before, true);
  await viewProgress(page, ALT);
  await expect(progress.getByText('Latest session · 2026-10-18', { exact: true })).toBeVisible();
  await expect(progress.getByText('18 total reps', { exact: true })).toBeVisible();
  for (const number of [1, 2]) {
    const set = progress.getByRole('group', { name: `Set ${number}`, exact: true });
    await expect(set.getByText('9 reps', { exact: true })).toBeVisible();
    await expect(set.getByText('0 kg', { exact: true })).toBeVisible();
  }
  await expect(progress.locator('.recharts-line-dots circle')).toHaveCount(2);
  await selectProgress(page, 'Bench Press · History');
  await expect(progress.getByText('Latest session · 2026-10-18', { exact: true })).toBeVisible();
  await expect(progress.getByText('10 total reps', { exact: true })).toBeVisible();
  const retainedSet = progress.getByRole('group', { name: 'Set 1', exact: true });
  await expect(retainedSet.getByText('10 reps', { exact: true })).toBeVisible();
  await expect(retainedSet.getByText('60 kg', { exact: true })).toBeVisible();
  await expect(progress.getByRole('group', { name: 'Set 2', exact: true })).toHaveCount(0);
  await expect(progress.locator('.recharts-line-dots circle')).toHaveCount(5);
  await page.goto(`/routines/${ROUTINE_ID}?day=selected-day`);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  await expect(alternative.getByTestId('workout-set')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Bench Press', exact: true })).toHaveCount(0);
  const future = (await readDb(page)).sessions.find(session => session.status === 'active')!;
  expect(future.day_id).toBe('selected-day');
  expect(future.exercises.map(exercise => exercise.routine_exercise_id)).toEqual(['row-before', EXERCISE_ID, 'triceps-after']);
  expect(future.exercises[1].sets).toEqual(Array.from({ length: 3 }, () => ({ reps: 9, weight_kg: 0, done: false })));
  expect(day(await readDb(page), 'other-day')).toEqual(day(before, 'other-day'));
  expect(cloudRequests).toEqual([]);
});

test('permanent replacement survives draft discard while later autosaved working values roll back', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  await bench.getByLabel('kg', { exact: true }).nth(1).fill('58');
  await bench.getByLabel('Reps', { exact: true }).nth(1).fill('11');
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await applyPermanent(page);
  const permanentlySaved = await readDb(page);
  const alternative = page.getByRole('region', { name: ALT, exact: true });
  await alternative.getByLabel('Reps', { exact: true }).nth(0).fill('21');
  await alternative.getByLabel('kg', { exact: true }).nth(0).fill('99');
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Cancel workout', exact: true }).click();
  await page.getByRole('dialog', { name: 'Cancel this workout?', exact: true })
    .getByRole('button', { name: 'Discard workout', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/routines/${ROUTINE_ID}`));
  const discarded = await readDb(page);
  expect(discarded.sessions.find(session => session.id === SESSION_ID)).toBeUndefined();
  expect(day(discarded).exercises[1]).toEqual(day(permanentlySaved).exercises[1]);
  expect(day(discarded).exercises[1]).toMatchObject({ id: EXERCISE_ID, name: ALT, sets: 3, reps: 11, weight_kg: 0 });
  expect(day(discarded, 'other-day')).toEqual(day(before, 'other-day'));
  expectHistoryPreserved(discarded, before);
  const progress = await viewProgress(page, ALT);
  await expect(progress.getByText('Complete a set to see your repetitions here.', { exact: true })).toBeVisible();
  await selectProgress(page, 'Bench Press · History');
  await expect(progress.getByText('Latest session · 2026-10-16', { exact: true })).toBeVisible();
  await expect(progress.getByText('19 total reps', { exact: true })).toBeVisible();
  await expect(progress.locator('.recharts-line-dots circle')).toHaveCount(4);
  await page.goto(`/routines/${ROUTINE_ID}?day=selected-day`);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  await expect(alternative.getByTestId('workout-set')).toHaveCount(3);
  for (const input of await alternative.getByLabel('kg', { exact: true }).all()) await expect(input).toHaveValue('0');
  for (const input of await alternative.getByLabel('Reps', { exact: true }).all()) await expect(input).toHaveValue('11');
  expectHistoryPreserved(await readDb(page), before);
  expect(cloudRequests).toEqual([]);
});

for (const change of ['moved', 'deleted', 'revised'] as const) {
  test(`a ${change} template rejects a permanent alternative without changing any saved data`, async ({ page }) => {
    const cloudRequests = await openSession(page);
    const dialog = await preview(page);
    await dialog.getByRole('radio', { name: 'Also replace in routine', exact: true }).check();
    await page.evaluate(change => {
      const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
      const selected = db.routines[0].days!.find(day => day.id === 'selected-day')!;
      if (change === 'revised') {
        selected.exercises[1] = { ...selected.exercises[1], reps: 17, targets_revision: 'newer-manual-prescription' };
      } else {
        const [removed] = selected.exercises.splice(1, 1);
        if (change === 'moved') db.routines[0].days!.find(day => day.id === 'other-day')!.exercises.push(removed);
      }
      localStorage.setItem('tac_demo_db', JSON.stringify(db));
    }, change);
    const beforeApply = await readDb(page);
    await dialog.getByRole('button', { name: 'Use this exercise', exact: true }).click();
    await expect(dialog.getByText('The exercise could not be changed. Please try again.', { exact: true })).toBeVisible();
    const after = await readDb(page);
    expect(after.routines).toEqual(beforeApply.routines);
    expect(after.sessions).toEqual(beforeApply.sessions);
    expect(after.logs).toEqual(beforeApply.logs);
    expect(cloudRequests).toEqual([]);
  });
}

test('retrying a permanent alternative is idempotent and stale autosaves cannot restore its original work', () => {
  const { routine, active, history } = fixture();
  const original = active.exercises[1];
  const alternative: RoutineExercise = { id: 'synthetic-alternative-request', name: ALT,
    sets: 2, reps: 9, weight_kg: 0, rest_sec: 75 };
  const before = structuredClone({ routine, active, alternative });
  const changes = buildWorkoutExerciseSubstitutionChanges(active, routine, 1, original, alternative,
    'Synthetic user-approved permanent alternative', true, 10_000);
  expect(changes.routineData).not.toBeNull();
  const updatedRoutine = { ...routine, ...changes.routineData };
  const retried = buildWorkoutExerciseSubstitutionChanges(changes.session, updatedRoutine, 1, original, alternative,
    'Synthetic user-approved permanent alternative', true, 11_000);
  expect(retried.session).toEqual(changes.session);
  expect(retried.sessionData).toBeNull();
  expect(retried.routineData).toBeNull();
  expect(updatedRoutine.days![0].exercises.map(exercise => exercise.id)).toEqual(['row-before', EXERCISE_ID, 'triceps-after']);
  expect(updatedRoutine.days![0].exercises[1]).toMatchObject({ id: EXERCISE_ID, name: ALT, sets: 3 });
  expect(() => assertWorkoutAdditionsPreserved(changes.session, active.exercises)).toThrow();
  expect(() => assertWorkoutAdditionsPreserved(changes.session, changes.session.exercises)).not.toThrow();
  expect({ routine, active, alternative }).toEqual(before);
  const completed: WorkoutSession = { ...changes.session, status: 'completed', exercises: changes.session.exercises.map((exercise, index) =>
    index === 2 ? { ...exercise, sets: exercise.sets.map(set => ({ ...set, done: true })) } : exercise) };
  // Deleting the current template later cannot merge the two recorded movements.
  const choices = routineProgressChoices([], [completed, history[0]]);
  const bench = choices.filter(choice => choice.name === 'Bench Press');
  const replacement = choices.filter(choice => choice.name === ALT);
  expect(bench).toHaveLength(1);
  expect(replacement).toHaveLength(1);
  expect(bench[0].key).not.toBe(replacement[0].key);
  expect(findSessionExercise(completed, bench[0].name, bench[0])!.sets).toEqual([{ reps: 10, weight_kg: 60, done: true }]);
  expect(findSessionExercise(completed, replacement[0].name, replacement[0])!.sets).toEqual([
    { reps: 9, weight_kg: 0, done: true }, { reps: 9, weight_kg: 0, done: true },
  ]);
  expect(findSessionExercise(history[0], bench[0].name, bench[0])).toEqual(history[0].exercises[0]);
  expect(findSessionExercise(history[0], replacement[0].name, replacement[0])).toBeUndefined();
});

test('a partly completed manual exercise keeps its full future set count through temporary and permanent alternatives', () => {
  const { routine, active } = fixture();
  active.exercises.push({ name: 'Manual row', routine_exercise_id: 'manual-row', routine_addition: true,
    routine_defaults_excluded: true, targets_revision: 'addition:manual-row', target_sets: 3, target_reps: 12,
    weight_unit: 'kg', weight_unit_override: true,
    sets: [{ reps: 12, weight_kg: 20, done: true }, { reps: 11, weight_kg: 17.5, done: false },
      { reps: 10, weight_kg: 15, done: false }] });
  const manual = active.exercises[3];
  const temporary = buildWorkoutExerciseSubstitutionChanges(active, routine, 3, manual,
    { id: 'manual-temporary-request', name: 'Resistance Band Row', sets: 2, reps: 11, weight_kg: 0 },
    'Synthetic temporary alternative', false, 10_000);
  expect(temporary.routineData).toBeNull();
  const partlyCompleted = structuredClone(temporary.session);
  partlyCompleted.exercises[4].sets[0].done = true;
  const before = structuredClone({ routine, active, partlyCompleted });
  const permanent = buildWorkoutExerciseSubstitutionChanges(partlyCompleted, routine, 4, partlyCompleted.exercises[4],
    { id: 'manual-permanent-request', name: 'Seated Cable Row', sets: 1, reps: 10, weight_kg: 25,
      weight_unit: 'lb', weight_unit_override: true }, 'Synthetic permanent alternative', true, 11_000);
  const appended = permanent.routineData!.days![0].exercises[3];
  expect(appended).toMatchObject({ id: 'manual-permanent-request', name: 'Seated Cable Row', sets: 3,
    weight_unit: 'lb', weight_unit_override: true });
  expect(appended.set_defaults).toEqual(Array.from({ length: 3 }, () => ({ reps: 10, weight_kg: 25 })));
  expect(permanent.session.exercises[3].sets).toEqual(manual.sets.filter(set => set.done));
  expect(permanent.session.exercises[4].sets).toEqual([{ reps: 11, weight_kg: 0, done: true }]);
  expect(permanent.session.exercises[5]).toMatchObject({ name: 'Seated Cable Row', target_sets: 1,
    weight_unit: 'lb', weight_unit_override: true, sets: [{ reps: 10, weight_kg: 25, done: false }] });
  expect(permanent.routineData!.days![1]).toEqual(routine.days![1]);
  expect({ routine, active, partlyCompleted }).toEqual(before);
});

test('a stable exercise can be reordered within its day and only a canonical flat mirror follows its replacement', () => {
  for (const canonicalMirror of [true, false]) {
    const { routine, active } = fixture();
    const [row, bench, triceps] = routine.days![0].exercises;
    routine.days![0].exercises = [bench, row, triceps];
    routine.exercises = canonicalMirror ? routine.days!.flatMap(day => day.exercises)
      : [{ id: 'legacy-flat-only', name: 'Legacy flat exercise', sets: 1, reps: 8, weight_kg: 5 }];
    const before = structuredClone({ routine, active });
    const changes = buildWorkoutExerciseSubstitutionChanges(active, routine, 1, active.exercises[1],
      { id: `reordered-${canonicalMirror}`, name: ALT, sets: 2, reps: 9, weight_kg: 0 },
      'Synthetic replacement after a same-day reorder', true, 10_000);
    const result = { ...routine, ...changes.routineData };
    expect(result.days![0].exercises.map(exercise => exercise.id)).toEqual([EXERCISE_ID, 'row-before', 'triceps-after']);
    expect(result.days![0].exercises[0]).toMatchObject({ id: EXERCISE_ID, name: ALT, sets: 3,
      weight_unit: 'kg', weight_unit_override: true });
    expect(changes.session.exercises[2]).toMatchObject({ name: ALT, routine_exercise_id: EXERCISE_ID, routine_exercise_index: 0 });
    expect(result.days![1]).toEqual(routine.days![1]);
    expect(result.exercises).toEqual(canonicalMirror ? result.days!.flatMap(day => day.exercises) : routine.exercises);
    expect(changes.session.exercises[1].sets).toEqual(active.exercises[1].sets.filter(set => set.done));
    expect({ routine, active }).toEqual(before);
  }
});


test('Firestore map ordering cannot block autosaves, chained alternatives or retries of previously saved requests', () => {
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  const { routine, active } = fixture();
  const first = buildWorkoutExerciseSubstitutionChanges(active, routine, 1, active.exercises[1],
    { id: 'first-ordering-request', name: 'Cable Chest Press', sets: 2, reps: 10, weight_kg: 0, load_basis: 'machine_display' },
    'Synthetic first alternative', false, 1000);
  const roundTrip = reorder(first.session) as WorkoutSession;
  const before = structuredClone(roundTrip);
  expect(() => assertWorkoutAdditionsPreserved(first.session, roundTrip.exercises)).not.toThrow();
  const source = first.session.exercises[2];
  const alternative: RoutineExercise = { id: 'next-ordering-request', name: 'Resistance Band Chest Press', sets: 2, reps: 12,
    weight_kg: 0, load_basis: 'total', load_basis_confirmed: true, load_basis_note: 'Synthetic convention' };
  const next = buildWorkoutExerciseSubstitutionChanges(roundTrip, routine, 2, source, alternative,
    'Synthetic next alternative', false, 2000);
  expect(next.session.exercises[1].sets).toEqual(active.exercises[1].sets.filter(set => set.done));
  expect(next.session.exercises[2].name).toBe(alternative.name);
  expect(next.routineData).toBeNull();
  const legacy = structuredClone(next.session);
  const record = legacy.exercise_substitutions![alternative.id!];
  record.source_signature = JSON.stringify(reorder(JSON.parse(record.source_signature)));
  record.alternative_signature = JSON.stringify(reorder(JSON.parse(record.alternative_signature)));
  const retried = buildWorkoutExerciseSubstitutionChanges(legacy, routine, 2, source, alternative,
    'Synthetic next alternative', false, 3000);
  expect(retried.sessionData).toBeNull();
  expect(retried.routineData).toBeNull();
  expect(retried.session).toEqual(legacy);
  const tampered = structuredClone(roundTrip.exercises);
  tampered[2].exercise_substitution!.source.name = 'A different original movement';
  expect(() => assertWorkoutAdditionsPreserved(first.session, tampered)).toThrow();
  const changed = structuredClone(roundTrip);
  changed.exercises[2].sets[0].done = true;
  expect(() => buildWorkoutExerciseSubstitutionChanges(changed, routine, 2, source, alternative,
    'Synthetic next alternative', false, 4000)).toThrow(/changed/);
  const conflicting = structuredClone(legacy);
  const signature = JSON.parse(conflicting.exercise_substitutions![alternative.id!].source_signature);
  signature[0] = 'Different movement';
  conflicting.exercise_substitutions![alternative.id!].source_signature = JSON.stringify(signature);
  expect(() => buildWorkoutExerciseSubstitutionChanges(conflicting, routine, 2, source, alternative,
    'Synthetic next alternative', false, 4000)).toThrow(/already used/);
  expect(roundTrip).toEqual(before);
});
