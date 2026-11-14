import { expect, test, type Page } from '@playwright/test';
import { enterDemo } from './helpers';

type Request = { section: string; cursor?: string; pageSize?: number; days?: number; metricKey?: string; metricUnit?: string; sourceName?: string; method?: string; beforeDate?: string; excludeEntryId?: string };
const entry = (index: number) => ({ id: `page-reading-${index}`, measured_at: '2026-10-17', source_name: 'Selected scale', method: 'bia',
  metrics: [{ key: 'weight_kg', label: 'Weight', value: 80 + index, unit: 'kg' }] });

async function instrument(page: Page, options: { delaySummary?: boolean; delayJobs?: boolean } = {}) {
  const requests: Request[] = [];
  let releaseSummary = () => {};
  const waiting = new Promise<void>(resolve => { releaseSummary = resolve; });
  let releaseJobs = () => {};
  const waitingJobs = new Promise<void>(resolve => { releaseJobs = resolve; });
  await enterDemo(page);
  await page.route(/\/src\/firebase\/measurements\.ts(?:\?t=\d+)?$/, route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/firebase/measurements.ts?progressSelectedActual';
    export async function getMeasurementWorkspace(input) {
      if (!input?.section) throw new Error('Unexpected unselected measurement request');
      return (await fetch('/__selected_progress', {method:'POST',body:JSON.stringify(input)})).json();
    }` }));
  await page.route('**/__selected_progress', async route => {
    const input = route.request().postDataJSON() as Request;
    requests.push(input);
    const base = { section: input.section, revision: 1 };
    if (input.section === 'references') return route.fulfill({ json: { ...base, reference_entries: [] } });
    if (input.section === 'summary') {
      if (options.delaySummary) await waiting;
      return route.fulfill({ json: { ...base, memory: null, insights: null, factual_digest: {
        kind: 'progress-facts-v1', summary: '## Requested progress summary\n\nAll-history facts only.', revision: 1, status: 'ready',
      } } });
    }
    if (input.section === 'history') {
      const start = input.cursor === 'server-page-two' ? 10 : input.cursor === 'server-page-three' ? 20 : 0;
      const size = input.pageSize ?? 10;
      return route.fulfill({ json: { ...base, entries: Array.from({ length: Math.min(size, 25 - start) }, (_, i) => entry(start + i)),
        has_more: start + size < 25, next_cursor: start === 0 ? 'server-page-two' : start === 10 ? 'server-page-three' : null } });
    }
    if (input.section === 'trends') return route.fulfill({ json: { ...base,
      metric_options: [{ key: 'weight_kg', label: 'Weight', unit: 'kg' }],
      source_options: input.metricKey ? [{ source_name: 'Selected scale', method: 'bia' }, { source_name: 'Other assessment', method: 'anthropometric' }] : [],
      entries: input.sourceName ? [{ ...entry(0), measured_at: '2026-10-01' }, { ...entry(1), measured_at: '2026-10-17' }] : [], has_more: false } });
    if (options.delayJobs) await waitingJobs;
    return route.fulfill({ json: { ...base, jobs: [] } });
  });
  await page.goto('/progress');
  await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();
  return { requests, releaseSummary, releaseJobs };
}

test('Progress defers requests until a view or manual form is opened and keeps summary isolated', async ({ page }) => {
  const { requests } = await instrument(page);
  expect(requests).toEqual([]);
  await expect(page.getByTestId('measurement-history')).toHaveCount(0);
  await expect(page.getByTestId('measurement-trends')).toHaveCount(0);
  await expect(page.getByTestId('measurement-factual-memory')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add measurements', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ section: 'references', sourceName: 'Manual', method: 'manual' });
  expect(requests[0].beforeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByRole('dialog').getByRole('tab', { name: 'Upload report', exact: true }).click();
  expect(requests).toHaveLength(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Requested progress summary' })).toBeVisible();
  expect(requests.slice(1)).toEqual([{ section: 'summary' }]);
  await expect(page.getByTestId('measurement-history')).toHaveCount(0);
  await expect(page.getByTestId('measurement-trends')).toHaveCount(0);
});

test('history requests real ten-reading cursor pages without summary or trend data', async ({ page }) => {
  const { requests } = await instrument(page);
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  const rows = page.getByTestId('measurement-history').locator('[data-testid^="measurement-entry-"]');
  await expect(rows).toHaveCount(10);
  expect(requests).toEqual([{ section: 'history', pageSize: 10 }]);
  await page.getByRole('button', { name: 'Load 10 more readings', exact: true }).click();
  await expect(rows).toHaveCount(20);
  expect(requests.at(-1)).toEqual({ section: 'history', pageSize: 10, cursor: 'server-page-two' });
  await page.getByRole('button', { name: 'Load 10 more readings', exact: true }).click();
  await expect(rows).toHaveCount(25);
  expect(requests.at(-1)).toEqual({ section: 'history', pageSize: 10, cursor: 'server-page-three' });
  await expect(page.getByRole('button', { name: 'Load 10 more readings', exact: true })).toHaveCount(0);
  expect(requests.every(input => input.section === 'history')).toBe(true);
  await expect(page.getByTestId('measurement-factual-memory')).toHaveCount(0);
  await expect(page.getByTestId('measurement-trends')).toHaveCount(0);
});

test('trends fetch only the selected metric, source, method and period', async ({ page }) => {
  const { requests } = await instrument(page);
  await page.getByRole('tab', { name: 'Trends', exact: true }).click();
  await expect(page.getByTestId('measurement-trends')).toContainText('Choose a measurement and its source');
  expect(requests).toEqual([{ section: 'trends', days: 90 }]);
  await page.getByRole('combobox', { name: 'Trend to view', exact: true }).click();
  await page.getByRole('option', { name: 'Weight (kg)', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Source and method', exact: true })).toBeEnabled();
  await expect.poll(() => requests.at(-1)).toEqual({ section: 'trends', days: 90, metricKey: 'weight_kg', metricUnit: 'kg' });
  await page.getByRole('combobox', { name: 'Source and method', exact: true }).click();
  await page.getByRole('option', { name: 'Selected scale · Body composition scale (BIA)', exact: true }).click();
  await expect(page.locator('.recharts-line')).toBeVisible();
  expect(requests.at(-1)).toEqual({ section: 'trends', days: 90, metricKey: 'weight_kg', metricUnit: 'kg', sourceName: 'Selected scale', method: 'bia' });
  await page.getByRole('combobox', { name: 'Analysis period', exact: true }).click();
  await page.getByRole('option', { name: 'Last 30 days', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.days).toBe(30);
  expect(requests.at(-1)).toMatchObject({ metricKey: 'weight_kg', metricUnit: 'kg', sourceName: 'Selected scale', method: 'bia' });
  expect(requests.every(input => input.section === 'trends')).toBe(true);
  await expect(page.getByTestId('measurement-history')).toHaveCount(0);
});

test('a late summary response cannot replace the newly selected history', async ({ page }) => {
  const { requests, releaseSummary } = await instrument(page, { delaySummary: true });
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(page.getByTestId('measurement-history').locator('[data-testid^="measurement-entry-"]')).toHaveCount(10);
  releaseSummary();
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('measurement-factual-memory')).toHaveCount(0);
  await expect(page.getByTestId('measurement-history').locator('[data-testid^="measurement-entry-"]')).toHaveCount(10);
});

test('a job check completing after a view switch refreshes only the current selection', async ({ page }) => {
  const { requests, releaseJobs } = await instrument(page, { delayJobs: true });
  await page.getByRole('button', { name: 'Add measurements', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Value', exact: true }).first().fill('80');
  await dialog.getByRole('button', { name: 'Save measurements', exact: true }).click();
  await expect(page.getByTestId('measurement-history')).toBeVisible();
  await expect.poll(() => requests.some(input => input.section === 'jobs')).toBe(true);
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Requested progress summary' })).toBeVisible();
  const switchedAt = requests.length;
  releaseJobs();
  await expect.poll(() => requests.length).toBeGreaterThan(switchedAt);
  expect(requests.slice(switchedAt).every(input => input.section === 'summary')).toBe(true);
  await expect(page.getByTestId('measurement-history')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Requested progress summary' })).toBeVisible();
});
