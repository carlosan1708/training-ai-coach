import { test, expect, type Page } from '@playwright/test';
import { enterDemo } from './helpers';

test.use({ hasTouch: true, viewport: { width: 320, height: 740 } });

async function seedSecondDaySession(page: Page) {
  await enterDemo(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    const exercise = { name: 'Friday Cable Curl', sets: 1, reps: 10, weight_kg: 15, weight_unit: 'kg' };
    db.routines = [{
      id: 'five-day-plan', name: 'Five day plan', exercises: [exercise], session_count: 0,
      days: [{ id: 'monday', name: 'Monday', exercises: [{ ...exercise, name: 'Monday Press' }] },
        { id: 'friday', name: 'Friday Arms', exercises: [exercise] }],
    }];
    db.sessions = [{
      id: 'friday-workout', routine_id: 'five-day-plan', routine_name: 'Five day plan',
      day_id: 'friday', day_name: 'Friday Arms', date: '2026-10-16', status: 'active',
      started_at: Date.now() - 20 * 60_000,
      exercises: [{ name: exercise.name, target_sets: 1, target_reps: 10, target_weight_kg: 15,
        weight_unit: 'kg', sets: [{ reps: 10, weight_kg: 15, done: true }] }],
    }];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
}

test('finishing a nonfirst training day opens the saved session and its exact recorded sets', async ({ page }) => {
  await seedSecondDaySession(page);
  await page.goto('/routines/five-day-plan/session/friday-workout');
  const exercise = page.getByRole('region', { name: 'Friday Cable Curl', exact: true });
  await exercise.getByLabel('kg', { exact: true }).fill('17.5');
  await exercise.getByLabel('Reps', { exact: true }).fill('11');
  await page.getByRole('button', { name: 'Finish workout', exact: true }).tap();
  await expect(page).toHaveURL(/\/workout-history\?session=friday-workout&saved=1$/);
  await expect(page.getByRole('alert')).toContainText('Workout completed and saved.');
  const saved = page.getByTestId('session-friday-workout');
  await expect(saved.getByText('Friday Arms', { exact: true })).toBeVisible();
  await expect(saved.getByText('Completed', { exact: true }).first()).toBeVisible();
  const sets = saved.getByRole('table', { name: 'Completed sets for Friday Cable Curl', exact: true });
  await expect(sets.getByRole('row').nth(1)).toHaveText('11117.5 kg');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions);
  expect(stored).toHaveLength(1);
  expect(stored[0].status).toBe('completed');
  expect(stored[0].exercises[0].sets).toEqual([{ reps: 11, weight_kg: 17.5, done: true }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(sets).toBeVisible();
});

test('a saved session link retrieves its exact session beyond the first 100 workouts', async ({ page }) => {
  await seedSecondDaySession(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    const selected = { ...db.sessions[0], status: 'completed', date: '2025-01-01' };
    db.sessions = [...Array.from({ length: 105 }, (_, index) => ({
      ...selected, id: `newer-${index}`, date: '2026-10-16', routine_name: `Newer routine ${index}`,
    })), selected];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.goto('/workout-history?session=friday-workout&saved=1');
  await expect(page.getByText('101 sessions found', { exact: true })).toBeVisible();
  const selected = page.getByTestId('session-friday-workout');
  await expect(selected.getByRole('table', { name: 'Completed sets for Friday Cable Curl', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Workout completed and saved.');
  await page.getByRole('button', { name: 'Load older sessions', exact: true }).tap();
  await expect(page.getByText('106 sessions found', { exact: true })).toBeVisible();
  await expect(selected).toHaveCount(1);
});

test('history can refresh already loaded results and retry without hiding saved sessions', async ({ page }) => {
  await seedSecondDaySession(page);
  await page.goto('/workout-history');
  await expect(page.getByText('1 session found', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.sessions.push({ ...db.sessions[0], id: 'newly-saved', routine_name: 'Newly saved session', status: 'completed' });
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.getByRole('button', { name: 'Refresh history', exact: true }).tap();
  await expect(page.getByText('2 sessions found', { exact: true })).toBeVisible();
  await expect(page.getByTestId('session-newly-saved')).toBeVisible();
  await page.evaluate(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'tac_demo_db') {
        Storage.prototype.getItem = original;
        throw new Error('History read interrupted');
      }
      return original.call(this, key);
    };
  });
  await page.getByRole('button', { name: 'Refresh history', exact: true }).tap();
  await expect(page.getByRole('alert')).toContainText("We couldn't load your workout history.");
  await expect(page.getByTestId('session-newly-saved')).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).tap();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('2 sessions found', { exact: true })).toBeVisible();
});

test('same-day history uses actual completion and start timestamps before random document IDs', async ({ page }) => {
  await seedSecondDaySession(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    const base = { ...db.sessions[0], status: 'completed' };
    db.sessions = [
      { ...base, id: 'z-earliest', completed_at: { seconds: 1792166400, nanoseconds: 0 } },
      { ...base, id: 'a-latest', completed_at: '2026-10-16T20:00:00Z' },
      { ...base, id: 'm-middle', completed_at: undefined, started_at: Date.parse('2026-10-16T18:00:00Z') },
    ];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.goto('/workout-history');
  await expect(page.getByText('3 sessions found', { exact: true })).toBeVisible();
  const order = await page.locator('.MuiAccordion-root[data-testid^="session-"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')));
  expect(order).toEqual(['session-a-latest', 'session-m-middle', 'session-z-earliest']);
});
