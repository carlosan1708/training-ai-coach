import { expect, test, type Page } from '@playwright/test';
import { enterDemo, revealTrainingOptions } from './helpers';

test.use({ hasTouch: true, viewport: { width: 320, height: 740 }, locale: 'en-US', timezoneId: 'America/Costa_Rica' });

const ROUTINE_ID = 'mixed-weight-plan';
const EXERCISE = 'Machine press';
const LOG_DATE = '2026-10-16';

async function seedMixedUnits(page: Page, withHistory = true) {
  await page.clock.install({ time: new Date('2026-10-16T18:00:00Z') });
  await enterDemo(page);
  await page.evaluate(({ routineId, exercise, logDate, withHistory }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.profile.units = 'metric';
    db.profile.workout_weight_unit = 'lb';
    db.routines = [{ id: routineId, name: 'Mixed-unit workout', session_count: withHistory ? 2 : 0,
      exercises: [{ id: 'machine-press', name: exercise, sets: 2, reps: 10, weight_kg: 20, weight_unit: 'kg',
        set_defaults: [{ reps: 10, weight_kg: 20 }, { reps: 8, weight_kg: 20 }] }] }];
    db.sessions = withHistory ? [
      { id: 'legacy-old', routine_id: routineId, routine_name: 'Mixed-unit workout', date: '2026-10-09', status: 'completed',
        exercises: [{ name: exercise, routine_exercise_id: 'machine-press', target_sets: 2, target_reps: 10, weight_unit: 'kg',
          sets: [{ reps: 8, weight_kg: 20, done: true }, { reps: 7, weight_kg: 20, done: true }] }] },
      { id: 'legacy-latest', routine_id: routineId, routine_name: 'Mixed-unit workout', date: logDate, status: 'completed',
        exercises: [{ name: exercise, routine_exercise_id: 'machine-press', target_sets: 2, target_reps: 10, weight_unit: 'kg',
          sets: [{ reps: 10, weight_kg: 20, done: true }, { reps: 9, weight_kg: 20, done: true }] }] },
    ] : [];
    db.logs = { [logDate]: { date: logDate, weight_kg: 70, measurements: { waist_cm: 80 }, energy: 3,
      notes: 'Keep my measurement', food_log: [], exercise_log: [] } };
    db.reports = [];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
    // An old remembered body unit must not turn the user's kilogram measurements into pounds.
    localStorage.setItem('tac_weight_unit:demo-user:body-weight', 'lb');
  }, { routineId: ROUTINE_ID, exercise: EXERCISE, logDate: LOG_DATE, withHistory });
  await page.goto(`/routines/${ROUTINE_ID}`);
}

const readDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));

async function activeExercise(page: Page) {
  const id = new URL(page.url()).pathname.split('/').at(-1);
  return page.evaluate(id => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions
    .find((session: { id: string }) => session.id === id).exercises[0], id);
}

async function startWorkout(page: Page) {
  await page.getByRole('button', { name: 'Start Workout', exact: true }).tap();
  await page.waitForURL('**/session/**');
  return page.getByRole('region', { name: EXERCISE, exact: true });
}

test('workout pounds preference overrides legacy kilograms in prescription, configuration, repetitions and history without writes', async ({ page }) => {
  await seedMixedUnits(page);
  const before = await readDb(page);
  await expect(page.getByText('2×10 · 44.09 lb', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).tap();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Weight (lb)', { exact: true })).toHaveValue('44.09');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();

  await page.getByRole('button', { name: 'View progress', exact: true }).tap();
  await expect(page).toHaveURL(/view=progress/);
  const progress = page.getByRole('region', { name: 'Repetitions per set', exact: true });
  await expect(progress.getByRole('group', { name: 'Set 1', exact: true })).toContainText('10 reps');
  await expect(progress.getByRole('group', { name: 'Set 2', exact: true })).toContainText('9 reps');
  await expect(progress.getByRole('group', { name: 'Set 1', exact: true }).getByText('44.09 lb', { exact: true })).toBeVisible();
  await expect(progress.getByText('20 kg', { exact: true })).toHaveCount(0);
  await expect(progress.locator('.recharts-yAxis')).toHaveCount(1);

  await page.goto('/workout-history?session=legacy-latest');
  const history = page.getByRole('table', { name: `Completed sets for ${EXERCISE}`, exact: true });
  await expect(history.getByText('44.09 lb', { exact: true })).toHaveCount(2);
  await expect(history.getByText('20 kg', { exact: true })).toHaveCount(0);
  await page.goto(`/routines/${ROUTINE_ID}/session/legacy-latest`);
  const completed = page.getByRole('region', { name: EXERCISE, exact: true });
  await expect(completed.getByText('44.09 lb × 10', { exact: true })).toBeVisible();
  await expect(completed.getByText('44.09 lb × 9', { exact: true })).toBeVisible();
  expect(await readDb(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a deliberate kilogram machine override survives completion and the next workout while unit toggles preserve exact loads and repetitions', async ({ page }) => {
  await seedMixedUnits(page, false);
  const before = await readDb(page);
  const first = await startWorkout(page);
  await expect(first.getByLabel('lb', { exact: true }).first()).toHaveValue('44.09');
  await expect(first.getByText('Target: 2×10 · 44.09 lb', { exact: true })).toBeVisible();
  await revealTrainingOptions(page);
  await first.getByRole('button', { name: 'kg', exact: true }).tap();
  await expect(first.getByLabel('kg', { exact: true }).first()).toHaveValue('20');
  await expect.poll(async () => (await activeExercise(page)).weight_unit_override).toBe(true);
  await first.getByRole('checkbox').nth(0).check();
  await first.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).tap();
  await expect(page).toHaveURL(/\/workout-history\?session=.*&saved=1$/);
  // The historical display follows the overall preference; entry on this machine remains kilograms.
  await expect(page.getByRole('table', { name: `Completed sets for ${EXERCISE}`, exact: true })
    .getByText('44.09 lb', { exact: true })).toHaveCount(2);

  await page.goto(`/routines/${ROUTINE_ID}`);
  const next = await startWorkout(page);
  await expect(next.getByLabel('kg', { exact: true }).first()).toHaveValue('20');
  await expect(next.getByLabel('Reps', { exact: true }).nth(0)).toHaveValue('10');
  await expect(next.getByLabel('Reps', { exact: true }).nth(1)).toHaveValue('8');
  for (const unit of ['lb', 'kg', 'lb'] as const) {
    await revealTrainingOptions(page);
    await next.getByRole('button', { name: unit, exact: true }).tap();
    await expect(next.getByLabel(unit, { exact: true }).first()).toHaveValue(unit === 'kg' ? '20' : '44.09');
  }
  await expect.poll(async () => (await activeExercise(page)).weight_unit).toBe('lb');
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  expect(await activeExercise(page)).toMatchObject({ weight_unit: 'lb', weight_unit_override: true,
    sets: [{ weight_kg: 20, reps: 10, done: false }, { weight_kg: 20, reps: 8, done: false }] });
  const after = await readDb(page);
  expect(after.profile).toEqual(before.profile);
  expect(after.logs[LOG_DATE].weight_kg).toBe(70);
  expect(after.logs[LOG_DATE].measurements).toEqual(before.logs[LOG_DATE].measurements);
});

test('editing a workout load in pounds converts once and keeps the saved reps and historical kilogram values', async ({ page }) => {
  await seedMixedUnits(page);
  const before = await readDb(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).tap();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Weight (lb)', { exact: true }).fill('100');
  await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(page.getByText('2×10 · 100 lb', { exact: true })).toBeVisible();
  const exercise = await startWorkout(page);
  await expect(exercise.getByLabel('lb', { exact: true }).nth(0)).toHaveValue('100');
  await expect(exercise.getByLabel('lb', { exact: true }).nth(1)).toHaveValue('100');
  await expect(exercise.getByLabel('Reps', { exact: true }).nth(0)).toHaveValue('10');
  await expect(exercise.getByLabel('Reps', { exact: true }).nth(1)).toHaveValue('8');
  const active = await activeExercise(page);
  expect(active.sets.map((set: { weight_kg: number }) => set.weight_kg)).toEqual([45.359237, 45.359237]);
  const after = await readDb(page);
  expect(after.sessions.filter((session: { status: string }) => session.status === 'completed')).toEqual(before.sessions);
  expect(after.logs).toEqual(before.logs);
  expect(after.profile).toEqual(before.profile);
});

test('body measurements remain kilograms despite workout pounds and an old remembered body pound unit', async ({ page }) => {
  await seedMixedUnits(page);
  const before = await readDb(page);
  await page.goto(`/log?date=${LOG_DATE}`);
  await expect(page.getByLabel('Body weight (kg)', { exact: true })).toHaveValue('70');
  await expect(page.getByLabel('Body weight (lb)', { exact: true })).toHaveCount(0);
  await page.goto(`/log?tab=1&date=${LOG_DATE}`);
  const record = page.getByTestId(`measurement-entry-legacy_manual_${LOG_DATE}`);
  await expect(record).toContainText('70 kg');
  await expect(record).toContainText('80 cm');
  await record.getByRole('button', { name: 'View reading', exact: true }).tap();
  const results = page.getByRole('dialog');
  await expect(results).toContainText('70 kg');
  await expect(results.getByText(/154\.32 lb/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).tap();
  expect(await readDb(page)).toEqual(before);
});
