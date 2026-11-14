import { expect, test, type Page } from '@playwright/test';

const savedReport = {
  week_start: '2000-01-03', week_end: '2000-01-09', headline: 'Saved synthetic report',
  summary: 'Previously saved report.', wins: [], focus_next_week: [],
  stats: { sessions: 1, total_volume_kg: 100, routines_done: [], prev_volume_kg: 0,
    weight_source: null as { source_name: string; method: string } | null },
};

async function reportHarness(page: Page, options: { environment?: string; demo?: boolean; saved?: boolean; readFailure?: boolean; aiPaused?: boolean; report?: typeof savedReport } = {}) {
  const counts = { reads: 0, generations: 0, externalRequests: [] as string[] };
  await page.addInitScript(demo => {
    localStorage.setItem('ui_language', 'en');
    if (demo) localStorage.setItem('tac_demo_mode', '1');
  }, !!options.demo);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5199') {
      counts.externalRequests.push(url.origin);
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  await page.route('**/src/firebase/config.ts', route => route.fulfill({ contentType: 'application/javascript',
    body: `export const appEnvironment = ${JSON.stringify(options.environment ?? 'qa')};` }));
  await page.route('**/src/firebase/firestore.ts', route => route.fulfill({ contentType: 'application/javascript', body:
    'export async function getLatestWeeklyReport() { const response = await fetch("/__report/read"); if (!response.ok) throw new Error("Read failed"); return response.json(); }' }));
  await page.route('**/src/firebase/callables.ts', route => route.fulfill({ contentType: 'application/javascript', body:
    'export async function generateWeeklyReportFn() { const response = await fetch("/__report/generate", { method: "POST" }); const data = await response.json(); if (!response.ok) throw data; return { data }; }' }));
  await page.route('**/__report/read', route => {
    counts.reads += 1;
    return route.fulfill({ status: options.readFailure ? 503 : 200, json: options.saved ? options.report ?? savedReport : null });
  });
  await page.route('**/__report/generate', route => {
    counts.generations += 1;
    return route.fulfill({ status: options.aiPaused ? 412 : 200, json: options.aiPaused
      ? { code: 'functions/failed-precondition', details: { reason: 'QA_AI_PAUSED' } }
      : { report: { ...savedReport, headline: 'Explicit synthetic report' } } });
  });
  await page.route('**/__weekly-report-harness', route => route.fulfill({ contentType: 'text/html', body: `
    <html><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/weekly-report-harness.tsx');
    </script></body></html>` }));
  await page.goto('/__weekly-report-harness');
  await expect(page.getByText('Weekly AI Report', { exact: true })).toBeVisible();
  return counts;
}

test('saved historical provider data remains context and cannot set current weekly targets', async ({ page }) => {
  const report = { ...savedReport, headline: 'Historical synthetic report', summary: 'Adjust your target based on Charlie’s measurements.',
    wins: ['Charlie reported a weight change.'], focus_next_week: ['Go back to Charlie for your next measurement.'],
    stats: { ...savedReport.stats, weight_source: { source_name: 'Charlie Nutrición y Ejercicio (synthetic)', method: 'anthropometric' },
      weight_start_kg: 82, weight_end_kg: 80, weight_delta_kg: -2 } };
  const counts = await reportHarness(page, { saved: true, report });
  await expect(page.getByText('No further readings from this source are expected; current advice and targets use your own tracking and training.', { exact: false })).toBeVisible();
  await expect(page.getByText(report.summary, { exact: true })).toHaveCount(0);
  await expect(page.getByText(report.focus_next_week[0], { exact: true })).toHaveCount(0);
  await expect(page.getByText('-2 kg', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Log the completed sets, repetitions and loads of your next planned workout.', { exact: true })).toBeVisible();
  expect(report.stats.weight_delta_kg).toBe(-2);
  expect(counts.generations).toBe(0);
  expect(counts.externalRequests).toEqual([]);
});

for (const summary of ['Nothing to report.', 'Nada que reportar.']) {
  test(`saved weekly '${summary}' becomes a useful localized update without generation`, async ({ page }) => {
    const report = { ...savedReport, summary, focus_next_week: ['Book another anthropometric report.'],
      stats: { ...savedReport.stats, sessions: 2 } };
    const counts = await reportHarness(page, { saved: true, report });
    await expect(page.getByText('You have 2 completed workouts recorded this week.', { exact: false })).toBeVisible();
    await expect(page.getByText('Log the completed sets, repetitions and loads of your next planned workout.', { exact: true })).toBeVisible();
    await expect(page.getByText(summary, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Book another anthropometric report.', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Change language', exact: true }).click();
    await expect(page.getByText('Tienes 2 entrenamientos completados registrados esta semana.', { exact: false })).toBeVisible();
    await expect(page.getByText('Registra las series completadas, repeticiones y cargas de tu próximo entrenamiento planificado.', { exact: true })).toBeVisible();
    expect(counts.generations).toBe(0);
    expect(counts.externalRequests).toEqual([]);
    expect(report.summary).toBe(summary);
    expect(report.focus_next_week).toEqual(['Book another anthropometric report.']);
  });
}

test('a closed QA AI window explains the pause without retrying automatically', async ({ page }) => {
  const counts = await reportHarness(page, { aiPaused: true });
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('AI is paused in QA. Ask to open a temporary test window, or explore the demo.');
  expect(counts.generations).toBe(1);
  expect(counts.externalRequests).toEqual([]);
});

for (const scenario of ['missing', 'stale', 'failed read'] as const) {
  test(`QA ${scenario} weekly reports stay manual across language changes and remounts`, async ({ page }) => {
    const counts = await reportHarness(page, { saved: scenario === 'stale', readFailure: scenario === 'failed read' });
    await expect(page.getByText('QA reports run only when you ask.', { exact: false })).toBeVisible();
    if (scenario === 'stale') await expect(page.getByText(savedReport.headline)).toBeVisible();
    else await expect(page.getByRole('button', { name: 'Generate report', exact: true })).toBeVisible();
    expect(counts.generations).toBe(0);
    await page.getByRole('button', { name: 'Change language', exact: true }).click();
    await expect(page.getByText('En QA, los informes se generan solo cuando los solicitas.', { exact: false })).toBeVisible();
    await expect.poll(() => counts.reads).toBe(2);
    await page.getByRole('button', { name: 'Toggle report', exact: true }).click();
    await expect(page.getByText('Weekly AI Report', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Toggle report', exact: true }).click();
    await expect.poll(() => counts.reads).toBe(3);
    const generate = page.getByRole('button', { name: scenario === 'stale' ? 'Regenerar' : 'Generar informe', exact: true });
    await expect(generate).toBeVisible();
    expect(counts.generations).toBe(0);
    await generate.click();
    await expect(page.getByText('Explicit synthetic report', { exact: true })).toBeVisible();
    expect(counts.generations).toBe(1);
    expect(counts.externalRequests).toEqual([]);
  });
}

for (const scenario of ['production', 'demo'] as const) {
  test(`${scenario} retains automatic weekly report generation`, async ({ page }) => {
    const counts = await reportHarness(page, { environment: scenario === 'demo' ? 'qa' : 'production', demo: scenario === 'demo' });
    await expect(page.getByText('Explicit synthetic report', { exact: true })).toBeVisible();
    expect(counts.generations).toBe(1);
    await expect(page.getByText('QA reports run only when you ask.', { exact: false })).toHaveCount(0);
    expect(counts.externalRequests).toEqual([]);
  });
}

for (const summary of [
  'You completed all 5 planned sessions and recorded 41,731 kg of aggregate training volume, up 9% from last week. No energy data was recorded.',
  'Completaste 5 sesiones y registraste 41731 kg de volumen total, un 9% más.',
]) {
  test(`saved aggregate volume is removed from the weekly coaching card: ${summary}`, async ({ page }) => {
    const report = { ...savedReport, headline: 'Volume up 9%', summary,
      wins: ['Total tonnage increased 9%.'], focus_next_week: ['Increase training volume next week.'],
      stats: { ...savedReport.stats, sessions: 5, total_volume_kg: 41731, volume_change_pct: 9 } };
    const before = JSON.stringify(report);
    const counts = await reportHarness(page, { saved: true, report });
    await expect(page.getByText('You have 5 completed workouts recorded this week.', { exact: false })).toBeVisible();
    await expect(page.getByText(/41,731|41731|9%|tonnage|energy data/i)).toHaveCount(0);
    await expect(page.getByText('Volume up 9%', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Increase training volume next week.', { exact: true })).toHaveCount(0);
    expect(counts.generations).toBe(0);
    expect(counts.externalRequests).toEqual([]);
    expect(JSON.stringify(report)).toBe(before);
  });
}
