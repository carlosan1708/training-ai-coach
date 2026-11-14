import { expect, test, type Page } from '@playwright/test';
import { enterDemo } from './helpers';

const key = 'tac_demo_measurements_v1';
const historical = { id: 'synthetic-charlie-history', measured_at: '2025-06-12', source_name: 'Charlie (synthetic)', method: 'anthropometric', metrics: [{ key: 'waist_cm', label: 'Waist', value: 84, unit: 'cm' }, { key: 'triceps_mm', label: 'Triceps skinfold', value: 12, unit: 'mm' }], source_download_url: 'https://example.invalid/synthetic-report.pdf', revision: 1 };
const completedWorkout = { id: 'synthetic-completed-workout', routine_id: 'synthetic-routine', day_id: 'synthetic-day', date: '2026-10-22', status: 'completed', started_at: Date.parse('2026-10-22T18:00:00Z'), duration_min: 30, exercises: [{ name: 'Synthetic squat', sets: [{ reps: 8, weight_kg: 40, done: true }, { reps: 8, weight_kg: 40, done: true }] }] };

test.use({ timezoneId: 'America/Costa_Rica' });

async function prepare(page: Page, language: 'en' | 'es', entries: object[], sessions: object[]) {
  await page.clock.install({ time: new Date('2026-10-23T18:00:00Z') });
  await enterDemo(page);
  await page.evaluate(({ storageKey, lang, readings, workouts }) => {
    const database = JSON.parse(localStorage.getItem('tac_demo_db')!);
    database.logs = {}; database.reports = []; database.sessions = workouts;
    localStorage.setItem('tac_demo_db', JSON.stringify(database));
    localStorage.setItem('ui_language', lang);
    localStorage.setItem(storageKey, JSON.stringify({ entries: readings, removed: [], revision: 1, jobs: [], requests: {} }));
  }, { storageKey: key, lang: language, readings: entries, workouts: sessions });
  await page.goto('/progress');
}

async function refresh(page: Page, es: boolean) {
  await page.getByRole('tab', { name: es ? 'Resumen' : 'Summary', exact: true }).click();
  await page.getByRole('button', { name: es ? 'Actualizar análisis' : 'Refresh insights', exact: true }).click();
  await expect.poll(() => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).insights?.status, key)).toBe('ready');
  await expect(page.getByTestId('measurement-insights')).toContainText(es ? 'series completadas' : 'completed sets');
  const insight = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).insights, key);
  expect(insight.summary.trim().split(/\s+/).length).toBeLessThanOrEqual(45);
  expect(insight.focus).toHaveLength(1);
  expect(insight.focus[0].trim().split(/\s+/).length).toBeLessThanOrEqual(30);
  expect(`${insight.summary} ${insight.focus[0]}`).not.toMatch(/nothing to report|nada que (?:informar|reportar)/i);
  return insight;
}

for (const language of ['en', 'es'] as const) {
  const es = language === 'es';

  test(`historical anthropometry stays intact while home measurements begin an independent baseline in ${language}`, async ({ page }) => {
    const futureAnthro = { ...historical, id: 'future-anthro', source_name: 'Future clinic', measured_at: '2026-11-12' };
    const futureHome = { ...historical, id: 'future-home', source_name: 'Future home', method: 'manual', measured_at: '2026-11-12' };
    await prepare(page, language, [historical, futureAnthro, futureHome], [completedWorkout]);
    await page.getByRole('button', { name: es ? 'Añadir mediciones' : 'Add measurements', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: es ? 'Báscula o fuente' : 'Scale or source', exact: true }).fill('My tape');
    await dialog.getByRole('group', { name: es ? 'Cintura' : 'Waist', exact: true }).getByRole('textbox', { name: es ? 'Valor' : 'Value', exact: true }).fill('81');
    await dialog.getByRole('button', { name: es ? 'Guardar mediciones' : 'Save measurements', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('tab', { name: es ? 'Resumen' : 'Summary', exact: true }).click();
    await expect(page.getByTestId('measurement-historical-context')).toContainText('Charlie (synthetic)', { timeout: 12_000 });
    await expect(page.getByTestId('measurement-historical-context')).toContainText(es ? 'No se esperan más mediciones' : 'No further readings are expected');
    await expect(page.getByTestId('measurement-historical-context')).toContainText(es ? 'Las recomendaciones y metas actuales usan tu seguimiento propio y tus entrenamientos' : 'Current advice and targets use your own tracking and training');
    await expect(page.getByTestId('measurement-factual-memory')).toContainText(es ? 'Referencias históricas: Charlie (synthetic)' : 'Historical references: Charlie (synthetic)');
    await expect(page.getByTestId('measurement-insights')).toContainText(es ? 'punto de partida independiente' : 'separate baseline');
    const state = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!), key);
    expect(state.entries.find((entry: { id: string }) => entry.id === historical.id)).toEqual(historical);
    expect(state.insights.comparisons).toEqual([]);
    expect(state.insights.tracking_context.historical_sources).toEqual([{ source_name: 'Charlie (synthetic)', method: 'anthropometric', latest_date: '2025-06-12', role: 'historical_reference', follow_up_required: false }]);
    expect(state.insights.tracking_context.ongoing_sources).toEqual([{ source_name: 'My tape', method: 'manual', latest_date: '2026-10-23', role: 'ongoing_tracking_option' }]);
    expect(state.insights.summary).toContain('2026-10-23');
    expect(state.insights.summary).not.toContain('2026-11-12');
    expect(state.insights.summary.trim().split(/\s+/).length).toBeLessThanOrEqual(45);
    expect(state.insights.focus).toHaveLength(1);
    expect(state.insights.focus[0]).not.toMatch(/Charlie|skinfold|anthropometr|antropometr|pliegue|informe/i);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions)).toEqual([completedWorkout]);
    await page.getByRole('tab', { name: es ? 'Historial' : 'History', exact: true }).click();
    const historyCard = page.getByTestId(`measurement-entry-${historical.id}`);
    await expect(historyCard).toContainText('2025-06-12');
    await historyCard.getByRole('button', { name: es ? 'Ver lectura' : 'View reading', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: es ? 'Ver informe original' : 'View original report', exact: true })).toBeVisible();
  });

  test(`workouts provide a useful report without recent measurements in ${language}`, async ({ page }) => {
    const unfinished = { ...completedWorkout, id: 'synthetic-draft', status: 'in_progress' };
    const futureWorkout = { ...completedWorkout, id: 'synthetic-future-workout', date: '2026-11-12' };
    await prepare(page, language, [historical], [completedWorkout, unfinished, futureWorkout]);
    const insight = await refresh(page, es);
    expect(insight.workouts).toMatchObject({ sessions: 1, completed_sets: 2 });
    expect(insight.summary).toContain(es ? '1 entrenamiento completado y 2 series completadas' : '1 completed workout and 2 completed sets');
    expect(insight.summary).toContain(es ? 'referencia histórica' : 'historical references');
    expect(insight.focus[0]).toContain(es ? 'próximo entrenamiento' : 'next completed workout');
    expect(insight.focus[0]).not.toMatch(/Charlie|report|informe|skinfold|pliegue/i);
  });

  test(`an empty report gives one achievable next action in ${language}`, async ({ page }) => {
    await prepare(page, language, [], []);
    const insight = await refresh(page, es);
    expect(insight.workouts).toMatchObject({ sessions: 0, completed_sets: 0 });
    expect(insight.summary).toContain(es ? 'iniciar un registro útil de actividad' : 'start a useful activity record');
    expect(insight.focus[0]).toContain(es ? 'Registra tu próximo entrenamiento' : 'Log your next completed workout');
    await expect(page.getByTestId('measurement-historical-context')).toHaveCount(0);
  });

  test(`same-day and newer anthropometry cannot drive the current baseline or comparison chips in ${language}`, async ({ page }) => {
    const sameDayAnthro = { ...historical, id: 'synthetic-anthro-same-day', measured_at: '2026-10-20' };
    const newerAnthro = { ...historical, id: 'synthetic-anthro-newer', measured_at: '2026-10-23', metrics: [{ key: 'waist_cm', label: 'Waist', value: 94, unit: 'cm' }, { key: 'triceps_mm', label: 'Triceps skinfold', value: 22, unit: 'mm' }] };
    const own = { id: 'synthetic-own-current', measured_at: '2026-10-20', source_name: 'My tape', method: 'manual', metrics: [{ key: 'waist_cm', label: 'Waist', value: 81, unit: 'cm' }], revision: 1 };
    const entries = [sameDayAnthro, newerAnthro, own];
    await prepare(page, language, entries, [completedWorkout]);
    const baseline = await refresh(page, es);
    expect(baseline.summary).toContain('2026-10-20');
    expect(baseline.summary).not.toContain('2026-10-23');
    expect(baseline.summary).toContain(es ? 'punto de partida independiente' : 'separate baseline');
    expect(baseline.focus[0]).not.toMatch(/Charlie|skinfold|anthropometr|antropometr|pliegue|informe/i);
    expect(baseline.comparisons).toHaveLength(2);
    expect(baseline.comparisons.every((comparison: { method: string }) => comparison.method === 'anthropometric')).toBe(true);
    await expect(page.getByTestId('measurement-current-comparisons')).toHaveCount(0);
    await expect(page.getByTestId('measurement-factual-memory')).toContainText('84 cm (2026-10-20)');
    await expect(page.getByTestId('measurement-factual-memory')).toContainText('94 cm (2026-10-23)');

    const olderOwn = { ...own, id: 'synthetic-own-earlier', measured_at: '2026-10-19', metrics: [{ key: 'waist_cm', label: 'Waist', value: 82, unit: 'cm' }] };
    await page.evaluate(({ storageKey, reading }) => {
      const state = JSON.parse(localStorage.getItem(storageKey)!);
      state.entries.unshift(reading); state.revision += 1;
      localStorage.setItem(storageKey, JSON.stringify(state));
    }, { storageKey: key, reading: olderOwn });
    await page.reload();
    const current = await refresh(page, es);
    expect(current.summary).toContain('2026-10-20');
    expect(current.summary).not.toContain('2026-10-23');
    expect(current.comparisons).toHaveLength(3);
    expect(current.comparisons.find((comparison: { method: string }) => comparison.method === 'manual')).toMatchObject({ source_name: 'My tape', start_value: 82, end_value: 81, delta: -1 });
    const primaryComparisons = page.getByTestId('measurement-current-comparisons');
    await expect(primaryComparisons).toContainText('82 → 81 cm');
    await expect(primaryComparisons).not.toContainText('84 → 94 cm');
    await expect(primaryComparisons).not.toContainText(es ? 'Pliegue de tríceps' : 'Triceps skinfold');
    const saved = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).entries, key);
    for (const entry of entries) expect(saved.find((item: { id: string }) => item.id === entry.id)).toEqual(entry);
  });
}

test('an older dismissive demo insight is repaired on read without changing facts', async ({ page }) => {
  await prepare(page, 'en', [historical], [completedWorkout]);
  await refresh(page, false);
  await page.evaluate(storageKey => {
    const state = JSON.parse(localStorage.getItem(storageKey)!);
    state.insights.summary = 'Nothing to report.';
    state.insights.focus = ['Repeat the historical report.'];
    delete state.insights.tracking_context;
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, key);
  await page.reload();
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await expect(page.getByTestId('measurement-insights')).not.toContainText('Nothing to report');
  await expect(page.getByTestId('measurement-insights')).toContainText('1 completed workout and 2 completed sets');
  await expect(page.getByTestId('measurement-historical-context')).toContainText('No further readings are expected');
  expect(await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).entries, key)).toEqual([historical]);
});

test('source context bounds each source role and preserves all saved observations', async ({ page }) => {
  const entries = Array.from({ length: 51 }, (_, index) => ['anthropometric', 'manual'].map(method => ({
    ...historical, id: `${method}-${index}`, source_name: `Synthetic source ${String(index).padStart(2, '0')}`, method,
  }))).flat();
  await prepare(page, 'en', entries, []);
  const digest = await page.evaluate(async () => {
    const modulePath = '/src/demo/measurements.ts';
    const { getWorkspace } = await import(modulePath);
    return getWorkspace({ section: 'summary' }).factual_digest;
  });
  expect(digest.narrative_version).toBe(3);
  expect(digest.tracking_context.historical_sources).toHaveLength(50);
  expect(digest.tracking_context.ongoing_sources).toHaveLength(50);
  expect(digest.tracking_context.omitted_sources).toBe(2);
  expect(digest.tracking_context.historical_sources[0]).toMatchObject({ source_name: 'Synthetic source 00', method: 'anthropometric', follow_up_required: false });
  expect(digest.tracking_context.ongoing_sources[0]).toMatchObject({ source_name: 'Synthetic source 00', method: 'manual' });
  expect(await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).entries, key)).toEqual(entries);
});
