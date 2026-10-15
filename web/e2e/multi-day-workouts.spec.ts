import { test, expect, type Page } from '@playwright/test';
import { enterDemo } from './helpers';

test.use({ hasTouch: true, viewport: { width: 320, height: 700 } });

async function multiDayRoutine(page: Page) {
  await enterDemo(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.routines = [{
      id: 'multi-day', name: 'Two Day Plan', session_count: 0,
      days: [
        { id: 'upper', name: 'Upper day', exercises: [{ name: 'Bench Press', sets: 3, reps: 10, weight_kg: 20 }] },
        { id: 'lower', name: 'Lower day', exercises: [{ name: 'Squat', sets: 3, reps: 8, weight_kg: 30 }] },
      ],
    }];
    db.sessions = [];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.getByRole('button', { name: 'Workouts', exact: true }).tap();
  await expect(page.getByText('Two Day Plan', { exact: true })).toBeVisible();
}

test('mobile navigation opens stored multi-day routines and preserves each day when editing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await multiDayRoutine(page);
  await expect(page.getByText('2 exercises', { exact: true })).toBeVisible();
  await page.getByText('Two Day Plan', { exact: true }).tap();
  await expect(page.getByText('Bench Press', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Lower day' }).tap();
  await expect(page.getByText('Squat', { exact: true })).toBeVisible();
  await expect(page.getByText('Bench Press', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add exercise', exact: true }).tap();
  await page.getByRole('button', { name: 'Add custom exercise' }).tap();
  await page.getByLabel('Exercise name').fill('Calf Raise');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(page.getByText('Calf Raise', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Lower day' }).tap();
  await expect(page.getByText('Calf Raise', { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).routines[0]);
  expect(stored.days[0].exercises.map((e: { name: string }) => e.name)).toEqual(['Bench Press']);
  expect(stored.days[1].exercises.map((e: { name: string }) => e.name)).toEqual(['Squat', 'Calf Raise']);
  expect(stored.exercises).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y: 540 }] });
  for (let y = 510; y >= 210; y -= 30) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 140, y }] });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await touch.detach();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('tab', { name: 'Lower day' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('starts and resumes only the selected day, keeping other days separate', async ({ page }) => {
  await multiDayRoutine(page);
  await page.getByText('Two Day Plan', { exact: true }).tap();
  await page.getByRole('tab', { name: 'Lower day' }).tap();
  await page.getByRole('button', { name: /Start Workout/ }).tap();
  await page.waitForURL('**/session/**');
  await expect(page.getByText('Squat', { exact: true })).toBeVisible();
  await expect(page.getByText('Bench Press', { exact: true })).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions[0]);
  expect(saved.day_id).toBe('lower');
  expect(saved.day_name).toBe('Lower day');
  expect(saved.exercises.map((e: { name: string }) => e.name)).toEqual(['Squat']);
  await page.goto('/routines/multi-day');
  await expect(page.getByRole('button', { name: /Start Workout/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Lower day' }).tap();
  await expect(page.getByRole('button', { name: /Resume workout/ })).toBeVisible();
  await page.getByRole('button', { name: /Resume workout/ }).tap();
  await page.waitForURL('**/session/**');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions.length)).toBe(1);
});

test('day controls stay above long exercise lists; renaming preserves days and sessions', async ({ page }) => {
  await multiDayRoutine(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.routines[0].days[1].exercises = Array.from({ length: 12 }, (_, i) => ({
      name: `Leg exercise ${i + 1}`, sets: 3, reps: 10,
    }));
    db.sessions = [{ id: 'history', routine_id: 'multi-day', day_id: 'lower', day_name: 'Lower day',
      date: '2026-01-01', status: 'completed', exercises: [] }];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.getByText('Two Day Plan', { exact: true }).tap();
  await page.getByRole('tab', { name: 'Lower day' }).tap();
  const add = page.getByRole('button', { name: 'Add exercise', exact: true });
  const rename = page.getByRole('button', { name: 'Edit day name', exact: true });
  await expect(add).toBeInViewport();
  await expect(rename).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('day-controls-mobile.png'), animations: 'disabled' });
  await rename.tap();
  const dialog = page.getByRole('dialog', { name: 'Edit day name' });
  await dialog.getByLabel('Day name').fill('   ');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await dialog.getByLabel('Day name').fill('Discard this');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.getByRole('tab', { name: 'Lower day' })).toBeVisible();
  await rename.tap();
  await dialog.getByLabel('Day name').fill('  Legs and core  ');
  await page.screenshot({ path: test.info().outputPath('rename-day-mobile.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Legs and core', selected: true })).toBeVisible();
  await add.tap();
  await page.getByRole('button', { name: 'Add custom exercise' }).tap();
  await page.getByLabel('Exercise name').fill('Added to renamed day');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(page.getByText('Added to renamed day', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Legs and core' }).tap();
  await expect(page.getByText('Added to renamed day', { exact: true })).toBeVisible();
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  expect(db.routines[0].days[0].name).toBe('Upper day');
  expect(db.routines[0].days[0].exercises.map((e: { name: string }) => e.name)).toEqual(['Bench Press']);
  expect(db.routines[0].days[1].id).toBe('lower');
  expect(db.routines[0].days[1].name).toBe('Legs and core');
  expect(db.routines[0].days[1].exercises).toHaveLength(13);
  expect(db.sessions[0].day_name).toBe('Lower day');
  expect(db.routines[0].exercises).toBeUndefined();
  await page.getByRole('button', { name: 'Language', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Español' }).tap();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('button', { name: 'Añadir ejercicio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar nombre del día', exact: true }).tap();
  const spanishDialog = page.getByRole('dialog', { name: 'Editar nombre del día' });
  await expect(spanishDialog.getByLabel('Nombre del día')).toHaveValue('Legs and core');
  await expect(spanishDialog.getByRole('button', { name: 'Guardar', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('rename-day-landscape.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const format of ['flat', 'multi-day']) {
  test(`adds a day to a ${format} routine without changing existing exercises or history`, async ({ page }) => {
    await multiDayRoutine(page);
    await page.evaluate((flat) => {
      const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
      if (flat) {
        db.routines[0].exercises = db.routines[0].days[0].exercises;
        delete db.routines[0].days;
      }
      db.sessions = [{ id: 'past-session', routine_id: 'multi-day', status: 'completed', exercises: [] }];
      localStorage.setItem('tac_demo_db', JSON.stringify(db));
    }, format === 'flat');
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
    await page.getByText('Two Day Plan', { exact: true }).tap();
    const add = page.getByRole('button', { name: 'Add day', exact: true });
    await expect(add).toBeInViewport();
    await add.tap();
    const dialog = page.getByRole('dialog', { name: 'Add day' });
    await expect(dialog.getByLabel('Day name')).toHaveValue(format === 'flat' ? 'Day 2' : 'Day 3');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
    const cancelled = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
    expect(cancelled.routines).toEqual(original.routines);
    expect(cancelled.sessions).toEqual(original.sessions);
    expect(cancelled.logs).toEqual(original.logs);
    await add.tap();
    await dialog.getByLabel('Day name').fill('   ');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await dialog.getByLabel('Day name').fill('  New training day  ');
    await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(page.getByRole('tab', { name: 'New training day', selected: true })).toBeVisible();
    await expect(page.getByText('No exercises in this day yet.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Workout', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Add exercise', exact: true }).tap();
    await page.getByRole('button', { name: 'Add custom exercise' }).tap();
    await page.getByLabel('Exercise name').fill('Row');
    await page.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(page.getByText('Row', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'New training day' }).tap();
    await expect(page.getByText('Row', { exact: true })).toBeVisible();
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
    const days = db.routines[0].days;
    expect(days).toHaveLength(format === 'flat' ? 2 : 3);
    if (format === 'flat') {
      expect(days[0].name).toBe('Day 1');
      expect(days[0].exercises).toEqual(original.routines[0].exercises);
    } else {
      expect(days.slice(0, 2)).toEqual(original.routines[0].days);
    }
    expect(new Set(days.map((day: { id: string }) => day.id)).size).toBe(days.length);
    expect(days.at(-1).name).toBe('New training day');
    expect(days.at(-1).exercises.map((exercise: { name: string }) => exercise.name)).toEqual(['Row']);
    expect(db.sessions).toEqual(original.sessions);
    expect(db.logs).toEqual(original.logs);
  });
}

test('starts with saved targets by default and can cancel a session without changing the routine or logs', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/routines/demo-routine-upper');
  await expect(page.getByRole('checkbox', { name: 'Adjust with AI', exact: true })).not.toBeChecked();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  const routine = before.routines.find((r: { id: string }) => r.id === 'demo-routine-upper');
  await page.getByRole('button', { name: 'Start Workout', exact: true }).tap();
  await page.waitForURL('**/session/**');
  const sessionId = page.url().split('/').at(-1);
  const started = await page.evaluate((id) => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions
    .find((session: { id: string }) => session.id === id), sessionId);
  expect(started.ai_insight).toBeUndefined();
  expect(started.exercises.map((ex: { target_sets: number; target_reps: number; target_weight_kg: number }) =>
    [ex.target_sets, ex.target_reps, ex.target_weight_kg])).toEqual(
      routine.exercises.map((ex: { sets: number; reps: number; weight_kg?: number }) => [ex.sets, ex.reps, ex.weight_kg ?? 0]));
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: 'Cancel workout', exact: true }).tap();
  const confirmation = page.getByRole('dialog', { name: 'Cancel this workout?' });
  await expect(confirmation.getByRole('button', { name: 'Discard workout', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('cancel-workout-mobile.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await confirmation.getByRole('button', { name: 'Keep training', exact: true }).tap();
  await expect(page.locator('input[type="checkbox"]').first()).toBeChecked();
  // Queue an autosave immediately before cancelling: it must not recreate the discarded session.
  await page.getByLabel('kg', { exact: true }).first().fill('35');
  await page.getByRole('button', { name: 'Cancel workout', exact: true }).tap();
  await confirmation.getByRole('button', { name: 'Discard workout', exact: true }).tap();
  await page.waitForURL('**/routines/demo-routine-upper');
  await expect(page.getByRole('button', { name: 'Start Workout', exact: true })).toBeVisible();
  await page.reload();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  expect(after.sessions).toEqual(before.sessions);
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).tap();
  await page.waitForURL('**/session/**');
  expect(page.url().split('/').at(-1)).not.toBe(sessionId);
  await page.getByRole('button', { name: 'Language', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Español' }).tap();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('button', { name: 'Cancelar entrenamiento', exact: true }).tap();
  const spanish = page.getByRole('dialog', { name: '¿Cancelar este entrenamiento?' });
  await expect(spanish.getByRole('button', { name: 'Descartar entrenamiento', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('cancel-workout-landscape.png'), animations: 'disabled' });
});
