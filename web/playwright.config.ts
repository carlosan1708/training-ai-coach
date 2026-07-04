import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite — runs entirely against DEMO MODE, so no Firebase project,
 * .env.local, or Gemini key is needed:  npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 420, height: 850 }, // the app is mobile-first
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 420, height: 850 } } }],
  webServer: {
    command: 'npm run dev -- --port 5199 --host 127.0.0.1',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
