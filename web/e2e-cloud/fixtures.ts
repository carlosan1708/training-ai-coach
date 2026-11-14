import { test as base, expect, type Page } from '@playwright/test';
import { qaAccounts, qaTarget, verifyQaEnvironment, type AccountRole } from './guard';

const aiOrQueuedAi = new Set([
  'chat', 'generate_routine', 'plan_workout_session', 'generate_weekly_report',
  'analyze_exercise_photo', 'analyze_meal_photo', 'analyze_body_composition',
  'parse_exercise_photo', 'parse_body_composition_report',
  'extract_meal_plan_content', 'parse_measurement_import', 'generate_progress_insights',
  'save_measurement_entries', 'update_measurement_entry', 'delete_measurement_entry', 'retry_measurement_job',
]);

export const test = base.extend<{ verifiedQa: void }>({
  verifiedQa: [async ({ request, context }, use) => {
    const target = qaTarget();
    await verifyQaEnvironment(request, target);
    const blocked: string[] = [];
    await context.route('**/*', async route => {
      const endpoint = new URL(route.request().url()).pathname.split('/').filter(Boolean).at(-1) || '';
      if (!target.liveAi && route.request().method() === 'POST' && aiOrQueuedAi.has(endpoint)) {
        blocked.push(endpoint);
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await use();
    expect(blocked, 'Unexpected AI request was blocked. Reseed fresh weekly reports before the default cloud smoke tests.').toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function signIn(page: Page, role: AccountRole) {
  const account = qaAccounts()[role];
  await page.goto('/qa/sign-in');
  await expect(page.getByRole('heading', { name: 'Training Coach QA', exact: true })).toBeVisible();
  await page.getByLabel('QA email', { exact: true }).fill(account.email);
  try { await page.getByLabel('Password', { exact: true }).fill(account.password); }
  catch { throw new Error('The QA password field could not be filled. Credential details were not logged.'); }
  await page.getByRole('button', { name: 'Sign in to QA', exact: true }).click();
  await page.waitForURL(/\/(?:dashboard|pending-approval|rejected)(?:\?.*)?$/);
}
