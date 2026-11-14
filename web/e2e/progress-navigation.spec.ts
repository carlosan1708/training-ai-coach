import { expect, test, type Page } from '@playwright/test';
import { enterDemo } from './helpers';

test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, locale: 'en-US' });

const ROUTINE_ID = 'discoverable-repetition-progress';
const ROUTINE_NAME = 'Five day plan';
const FRIDAY_EXERCISE = 'Curl predicador';

async function seedRoutine(page: Page, withHistory = true) {
  await enterDemo(page);
  await page.evaluate(({ routineId, routineName, fridayExercise, history }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.routines = [{
      id: routineId,
      name: routineName,
      days: [
        { id: 'lunes', name: 'Monday', exercises: Array.from({ length: 12 }, (_, index) => ({
          name: `Monday exercise ${index + 1}`, sets: 3, reps: 10, weight_kg: 20,
        })) },
        { id: 'viernes', name: 'Friday', exercises: [
          { name: fridayExercise, sets: 3, reps: 10, weight_kg: 36 },
        ] },
        { id: 'domingo', name: 'Sunday', exercises: [
          { name: 'Hack squat', sets: 3, reps: 8, weight_kg: 40 },
        ] },
      ],
    }];
    db.sessions = history ? [
      { id: 'friday-completed', routine_id: routineId, routine_name: routineName,
        day_id: 'viernes', day_name: 'Friday', date: '2026-10-16', status: 'completed',
        exercises: [{ name: fridayExercise, target_sets: 3, target_reps: 10,
          sets: [10, 9, 8].map(reps => ({ reps, weight_kg: 36, done: true })) }] },
      { id: 'sunday-active', routine_id: routineId, routine_name: routineName,
        day_id: 'domingo', day_name: 'Sunday', date: '2026-10-18', status: 'active',
        exercises: [{ name: 'Hack squat', target_sets: 3, target_reps: 8,
          sets: [{ reps: 77, weight_kg: 40, done: true }] }] },
    ] : [];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { routineId: ROUTINE_ID, routineName: ROUTINE_NAME,
    fridayExercise: FRIDAY_EXERCISE, history: withHistory });
  await page.goto(`/routines/${ROUTINE_ID}`);
  await expect(page.getByRole('tab', { name: 'Monday', selected: true })).toBeVisible();
}

async function storedData(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
}

function expectProgressDay(page: Page, day: string) {
  const params = new URL(page.url()).searchParams;
  expect(params.get('view')).toBe('progress');
  expect(params.get('day')).toBe(day);
}

test('progress is reachable above a long exercise list and opens the latest completed day', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await seedRoutine(page);
  const before = await storedData(page);
  const openProgress = page.getByRole('button', { name: 'View progress', exact: true });
  await expect(openProgress).toBeInViewport();
  await openProgress.tap();

  await expect(page.getByRole('tab', { name: 'Friday', selected: true })).toBeVisible();
  expectProgressDay(page, 'viernes');
  const progress = page.getByRole('region', { name: 'Repetitions per set', exact: true });
  await expect(progress).toBeInViewport();
  await expect(progress.locator('.recharts-wrapper')).toBeVisible();
  await expect(progress.getByText('Latest session · 2026-10-16', { exact: true })).toBeVisible();
  await expect(progress.getByText('27 total reps', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Workout', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add exercise', exact: true })).toHaveCount(0);
  await expect(page.getByText('Monday exercise 12', { exact: true })).toHaveCount(0);
  await expect(progress.getByText('77 reps', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await storedData(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('a progress deep link survives reload and recovers history from an empty selected day', async ({ page }) => {
  await seedRoutine(page);
  const before = await storedData(page);
  await page.goto(`/routines/${ROUTINE_ID}?view=progress&day=viernes`);
  const progress = page.getByRole('region', { name: 'Repetitions per set', exact: true });
  await expect(progress).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Friday', selected: true })).toBeVisible();
  await page.reload();
  await expect(progress.getByRole('group', { name: 'Set 1', exact: true }).getByText('10 reps', { exact: true })).toBeVisible();
  expectProgressDay(page, 'viernes');

  await page.getByRole('tab', { name: 'Monday', exact: true }).tap();
  expectProgressDay(page, 'lunes');
  await expect(progress).toBeVisible();
  await expect(progress.getByText('27 total reps', { exact: true })).toHaveCount(0);
  await expect(progress.locator('.recharts-wrapper')).toHaveCount(0);
  await page.getByRole('button', { name: 'View latest progress', exact: true }).tap();
  await expect(page.getByRole('tab', { name: 'Friday', selected: true })).toBeVisible();
  await expect(progress.getByText('27 total reps', { exact: true })).toBeVisible();
  expectProgressDay(page, 'viernes');

  await page.getByRole('button', { name: 'View exercises', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Start Workout', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add exercise', exact: true })).toBeVisible();
  await expect(page.getByRole('paragraph').filter({ hasText: /^Curl predicador$/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).not.toBe('progress');
  expect(await storedData(page)).toEqual(before);
});

test('Spanish progress remains reachable without history and changes no workout or measurement data', async ({ page }) => {
  await seedRoutine(page, false);
  await page.getByRole('button', { name: 'Language', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Español', exact: true }).tap();
  await expect.poll(async () => (await storedData(page)).profile.ui_language).toBe('es');
  const before = await storedData(page);
  await page.getByRole('button', { name: 'Ver progreso', exact: true }).tap();
  expect(new URL(page.url()).searchParams.get('view')).toBe('progress');
  await expect(page.getByRole('tab', { name: 'Monday', selected: true })).toBeVisible();
  const progress = page.getByRole('region', { name: 'Repeticiones por serie', exact: true });
  await expect(progress).toBeInViewport();
  await expect(progress.getByText('Completa una serie para ver aquí tus repeticiones.', { exact: true })).toBeVisible();
  await expect(progress.locator('.recharts-wrapper')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ver último progreso', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Friday', exact: true }).tap();
  expectProgressDay(page, 'viernes');
  await expect(progress).toBeVisible();
  await expect(progress.locator('.recharts-wrapper')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver ejercicios', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Empezar entrenamiento', exact: true })).toBeVisible();
  await expect(page.getByText(FRIDAY_EXERCISE, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await storedData(page)).toEqual(before);
});
