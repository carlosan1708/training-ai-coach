import { test, expect } from '@playwright/test';
import { enterDemo } from './helpers';

test.describe('workout routines', () => {
  test('routines list shows the seeded routines', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/routines');
    await expect(page.getByText('Upper Body Strength')).toBeVisible();
    await expect(page.getByText('Lower Body Power')).toBeVisible();
    await expect(page.getByText('6 exercises').first()).toBeVisible();
  });

  test('create a routine, add a custom exercise, then delete the routine', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/routines');

    // create
    await page.getByRole('button', { name: 'New Routine' }).click();
    await page.getByLabel('Routine name').fill('E2E Test Day');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL('**/routines/**');
    await expect(page.getByText('E2E Test Day')).toBeVisible();

    // add a custom exercise (no network needed)
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await page.getByRole('button', { name: 'Add custom exercise' }).click();
    await page.getByLabel('Exercise name').fill('Farmer Carry');
    await page.getByLabel('Weight (kg)').fill('24');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Farmer Carry')).toBeVisible();
    await expect(page.getByText('3×10 · 24kg')).toBeVisible();

    // delete the routine from the list (native confirm dialog)
    await page.goto('/routines');
    page.on('dialog', (d) => d.accept());
    const card = page.locator('.MuiCard-root', { hasText: 'E2E Test Day' });
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('E2E Test Day')).toHaveCount(0);
  });

  test('AI generates a legs routine with matched exercises', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/routines');
    await page.getByRole('button', { name: 'Generate with AI' }).click();
    await page.getByLabel('Focus').fill('legs, 45 minutes');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.waitForURL('**/routines/**', { timeout: 15_000 });
    await expect(page.getByText('AI Leg Day')).toBeVisible();
    await expect(page.getByText('Barbell Squat')).toBeVisible();
    await expect(page.getByText('Romanian Deadlift')).toBeVisible();
  });

  test('start an AI-adjusted session, log sets, add a set, finish', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/routines');
    await page.getByText('Upper Body Strength').first().click();

    // progressive-overload history is seeded → progress + history visible
    await expect(page.getByText('Progress', { exact: true })).toBeVisible();
    await expect(page.getByText('Session history')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Adjust with AI', exact: true }).check();
    await page.getByRole('button', { name: /Start Workout/ }).click();
    await page.waitForURL('**/session/**', { timeout: 15_000 });

    // AI plan applied: insight banner + per-exercise adjustment note
    await expect(page.getByText(/progressive overload/)).toBeVisible();
    await expect(page.getByText('All sets completed — load up').first()).toBeVisible();
    await expect(page.getByText(/Last time:/).first()).toBeVisible();

    // log the first three sets
    const checks = page.locator('input[type="checkbox"]');
    for (let i = 0; i < 3; i++) await checks.nth(i).check();
    await expect(page.getByText(/1[0-9]%/)).toBeVisible(); // progress moved off 0%

    // add a set to the first exercise
    const before = await checks.count();
    await page.getByRole('button', { name: 'Add set' }).first().click();
    await expect(checks).toHaveCount(before + 1);

    // finish → back on the routine page with a new history entry (today)
    await page.getByRole('button', { name: 'Finish workout' }).click();
    await page.waitForURL(/\/routines\/[^/]+$/, { timeout: 15_000 });
    const today = new Date().toISOString().split('T')[0];
    await expect(page.getByText(today).first()).toBeVisible();
  });

  test('resume an in-progress session instead of starting a new one', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/routines');
    await page.getByText('Lower Body Power').first().click();
    await page.getByRole('button', { name: /Start Workout/ }).click();
    await page.waitForURL('**/session/**', { timeout: 15_000 });

    // leave mid-session, come back → the button offers to resume
    await page.goto('/routines');
    await page.getByText('Lower Body Power').first().click();
    await expect(page.getByRole('button', { name: /Resume workout/ })).toBeVisible();
  });
});
