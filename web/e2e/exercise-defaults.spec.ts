import { test, expect, type Page } from '@playwright/test';
import { enterDemo, revealTrainingOptions } from './helpers';
import { carrySessionDefaults, resolveExerciseDefaults } from '../src/lib/exerciseDefaults';
import type { Routine, WorkoutSession } from '../src/types/routine';

async function seed(page: Page) {
  await enterDemo(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.routines = [{ id: 'persistent-loads', name: 'Persistent working loads', exercises: [{
      name: 'Bench Press', sets: 3, reps: 10, weight_kg: 20, weight_unit: 'kg',
    }] }];
    db.sessions = [{
      id: 'z-older-id', routine_id: 'persistent-loads', routine_name: 'Persistent working loads',
      status: 'completed', date: '2026-01-05', completed_at: 1000,
      exercises: [{ name: 'Bench Press', target_sets: 3, target_reps: 10, weight_unit: 'kg',
        sets: [{ reps: 10, weight_kg: 80, done: true }] }],
    }, {
      id: 'a-newer-time', routine_id: 'persistent-loads', routine_name: 'Persistent working loads',
      status: 'completed', date: '2026-01-05', completed_at: 2000,
      exercises: [{ name: 'Bench Press', target_sets: 3, target_reps: 10, weight_unit: 'lb',
        sets: [
          { reps: 12, weight_kg: 45.359237, done: true },
          { reps: 9, weight_kg: 40.8233133, done: true },
          { reps: 7, weight_kg: 0, done: false },
        ] }],
    }];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.goto('/routines/persistent-loads');
}

test('next workout reuses each latest entered load and rep count, including unfinished zero-weight sets', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  await expect(bench.getByLabel('lb', { exact: true }).nth(0)).toHaveValue('100');
  await expect(bench.getByLabel('lb', { exact: true }).nth(1)).toHaveValue('90');
  await expect(bench.getByLabel('lb', { exact: true }).nth(2)).toHaveValue('0');
  await expect(bench.getByLabel('Reps', { exact: true }).nth(0)).toHaveValue('12');
  await expect(bench.getByLabel('Reps', { exact: true }).nth(1)).toHaveValue('9');
  await expect(bench.getByLabel('Reps', { exact: true }).nth(2)).toHaveValue('7');
  for (const checkbox of await bench.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
});

test('saved session edits become persistent defaults and future workouts retain configured set count', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  await bench.getByLabel('lb', { exact: true }).nth(0).fill('95');
  await bench.getByLabel('Reps', { exact: true }).nth(0).fill('8');
  await bench.getByLabel('Reps', { exact: true }).nth(1).fill('6');
  await revealTrainingOptions(page);
  await bench.getByRole('button', { name: 'Remove set 3', exact: true }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(bench.getByLabel('lb', { exact: true }).nth(0)).toHaveValue('95');
  await bench.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.waitForURL('**/workout-history?**');
  await page.goto('/routines/persistent-loads');
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  await expect(bench.getByTestId('workout-set')).toHaveCount(3);
  await expect(bench.getByLabel('lb', { exact: true }).nth(0)).toHaveValue('95');
  await expect(bench.getByLabel('Reps', { exact: true }).nth(0)).toHaveValue('8');
  await expect(bench.getByLabel('lb', { exact: true }).nth(1)).toHaveValue('90');
  await expect(bench.getByLabel('Reps', { exact: true }).nth(1)).toHaveValue('6');
  await expect(bench.getByLabel('lb', { exact: true }).nth(2)).toHaveValue('90');
  await expect(bench.getByLabel('Reps', { exact: true }).nth(2)).toHaveValue('6');
  for (const checkbox of await bench.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
});

test('explicit routine edits replace previous defaults and an older resumed session cannot overwrite them', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  // The URL can update before the lazy session route replaces the routine's Back button.
  await revealTrainingOptions(page);
  await expect(page.getByRole('button', { name: 'Cancel workout', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Bench Press', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForURL('**/routines/persistent-loads');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Weight (lb)', { exact: true })).toHaveValue('100');
  await dialog.getByLabel('Reps', { exact: true }).fill('15');
  await dialog.getByRole('button', { name: 'kg', exact: true }).click();
  await dialog.getByLabel('Weight (kg)', { exact: true }).fill('30');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Resume workout in progress', exact: true }).click();
  await page.waitForURL('**/session/**');
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  await bench.getByLabel('lb', { exact: true }).first().fill('110');
  await bench.getByLabel('Reps', { exact: true }).first().fill('5');
  await bench.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.waitForURL('**/workout-history?**');
  await page.goto('/routines/persistent-loads');
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  await expect(bench.getByLabel('kg', { exact: true }).first()).toHaveValue('30');
  await expect(bench.getByLabel('Reps', { exact: true }).first()).toHaveValue('15');
});

test('AI adjustments are explicit and become the next saved baseline', async ({ page }) => {
  await seed(page);
  await page.getByRole('checkbox', { name: 'Adjust with AI', exact: true }).check();
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions[0]);
  expect(first.ai_insight).toBeTruthy();
  const defaults = first.exercises[0].sets.map((set: { reps: number; weight_kg: number }) =>
    ({ reps: set.reps, weight_kg: set.weight_kg }));
  const storedDefaults = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).routines[0].exercises[0].set_defaults);
  expect(storedDefaults).toEqual(defaults);
  await page.getByRole('region', { name: 'Bench Press', exact: true }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.waitForURL('**/workout-history?**');
  await page.goto('/routines/persistent-loads');
  await expect(page.getByRole('checkbox', { name: 'Adjust with AI', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  const next = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions[0]);
  expect(next.ai_insight).toBeUndefined();
  expect(next.exercises[0].sets.map((set: { reps: number; weight_kg: number }) =>
    ({ reps: set.reps, weight_kg: set.weight_kg }))).toEqual(defaults);
});

test('editing only the rep target keeps the different working weights for each set', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reps', { exact: true }).fill('13');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  await expect(bench.getByLabel('lb', { exact: true }).nth(0)).toHaveValue('100');
  await expect(bench.getByLabel('lb', { exact: true }).nth(1)).toHaveValue('90');
  await expect(bench.getByLabel('lb', { exact: true }).nth(2)).toHaveValue('0');
  for (const input of await bench.getByLabel('Reps', { exact: true }).all()) await expect(input).toHaveValue('13');
});

test('discarding an AI-adjusted draft restores the routine before the adjustment', async ({ page }) => {
  await seed(page);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  await page.getByRole('checkbox', { name: 'Adjust with AI', exact: true }).check();
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  const adjusted = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  expect(adjusted.sessions[0].ai_insight).toBeTruthy();
  expect(adjusted.routines).not.toEqual(before.routines);
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Cancel workout', exact: true }).click();
  await page.getByRole('dialog', { name: 'Cancel this workout?', exact: true })
    .getByRole('button', { name: 'Discard workout', exact: true }).click();
  await expect(page).toHaveURL('/routines/persistent-loads');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  expect(after.routines).toEqual(before.routines);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.logs).toEqual(before.logs);
});

test('defaults keep same-name exercises isolated by day and stable exercise id, allowing zero and decreases', () => {
  const routine: Routine = { id: 'split', name: 'Split', exercises: [], days: [
    { id: 'upper', name: 'Upper', exercises: [{ id: 'press-upper', name: 'Press', sets: 2, reps: 10, weight_kg: 50 }] },
    { id: 'lower', name: 'Lower', exercises: [{ id: 'press-lower', name: 'Press', sets: 2, reps: 12, weight_kg: 100 }] },
  ] };
  const session: WorkoutSession = { id: 's', routine_id: 'split', routine_name: 'Split', day_id: 'lower',
    date: '2026-01-05', status: 'completed', exercises: [{ name: 'Press', routine_exercise_id: 'press-lower',
      target_sets: 2, target_reps: 12, weight_unit: 'kg', sets: [
        { weight_kg: 0, reps: 8, done: true }, { weight_kg: -5, reps: 6, done: false },
      ] }] };
  expect(resolveExerciseDefaults(routine, 0, [session], 'upper').sets.map(set => set.weight_kg)).toEqual([50, 50]);
  expect(resolveExerciseDefaults(routine, 0, [session], 'lower').sets).toEqual([
    { weight_kg: 0, reps: 8, done: false }, { weight_kg: -5, reps: 6, done: false },
  ]);
  const patch = carrySessionDefaults(routine, session)!;
  expect(patch.days![0]).toEqual(routine.days![0]);
  expect(patch.days![1].exercises[0].set_defaults).toEqual([{ weight_kg: 0, reps: 8 }, { weight_kg: -5, reps: 6 }]);
  expect(patch.days![1].exercises[0].sets).toBe(2);
  expect(carrySessionDefaults({ ...routine, days: [routine.days![0], { ...routine.days![1], exercises: [{
    ...routine.days![1].exercises[0], targets_revision: 'new-explicit-targets',
  }] }] }, session)).toBeNull();
});
