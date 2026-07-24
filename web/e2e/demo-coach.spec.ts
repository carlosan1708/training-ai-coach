import { test, expect } from '@playwright/test';
import { enterDemo, TINY_PNG } from './helpers';

test.describe('AI coach & daily log', () => {
  test('chat replies with training context', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/chat');
    const input = page.getByRole('textbox');
    await input.fill('Should I train today?');
    await input.press('Enter');
    await expect(page.getByText('Lower Body Power', { exact: false })).toBeVisible({ timeout: 15_000 });
  });

  test('chat answers a progress question with real log numbers', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/chat');
    const input = page.getByRole('textbox');
    await input.fill('How is my weight trending?');
    await input.press('Enter');
    await expect(page.getByText(/kg to .*kg/, { exact: false })).toBeVisible({ timeout: 15_000 });
  });

  test('daily log saves weight and energy', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/log');
    const weight = page.getByLabel(/Weight/i).first();
    await weight.fill('77.0');
    await page.getByRole('button', { name: /Save/i }).first().click();
    // reload — the value must persist in the demo DB
    await page.reload();
    await expect(page.getByLabel(/Weight/i).first()).toHaveValue('77');
  });

  test('exercise photo analysis prefills entries (demo AI)', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/log');
    await page.getByRole('tab', { name: 'Exercises' }).click();
    await page.setInputFiles('input[type="file"]', {
      name: 'whiteboard.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await page.getByRole('button', { name: 'Analyze with AI' }).click();
    await expect(page.getByLabel('Exercise', { exact: true }).first()).toHaveValue(
      'Barbell Bench Press',
      { timeout: 15_000 }
    );
  });

  test('finished workout session mirrors into the daily exercise log', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/routines');
    await page.getByText('Lower Body Power').first().click();
    await page.getByRole('button', { name: /Start Workout|Resume workout/ }).click();
    await page.waitForURL('**/session/**', { timeout: 15_000 });
    const checks = page.locator('input[type="checkbox"]');
    for (let i = 0; i < 4; i++) await checks.nth(i).check();
    await page.getByRole('button', { name: 'Finish workout' }).click();
    await page.waitForURL(/\/routines\/[^/]+$/, { timeout: 15_000 });

    await page.goto('/log');
    await page.getByRole('tab', { name: 'Exercises' }).click();
    await expect(page.getByLabel('Exercise', { exact: true }).first()).toHaveValue(
      'Barbell Squat',
      { timeout: 15_000 }
    );
  });

  test('meal plans page is still reachable at /plans (unlisted)', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/plans');
    await expect(page.getByText('Hypertrophy Meal Plan').first()).toBeVisible();
  });

  test('meal photo analysis is gated off in demo mode', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/log');
    await page.getByRole('tab', { name: 'Meals' }).click();
    // demo shows the "full app only" notice and no uploader
    await expect(page.getByText('available in the full app', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /Take \/ Upload Photo/ })).toHaveCount(0);
    // and the dashboard nutrition card is hidden in demo
    await page.goto('/dashboard');
    await expect(page.getByText("Today's Nutrition")).toHaveCount(0);
  });
});
