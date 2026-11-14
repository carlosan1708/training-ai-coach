import { expect, test, type Page } from '@playwright/test';
import type { WorkoutSession } from '../src/types/routine';
import { enterDemo } from './helpers';

test.use({ hasTouch: true, viewport: { width: 320, height: 740 }, locale: 'en-US' });

const ROUTINE_ID = 'rep-focused-progress';
const ROUTINE_NAME = 'Repetition progress';
const CURL = 'Curl predicador';
const PUSH_UPS = 'Push-ups';

function savedSession(id: string, date: string, exercises: WorkoutSession['exercises'],
  status: WorkoutSession['status'] = 'completed'): WorkoutSession {
  return { id, date, status, routine_id: ROUTINE_ID, routine_name: ROUTINE_NAME, exercises };
}

function sessionExercise(name: string, sets: WorkoutSession['exercises'][number]['sets']) {
  return { name, target_sets: sets.length, target_reps: 10, weight_unit: 'kg' as const, sets };
}

async function seedProgress(page: Page, sessions: WorkoutSession[]) {
  await enterDemo(page);
  await page.evaluate(({ routineId, routineName, curl, pushUps, workouts }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.profile.units = 'metric';
    db.routines = [{ id: routineId, name: routineName, exercises: [
      { name: curl, sets: 3, reps: 10, weight_kg: 36, weight_unit: 'kg' },
      { name: pushUps, sets: 2, reps: 12, weight_kg: 0, weight_unit: 'kg' },
    ] }];
    db.sessions = workouts;
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { routineId: ROUTINE_ID, routineName: ROUTINE_NAME, curl: CURL, pushUps: PUSH_UPS, workouts: sessions });
  await page.goto(`/routines/${ROUTINE_ID}`);
}

async function storedData(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
}

test('repetition progress uses the latest completed workout and each completed set\'s actual load', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  // Shuffled rows include a newer active workout and two completions on the same day.
  await seedProgress(page, [
    savedSession('old', '2026-10-09', [sessionExercise(CURL, [
      { reps: 8, weight_kg: 30, done: true },
      { reps: 8, weight_kg: 30, done: true },
      { reps: 7, weight_kg: 30, done: true },
    ])]),
    savedSession('active', '2026-10-17', [sessionExercise(CURL, [
      { reps: 77, weight_kg: 777, done: true },
    ])], 'active'),
    { ...savedSession('z-same-date-earlier', '2026-10-16', [sessionExercise(CURL, [
      { reps: 14, weight_kg: 20, done: true },
      { reps: 13, weight_kg: 20, done: true },
    ])]), completed_at: 1000 },
    { ...savedSession('a-same-date-latest', '2026-10-16', [{ ...sessionExercise(CURL, [
      { reps: 10, weight_kg: 36, done: true },
      { reps: 99, weight_kg: 999, done: false },
      { reps: 8, weight_kg: 32, done: true },
    ]), weight_unit: 'lb' }]), completed_at: 2000 },
  ]);
  const before = await storedData(page);
  const progress = page.getByRole('region', { name: 'Repetitions per set', exact: true });
  await expect(progress).toBeVisible();
  await expect(progress.getByText('Latest session · 2026-10-16', { exact: true })).toBeVisible();
  const first = progress.getByRole('group', { name: 'Set 1', exact: true });
  await expect(first.getByText('10 reps', { exact: true })).toBeVisible();
  await expect(first.getByText('79.37 lb', { exact: true })).toBeVisible();
  const third = progress.getByRole('group', { name: 'Set 3', exact: true });
  await expect(third.getByText('8 reps', { exact: true })).toBeVisible();
  await expect(third.getByText('70.55 lb', { exact: true })).toBeVisible();
  await expect(progress.getByRole('group', { name: 'Set 2', exact: true })).toHaveCount(0);
  await expect(progress.getByText('18 total reps', { exact: true })).toBeVisible();
  await expect(progress.getByText('77 reps', { exact: true })).toHaveCount(0);
  await expect(progress.getByText('99 reps', { exact: true })).toHaveCount(0);
  await expect(progress.getByText('999 kg', { exact: true })).toHaveCount(0);
  await expect(progress.locator('.recharts-yAxis')).toHaveCount(1);
  await expect(progress.getByText(/Top set|Volume/)).toHaveCount(0);
  expect(await storedData(page)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('switching exercise updates repetitions and retains zero-load bodyweight work with a one-session hint', async ({ page }) => {
  await seedProgress(page, [
    savedSession('latest', '2026-10-16', [
      sessionExercise(CURL, [
        { reps: 10, weight_kg: 36, done: true },
        { reps: 9, weight_kg: 36, done: true },
        { reps: 8, weight_kg: 36, done: true },
      ]),
      sessionExercise(PUSH_UPS, [
        { reps: 12, weight_kg: 0, done: true },
        { reps: 11, weight_kg: 0, done: true },
      ]),
    ]),
    savedSession('old', '2026-10-09', [sessionExercise(CURL, [
      { reps: 8, weight_kg: 36, done: true },
    ])]),
  ]);
  const before = await storedData(page);
  const progress = page.getByRole('region', { name: 'Repetitions per set', exact: true });
  await expect(progress.getByText('27 total reps', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Exercise', exact: true }).tap();
  await page.getByRole('option', { name: PUSH_UPS, exact: true }).tap();
  const first = progress.getByRole('group', { name: 'Set 1', exact: true });
  const second = progress.getByRole('group', { name: 'Set 2', exact: true });
  await expect(first.getByText('12 reps', { exact: true })).toBeVisible();
  await expect(first.getByText('0 kg', { exact: true })).toBeVisible();
  await expect(second.getByText('11 reps', { exact: true })).toBeVisible();
  await expect(second.getByText('0 kg', { exact: true })).toBeVisible();
  await expect(progress.getByRole('group', { name: 'Set 3', exact: true })).toHaveCount(0);
  await expect(progress.getByText('23 total reps', { exact: true })).toBeVisible();
  await expect(progress.getByText('Complete another session to compare your repetitions.', { exact: true })).toBeVisible();
  await expect(progress.getByText('27 total reps', { exact: true })).toHaveCount(0);
  expect(await storedData(page)).toEqual(before);
});

test('Spanish mobile progress makes 10, 9 and 8 repetitions readable without volume or horizontal overflow', async ({ page }) => {
  await seedProgress(page, [savedSession('latest', '2026-10-16', [sessionExercise(CURL, [
    { reps: 10, weight_kg: 36, done: true },
    { reps: 9, weight_kg: 36, done: true },
    { reps: 8, weight_kg: 36, done: true },
  ])])]);
  await page.getByRole('button', { name: 'Language', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Español', exact: true }).tap();
  const progress = page.getByRole('region', { name: 'Repeticiones por serie', exact: true });
  await expect(progress).toBeVisible();
  // Language changes intentionally persist profile preferences; viewing progress must not write further data.
  await expect.poll(async () => (await storedData(page)).profile.ui_language).toBe('es');
  const before = await storedData(page);
  for (const [index, reps] of [10, 9, 8].entries()) {
    const set = progress.getByRole('group', { name: `Serie ${index + 1}`, exact: true });
    await expect(set.getByText(`${reps} reps`, { exact: true })).toBeVisible();
    await expect(set.getByText('36 kg', { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('combobox', { name: 'Ejercicio', exact: true })).toHaveText(CURL);
  await expect(progress.getByText('27 repeticiones en total', { exact: true })).toBeVisible();
  await expect(progress.getByText('Completa otra sesión para comparar tus repeticiones.', { exact: true })).toBeVisible();
  await expect(progress.getByText(/Serie máxima|Volumen/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await progress.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('repetitions-spanish-mobile.png'), animations: 'disabled' });
  expect(await storedData(page)).toEqual(before);
});
