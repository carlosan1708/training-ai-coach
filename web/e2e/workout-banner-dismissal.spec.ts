import { test, expect, type Page } from '@playwright/test';
import type { DemoDb } from '../src/demo/db';
import { enterDemo, revealTrainingOptions } from './helpers';

test.use({ hasTouch: true, viewport: { width: 320, height: 700 } });

const SESSION_PATH = '/routines/banner-plan/session/banner-active';
const readDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);

async function openSession(page: Page) {
  await page.clock.install({ time: new Date('2026-10-18T16:00:00Z') });
  await enterDemo(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.routines = [{ id: 'banner-plan', name: 'Banner workout', exercises: [], session_count: 1 }];
    db.sessions = [{
      id: 'banner-history', routine_id: 'banner-plan', routine_name: 'Banner workout',
      date: '2026-10-16', status: 'completed', completed_at: Date.now() - 172_800_000,
      exercises: [{
        name: 'Bench Press', target_sets: 1, target_reps: 10, target_weight_kg: 55,
        sets: [{ weight_kg: 55, reps: 10, done: true }],
      }],
    }, {
      id: 'banner-active', routine_id: 'banner-plan', routine_name: 'Banner workout',
      date: '2026-10-18', status: 'active',
      exercises: [{
        name: 'Bench Press', target_sets: 3, target_reps: 10, target_weight_kg: 60,
        weight_unit: 'kg', weight_unit_override: true,
        sets: [
          { weight_kg: 60, reps: 10, done: true },
          { weight_kg: 57.5, reps: 9, done: false },
          { weight_kg: 55, reps: 8, done: false },
        ],
      }],
    }];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.goto(SESSION_PATH);
  await expect(page.getByRole('region', { name: 'Bench Press', exact: true })).toBeVisible();
}

function expectOnlyLastSetsRemoved(before: DemoDb, after: DemoDb, remaining = 2) {
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
  expect(after.sessions[0]).toEqual(before.sessions[0]);
  expect(after.sessions[1].exercises[0].sets).toEqual(before.sessions[1].exercises[0].sets.slice(0, remaining));
  expect(after.sessions[1].status).toBe('active');
}

for (const language of ['en', 'es'] as const) {
  test(`dismisses the removed-set banner in ${language} without undoing the saved removal`, async ({ page }) => {
    await openSession(page);
    if (language === 'es') {
      await page.getByRole('button', { name: 'Language', exact: true }).tap();
      await page.getByRole('menuitem', { name: 'Español' }).tap();
    }
    const before = await readDb(page);
    const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
    await revealTrainingOptions(page);
    await bench.getByRole('button', { name: language === 'es' ? 'Eliminar serie 3' : 'Remove set 3', exact: true }).tap();
    const banner = page.getByRole('alert');
    await expect(banner).toContainText(language === 'es' ? 'Serie 3 eliminada de Bench Press' : 'Set 3 removed from Bench Press');
    await expect(banner.getByRole('button', { name: language === 'es' ? 'Deshacer' : 'Undo', exact: true })).toBeVisible();
    const dismiss = banner.getByRole('button', { name: language === 'es' ? 'Cerrar aviso' : 'Dismiss notification', exact: true });
    await expect(dismiss).toBeInViewport();
    await expect.poll(async () => (await dismiss.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(44);
    await expect.poll(async () => (await dismiss.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`removed-set-banner-${language}-320px.png`), animations: 'disabled' });
    await dismiss.tap();
    await expect(banner).toHaveCount(0);
    await expect(page.getByText(language === 'es' ? 'Cambios guardados' : 'All changes saved', { exact: true })).toBeVisible();
    expectOnlyLastSetsRemoved(before, await readDb(page));
    await page.reload();
    await expect(bench.getByTestId('workout-set')).toHaveCount(2);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expectOnlyLastSetsRemoved(before, await readDb(page));
  });
}

test('the removed-set banner expires after eight seconds while the removal stays saved', async ({ page }) => {
  await openSession(page);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1_000)));
  const before = await readDb(page);
  await revealTrainingOptions(page);
  await page.getByRole('region', { name: 'Bench Press', exact: true }).getByRole('button', { name: 'Remove set 3', exact: true }).tap();
  const banner = page.getByRole('alert');
  await expect(banner).toContainText('Set 3 removed from Bench Press');
  // MUI intentionally pauses Snackbar expiry while the pointer hovers over it.
  await page.mouse.move(0, 0);
  await page.clock.runFor(7_500);
  await expect(banner).toBeVisible();
  await page.clock.runFor(800);
  await expect(banner).toHaveCount(0);
  expectOnlyLastSetsRemoved(before, await readDb(page));
});

test('removing another set gives the new banner a fresh eight-second window', async ({ page }) => {
  await openSession(page);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1_000)));
  const before = await readDb(page);
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  await revealTrainingOptions(page);
  await bench.getByRole('button', { name: 'Remove set 3', exact: true }).tap();
  await page.mouse.move(0, 0);
  await page.clock.runFor(5_000);
  await revealTrainingOptions(page);
  await bench.getByRole('button', { name: 'Remove set 2', exact: true }).tap();
  await page.mouse.move(0, 0);
  const banner = page.getByRole('alert');
  await expect(banner).toContainText('Set 2 removed from Bench Press');
  await page.clock.runFor(7_500);
  await expect(banner).toBeVisible();
  await page.clock.runFor(800);
  await expect(banner).toHaveCount(0);
  expectOnlyLastSetsRemoved(before, await readDb(page), 1);
});
