import { defineConfig, devices } from '@playwright/test';
import { qaTarget } from './e2e-cloud/guard';

// Deliberately fail during configuration before a browser, login or write occurs.
const target = qaTarget();

export default defineConfig({
  testDir: './e2e-cloud',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/cloud-qa',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: target.baseURL,
    locale: 'en-US', timezoneId: 'America/Costa_Rica',
    trace: 'off', video: 'off', screenshot: 'only-on-failure', serviceWorkers: 'block',
  },
  projects: [{ name: 'isolated-qa-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
});
