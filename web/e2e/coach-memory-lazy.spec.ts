import { expect, test } from '@playwright/test';
import { enterDemo } from './helpers';

test('coach memory reads only the selected tab and does not poll while closed', async ({ page }) => {
  await page.clock.install();
  const requests: string[] = [];
  await page.route('**/__memory_selection', route => {
    requests.push(route.request().postDataJSON().section);
    return route.fulfill({ json: {} });
  });
  await page.route('**/src/firebase/coachMemory.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export async function getChatMemory() { await fetch('/__memory_selection', {method:'POST',body:JSON.stringify({section:'personal'})}); return {revision:0,facts:[]}; }
    export async function deleteChatMemory() { throw new Error('Unexpected delete'); }` }));
  await page.route('**/src/firebase/measurements.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    import { getMeasurementWorkspace as originalWorkspace } from '/src/firebase/measurements.ts?memoryLazyActual';
    export * from '/src/firebase/measurements.ts?memoryLazyActual';
    export async function getMeasurementWorkspace(input) { if (!input?.section) return originalWorkspace();
      await fetch('/__memory_selection', {method:'POST',body:JSON.stringify(input)});
      return {section:'summary',revision:1,factual_digest:{summary:'## Only requested summary',kind:'progress-facts-v1',status:'ready',revision:1}}; }` }));
  await enterDemo(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Coach memory', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'What your coach remembers' });
  await expect(dialog).toContainText('No personal memories saved yet.');
  expect(requests).toEqual(['personal']);
  await dialog.getByRole('tab', { name: 'Your progress', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Only requested summary' })).toBeVisible();
  expect(requests).toEqual(['personal', 'summary']);
  await dialog.getByRole('tab', { name: 'About you', exact: true }).click();
  await expect(dialog).toContainText('No personal memories saved yet.');
  expect(requests).toEqual(['personal', 'summary', 'personal']);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.clock.fastForward(120_000);
  expect(requests).toEqual(['personal', 'summary', 'personal']);
});
