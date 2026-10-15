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
  await page.screenshot({ path: test.info().outputPath('day-controls-mobile.png') });
  await rename.tap();
  const dialog = page.getByRole('dialog', { name: 'Edit day name' });
  await dialog.getByLabel('Day name').fill('   ');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await dialog.getByLabel('Day name').fill('Discard this');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.getByRole('tab', { name: 'Lower day' })).toBeVisible();
  await rename.tap();
  await dialog.getByLabel('Day name').fill('  Legs and core  ');
  await page.screenshot({ path: test.info().outputPath('rename-day-mobile.png') });
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
  await page.screenshot({ path: test.info().outputPath('rename-day-landscape.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
