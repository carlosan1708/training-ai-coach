import { expect, test, type Page } from '@playwright/test';
import { enterDemo } from './helpers';

const measurementKey = 'tac_demo_measurements_v1';
type WorkspaceRequest = { section?: string; beforeDate?: string; sourceName?: string; method?: string; excludeEntryId?: string };

test.use({ timezoneId: 'America/Costa_Rica' });

async function recordRequests(page: Page) {
  const requests: WorkspaceRequest[] = [];
  let modelCalls = 0;
  await page.route(/\/src\/firebase\/measurements\.ts(?:\?t=\d+)?$/, route => route.fulfill({ contentType: 'application/javascript', body: `
    import { getMeasurementWorkspace as actual } from '/src/firebase/measurements.ts?circumferenceActual';
    export * from '/src/firebase/measurements.ts?circumferenceActual';
    export async function getMeasurementWorkspace(input) {
      await fetch('/__circumference_workspace', { method: 'POST', body: JSON.stringify(input ?? {}) });
      return actual(input);
    }
    export async function parseMeasurementImport() { await fetch('/__unexpected_circumference_ai'); throw new Error('Unexpected model request'); }
    export async function generateProgressInsights() { await fetch('/__unexpected_circumference_ai'); throw new Error('Unexpected model request'); }
  ` }));
  await page.route('**/src/firebase/callables.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/firebase/callables.ts?circumferenceNoAi';
    export async function chatFn() { await fetch('/__unexpected_circumference_ai'); throw new Error('Unexpected model request'); }
  ` }));
  await page.route('**/__circumference_workspace', route => {
    requests.push(route.request().postDataJSON() as WorkspaceRequest);
    return route.fulfill({ json: {} });
  });
  await page.route('**/__unexpected_circumference_ai', route => {
    modelCalls++;
    return route.fulfill({ json: {} });
  });
  return { requests, modelCalls: () => modelCalls };
}

test('manual circumferences show earlier report references without filling or changing historical data', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.clock.install({ time: new Date('2026-10-18T18:00:00Z') });
  await enterDemo(page);
  const recorded = await recordRequests(page);
  const historicalDb = await page.evaluate(key => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.logs = { '2024-02-01': { date: '2024-02-01', weight_kg: 72, measurements: {}, energy: 3, notes: 'Synthetic preserved daily log', food_log: [], exercise_log: [] } };
    db.reports = [{
      id: 'synthetic-charlie-assessment', source_app: 'Charlie assessment (synthetic)', report_date: '2025-06-12',
      storage_path: 'demo/synthetic-charlie.pdf', download_url: 'https://example.test/synthetic-charlie.pdf', file_type: 'pdf', created_at: 1,
      extracted_data: { report_date: '2025-06-12', fat_method: 'anthropometric',
        girths: { relaxed_arm_cm: 30.6, tensed_arm_cm: 32.8, waist_cm: 79.4, calf_cm: 35.7 },
        skinfolds: { medial_thigh_mm: 15.4, medial_calf_mm: 9.2 } },
    }];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
    localStorage.setItem(key, JSON.stringify({ entries: [
      { id: 'synthetic-later-bia', measured_at: '2026-10-16', source_name: 'Synthetic BIA', method: 'bia', metrics: [
        { key: 'weight_kg', label: 'Weight', value: 76, unit: 'kg' }, { key: 'body_fat_pct', label: 'Body fat', value: 18, unit: '%' },
      ] },
      { id: 'synthetic-generic-arm', measured_at: '2026-10-15', source_name: 'Unspecified arm (synthetic)', method: 'manual', metrics: [
        { key: 'arms_cm', label: 'Arms', value: 39.9, unit: 'cm' }, { key: 'medial_thigh_mm', label: 'Medial thigh skinfold', value: 20.1, unit: 'mm' },
        { key: 'medial_calf_mm', label: 'Medial calf skinfold', value: 10.4, unit: 'mm' },
      ] },
    ], removed: [], revision: 2, jobs: [], requests: {} }));
    return JSON.stringify(db);
  }, measurementKey);
  const historicalReadings = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).entries, measurementKey);
  await page.goto('/progress');
  expect(recorded.requests).toEqual([]);
  await page.getByRole('button', { name: 'Add measurements', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const references = [
    { key: 'relaxed_arm_cm', label: 'Relaxed arm', value: '30.6' },
    { key: 'tensed_arm_cm', label: 'Tensed arm', value: '32.8' },
    { key: 'waist_cm', label: 'Waist', value: '79.4' },
    { key: 'calf_cm', label: 'Calf', value: '35.7' },
  ];
  await expect(dialog).toContainText('Previous readings are references only. Enter new values and leave anything you have not measured blank.');
  for (const item of references) {
    const group = dialog.getByRole('group', { name: item.label, exact: true });
    await expect(group.getByTestId(`measurement-previous-${item.key}`)).toHaveText(`Previous: ${item.value} cm · 2025-06-12 · Charlie assessment (synthetic) · Anthropometric / skinfolds`);
    await expect(group.getByRole('textbox', { name: 'Value', exact: true })).toHaveValue('');
  }
  const thigh = dialog.getByRole('group', { name: 'Thighs', exact: true });
  await expect(thigh.getByTestId('measurement-previous-thighs_cm')).toHaveText('No earlier reading saved.');
  await expect(thigh.getByRole('textbox', { name: 'Value', exact: true })).toHaveValue('');
  for (const label of ['Weight', 'Body fat']) await expect(dialog.getByRole('group', { name: label, exact: true }).getByRole('textbox', { name: 'Value', exact: true })).toHaveValue('');
  const waist = dialog.getByRole('group', { name: 'Waist', exact: true });
  await waist.getByRole('textbox', { name: 'Unit', exact: true }).fill('in');
  await expect(waist.getByTestId('measurement-previous-waist_cm')).toContainText('Previous: 79.4 cm');
  await expect(waist.getByRole('textbox', { name: 'Value', exact: true })).toHaveValue('');
  await waist.getByRole('textbox', { name: 'Unit', exact: true }).fill('cm');
  await dialog.getByRole('group', { name: 'Relaxed arm', exact: true }).scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: testInfo.outputPath('circumference-form.png') });
  expect(recorded.requests.every(input => input.section === 'references')).toBe(true);
  await dialog.getByRole('group', { name: 'Relaxed arm', exact: true }).getByRole('textbox', { name: 'Value', exact: true }).fill('31.2');
  await dialog.getByRole('button', { name: 'Save measurements', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const after = await page.evaluate(key => ({ database: localStorage.getItem('tac_demo_db'), measurements: JSON.parse(localStorage.getItem(key)!) }), measurementKey);
  expect(after.database).toBe(historicalDb); // Original report, daily logs, routines, completed sets and loads stay untouched.
  expect(after.measurements.entries.slice(1)).toEqual(historicalReadings);
  expect(after.measurements.removed).toEqual([]);
  expect(after.measurements.entries[0]).toMatchObject({ measured_at: '2026-10-18', source_name: 'Manual', method: 'manual', metrics: [
    { key: 'relaxed_arm_cm', value: 31.2, unit: 'cm' },
  ] });
  expect(after.measurements.entries[0].metrics).toHaveLength(1);
  await page.getByTestId('measurement-entry-legacy_report_synthetic-charlie-assessment').getByRole('button', { name: 'View reading', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('30.6 cm');
  expect(recorded.modelCalls()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('references follow the selected date and exclude the reading being edited', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-18T18:00:00Z') });
  await enterDemo(page);
  const recorded = await recordRequests(page);
  await page.evaluate(key => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.logs = {}; db.reports = [];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
    localStorage.setItem(key, JSON.stringify({ entries: [
      { id: 'synthetic-edit-reading', measured_at: '2026-10-10', source_name: 'Charlie assessment (synthetic)', method: 'anthropometric', metrics: [{ key: 'relaxed_arm_cm', label: 'Relaxed arm', value: 33.9, unit: 'cm' }] },
      { id: 'synthetic-earlier-reading', measured_at: '2025-06-12', source_name: 'Charlie assessment (synthetic)', method: 'anthropometric', metrics: [{ key: 'relaxed_arm_cm', label: 'Relaxed arm', value: 31.4, unit: 'cm' }] },
      { id: 'synthetic-oldest-reading', measured_at: '2024-03-10', source_name: 'Charlie assessment (synthetic)', method: 'anthropometric', metrics: [{ key: 'relaxed_arm_cm', label: 'Relaxed arm', value: 29.7, unit: 'cm' }] },
    ], removed: [], revision: 3, jobs: [], requests: {} }));
  }, measurementKey);
  const before = await page.evaluate(key => localStorage.getItem(key), measurementKey);
  await page.goto('/progress');
  await page.getByRole('button', { name: 'Add measurements', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const hint = dialog.getByTestId('measurement-previous-relaxed_arm_cm');
  await expect(hint).toContainText('Previous: 33.9 cm · 2026-10-10');
  await dialog.getByLabel('Measurement date', { exact: true }).fill('2025-06-01');
  await expect(hint).toContainText('Previous: 29.7 cm · 2024-03-10');
  await dialog.getByLabel('Measurement date', { exact: true }).fill('2024-03-10');
  await expect(hint).toHaveText('No earlier reading saved.');
  await expect(dialog.getByRole('group', { name: 'Relaxed arm', exact: true }).getByRole('textbox', { name: 'Value', exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.getByTestId('measurement-entry-synthetic-edit-reading').getByRole('button', { name: 'View reading', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit reading', exact: true }).click();
  await expect(hint).toContainText('Previous: 31.4 cm · 2025-06-12');
  await dialog.getByLabel('Measurement date', { exact: true }).fill('2026-10-18');
  await expect.poll(() => recorded.requests.at(-1)).toMatchObject({ section: 'references', beforeDate: '2026-10-18', sourceName: 'Charlie assessment (synthetic)', method: 'anthropometric', excludeEntryId: 'synthetic-edit-reading' });
  await expect(hint).toContainText('Previous: 31.4 cm · 2025-06-12');
  await expect(dialog.getByRole('group', { name: 'Relaxed arm', exact: true }).getByRole('textbox', { name: 'Value', exact: true })).toHaveValue('33.9');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), measurementKey)).toBe(before);
  expect(recorded.modelCalls()).toBe(0);
});
