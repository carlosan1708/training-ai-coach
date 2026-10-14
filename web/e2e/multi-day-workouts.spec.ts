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
