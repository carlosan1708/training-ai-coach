import { test, expect, type Page } from '@playwright/test';
import { enterDemo, revealTrainingOptions } from './helpers';

test.use({ hasTouch: true, viewport: { width: 320, height: 700 } });

async function openSession(page: Page, status: 'active' | 'completed' = 'active', units: 'metric' | 'imperial' = 'metric') {
  await enterDemo(page);
  await page.evaluate(({ status, units }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.profile.units = units;
    db.routines = [{ id: 'session-ux-plan', name: 'Mixed machine workout', exercises: [], session_count: 0 }];
    db.sessions = [{
      id: 'session-ux', routine_id: 'session-ux-plan', routine_name: 'Mixed machine workout',
      day_name: 'Upper body', date: '2026-01-05', status,
      exercises: [{
        name: 'Bench Press', target_sets: 3, target_reps: 10, target_weight_kg: 60, weight_unit: 'kg',
        notes: 'Original prescription: 3 × 6–10 reps. Keep 1–2 RIR.', rest_sec: 180,
        sets: [
          { weight_kg: 60, reps: 10, done: true },
          { weight_kg: 60, reps: 9, done: false },
          { weight_kg: 55, reps: 8, done: false },
        ],
      }, {
        name: 'Cable Curl', target_sets: 1, target_reps: 12, target_weight_kg: 20,
        sets: [{ weight_kg: 20, reps: 12, done: false }],
      }],
    }];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { status, units });
  await page.goto('/routines/session-ux-plan/session/session-ux');
  await expect(page.getByRole('region', { name: 'Bench Press', exact: true })).toBeVisible();
}

async function storedSession(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions[0]);
}

test('recording takes priority over secondary options and finishing on mobile', async ({ page }) => {
  await openSession(page);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  const finish = page.getByRole('button', { name: 'Finish workout', exact: true });
  await expect(finish).toHaveClass(/MuiButton-text/);
  await expect(page.getByRole('button', { name: 'Cancel workout', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find an alternative with AI', exact: true })).toHaveCount(0);
  const row = page.getByTestId('workout-set').first();
  const weightBounds = await row.getByLabel('kg', { exact: true }).boundingBox();
  const repsBounds = await row.getByLabel('Reps', { exact: true }).boundingBox();
  const completeBounds = await row.getByRole('checkbox').boundingBox();
  expect(Math.abs(weightBounds!.y - repsBounds!.y)).toBeLessThan(3);
  expect(Math.abs(weightBounds!.y - completeBounds!.y)).toBeLessThan(16);
  await page.screenshot({ path: test.info().outputPath('workout-focused-320.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 390 });
  for (const name of ['Bench Press', 'Cable Curl']) {
    const weight = page.getByRole('region', { name, exact: true }).getByLabel('kg', { exact: true }).first();
    await weight.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await weight.tap();
    await weight.fill('72.5');
    await expect(weight).toBeFocused();
    await expect(weight).toHaveValue('72.5');
    expect(await weight.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom < window.innerHeight - 70
        && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        && parseFloat(getComputedStyle(element).fontSize) >= 16;
    })).toBe(true);
  }
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
  await page.getByRole('region', { name: 'Cable Curl', exact: true }).getByLabel('kg', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: test.info().outputPath('compact-mobile-recording.png') });
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await expect(finish).toHaveClass(/MuiButton-contained/);
  await finish.scrollIntoViewIfNeeded();
  const lastExercise = await page.getByRole('region', { name: 'Cable Curl', exact: true }).boundingBox();
  const finishBounds = await finish.boundingBox();
  expect(finishBounds!.y).toBeGreaterThanOrEqual(lastExercise!.y + lastExercise!.height);
  await finish.tap();
  await expect(page).toHaveURL(/\/workout-history\?session=session-ux&saved=1$/);
  expect((await storedSession(page)).exercises[1].sets[0].weight_kg).toBe(72.5);
});

test('mixed machine units convert to canonical kilograms and persist without repeated-conversion drift', async ({ page }) => {
  await openSession(page);
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  const curl = page.getByRole('region', { name: 'Cable Curl', exact: true });
  await expect(bench.getByText('Rest 180s', { exact: true })).toBeVisible();
  await expect(bench.getByRole('textbox', { name: 'Exercise notes', exact: true })).not.toBeVisible();
  await bench.getByTestId('exercise-notes').locator('summary').click();
  await expect(bench.getByRole('textbox', { name: 'Exercise notes', exact: true })).toHaveValue('Original prescription: 3 × 6–10 reps. Keep 1–2 RIR.');
  await revealTrainingOptions(page);
  await bench.getByRole('button', { name: 'lb', exact: true }).tap();
  await expect(bench.getByLabel('lb', { exact: true }).first()).toHaveValue('132.28');
  await bench.getByLabel('lb', { exact: true }).first().fill('100.125');
  await expect(bench.getByLabel('lb', { exact: true }).first()).toHaveValue('100.125');
  await bench.getByLabel('lb', { exact: true }).first().fill('100');
  await expect(bench.getByTestId('workout-set').first().getByText('≈ 45.36 kg', { exact: true })).toBeVisible();
  await expect(curl.getByLabel('kg', { exact: true })).toHaveValue('20');
  await expect(bench.getByText('Target: 3×10 · 132.28 lb', { exact: true })).toBeVisible();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  let session = await storedSession(page);
  expect(session.exercises[0].weight_unit).toBe('lb');
  expect(session.exercises[0].sets[0].weight_kg).toBeCloseTo(45.359237, 8);
  expect(session.exercises[1].sets[0].weight_kg).toBe(20);
  await page.reload();
  await expect(bench.getByLabel('lb', { exact: true }).first()).toHaveValue('100');
  await revealTrainingOptions(page);
  await bench.getByRole('button', { name: 'kg', exact: true }).tap();
  await expect(bench.getByLabel('kg', { exact: true }).first()).toHaveValue('45.36');
  await revealTrainingOptions(page);
  await bench.getByRole('button', { name: 'lb', exact: true }).tap();
  await expect(bench.getByLabel('lb', { exact: true }).first()).toHaveValue('100');
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  session = await storedSession(page);
  expect(session.exercises[0].sets[0].weight_kg).toBeCloseTo(45.359237, 8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const touchTargets = await bench.getByRole('button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(touchTargets.every(rect => rect.width >= 44 && rect.height >= 44)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('mixed-units-320px.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Finish workout', exact: true }).tap();
  await page.waitForURL(/\/workout-history\?session=session-ux&saved=1$/);
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).logs['2026-01-05']);
  expect(log.exercise_log[0].weight_unit).toBe('lb');
  expect(log.exercise_log[0].weight_kg).toBeCloseTo(45.359237, 8);
  expect(log.exercise_log[0].notes).toContain('100 lb');
});

test('removes an accidental added set and undo restores its recorded values', async ({ page }) => {
  await openSession(page);
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  await expect(page.getByText('1 of 4 sets completed', { exact: true })).toBeVisible();
  await bench.getByRole('button', { name: 'Add set', exact: true }).tap();
  const added = bench.getByTestId('workout-set').nth(3);
  await added.getByLabel('kg', { exact: true }).fill('62.5');
  await added.getByLabel('Reps', { exact: true }).fill('11');
  await added.getByRole('checkbox').check();
  await expect(page.getByText('2 of 5 sets completed', { exact: true })).toBeVisible();
  await revealTrainingOptions(page);
  await bench.getByRole('button', { name: 'Remove set 4', exact: true }).tap();
  await expect(bench.getByTestId('workout-set')).toHaveCount(3);
  await expect(page.getByText('1 of 4 sets completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await expect(bench.getByTestId('workout-set')).toHaveCount(4);
  await expect(added.getByLabel('kg', { exact: true })).toHaveValue('62.5');
  await expect(added.getByLabel('Reps', { exact: true })).toHaveValue('11');
  await expect(added.getByRole('checkbox')).toBeChecked();
  await revealTrainingOptions(page);
  await bench.getByRole('button', { name: 'Remove set 4', exact: true }).tap();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(bench.getByTestId('workout-set')).toHaveCount(3);
  await revealTrainingOptions(page);
  await expect(page.getByRole('region', { name: 'Cable Curl', exact: true })
    .getByRole('button', { name: 'Remove set 1', exact: true })).toBeDisabled();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
});

test('Back flushes the latest edit before leaving and retries a failed autosave', async ({ page }) => {
  await openSession(page);
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'tac_demo_db') {
        Storage.prototype.setItem = original;
        throw new DOMException('Demo write interrupted', 'QuotaExceededError');
      }
      original.call(this, key, value);
    };
  });
  await bench.getByLabel('kg', { exact: true }).first().fill('72.5');
  await expect(page.getByText('Changes not saved', { exact: true })).toBeVisible();
  expect((await storedSession(page)).exercises[0].sets[0].weight_kg).toBe(60);
  await page.getByRole('button', { name: 'Retry', exact: true }).tap();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  expect((await storedSession(page)).exercises[0].sets[0].weight_kg).toBe(72.5);
  await bench.getByLabel('kg', { exact: true }).first().fill('75');
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await page.waitForURL('**/routines/session-ux-plan');
  expect((await storedSession(page)).exercises[0].sets[0].weight_kg).toBe(75);
  await page.goto('/routines/session-ux-plan/session/session-ux');
  await expect(bench.getByLabel('kg', { exact: true }).first()).toHaveValue('75');
});

test('completed workouts are read only and legacy exercises use profile units', async ({ page }) => {
  await openSession(page, 'completed', 'imperial');
  const before = await storedSession(page);
  await expect(page.getByText('Completed workout · edit to make corrections', { exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Finish workout', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add set', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Remove set/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Cable Curl', exact: true }).getByText('44.09 lb × 12', { exact: true })).toBeVisible();
  for (const checkbox of await page.getByRole('checkbox').all()) await expect(checkbox).toBeDisabled();
  await page.getByRole('button', { name: 'Language', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Español' }).tap();
  await expect(page.getByText('Entrenamiento completado · puedes editarlo para corregirlo', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await storedSession(page)).toEqual(before);
  await page.screenshot({ path: test.info().outputPath('completed-session-landscape.png'), animations: 'disabled' });
});

test('failed completion is atomic and Back preserves the latest unsaved weight', async ({ page }) => {
  await openSession(page);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.assign(window, { restoreWorkoutStorage: () => { Storage.prototype.setItem = original; } });
    Storage.prototype.setItem = function (key, value) {
      if (key === 'tac_demo_db') throw new DOMException('Interrupted workout save', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.getByRole('region', { name: 'Bench Press', exact: true }).getByLabel('kg', { exact: true }).first().fill('75');
  await page.getByRole('button', { name: 'Finish workout', exact: true }).tap();
  await expect(page.getByText('Changes not saved', { exact: true })).toBeVisible();
  const failed = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  expect(failed.sessions[0].status).toBe('active');
  expect(failed.routines).toEqual(before.routines);
  expect(failed.logs).toEqual(before.logs);
  await page.evaluate(() => (window as Window & { restoreWorkoutStorage: () => void }).restoreWorkoutStorage());
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(page).toHaveURL(/\/routines\/session-ux-plan$/);
  expect((await storedSession(page)).exercises[0].sets[0].weight_kg).toBe(75);
  await page.goto('/routines/session-ux-plan/session/session-ux');
  await page.getByRole('button', { name: 'Finish workout', exact: true }).tap();
  await expect(page).toHaveURL(/\/workout-history\?session=session-ux&saved=1$/);
  const completed = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  expect(completed.routines[0].session_count).toBe(1);
  expect(completed.logs['2026-01-05'].exercise_log[0].weight_kg).toBe(75);
  // Reopening the session is read-only and cannot count the workout twice.
  await page.goto('/routines/session-ux-plan/session/session-ux');
  await expect(page.getByText('Completed workout · edit to make corrections', { exact: true })).toBeVisible();
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!))).routines[0].session_count).toBe(1);
});
