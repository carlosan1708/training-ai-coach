import { expect, test } from '@playwright/test';
import { enterDemo } from './helpers';

const memoryKey = 'tac_demo_coach_memory_v1';

async function coach(page: import('@playwright/test').Page) {
  await enterDemo(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
  await expect(page.getByRole('textbox')).toBeVisible();
}

test('explicit demo memory survives a new chat and can be forgotten with confirmation', async ({ page }) => {
  await coach(page);
  await page.getByRole('textbox').fill('Remember that I prefer three training days per week.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Coach memory updated');
  await page.reload();
  await page.getByRole('textbox').fill('What do you remember about me?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('I prefer three training days per week.');
  await page.getByRole('button', { name: 'Coach memory', exact: true }).first().click();
  const memory = page.getByRole('dialog', { name: 'What your coach remembers' });
  await expect(memory).toContainText('I prefer three training days per week.');
  await memory.getByRole('button', { name: /^Forget:/ }).click();
  await page.getByRole('dialog', { name: 'Forget this memory?' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(memory).toContainText('I prefer three training days per week.');
  await memory.getByRole('button', { name: /^Forget:/ }).click();
  await page.getByRole('dialog', { name: 'Forget this memory?' }).getByRole('button', { name: 'Forget', exact: true }).click();
  await expect(memory).toContainText('No personal memories saved yet.');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).facts.length, memoryKey)).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_chat_usage_v1')!).count)).toBe(2);
});

test('forget all preserves other app data and the add-memory action only restores a draft', async ({ page }) => {
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ revision: 2, facts: [
    { id: 'a', category: 'preference', text: 'I prefer morning workouts.' },
    { id: 'b', category: 'goal', text: 'I want to train consistently.' },
  ] })), { key: memoryKey });
  await coach(page);
  const retainedData = () => page.evaluate(() => {
    const { profile, logs, routines, workout_sessions, meal_plans, reports } = JSON.parse(localStorage.getItem('tac_demo_db')!);
    return { profile, logs, routines, workout_sessions, meal_plans, reports };
  });
  const databaseBefore = await retainedData();
  expect(databaseBefore.profile).toBeTruthy();
  await page.getByRole('button', { name: 'Coach memory', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'What your coach remembers' });
  await dialog.getByRole('button', { name: 'Forget all', exact: true }).click();
  await page.getByRole('dialog', { name: 'Forget all personal memories?' }).getByRole('button', { name: 'Forget', exact: true }).click();
  await expect(dialog).toContainText('No personal memories saved yet.');
  expect(await retainedData()).toEqual(databaseBefore);
  await dialog.getByRole('button', { name: 'Tell the coach something', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveValue('Remember that ');
  await expect(page.getByRole('log')).not.toContainText('Remember that');
});

test('full-history factual progress is readable on mobile without a model request', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  let calls = 0;
  await page.route('**/src/firebase/measurements.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/firebase/measurements.ts?memoryFixture';
    export async function getMeasurementWorkspace() { return {
      entries: [], revision:1, memory:null, insights:null, jobs:[],
      factual_digest: {kind:'progress-facts-v1',status:'ready',revision:1,source_fingerprint:'synthetic',history_incomplete:false,
        range:{start_date:'2025-01-01',end_date:'2026-01-01',as_of:'2026-01-02'},counts:{observations:119,measurement_dates:102},
        summary:'## Full-history overview\\n\\n119 readings across 102 measurement dates.\\n\\n| Metric | Baseline | Latest | Change |\\n|---|---|---|---|\\n| Example metric | 20 % | 18 % | -2 percentage points |\\n\\n1 completed workout. Daily medians; sources are separate.' }
    }; }` }));
  await page.route('**/src/firebase/callables.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/firebase/callables.ts?memoryNoAi';
    export async function chatFn() { await fetch('/__unexpected_memory_ai'); throw new Error('Should not call AI'); }` }));
  await page.route('**/__unexpected_memory_ai', route => { calls++; return route.fulfill({ json: {} }); });
  await coach(page);
  await page.getByRole('button', { name: 'Coach memory', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'What your coach remembers' });
  await dialog.getByRole('tab', { name: 'Your progress', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Full-history overview' })).toBeVisible();
  await expect(dialog.getByRole('table')).toContainText('-2 percentage points');
  await expect(dialog).toContainText('119 readings across 102 measurement dates.');
  const widths = await page.evaluate(() => ({ window: innerWidth, page: document.documentElement.scrollWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.window);
  expect(calls).toBe(0);
});

test('memory load errors stay recoverable and do not claim an empty saved memory', async ({ page }) => {
  await page.route('**/src/firebase/coachMemory.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export async function getChatMemory() { throw new Error('Synthetic unavailable store'); }
    export async function deleteChatMemory() { throw new Error('Unexpected delete'); }` }));
  await coach(page);
  await page.getByRole('button', { name: 'Coach memory', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'What your coach remembers' });
  await expect(dialog.getByRole('alert')).toContainText("Couldn't load the coach's memory.");
  await expect(dialog).not.toContainText('No personal memories saved yet.');
  await expect(dialog.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
});
