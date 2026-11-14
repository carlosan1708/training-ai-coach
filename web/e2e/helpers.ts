import { type Page, expect } from '@playwright/test';

/** Enter demo mode from the landing page, landing on the dashboard. */
export async function enterDemo(page: Page) {
  await page.goto('/');
  await page.getByText('Try the demo').click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByText('Welcome, Alex!')).toBeVisible();
}

/** Existing recording/correction cases explicitly enter the secondary controls they exercise. */
export async function revealTrainingOptions(page: Page) {
  if (await page.getByRole('dialog').count()) return;
  if (new URL(page.url()).pathname.includes('/session/')) await expect(page.getByTestId('workout-options')).toBeVisible();
  for (const testId of ['workout-options', 'exercise-options']) {
    for (const disclosure of await page.getByTestId(testId).all()) {
      if (await disclosure.getAttribute('open') === null) await disclosure.locator('summary').first().click();
    }
  }
}

/** 1×1 red PNG for file-upload flows. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
