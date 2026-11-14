import { test, expect, type Page } from '@playwright/test';
import type { DemoDb } from '../src/demo/db';
import { enterDemo } from './helpers';

const readDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);
const savedHistory = (page: Page) => page.getByTestId('session-saved-before-route-failure');

async function openWorkout(page: Page) {
  await enterDemo(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.profile.workout_weight_unit = 'kg';
    db.routines = [{ id: 'lazy-history-plan', name: 'History recovery plan', session_count: 1,
      exercises: [{ id: 'row', name: 'Cable Row', sets: 1, reps: 11, weight_kg: 25 }] }];
    db.sessions = [{ id: 'history-before-release', routine_id: 'lazy-history-plan', routine_name: 'History recovery plan',
      date: '2026-10-16', status: 'completed', exercises: [{ name: 'Cable Row', routine_exercise_id: 'row',
        target_sets: 1, target_reps: 10, sets: [{ reps: 10, weight_kg: 20, done: true }] }] },
    { id: 'saved-before-route-failure', routine_id: 'lazy-history-plan', routine_name: 'History recovery plan',
      date: '2026-10-18', status: 'active', started_at: Date.now() - 300_000,
      exercises: [{ name: 'Cable Row', routine_exercise_id: 'row', target_sets: 1, target_reps: 11,
        sets: [{ reps: 11, weight_kg: 25, done: true }] }] }];
    db.logs = { '2026-10-16': { date: '2026-10-16', measurements: {}, energy: 4,
      notes: 'Historical record stays unchanged.', food_log: [], exercise_log: [] } };
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  const before = await readDb(page);
  await page.goto('/routines/lazy-history-plan/session/saved-before-route-failure');
  await expect(page.getByRole('region', { name: 'Cable Row', exact: true })).toBeVisible();
  return before;
}

function expectExactlyOneCompletion(after: DemoDb, before: DemoDb) {
  expect(after.sessions).toHaveLength(2);
  expect(after.sessions.find(session => session.id === 'saved-before-route-failure')?.status).toBe('completed');
  expect(after.sessions.find(session => session.id === 'history-before-release')).toEqual(before.sessions[0]);
  expect(after.routines[0].session_count).toBe(2);
  expect(after.logs['2026-10-16']).toEqual(before.logs['2026-10-16']);
  expect(after.logs['2026-10-18'].exercise_log.filter(entry => entry.workout_session_id === 'saved-before-route-failure')).toHaveLength(1);
}

test('finishing a workout recovers its saved history when the old history module is unavailable', async ({ page }) => {
  let failures = 0;
  let historyDocuments = 0;
  page.on('request', request => {
    if (request.isNavigationRequest() && new URL(request.url()).pathname === '/workout-history') historyDocuments += 1;
  });
  await page.route(/\/src\/pages\/WorkoutHistoryPage\.tsx(?:\?|$)/, route => {
    if (failures === 0) {
      failures += 1;
      // Hosting rewrites a removed asset from an old tab to the new HTML shell.
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>New release</body></html>' });
    }
    return route.continue();
  });
  const before = await openWorkout(page);
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page).toHaveURL('/workout-history?session=saved-before-route-failure&saved=1');
  await expect.poll(() => failures).toBe(1);
  const saved = savedHistory(page);
  await expect(saved.getByRole('table', { name: 'Completed sets for Cable Row', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(saved).toContainText('25 kg');
  const after = await readDb(page);
  expectExactlyOneCompletion(after, before);
  expect(historyDocuments).toBe(1);
});

test('persistent history module failures show a visible fallback after one reload and support explicit recovery', async ({ page }) => {
  let blockModule = true;
  let failures = 0;
  let historyDocuments = 0;
  page.on('request', request => {
    if (request.isNavigationRequest() && new URL(request.url()).pathname === '/workout-history') historyDocuments += 1;
  });
  await page.route(/\/src\/pages\/WorkoutHistoryPage\.tsx(?:\?|$)/, route => {
    if (blockModule) {
      failures += 1;
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>Removed asset</body></html>' });
    }
    return route.continue();
  });
  const before = await openWorkout(page);
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page).toHaveURL('/workout-history?session=saved-before-route-failure&saved=1');
  await expect.poll(() => failures).toBe(2);
  await expect(page.getByRole('heading', { name: 'We couldn’t open this screen', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Reload screen', exact: true })).toBeVisible();
  expect(historyDocuments).toBe(1);
  expect(failures).toBe(2);
  const completedBeforeReload = await readDb(page);
  expectExactlyOneCompletion(completedBeforeReload, before);
  blockModule = false;
  await page.getByRole('button', { name: 'Reload screen', exact: true }).click();
  await expect(savedHistory(page).getByRole('table', { name: 'Completed sets for Cable Row', exact: true })).toBeVisible();
  const recovered = await readDb(page);
  expectExactlyOneCompletion(recovered, before);
  expect(recovered.sessions).toEqual(completedBeforeReload.sessions);
  expect(recovered.routines).toEqual(completedBeforeReload.routines);
  expect(recovered.logs).toEqual(completedBeforeReload.logs);
  expect(historyDocuments).toBe(2);
});
