import { test, expect, type Page } from '@playwright/test';
import { enterDemo } from './helpers';

test.use({ hasTouch: true, viewport: { width: 320, height: 740 } });

async function openHistoryFilters(page: Page) {
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  if (await filters.getAttribute('aria-expanded') !== 'true') await filters.tap();
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
}

async function seedHistory(page: Page) {
  await enterDemo(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.profile.units = 'metric';
    db.sessions = [
      {
        id: 'history-upper', routine_id: 'deleted-routine', routine_name: 'My old upper routine',
        day_id: 'upper', day_name: 'Upper A', date: '2026-10-12', status: 'completed', duration_min: 48,
        // The persisted aggregate is deliberately wrong; history derives actual work from done sets.
        total_volume_kg: 99999,
        exercises: [
          { name: 'Bench Press', target_sets: 3, target_reps: 10, sets: [
            { reps: 10, weight_kg: 20, done: true },
            { reps: 99, weight_kg: 999, done: false },
            { reps: 8, weight_kg: 25, done: true },
          ] },
          { name: 'Lateral Raise', target_sets: 2, target_reps: 12, weight_unit: 'lb', sets: [
            { reps: 12, weight_kg: 4.5359237, done: true },
          ] },
          { name: 'Skipped exercise', target_sets: 1, target_reps: 12, sets: [
            { reps: 50, weight_kg: 888, done: false },
          ] },
        ],
      },
      {
        id: 'history-lower', routine_id: 'deleted-routine', routine_name: 'My old upper routine',
        day_id: 'lower', day_name: 'Lower B', date: '2026-10-09', status: 'completed', exercises: [
          { name: 'Leg Press', target_sets: 1, target_reps: 10, sets: [{ reps: 10, weight_kg: 50, done: true }] },
        ],
      },
      {
        id: 'history-active', routine_id: 'demo-routine-upper', routine_name: 'Upper Body Strength',
        day_id: 'upper', day_name: 'Upper B', date: '2026-10-15', status: 'active', exercises: [
          { name: 'Cable Row', target_sets: 2, target_reps: 10, sets: [
            { reps: 10, weight_kg: 30, done: true }, { reps: 10, weight_kg: 30, done: false },
          ] },
        ],
      },
    ];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.goto('/workout-history');
  await expect(page.getByRole('heading', { name: 'Workout history', exact: true })).toBeVisible();
  await expect(page.getByText('3 sessions found', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('combobox', { name: 'Session status', exact: true })).toHaveCount(0);
}

test('shows actual completed sets and their own units, including history from deleted routines', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seedHistory(page);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  const session = page.getByTestId('session-history-upper');
  await session.getByRole('button', { name: /View sets for/ }).tap();
  await expect(session.getByTestId('workout-elapsed')).toHaveText('48:00');
  await expect(session.getByTestId('session-volume')).toHaveText('454 kg·reps');
  const bench = session.getByRole('table', { name: 'Completed sets for Bench Press', exact: true });
  await expect(bench.getByRole('row')).toHaveCount(3); // heading and two completed sets
  await expect(bench.getByRole('row').nth(1)).toHaveText('11020 kg');
  await expect(bench.getByRole('row').nth(2)).toHaveText('3825 kg');
  await expect(session.getByText('10 lb', { exact: true })).toBeVisible();
  await expect(session.getByText('999 kg', { exact: true })).toHaveCount(0);
  await expect(session.getByText('888 kg', { exact: true })).toHaveCount(0);
  await expect(session.getByText('No completed sets recorded.', { exact: true })).toBeVisible();
  await expect(session.getByText('1 set not completed; excluded from the total.', { exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('history-actual-sets-mobile.png'), animations: 'disabled' });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!))).toEqual(before);
  expect(errors).toEqual([]);
});

test('filters by search, dates and status, and resolves routine/day links by saved IDs', async ({ page }) => {
  await seedHistory(page);
  await page.getByLabel('Search routine, day or exercise', { exact: true }).fill('leg press');
  await expect(page.getByText('1 session found', { exact: true })).toBeVisible();
  await expect(page.getByTestId('session-history-lower')).toBeVisible();
  await expect(page.getByTestId('session-history-upper')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).tap();
  await openHistoryFilters(page);
  await page.getByLabel('From date', { exact: true }).fill('2026-10-11');
  await page.getByLabel('To date', { exact: true }).fill('2026-10-13');
  await expect(page.getByText('1 session found', { exact: true })).toBeVisible();
  await expect(page.getByTestId('session-history-upper')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).tap();
  await openHistoryFilters(page);
  await page.getByRole('combobox', { name: /^Session status\b/ }).tap();
  await page.getByRole('option', { name: 'In progress', exact: true }).tap();
  await expect(page.getByText('1 session found', { exact: true })).toBeVisible();
  await expect(page.getByTestId('session-history-active')).toBeVisible();
  await page.getByLabel('Search routine, day or exercise', { exact: true }).fill('missing exercise');
  await expect(page.getByText('No sessions match these filters.', { exact: false })).toBeVisible();
  await page.goto('/workout-history?routine=deleted-routine&day=lower');
  await expect(page.getByText('1 session found', { exact: true })).toBeVisible();
  await expect(page.getByTestId('session-history-lower')).toBeVisible();
  await openHistoryFilters(page);
  await expect(page.getByRole('combobox', { name: /^Routine\b/ })).toHaveText('My old upper routine');
  await expect(page.getByRole('combobox', { name: /^Training day\b/ })).toHaveText('Lower B');
  await page.goto('/workout-history?routine=deleted-routine&session=history-upper');
  await expect(page.getByRole('table', { name: 'Completed sets for Bench Press', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).tap();
  await expect(page.getByText('3 sessions found', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/workout-history$/);
});

test('resumes the exact active session without adding a second workout', async ({ page }) => {
  await seedHistory(page);
  const active = page.getByTestId('session-history-active');
  await active.getByRole('button', { name: /View sets for/ }).tap();
  await active.getByRole('link', { name: 'Resume workout', exact: true }).tap();
  await expect(page).toHaveURL(/\/routines\/demo-routine-upper\/session\/history-active$/);
  await expect(page.getByText('Cable Row', { exact: true })).toBeVisible();
  const sessions = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions);
  expect(sessions).toHaveLength(3);
  expect(sessions.find((session: { id: string }) => session.id === 'history-active').status).toBe('active');
});

test('legacy sessions use the preferred unit while stored exercise units remain explicit', async ({ page }) => {
  await seedHistory(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.profile.units = 'imperial';
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.reload();
  const session = page.getByTestId('session-history-upper');
  await session.getByRole('button', { name: /View sets for/ }).tap();
  await expect(session.getByText('44.09 lb', { exact: true })).toBeVisible();
  await expect(session.getByText('55.12 lb', { exact: true })).toBeVisible();
  await expect(session.getByText('10 lb', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions[0].exercises[0].sets[0].weight_kg)).toBe(20);
});

test('offers an actionable empty state and remains usable in Spanish landscape', async ({ page }) => {
  await seedHistory(page);
  await page.getByRole('button', { name: 'Language', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Español', exact: true }).tap();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('heading', { name: 'Historial de entrenamientos', exact: true })).toBeVisible();
  await page.getByTestId('session-history-upper').getByRole('button', { name: /Ver series de/ }).tap();
  await expect(page.getByRole('table', { name: 'Series completadas de Bench Press', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('history-spanish-landscape.png'), animations: 'disabled' });
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.sessions = [];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tu historial empieza aquí', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Ver rutinas', exact: true }).tap();
  await expect(page).toHaveURL(/\/routines$/);
});

test('loads older sessions without losing sessions on the same date', async ({ page }) => {
  await seedHistory(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.sessions = Array.from({ length: 105 }, (_, index) => ({
      id: `same-date-${String(index).padStart(3, '0')}`, routine_id: 'deleted-routine', routine_name: `Saved routine ${index}`,
      date: '2026-10-12', status: 'completed', exercises: [],
    }));
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.reload();
  await expect(page.getByText('100 sessions found', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load older sessions', exact: true }).tap();
  await expect(page.getByText('105 sessions found', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load older sessions', exact: true })).toHaveCount(0);
  expect(await page.locator('[data-testid^="session-same-date-"]').count()).toBe(105);
});
