import { expect, test, type Page } from '@playwright/test';
import { enterDemo } from './helpers';

async function costHarness(page: Page, mode: 'usage' | 'polling', environment: 'qa' | 'production', screen = 'home', batches: unknown[] = []) {
  const events: string[] = [];
  await page.clock.install({ time: new Date('2026-10-17T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-17T12:00:01Z'));
  await page.route('**/src/firebase/config.ts', route => route.fulfill({ contentType: 'application/javascript', body: `export const appEnvironment = "${environment}";` }));
  await page.route('**/src/firebase/usage.ts', route => route.fulfill({ contentType: 'application/javascript', body:
    `export const screenForPath = () => "${screen}"; export const recordUsage = (event, screen, actions) => fetch("/__usage", { method: "POST", body: JSON.stringify({event,screen,...(actions ? {actions}: {})}) });` }));
  await page.route('**/__usage', route => { const data = route.request().postDataJSON(); events.push(data.event); if (data.actions) batches.push(data); return route.fulfill({ json: {} }); });
  await page.route('**/__qa-cost-harness?*', route => route.fulfill({ contentType: 'text/html', body: `<html><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/qa-cost-harness.tsx');</script></body></html>` }));
  await page.goto('/__qa-cost-harness?mode=' + mode);
  return events;
}

test('workout action counts are batched, private, allowlisted and flushed on navigation without idle polling', async ({ page }) => {
  const batches: unknown[] = [];
  await costHarness(page, 'usage', 'qa', 'workout', batches);
  await page.getByRole('button', { name: 'Complete set', exact: true }).click();
  await page.getByRole('button', { name: 'Complete set', exact: true }).click();
  await page.getByLabel('Private weight', { exact: true }).fill('987.654');
  await page.getByLabel('Private weight', { exact: true }).blur();
  await page.getByRole('button', { name: 'Untracked action', exact: true }).click();
  await page.getByRole('button', { name: 'Finish once', exact: true }).click();
  await page.clock.runFor(29_999);
  expect(batches).toEqual([]);
  await page.clock.runFor(1);
  await expect.poll(() => batches).toEqual([{ event: 'ui_actions', screen: 'workout', actions: { set_completion_toggled: 2, weight_edited: 1, finish_clicked: 1 } }]);
  await page.clock.runFor(90_000);
  expect(batches).toHaveLength(1);
  await page.getByRole('button', { name: 'Complete set', exact: true }).click();
  await page.getByRole('button', { name: 'Leave workout', exact: true }).click();
  await expect.poll(() => batches).toHaveLength(2);
  expect(batches[1]).toEqual({ event: 'ui_actions', screen: 'workout', actions: { set_completion_toggled: 1 } });
  expect(JSON.stringify(batches)).not.toContain('987');
});

test('QA job polling stops in hidden tabs, expires after a minute, and resumes only on request', async ({ page }) => {
  await costHarness(page, 'polling', 'qa');
  const count = page.getByRole('status', { name: 'Poll count', exact: true });
  await expect(count).toHaveText('0');
  await page.clock.runFor(3600);
  await expect(count).toHaveText('2');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(3600);
  await expect(count).toHaveText('2');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(1800);
  await expect(count).toHaveText('3');
  await page.clock.runFor(60_000);
  await expect(page.getByRole('status', { name: 'Polling status', exact: true })).toHaveText('Paused');
  const pausedCount = await count.textContent();
  await page.clock.runFor(120_000);
  await expect(count).toHaveText(pausedCount!);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Polling status', exact: true })).toHaveText('Checking');
  await page.clock.runFor(1800);
  await expect(count).toHaveText(String(Number(pausedCount) + 2));
});

test('production job polling retains its existing continuous behavior', async ({ page }) => {
  await costHarness(page, 'polling', 'production');
  await expect(page.getByRole('status', { name: 'Poll count', exact: true })).toHaveText('0');
  await page.clock.runFor(61_200);
  await expect(page.getByRole('status', { name: 'Poll count', exact: true })).toHaveText('34');
  await expect(page.getByRole('status', { name: 'Polling status', exact: true })).toHaveText('Checking');
});

for (const environment of ['qa', 'production'] as const) {
  test(`${environment} usage retains screen views ${environment === 'qa' ? 'without a periodic heartbeat' : 'and active heartbeats'}`, async ({ page }) => {
    const events = await costHarness(page, 'usage', environment);
    await expect(page.getByText('Usage ready', { exact: true })).toBeVisible();
    await expect.poll(() => events).toEqual(['screen_view']);
    await page.clock.runFor(1000);
    await page.locator('body').dispatchEvent('pointerdown');
    await page.clock.runFor(30_000);
    if (environment === 'production') await expect.poll(() => events).toEqual(['screen_view', 'heartbeat']);
    else expect(events).toEqual(['screen_view']);
  });
}

test('Try demo keeps data, extraction and coaching local while navigating the app', async ({ page }) => {
  const cloudRequests: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (/\.cloudfunctions\.net$|\.run\.app$|^(?:firestore|identitytoolkit|securetoken|firebasestorage)\.googleapis\.com$|^api\.openai\.com$/.test(url.hostname)) {
      cloudRequests.push(url.hostname);
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  await enterDemo(page);
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await nav.getByRole('button', { name: 'Progress', exact: true }).click();
  await page.getByRole('button', { name: 'Add measurements', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Paste report text', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Report text', exact: true }).fill('Date: 2026-10-15\nSource: Local QA scale\nWeight: 78.4 kg');
  await dialog.getByRole('button', { name: 'Extract measurements', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review your measurements', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await nav.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByPlaceholder('Ask your coach anything...', { exact: true }).fill('Help me recover after training');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Help me recover after training');
  await expect(page.getByRole('log')).toContainText('Lower Body Power');
  expect(cloudRequests).toEqual([]);
});
