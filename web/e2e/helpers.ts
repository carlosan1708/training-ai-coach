import { type Page, expect } from '@playwright/test';

/** Enter demo mode from the landing page, landing on the dashboard. */
export async function enterDemo(page: Page) {
  await page.goto('/');
  await page.getByText('Try the demo').click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByText('Welcome, Alex!')).toBeVisible();
}

/** 1×1 red PNG for file-upload flows. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
