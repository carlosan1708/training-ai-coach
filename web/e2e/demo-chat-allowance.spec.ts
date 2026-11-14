import { expect, test } from '@playwright/test';
import { enterDemo } from './helpers';
import { DEMO_CHAT_USAGE_KEY } from '../src/demo/chatLimit';

// The allowance follows Costa Rica even when the browser is on another day.
test.use({ locale: 'en-US', timezoneId: 'Asia/Tokyo' });

test('the local demo allows ten messages, keeps its limit after reload and sample-data reset', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-17T18:00:00Z') });
  await enterDemo(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
  const composer = page.getByRole('textbox');
  for (let count = 1; count <= 10; count++) {
    await composer.fill('Synthetic demo message ' + count);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(composer).toBeEnabled();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).count, DEMO_CHAT_USAGE_KEY)).toBe(count);
  }
  await page.reload();
  await page.getByRole('textbox').fill('Synthetic eleventh message');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The demo includes 10 chat messages per day.');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), DEMO_CHAT_USAGE_KEY)).toEqual({ day: '2026-10-17', count: 10 });
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  await expect(page.getByText('Try the demo', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tac_demo_db'))).toBeNull();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).count, DEMO_CHAT_USAGE_KEY)).toBe(10);
  await enterDemo(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('textbox').fill('Sample reset cannot refill the allowance');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The demo includes 10 chat messages per day.');
});

test('the demo allowance resets at Costa Rica midnight, not the browser calendar day', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-18T05:59:00Z') });
  await enterDemo(page);
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ day: '2026-10-17', count: 10 })), DEMO_CHAT_USAGE_KEY);
  await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
  const composer = page.getByRole('textbox');
  await composer.fill('A message for the next Costa Rica day');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The demo includes 10 chat messages per day.');
  await page.clock.fastForward(120_000);
  await page.getByRole('button', { name: 'Restore message', exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composer).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), DEMO_CHAT_USAGE_KEY)).toEqual({ day: '2026-10-18', count: 1 });
});

test('real callable chat ignores an exhausted local demo allowance', async ({ page }) => {
  // Replace only the Firebase Functions SDK boundary; no actual API is contacted.
  await page.route(url => url.pathname.endsWith('/firebase_functions.js'), route => route.fulfill({ contentType: 'application/javascript', body: `
    export const getFunctions = () => ({});
    export const connectFunctionsEmulator = () => {};
    export const httpsCallable = () => async () => ({ data: { reply: 'Synthetic real-account reply' } });` }));
  await page.goto('/');
  const replies = await page.evaluate(async key => {
    localStorage.removeItem('tac_demo_mode');
    localStorage.setItem(key, JSON.stringify({ day: '2026-10-17', count: 10 }));
    const modulePath = '/src/firebase/callables.ts';
    const { chatFn } = await import(modulePath);
    const result: string[] = [];
    for (let count = 0; count < 11; count++) result.push((await chatFn({ message: 'Synthetic real message', sessionId: 'synthetic-session' })).data.reply);
    return result;
  }, DEMO_CHAT_USAGE_KEY);
  expect(replies).toEqual(Array(11).fill('Synthetic real-account reply'));
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).count, DEMO_CHAT_USAGE_KEY)).toBe(10);
});
