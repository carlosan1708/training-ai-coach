import { expect, test, type Page } from '@playwright/test';
import { enterDemo, TINY_PNG } from './helpers';

const KEY = 'tac_demo_measurements_v1';
const history = (page: Page) => page.getByRole('tab', { name: /^(History|Historial)$/ }).click();
const summary = (page: Page) => page.getByRole('tab', { name: /^(Summary|Resumen)$/ }).click();
test.use({ timezoneId: 'America/Costa_Rica' });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-17T18:00:00Z') });
  await enterDemo(page);
  await page.evaluate(key => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.logs = {}; db.reports = []; db.sessions = [];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
    localStorage.removeItem(key);
  }, KEY);
  await page.goto('/progress');
  await expect(page.getByTestId('measurement-workspace')).toBeVisible();
  await history(page);
});

async function manual(page: Page, weight = '80', date = '2026-10-17') {
  await page.getByRole('button', { name: 'Add measurements', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Measurement date', { exact: true }).fill(date);
  await dialog.getByRole('textbox', { name: 'Value', exact: true }).nth(0).fill(weight);
  await dialog.getByRole('textbox', { name: 'Value', exact: true }).nth(2).fill('82');
  return dialog;
}

test('manual save persists canonical facts and prepares entry memory automatically', async ({ page }) => {
  const dialog = await manual(page);
  await dialog.getByRole('button', { name: 'Save measurements', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('measurement-workspace')).toContainText('Weight: 80 kg');
  await summary(page);
  await expect(page.getByTestId('measurement-memory')).toBeVisible({ timeout: 12_000 });
  const facts = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(facts.entries).toHaveLength(1);
  expect(facts.entries[0].metrics.find((metric: { key: string }) => metric.key === 'waist_cm').value).toBe(82);
  expect(facts.summaries[facts.entries[0].id].summary).toContain('80 kg');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).logs)).toEqual({});
});

test('pasted multi-date report stays a review draft until confirmation and preserves original units', async ({ page }) => {
  await page.getByRole('button', { name: 'Add measurements', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Paste report text', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Report text', exact: true }).fill('2026-10-01\nWeight: 180 lb\nWaist: 32 in\n2026-10-17\nWeight: 175 lb\nWaist: 31 in');
  await dialog.getByRole('button', { name: 'Extract measurements', exact: true }).click();
  await expect(dialog.getByTestId('measurement-draft-1')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
  await expect(dialog.getByTestId('measurement-draft-0')).toContainText('Weight: 180 lb');
  await dialog.getByRole('button', { name: 'Save measurements', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const entries = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).entries, KEY);
  expect(entries).toHaveLength(2);
  const weight = entries[0].metrics.find((metric: { key: string }) => metric.key === 'weight_kg');
  expect(weight.value).toBeCloseTo(81.64663, 4);
  expect(weight.raw_value).toBe(180);
  expect(weight.raw_unit).toBe('lb');
  await expect(page.getByTestId('measurement-insights')).toContainText('−', { timeout: 100 }).catch(() => {});
  await summary(page);
  await expect(page.getByTestId('measurement-memory')).toBeVisible({ timeout: 12_000 });
  const comparison = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).insights.comparisons.find((item: { key: string }) => item.key === 'weight_kg'), KEY);
  expect(comparison.delta).toBeCloseTo(-2.27, 2);
});

test('manual imperial values normalize and edits/deletes invalidate earlier memory', async ({ page }) => {
  const dialog = await manual(page, '180');
  await dialog.getByRole('textbox', { name: 'Unit', exact: true }).nth(0).fill('lb');
  await dialog.getByRole('button', { name: 'Save measurements', exact: true }).click();
  await summary(page);
  await expect(page.getByTestId('measurement-memory')).toBeVisible({ timeout: 12_000 });
  await history(page);
  await page.getByRole('button', { name: 'View reading', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit reading', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Value', exact: true }).nth(0).fill('79');
  await page.getByRole('dialog').getByRole('button', { name: 'Save measurements', exact: true }).click();
  await expect(page.getByTestId('measurement-memory')).not.toBeVisible();
  await expect(page.getByTestId('measurement-workspace')).toContainText('Weight: 79 kg');
  await summary(page);
  await expect(page.getByTestId('measurement-memory')).toBeVisible({ timeout: 12_000 });
  await history(page);
  await page.getByRole('button', { name: 'View reading', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete reading', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete this reading?' }).getByRole('button', { name: 'Delete reading', exact: true }).click();
  await expect(page.getByTestId('measurement-workspace')).toContainText('Your first reading is a starting point');
  await expect(page.getByTestId('measurement-memory')).not.toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).entries.length, KEY)).toBe(0);
});

test('pasted tape values retain missing and unfamiliar units through review and storage', async ({ page }) => {
  await page.getByRole('button', { name: 'Add measurements', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Paste report text', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Report text', exact: true }).fill('2026-10-17\nWaist: 32\nChest: 40 ticks\nHips: 35 in');
  await dialog.getByRole('button', { name: 'Extract measurements', exact: true }).click();
  await expect(dialog.getByTestId('measurement-draft-0')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Unit', exact: true }).nth(0)).toHaveValue('');
  await expect(dialog.getByRole('textbox', { name: 'Unit', exact: true }).nth(1)).toHaveValue('ticks');
  await expect(dialog.getByRole('textbox', { name: 'Unit', exact: true }).nth(2)).toHaveValue('cm');
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
  await dialog.getByRole('button', { name: 'Save measurements', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const metrics = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).entries[0].metrics, KEY);
  expect(metrics[0]).toMatchObject({ value: 32, unit: '', raw_value: 32, raw_unit: '', confidence: 'low' });
  expect(metrics[0].key).toMatch(/^unmapped_/);
  expect(metrics[1]).toMatchObject({ value: 40, unit: 'ticks', raw_unit: 'ticks', confidence: 'low' });
  expect(metrics[2]).toMatchObject({ key: 'hips_cm', value: 88.9, unit: 'cm', raw_value: 35, raw_unit: 'in' });
});

test('upload cancellation before save leaves history unchanged and a one-step import keeps the original', async ({ page }) => {
  await page.getByRole('button', { name: 'Add measurements', exact: true }).first().click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Upload report', exact: true }).click();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'scale.png', mimeType: 'image/png', buffer: TINY_PNG });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
  await page.getByRole('button', { name: 'Add measurements', exact: true }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Upload report', exact: true }).click();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'scale.png', mimeType: 'image/png', buffer: TINY_PNG });
  await dialog.getByRole('button', { name: 'Save report', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).entries[0], KEY);
  expect(saved.measured_at).toBeNull();
  await page.getByRole('button', { name: 'View reading', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'View original report', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'View original report', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'View original report', exact: true })).toHaveAttribute('src', /^blob:/);
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Open original file', exact: true })).toHaveAttribute('href', /^blob:/);
});

test('failed summary offers retry while saved facts remain available', async ({ page }) => {
  const dialog = await manual(page);
  await dialog.getByRole('button', { name: 'Save measurements', exact: true }).click();
  await page.evaluate(key => {
    const state = JSON.parse(localStorage.getItem(key)!);
    state.jobs[0].status = 'failed'; state.jobs[0].error = 'Synthetic analysis failure';
    localStorage.setItem(key, JSON.stringify(state));
  }, KEY);
  await page.reload();
  await summary(page);
  const warning = page.getByRole('alert').filter({ hasText: 'the analysis could not finish' });
  await expect(warning).toBeVisible();
  await history(page);
  await expect(page.getByTestId('measurement-workspace')).toContainText('Weight: 80 kg');
  await summary(page);
  await warning.getByRole('button', { name: 'Try again', exact: true }).click();
  await summary(page);
  await expect(page.getByTestId('measurement-memory')).toBeVisible({ timeout: 12_000 });
});

test('timeline pages in tens and keeps expanded readings while a requested analysis finishes', async ({ page }) => {
  await page.evaluate(key => {
    const entries = Array.from({ length: 23 }, (_, index) => ({ id: `fixture-${index}`, measured_at: `2026-10-${String(17 - index % 17).padStart(2, '0')}`, source_name: 'Fixture scale', method: 'bia', metrics: [{ key: 'weight_kg', label: 'Weight', value: 80 + index / 10, unit: 'kg' }], revision: 1 }));
    localStorage.setItem(key, JSON.stringify({ entries, removed: [], revision: 1, jobs: [], requests: {} }));
  }, KEY);
  await page.reload();
  await history(page);
  await expect(page.getByTestId('measurement-workspace').locator('[data-testid^="measurement-entry-"]')).toHaveCount(10);
  await page.getByRole('button', { name: 'Load 10 more readings', exact: true }).click();
  await expect(page.getByTestId('measurement-workspace').locator('[data-testid^="measurement-entry-"]')).toHaveCount(20);
  await summary(page);
  await page.getByRole('button', { name: 'Refresh insights', exact: true }).click();
  await history(page);
  await page.getByRole('button', { name: 'Load 10 more readings', exact: true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).jobs[0].status, KEY)).toBe('ready');
  await expect(page.getByTestId('measurement-workspace').locator('[data-testid^="measurement-entry-"]')).toHaveCount(20);
});

test('Spanish narrow-mobile review supports decimal entry without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => localStorage.setItem('ui_language', 'es'));
  await page.reload();
  await page.getByRole('button', { name: 'Añadir mediciones', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Valor', exact: true }).nth(0).fill('78,2');
  await dialog.getByRole('button', { name: 'Guardar mediciones', exact: true }).click();
  await expect(page.getByTestId('measurement-workspace')).toContainText('Peso: 78.2 kg');
  await summary(page);
  await expect(page.getByTestId('measurement-memory')).toBeVisible({ timeout: 12_000 });
  await expect(page.getByTestId('measurement-memory')).toContainText('lecturas guardadas');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('measurements-es-mobile.png'), fullPage: true });
});
