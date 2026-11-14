import { test, expect } from '@playwright/test';
import { enterDemo } from './helpers';

test.describe('landing & dashboard', () => {
  test('landing page offers Google sign-in and the demo', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Continue with Google|Sign in/i })).toBeVisible();
    await expect(page.getByText('Try the demo')).toBeVisible();
    await expect(page.getByText('No account needed', { exact: false })).toBeVisible();
  });

  test('entering demo lands on a seeded dashboard', async ({ page }) => {
    await enterDemo(page);
    await expect(page.getByText('77.2 kg', { exact: true })).toBeVisible(); // seeded weight
    await expect(page.getByText('Goal: 75 kg').first()).toBeVisible();
    await expect(page.getByText('Demo mode', { exact: false })).toBeVisible(); // banner
  });

  test('goal forecast projects the goal date from seeded weights', async ({ page }) => {
    await enterDemo(page);
    await expect(page.getByText('Goal Forecast')).toBeVisible();
    await expect(page.getByText(/kg\/week/)).toBeVisible();
    await expect(page.getByText(/At this rate you'll reach 75 kg/)).toBeVisible();
  });

  test('weekly report auto-generates on login when stale', async ({ page }) => {
    await enterDemo(page);
    // fresh demo has no stored report — the login trigger creates one
    await expect(page.getByText('Weekly AI Report')).toBeVisible();
    await expect(page.getByText('WINS')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('NEXT WEEK')).toBeVisible();
    await expect(page.getByText(/kg lifted/)).toHaveCount(0);
    await expect(page.getByText(/completed sets\./)).toBeVisible();
  });

  test('exit demo returns to the landing page and clears data', async ({ page }) => {
    await enterDemo(page);
    await page.getByRole('button', { name: 'Exit demo' }).click();
    await page.waitForURL('**/');
    await expect(page.getByText('Try the demo')).toBeVisible();
    const flag = await page.evaluate(() => localStorage.getItem('tac_demo_mode'));
    expect(flag).toBeNull();
  });
});

test.describe('demo local calendar dates', () => {
  test.use({ timezoneId: 'America/Costa_Rica' });
  test('an evening demo seeds today rather than the next UTC date', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-18T02:00:00Z') });
    await enterDemo(page);
    await expect(page.getByRole('heading', { name: '77.2 kg', exact: true })).toBeVisible();
    const dates = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('tac_demo_db')!).logs));
    expect(dates).toContain('2026-10-17');
    expect(dates.every(date => date <= '2026-10-17')).toBe(true);
  });
});
