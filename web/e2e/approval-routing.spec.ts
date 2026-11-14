import { expect, test, type Page } from '@playwright/test';

async function openAccessHarness(page: Page, query = '') {
  const cloudRequests: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (/\.cloudfunctions\.net$|\.run\.app$|^(?:firestore|identitytoolkit|securetoken|firebasestorage)\.googleapis\.com$|^api\.openai\.com$/.test(url.hostname)) {
      cloudRequests.push(url.hostname);
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  await page.route('**/__access-routing-harness?*', route => route.fulfill({ contentType: 'text/html', body: `<html><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/access-routing-harness.tsx');</script></body></html>` }));
  await page.goto('/__access-routing-harness?' + query);
  return cloudRequests;
}

for (const status of ['pending', 'rejected']) {
  test(`a live owner grant leaves the ${status} screen without changing approval status`, async ({ page }) => {
    const cloudRequests = await openAccessHarness(page, 'status=' + status);
    const route = page.getByRole('status', { name: 'Current route', exact: true });
    await expect(route).toHaveText(status === 'rejected' ? '/rejected' : '/pending-approval');
    await page.getByRole('button', { name: 'Deliver owner role', exact: true }).click();
    await expect(route).toHaveText('/dashboard');
    await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeVisible();
    expect(cloudRequests).toEqual([]);
  });
}

test('a live approval unlocks the dashboard and revocation returns to pending', async ({ page }) => {
  await openAccessHarness(page);
  const route = page.getByRole('status', { name: 'Current route', exact: true });
  await expect(route).toHaveText('/pending-approval');
  await page.getByRole('button', { name: 'Deliver approval', exact: true }).click();
  await expect(route).toHaveText('/dashboard');
  await page.getByRole('button', { name: 'Deliver pending', exact: true }).click();
  await expect(route).toHaveText('/pending-approval');
});

test('pending and rejected screens follow live status changes', async ({ page }) => {
  await openAccessHarness(page);
  const route = page.getByRole('status', { name: 'Current route', exact: true });
  await expect(route).toHaveText('/pending-approval');
  await page.getByRole('button', { name: 'Deliver rejection', exact: true }).click();
  await expect(route).toHaveText('/rejected');
  await page.getByRole('button', { name: 'Deliver pending', exact: true }).click();
  await expect(route).toHaveText('/pending-approval');
});

test('new owners without a profile continue to onboarding', async ({ page }) => {
  await openAccessHarness(page, 'missingProfile=1');
  await page.getByRole('button', { name: 'Deliver owner role', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Current route', exact: true })).toHaveText('/onboarding');
});

test('an account switch waits for access belonging to the new user', async ({ page }) => {
  await openAccessHarness(page);
  await expect(page.getByRole('status', { name: 'Current route', exact: true })).toHaveText('/pending-approval');
  await page.getByRole('button', { name: 'Switch account', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Loading', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Deliver current account access', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Current route', exact: true })).toHaveText('/pending-approval');
});
