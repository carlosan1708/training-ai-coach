import { expect, test, type Page } from '@playwright/test';
import { enterDemo, TINY_PNG } from './helpers';

const KEY = 'tac_demo_measurements_v1';
const metrics = [
  { key: 'weight_kg', label: 'Weight', value: 63.50293, unit: 'kg', raw_value: '140', raw_unit: 'lb', confidence: 'low' },
  { key: 'bone_mass_kg', label: 'Bone mass', value: 3.2, unit: 'kg' },
  { key: 'protein_kg', label: 'Protein mass', value: 10, unit: 'kg' },
  { key: 'protein_pct', label: 'Protein', value: 16, unit: '%' },
  { key: 'skeletal_muscle_kg', label: 'Skeletal muscle', value: 28, unit: 'kg' },
  { key: 'skeletal_muscle_pct', label: 'Skeletal muscle', value: 44, unit: '%' },
  { key: 'body_water_kg', label: 'Water mass', value: 37, unit: 'kg' },
  { key: 'body_water_pct', label: 'Body water', value: 59, unit: '%' },
  { key: 'bmr_kcal', label: 'BMR', value: 1500, unit: 'kcal' },
  { key: 'metabolic_age', label: 'Body age', value: 30, unit: 'years' },
  { key: 'visceral_fat_level', label: 'Visceral fat', value: 4, unit: 'index' },
  { key: 'left_arm_muscle_reference_pct', label: 'Left arm muscle relative to standard', value: 121.7, unit: '%' },
  { key: 'trunk_fat_reference_pct', label: 'Trunk fat relative to standard', value: 137.6, unit: '%' },
];

async function setup(page: Page) {
  await page.addInitScript(() => {
    const trace = { created: [] as string[], revoked: [] as string[] };
    Object.assign(window, { imageReviewUrls: trace });
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = object => { const url = create(object); trace.created.push(url); return url; };
    URL.revokeObjectURL = url => { trace.revoked.push(url); revoke(url); };
  });
  // Only the extraction boundary is replaced; saving/history use the real local demo.
  const fixture = { import_id: 'synthetic-fitdays', status: 'review', warnings: [], entries: [{
    measured_at: '2026-10-15', source_name: 'Fitdays', method: 'bia', metrics,
  }] };
  await page.route('**/src/firebase/measurements.ts', route => route.fulfill({ contentType: 'application/javascript', body:
    `export * from '/src/firebase/measurements.ts?fitdaysBoundary'; export async function parseMeasurementImport() { return ${JSON.stringify(fixture)}; }` }));
  await enterDemo(page);
  await page.evaluate(key => { const db = JSON.parse(localStorage.getItem('tac_demo_db')!); db.logs = {}; db.reports = []; localStorage.setItem('tac_demo_db', JSON.stringify(db)); localStorage.removeItem(key); }, KEY);
  await page.goto('/progress');
  await page.getByRole('button', { name: 'Add measurements', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Upload report', exact: true }).click();
  return dialog;
}

test('smart-scale image saves in one step, keeps all ratios/originals, and can be edited afterward', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const dialog = await setup(page);
  await dialog.locator('input[type=file]').setInputFiles({ name: 'synthetic-fitdays.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(dialog.getByRole('img', { name: 'Selected measurement image', exact: true })).toBeVisible();
  const previewUrl = await dialog.getByRole('img').getAttribute('src');
  await expect(dialog.getByTestId('measurement-draft-0')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Extract measurements', exact: true })).toHaveCount(0);
  await dialog.screenshot({ path: test.info().outputPath('save-report-mobile.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Save report', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Report saved. You can view or edit the readings in your history.', { exact: true })).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).entries[0], KEY);
  expect(saved.source_name).toBe('Fitdays'); expect(saved.method).toBe('bia');
  expect(saved.measured_at).toBe('2026-10-15');
  expect(saved.metrics.map((metric: { key: string }) => metric.key)).toEqual(metrics.map(metric => metric.key));
  expect(saved.metrics[0]).toMatchObject({ value: 63.50293, unit: 'kg', raw_value: '140', raw_unit: 'lb' });
  expect(saved.metrics.at(-1)).toMatchObject({ value: 137.6, unit: '%' });
  expect(await page.evaluate(() => (window as Window & { imageReviewUrls: { revoked: string[] } }).imageReviewUrls.revoked)).toContain(previewUrl);
  await page.getByRole('button', { name: 'View reading', exact: true }).click();
  const details = page.getByRole('dialog');
  await expect(details.getByText('121.7 %', { exact: true })).not.toBeVisible();
  await details.screenshot({ path: test.info().outputPath('saved-report-compact-mobile.png'), animations: 'disabled' });
  await details.getByRole('button', { name: /More readings/ }).click();
  await expect(details.getByText('121.7 %', { exact: true })).toBeVisible();
  await expect(details.getByText('137.6 %', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'View original report', exact: true }).click();
  await expect(details.getByRole('img', { name: 'View original report', exact: true })).toHaveAttribute('src', /^blob:/);
  await details.getByRole('button', { name: 'Edit reading', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Value', exact: true }).first().fill('64');
  await page.getByRole('dialog').getByRole('button', { name: 'Save measurements', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const updated = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).entries[0], KEY);
  expect(updated.id).toBe(saved.id);
  expect(updated.metrics[0].value).toBe(64);
  expect(updated.metrics.slice(1)).toEqual(saved.metrics.slice(1));
  expect(updated.source_storage_path).toBe(saved.source_storage_path);
  expect(updated.import_id).toBe(saved.import_id);
});

test('replacing and cancelling an image releases previews without saving a reading', async ({ page }) => {
  const dialog = await setup(page);
  const input = dialog.locator('input[type=file]');
  await input.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: TINY_PNG });
  const first = await dialog.getByRole('img').getAttribute('src');
  await input.setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: TINY_PNG });
  const second = await dialog.getByRole('img').getAttribute('src');
  expect(second).not.toBe(first);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const revoked = await page.evaluate(() => (window as Window & { imageReviewUrls: { revoked: string[] } }).imageReviewUrls.revoked);
  expect(revoked).toContain(first); expect(revoked).toContain(second);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
});
