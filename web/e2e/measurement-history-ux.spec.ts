import { expect, test } from '@playwright/test';
import { enterDemo } from './helpers';

test.use({ timezoneId: 'America/Costa_Rica' });

test.beforeEach(async ({ page }) => {
  // Still October 15 in Costa Rica: UTC date conversion would select tomorrow.
  await page.clock.install({ time: new Date('2026-10-16T04:15:00Z') });
  await enterDemo(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.logs = {};
    for (let index = 0; index < 101; index += 1) {
      const day = new Date(2025, 0, 1 + index, 12);
      const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      db.logs[date] = { date, measurements: {}, energy: 3, notes: '', food_log: [], exercise_log: [] };
    }
    db.logs['2020-03-01'] = {
      date: '2020-03-01', weight_kg: 72.5, body_fat_pct: 17,
      measurements: { waist_cm: 82, chest_cm: 100, arms_cm: 34.5 },
      energy: 3, notes: '', food_log: [], exercise_log: [],
    };
    // Legacy report kept only on a daily log: there is no reports-collection copy.
    db.logs['2019-02-15'] = {
      date: '2019-02-15', measurements: {}, energy: 3, notes: '', food_log: [], exercise_log: [],
      body_composition_report: {
        source_app: 'ISAK historical', report_date: '2019-02-10', weight_kg: 70.2,
        muscle_mass_kg: 32.1, skinfolds: { triceps_mm: 11.2 }, girths: { waist_cm: 81 },
        report_url: 'https://example.test/reports/isak-2019.pdf',
      },
    };
    db.reports = [{
      id: 'historical-bia', source_app: 'InBody historical', report_date: '2020-02-01',
      download_url: 'https://example.test/reports/bia-2020.pdf', storage_path: 'demo/bia.pdf', file_type: 'pdf',
      extracted_data: { source_app: 'InBody historical', report_date: '2020-02-01', weight_kg: 75.2, body_fat_pct: 20.1, skeletal_muscle_kg: 31.5 },
      created_at: 1,
    }];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.goto('/log?tab=1');
});

test('history loads all uploaded reports and paginates older manual and legacy report records without writes', async ({ page }) => {
  const before = await page.evaluate(() => localStorage.getItem('tac_demo_db'));
  await page.getByRole('button', { name: 'Browse original records', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Measurement history', exact: true })).toBeVisible();
  const uploaded = page.getByTestId('measurement-record-report-historical-bia');
  await expect(uploaded).toBeVisible();
  await expect(uploaded).toContainText('75.2 kg');
  await uploaded.getByRole('button', { name: 'View results' }).click();
  await expect(page.getByRole('dialog')).toContainText('31.5kg');
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Open original report' })).toHaveAttribute('href', 'https://example.test/reports/bia-2020.pdf');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Load older records' }).click();
  const manual = page.getByTestId('measurement-record-log-2020-03-01');
  await expect(manual).toBeVisible();
  await manual.getByRole('button', { name: 'View results' }).click();
  await expect(page.getByRole('dialog')).toContainText('34.5 cm');
  await expect(page.getByRole('dialog').getByRole('button', { name: /save/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  const legacy = page.getByTestId('measurement-record-log-2019-02-15');
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(manual).toHaveCount(0);
  await expect(legacy).toBeVisible();
  await legacy.getByRole('button', { name: 'View results' }).click();
  await expect(page.getByRole('dialog')).toContainText('11.2 mm');
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Open original report' })).toHaveAttribute('href', 'https://example.test/reports/isak-2019.pdf');
  await page.route('https://example.test/reports/isak-2019.pdf', (route) => route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }));
  await page.getByRole('button', { name: 'Preview original', exact: true }).click();
  await expect(page.locator('iframe[title="Open original report"]')).toHaveAttribute('src', 'https://example.test/reports/isak-2019.pdf');
  expect(await page.evaluate(() => localStorage.getItem('tac_demo_db'))).toBe(before);
});

test('calendar date navigation edits existing canonical readings and keeps new-date inputs separate', async ({ page }) => {
  await expect(page.getByLabel('Log date', { exact: true })).toHaveValue('2026-10-15');
  await page.getByLabel('Log date', { exact: true }).fill('2020-03-01');
  await expect(page.getByTestId('measurement-workspace')).toHaveAttribute('data-entry-date', '2020-03-01');
  await page.getByTestId('measurement-entry-legacy_manual_2020-03-01').getByRole('button', { name: 'View reading', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit reading', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Value', exact: true }).nth(2)).toHaveValue('82');
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Value', exact: true }).nth(1)).toHaveValue('17');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(page.getByLabel('Log date', { exact: true })).toHaveValue('2026-10-15');
  await expect(page.getByTestId('measurement-workspace')).toHaveAttribute('data-entry-date', '2026-10-15');
  await page.getByRole('button', { name: 'Add measurements', exact: true }).first().click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Value', exact: true }).nth(2)).toHaveValue('');
  await page.getByRole('dialog').getByRole('textbox', { name: 'Value', exact: true }).nth(2).fill('85');
  await page.getByRole('dialog').getByRole('button', { name: 'Save measurements', exact: true }).click();
  await expect(page.getByTestId('measurement-workspace')).toContainText('85 cm');
  const logs = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).logs);
  expect(logs['2020-03-01'].measurements.waist_cm).toBe(82);
  expect(logs['2026-10-15']).toBeUndefined();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_measurements_v1')!).entries);
  expect(entries[0].measured_at).toBe('2026-10-15');
  expect(entries[0].metrics).toEqual([expect.objectContaining({ key: 'waist_cm', value: 85 })]);
});

test('date controls and scrollable log tabs stay usable on a narrow mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.getByLabel('Log date', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Today', exact: true }).first()).toBeInViewport();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByLabel('Log date', { exact: true })).toHaveValue('2026-10-14');
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByLabel('Log date', { exact: true })).toHaveValue('2026-10-15');
  await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('tablist', { name: 'Log sections' })).toBeVisible();
  await page.getByRole('button', { name: 'Browse original records', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('measurement-history-mobile.png'), fullPage: true });
  await page.getByTestId('measurement-record-report-historical-bia').getByRole('button', { name: 'View results' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('measurement-results-mobile.png'), fullPage: true });
});
