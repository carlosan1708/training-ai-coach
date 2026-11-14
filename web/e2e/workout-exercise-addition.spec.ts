import { test, expect, type Page } from '@playwright/test';
import type { DemoDb } from '../src/demo/db';
import { enterDemo, revealTrainingOptions } from './helpers';

test.use({ timezoneId: 'America/Costa_Rica', locale: 'en-US', viewport: { width: 420, height: 850 } });

const ROUTINE_ID = 'exercise-addition-plan';
const SESSION_ID = 'exercise-addition-active';
const SESSION_PATH = `/routines/${ROUTINE_ID}/session/${SESSION_ID}`;
const LIBRARY_EXERCISE = 'Dumbbell Lateral Raise';

async function openSession(page: Page, status: 'active' | 'completed' = 'active') {
  const cloudRequests: string[] = [];
  await page.route(/plan_workout_session|cloudfunctions\.net|\.a\.run\.app|api\.openai\.com|generativelanguage\.googleapis\.com/, route => {
    cloudRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.route('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json', route => route.fulfill({
    json: [{ id: 'Synthetic_Lateral_Raise', name: LIBRARY_EXERCISE, primaryMuscles: ['shoulders'],
      secondaryMuscles: [], equipment: 'dumbbell', instructions: ['Raise the weights with control.'], images: [] }],
  }));
  await page.clock.install({ time: new Date('2026-10-18T16:00:00Z') });
  await enterDemo(page);
  await page.evaluate(({ routineId, sessionId, status }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.profile.units = 'metric';
    db.profile.workout_weight_unit = 'kg';
    db.routines = [{
      id: routineId, name: 'Exercise addition plan', exercises: [], session_count: 2, last_session_at: '2026-10-16',
      days: [{ id: 'upper', name: 'Upper day', exercises: [{
        id: 'bench-exercise', name: 'Bench Press', sets: 3, reps: 10, weight_kg: 60,
        weight_unit: 'kg', weight_unit_override: true, targets_revision: 'bench-prescription',
        set_defaults: [{ reps: 10, weight_kg: 60 }, { reps: 9, weight_kg: 57.5 }, { reps: 8, weight_kg: 55 }],
      }] }, { id: 'lower', name: 'Lower day', exercises: [{
        id: 'squat-exercise', name: 'Squat', sets: 2, reps: 8, weight_kg: 70, weight_unit: 'kg',
      }] }],
    }];
    db.sessions = [{
      id: 'past-upper', routine_id: routineId, routine_name: 'Exercise addition plan',
      day_id: 'upper', day_name: 'Upper day', date: '2026-10-16', status: 'completed',
      exercises: [{ name: 'Bench Press', routine_exercise_id: 'bench-exercise', targets_revision: 'bench-prescription',
        target_sets: 1, target_reps: 10, sets: [{ reps: 10, weight_kg: 55, done: true }] }],
    }, {
      id: 'past-lower', routine_id: routineId, routine_name: 'Exercise addition plan',
      day_id: 'lower', day_name: 'Lower day', date: '2026-10-15', status: 'completed',
      exercises: [{ name: 'Squat', routine_exercise_id: 'squat-exercise', target_sets: 1, target_reps: 8,
        sets: [{ reps: 8, weight_kg: 65, done: true }] }],
    }, {
      id: sessionId, routine_id: routineId, routine_name: 'Exercise addition plan',
      day_id: 'upper', day_name: 'Upper day', date: '2026-10-18', status, started_at: Date.now() - 300_000,
      ...(status === 'completed' ? { completed_at: Date.now() - 60_000 } : {}),
      exercises: [{ name: 'Bench Press', routine_exercise_id: 'bench-exercise', routine_exercise_index: 0,
        targets_revision: 'bench-prescription', weight_unit: 'kg', weight_unit_override: true,
        target_sets: 3, target_reps: 10, target_weight_kg: 60,
        sets: [{ reps: 10, weight_kg: 60, done: true }, { reps: 9, weight_kg: 57.5, done: false },
          { reps: 8, weight_kg: 55, done: false }] }],
    }];
    db.logs = {
      '2026-10-16': { date: '2026-10-16', measurements: {}, energy: 4, notes: 'Saved historical log.', food_log: [],
        exercise_log: [{ workout_session_id: 'past-upper', exercise: 'Bench Press', sets: 1, reps: 10, weight_kg: 55 }] },
      '2026-10-18': { date: '2026-10-18', measurements: {}, energy: 3, notes: 'Keep my manual entry.', food_log: [],
        exercise_log: [{ exercise: 'Manual walk', duration_min: 20 }] },
    };
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { routineId: ROUTINE_ID, sessionId: SESSION_ID, status });
  await page.goto(SESSION_PATH);
  await expect(page.getByRole('region', { name: 'Bench Press', exact: true })).toBeVisible();
  return cloudRequests;
}

const readDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);
const active = (db: DemoDb) => db.sessions.find(session => session.id === SESSION_ID)!;
const day = (db: DemoDb, id: string) => db.routines[0].days!.find(item => item.id === id)!;

function expectPastUnchanged(after: DemoDb, before: DemoDb) {
  for (const saved of before.sessions.filter(session => session.id !== SESSION_ID)) {
    expect(after.sessions.find(session => session.id === saved.id)).toEqual(saved);
  }
  expect(after.logs['2026-10-16']).toEqual(before.logs['2026-10-16']);
}

async function configureAddition(page: Page, name: string, library = false, sets = 1) {
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  if (library) await page.getByRole('button', { name: new RegExp(LIBRARY_EXERCISE) }).click();
  else await page.getByRole('button', { name: 'Add custom exercise', exact: true }).click();
  const config = page.getByRole('dialog');
  if (!library) {
    const input = config.getByRole('combobox', { name: 'Exercise name', exact: true });
    await input.fill(name);
    await input.press('Escape');
  }
  await config.getByLabel('Sets', { exact: true }).fill(String(sets));
  await config.getByLabel('Reps', { exact: true }).fill(library ? '12' : '19');
  await config.getByLabel('Weight (kg)', { exact: true }).fill(library ? '12' : '199');
  await config.getByRole('button', { name: 'Save', exact: true }).click();
  const scope = page.getByRole('dialog', { name: 'Add to workout', exact: true });
  await expect(scope).toBeVisible();
  return scope;
}

test('addition scope defaults to this workout and cancelling either scope changes no saved training data', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  let scope = await configureAddition(page, 'Cancelled addition');
  await expect(scope.getByRole('radio', { name: 'Only this workout', exact: true })).toBeChecked();
  await expect(scope.getByRole('radio', { name: 'Also save in this routine', exact: true })).not.toBeChecked();
  await scope.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(scope).toBeHidden();
  expect((await readDb(page)).sessions).toEqual(before.sessions);
  expect((await readDb(page)).routines).toEqual(before.routines);
  expect((await readDb(page)).logs).toEqual(before.logs);

  scope = await configureAddition(page, 'Cancelled permanent addition');
  await scope.getByRole('radio', { name: 'Also save in this routine', exact: true }).check();
  await scope.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(scope).toBeHidden();
  scope = await configureAddition(page, 'Default reset check');
  await expect(scope.getByRole('radio', { name: 'Only this workout', exact: true })).toBeChecked();
  await scope.getByRole('button', { name: 'Cancel', exact: true }).click();
  const after = await readDb(page);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
  expect(cloudRequests).toEqual([]);
});

test('a temporary same-name exercise stays in saved history without leaking into future routine defaults', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  const original = active(before).exercises[0];
  const scope = await configureAddition(page, 'Bench Press');
  await expect(scope.getByRole('radio', { name: 'Only this workout', exact: true })).toBeChecked();
  await scope.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await expect(scope).toBeHidden();
  await expect(page.getByRole('region', { name: 'Bench Press', exact: true })).toHaveCount(2);
  await expect.poll(async () => active(await readDb(page)).exercises.length).toBe(2);
  const added = await readDb(page);
  expect(active(added).exercises[0]).toEqual(original);
  expect(active(added).exercises[1]).toMatchObject({ name: 'Bench Press', routine_defaults_excluded: true,
    sets: [{ reps: 19, weight_kg: 199, done: false }] });
  expect(active(added).exercises[1].routine_exercise_id).not.toBe('bench-exercise');
  expect(added.routines).toEqual(before.routines);
  expect(added.logs).toEqual(before.logs);
  expectPastUnchanged(added, before);

  await page.reload();
  const benches = page.getByRole('region', { name: 'Bench Press', exact: true });
  await expect(benches).toHaveCount(2);
  await expect(benches.nth(0).getByRole('checkbox').first()).toBeChecked();
  await expect(benches.nth(0).getByLabel('Reps', { exact: true }).nth(1)).toHaveValue('9');
  await expect(benches.nth(0).getByLabel('kg', { exact: true }).nth(1)).toHaveValue('57.5');
  await expect(benches.nth(1).getByLabel('kg', { exact: true })).toHaveValue('199');
  await benches.nth(1).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page).toHaveURL(`/workout-history?session=${SESSION_ID}&saved=1`);
  const history = page.getByTestId(`session-${SESSION_ID}`);
  const tables = history.getByRole('table', { name: 'Completed sets for Bench Press', exact: true });
  await expect(tables).toHaveCount(2);
  await expect(tables.nth(0)).toContainText('60 kg');
  await expect(tables.nth(1)).toContainText('199 kg');
  const completed = await readDb(page);
  expect(active(completed).status).toBe('completed');
  expect(active(completed).exercises[0]).toEqual(original);
  expect(day(completed, 'upper').exercises).toHaveLength(1);
  expect(day(completed, 'lower')).toEqual(day(before, 'lower'));
  expect(completed.logs['2026-10-18'].exercise_log.filter(entry => !entry.workout_session_id))
    .toEqual(before.logs['2026-10-18'].exercise_log);
  expectPastUnchanged(completed, before);

  await page.goto(`/routines/${ROUTINE_ID}?day=upper`);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  await expect(page.getByRole('region', { name: 'Bench Press', exact: true })).toHaveCount(1);
  const future = (await readDb(page)).sessions.find(session => session.status === 'active')!;
  expect(future.exercises).toHaveLength(1);
  expect(future.exercises[0].routine_exercise_id).toBe('bench-exercise');
  expect(future.exercises[0].sets).toEqual(original.sets.map(set => ({ ...set, done: false })));
  expect(cloudRequests).toEqual([]);
});

test('a permanent library addition stays in its exact day through discard while cancelled working values roll back', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  await bench.getByLabel('kg', { exact: true }).nth(1).fill('58');
  await bench.getByLabel('Reps', { exact: true }).nth(1).fill('11');
  const scope = await configureAddition(page, LIBRARY_EXERCISE, true);
  await scope.getByRole('radio', { name: 'Also save in this routine', exact: true }).check();
  await scope.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await expect(scope).toBeHidden();
  const lateral = page.getByRole('region', { name: LIBRARY_EXERCISE, exact: true });
  await expect(lateral).toBeVisible();
  const after = await readDb(page);
  const permanent = day(after, 'upper').exercises.find(exercise => exercise.name === LIBRARY_EXERCISE)!;
  expect(permanent.id).toBeTruthy();
  expect(permanent.library_id).toBe('Synthetic_Lateral_Raise');
  expect(active(after).exercises[1].routine_exercise_id).toBe(permanent.id);
  expect(active(after).exercises[1].routine_defaults_excluded).not.toBe(true);
  expect(active(after).exercises[0].sets).toEqual([
    { reps: 10, weight_kg: 60, done: true }, { reps: 11, weight_kg: 58, done: false },
    { reps: 8, weight_kg: 55, done: false },
  ]);
  expect(day(after, 'lower')).toEqual(day(before, 'lower'));
  expect(after.logs).toEqual(before.logs);
  expectPastUnchanged(after, before);

  await lateral.getByLabel('kg', { exact: true }).fill('99');
  await lateral.getByLabel('Reps', { exact: true }).fill('21');
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Cancel workout', exact: true }).click();
  await page.getByRole('dialog', { name: 'Cancel this workout?', exact: true })
    .getByRole('button', { name: 'Discard workout', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/routines/${ROUTINE_ID}`));
  const discarded = await readDb(page);
  expect(discarded.sessions.find(session => session.id === SESSION_ID)).toBeUndefined();
  expect(day(discarded, 'upper').exercises.map(exercise => exercise.name)).toEqual(['Bench Press', LIBRARY_EXERCISE]);
  expect(day(discarded, 'upper').exercises[1].id).toBe(permanent.id);
  expect(day(discarded, 'lower')).toEqual(day(before, 'lower'));
  expect(discarded.logs).toEqual(before.logs);
  expectPastUnchanged(discarded, before);
  await page.goto(`/routines/${ROUTINE_ID}?day=upper`);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  await expect(lateral.getByLabel('kg', { exact: true })).toHaveValue('12');
  await expect(lateral.getByLabel('Reps', { exact: true })).toHaveValue('12');
  const future = (await readDb(page)).sessions.find(session => session.status === 'active')!;
  expect(future.exercises).toHaveLength(2);
  expect(future.exercises[1].routine_exercise_id).toBe(permanent.id);
  expect(future.exercises[0].sets).toEqual(active(before).exercises[0].sets.map(set => ({ ...set, done: false })));
  expectPastUnchanged(await readDb(page), before);
  expect(cloudRequests).toEqual([]);
});

test('a recorded temporary addition can be saved in the routine later without replacing or duplicating its sets', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  const scope = await configureAddition(page, 'Temporary cable row');
  await scope.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await expect(scope).toBeHidden();
  const row = page.getByRole('region', { name: 'Temporary cable row', exact: true });
  await expect(row.getByText('Only this workout', { exact: true })).toBeVisible();
  await row.getByLabel('kg', { exact: true }).fill('25');
  await row.getByLabel('Reps', { exact: true }).fill('17');
  await row.getByRole('checkbox').check();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  const recorded = await readDb(page);
  const temporary = active(recorded).exercises[1];
  expect(temporary.routine_exercise_id).toBeTruthy();
  expect(temporary.sets).toEqual([{ reps: 17, weight_kg: 25, done: true }]);
  await revealTrainingOptions(page);
  await row.getByRole('button', { name: 'Save in routine', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Save in routine?', exact: true });
  await confirmation.getByRole('button', { name: 'Save in routine', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(row.getByRole('button', { name: 'Save in routine', exact: true })).toHaveCount(0);
  const promoted = await readDb(page);
  expect(active(promoted).exercises).toHaveLength(2);
  expect(active(promoted).exercises[0]).toEqual(active(recorded).exercises[0]);
  expect(active(promoted).exercises[1].routine_exercise_id).toBe(temporary.routine_exercise_id);
  expect(active(promoted).exercises[1].sets).toEqual(temporary.sets);
  expect(active(promoted).exercises[1].routine_defaults_excluded).not.toBe(true);
  const saved = day(promoted, 'upper').exercises.filter(exercise => exercise.id === temporary.routine_exercise_id);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ name: 'Temporary cable row', sets: 1,
    set_defaults: [{ reps: 17, weight_kg: 25 }] });
  expect(day(promoted, 'lower')).toEqual(day(before, 'lower'));
  expect(promoted.logs).toEqual(before.logs);
  expectPastUnchanged(promoted, before);
  await page.reload();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await expect(row.getByRole('button', { name: 'Save in routine', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page).toHaveURL(`/workout-history?session=${SESSION_ID}&saved=1`);
  await page.goto(`/routines/${ROUTINE_ID}?day=upper`);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  await expect(row.getByLabel('kg', { exact: true })).toHaveValue('25');
  await expect(row.getByLabel('Reps', { exact: true })).toHaveValue('17');
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  const next = (await readDb(page)).sessions.find(session => session.status === 'active')!;
  expect(next.exercises.filter(exercise => exercise.routine_exercise_id === temporary.routine_exercise_id)).toHaveLength(1);
  expectPastUnchanged(await readDb(page), before);
  expect(cloudRequests).toEqual([]);
});

test('AI substitution of a manual addition retains its completed sets and replaces only its pending work', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  const scope = await configureAddition(page, 'Bench Press', false, 2);
  await scope.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await expect(scope).toBeHidden();
  const benches = page.getByRole('region', { name: 'Bench Press', exact: true });
  await expect(benches).toHaveCount(2);
  const manual = benches.nth(1);
  await manual.getByLabel('kg', { exact: true }).nth(0).fill('25');
  await manual.getByLabel('Reps', { exact: true }).nth(0).fill('17');
  await manual.getByLabel('kg', { exact: true }).nth(1).fill('20');
  await manual.getByLabel('Reps', { exact: true }).nth(1).fill('15');
  await manual.getByRole('checkbox').first().check();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  const recorded = await readDb(page);
  const manualBefore = active(recorded).exercises[1];
  expect(manualBefore.routine_addition).toBe(true);
  await revealTrainingOptions(page);
  await manual.getByRole('button', { name: 'Find an alternative with AI', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Exercise alternatives', exact: true });
  await dialog.getByRole('button', { name: /^Suggest alternatives?$/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Incline Push-Up', exact: true })).toBeVisible();
  expect(active(await readDb(page)).exercises).toEqual(active(recorded).exercises);
  await dialog.getByRole('button', { name: 'Use this exercise', exact: true }).click();
  await expect(dialog).toBeHidden();
  const alternative = page.getByRole('region', { name: 'Incline Push-Up', exact: true });
  await expect(alternative).toBeVisible();
  await expect.poll(async () => active(await readDb(page)).exercises.length).toBe(3);
  const replaced = await readDb(page);
  expect(active(replaced).exercises[0]).toEqual(active(recorded).exercises[0]);
  expect(active(replaced).exercises[1].routine_exercise_id).toBe(manualBefore.routine_exercise_id);
  expect(active(replaced).exercises[1].sets).toEqual([{ reps: 17, weight_kg: 25, done: true }]);
  expect(active(replaced).exercises[2]).toMatchObject({ name: 'Incline Push-Up', routine_defaults_excluded: true,
    target_sets: 1, sets: [{ reps: 15, weight_kg: 0, done: false }] });
  expect(replaced.routines).toEqual(before.routines);
  expect(replaced.logs).toEqual(before.logs);
  expectPastUnchanged(replaced, before);

  await page.reload();
  await expect(benches).toHaveCount(2);
  await expect(benches.nth(1).getByTestId('workout-set')).toHaveCount(1);
  await expect(benches.nth(1).getByRole('checkbox')).toBeChecked();
  await expect(alternative.getByTestId('workout-set')).toHaveCount(1);
  await expect(alternative.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page).toHaveURL(`/workout-history?session=${SESSION_ID}&saved=1`);
  await expect(page.getByTestId(`session-${SESSION_ID}`).getByRole('table', {
    name: 'Completed sets for Bench Press', exact: true,
  })).toHaveCount(2);
  const completed = await readDb(page);
  expect(active(completed).status).toBe('completed');
  expect(active(completed).exercises).toEqual(active(replaced).exercises);
  expect(day(completed, 'upper').exercises.map(exercise => exercise.name)).toEqual(['Bench Press']);
  expect(day(completed, 'lower')).toEqual(day(before, 'lower'));
  expectPastUnchanged(completed, before);
  expect(cloudRequests).toEqual([]);
});

test('retrying a substituted manual addition cannot restore or permanently promote the original request', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  const result = await page.evaluate(async ({ sessionId }) => {
    const apiPath = '/src/firebase/firestore.ts';
    const authPath = '/src/store/authStore.ts';
    const api = await import(apiPath);
    const { useAuthStore } = await import(authPath);
    const uid = useAuthStore.getState().currentUser.uid;
    const request = { id: 'retryable-manual-addition', name: 'Retryable manual row',
      sets: 1, reps: 12, weight_kg: 8, weight_unit: 'kg' };
    const added = await api.addExerciseToWorkoutSession(uid, sessionId, request, false);
    const original = added.exercises[1];
    const substituted = await api.substituteWorkoutSessionExercise(uid, sessionId, 1, original,
      { id: 'retryable-alternative', name: 'Resistance Band Row', sets: 1, reps: 12, weight_kg: 0 },
      'Synthetic explicit replacement');
    const retried = await api.addExerciseToWorkoutSession(uid, sessionId, request, false);
    let stalePromotionRejected = false;
    try {
      await api.addExerciseToWorkoutSession(uid, sessionId, request, true);
    } catch {
      stalePromotionRejected = true;
    }
    return { substituted, retried, stalePromotionRejected };
  }, { sessionId: SESSION_ID });
  expect(result.stalePromotionRejected).toBe(true);
  expect(result.retried).toEqual(result.substituted);
  expect(result.substituted.exercises).toHaveLength(2);
  expect(result.substituted.exercises[0]).toEqual(active(before).exercises[0]);
  expect(result.substituted.exercises[1]).toMatchObject({ name: 'Resistance Band Row',
    routine_defaults_excluded: true, sets: [{ reps: 12, weight_kg: 0, done: false }] });
  const after = await readDb(page);
  expect(active(after)).toEqual(result.substituted);
  expect(active(after).exercises.some(exercise => exercise.routine_exercise_id === 'retryable-manual-addition')).toBe(false);
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
  expectPastUnchanged(after, before);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Resistance Band Row', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Retryable manual row', exact: true })).toHaveCount(0);
  expect(active(await readDb(page))).toEqual(result.substituted);
  expect(cloudRequests).toEqual([]);
});

test('an exercise added in the workout editor is temporary until explicitly saved from its workout card', async ({ page }) => {
  const cloudRequests = await openSession(page);
  const before = await readDb(page);
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Edit workout', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit workout', exact: true });
  await editor.getByRole('button', { name: 'Add exercise', exact: true }).click();
  const added = editor.getByRole('region', { name: 'Exercise 2', exact: true });
  await added.getByRole('combobox', { name: 'Exercise name', exact: true }).fill('Bench Press');
  await added.getByLabel('Reps', { exact: true }).fill('27');
  await added.getByLabel('Weight (kg)', { exact: true }).fill('177');
  await added.getByRole('checkbox', { name: 'Set completed', exact: true }).check();
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toBeHidden();
  const benches = page.getByRole('region', { name: 'Bench Press', exact: true });
  await expect(benches).toHaveCount(2);
  await expect(benches.nth(1).getByText('Only this workout', { exact: true })).toBeVisible();
  const edited = await readDb(page);
  const newExercise = active(edited).exercises[1];
  expect(newExercise).toMatchObject({ routine_defaults_excluded: true, routine_addition: true,
    sets: [{ reps: 27, weight_kg: 177, done: true }] });
  expect(newExercise.routine_exercise_id).not.toBe('bench-exercise');
  expect(active(edited).exercises[0].sets).toEqual(active(before).exercises[0].sets);
  expect(day(edited, 'upper').exercises).toHaveLength(1);
  expect(day(edited, 'upper').exercises[0].set_defaults).toEqual(day(before, 'upper').exercises[0].set_defaults);
  expect(day(edited, 'lower')).toEqual(day(before, 'lower'));
  expect(edited.logs).toEqual(before.logs);
  expectPastUnchanged(edited, before);
  await revealTrainingOptions(page);
  await benches.nth(1).getByRole('button', { name: 'Save in routine', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Save in routine?', exact: true });
  await confirmation.getByRole('button', { name: 'Save in routine', exact: true }).click();
  await expect(confirmation).toBeHidden();
  const promoted = await readDb(page);
  expect(active(promoted).exercises[1].routine_exercise_id).toBe(newExercise.routine_exercise_id);
  expect(active(promoted).exercises[1].sets).toEqual(newExercise.sets);
  expect(day(promoted, 'upper').exercises.map(exercise => exercise.id))
    .toEqual(['bench-exercise', newExercise.routine_exercise_id]);
  expect(day(promoted, 'lower')).toEqual(day(before, 'lower'));
  expect(promoted.logs).toEqual(before.logs);
  expectPastUnchanged(promoted, before);
  expect(cloudRequests).toEqual([]);
});

test('Spanish addition scope and later-save confirmation fit a narrow mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const cloudRequests = await openSession(page);
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Español', exact: true }).click();
  const before = await readDb(page);
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Añadir ejercicio', exact: true }).click();
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Añadir ejercicio personalizado', exact: true }).click();
  const config = page.getByRole('dialog');
  const name = config.getByRole('combobox', { name: 'Nombre del ejercicio', exact: true });
  await name.fill('Elevación lateral nueva');
  await name.press('Escape');
  await config.getByLabel('Series', { exact: true }).fill('1');
  await config.getByLabel('Reps', { exact: true }).fill('8');
  await config.getByLabel('Peso (kg)', { exact: true }).fill('5');
  await config.getByRole('button', { name: 'Guardar', exact: true }).click();
  const scope = page.getByRole('dialog', { name: 'Añadir al entrenamiento', exact: true });
  await expect(scope.getByRole('radio', { name: 'Solo este entrenamiento', exact: true })).toBeChecked();
  await expect(scope.getByRole('radio', { name: 'También guardar en esta rutina', exact: true })).not.toBeChecked();
  await expect(scope.getByRole('button', { name: 'Añadir ejercicio', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('spanish-addition-scope-mobile.png'), animations: 'disabled' });
  await scope.getByRole('button', { name: 'Añadir ejercicio', exact: true }).click();
  await expect(scope).toBeHidden();
  const added = page.getByRole('region', { name: 'Elevación lateral nueva', exact: true });
  await expect(added.getByText('Solo este entrenamiento', { exact: true })).toBeVisible();
  const temporary = await readDb(page);
  await revealTrainingOptions(page);
  await added.getByRole('button', { name: 'Guardar en rutina', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '¿Guardar en la rutina?', exact: true });
  await expect(confirmation.getByRole('button', { name: 'Guardar en rutina', exact: true })).toBeInViewport();
  await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(confirmation).toBeHidden();
  const after = await readDb(page);
  expect(after.sessions).toEqual(temporary.sessions);
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
  expect(active(after).exercises[0]).toEqual(active(before).exercises[0]);
  expectPastUnchanged(after, before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(cloudRequests).toEqual([]);
});

test('completed workouts keep the direct addition control hidden', async ({ page }) => {
  const cloudRequests = await openSession(page, 'completed');
  const before = await readDb(page);
  await expect(page.getByRole('button', { name: 'Add exercise', exact: true })).toHaveCount(0);
  const after = await readDb(page);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
  expect(cloudRequests).toEqual([]);
});
