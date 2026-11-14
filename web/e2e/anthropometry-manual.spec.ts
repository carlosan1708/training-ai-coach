import { expect, test } from '@playwright/test';
import { enterDemo } from './helpers';

const measurementKey = 'tac_demo_measurements_v1';

for (const language of ['en', 'es'] as const) {
  test(`manual anthropometry choices preserve cm/mm values and unmeasured blanks in ${language}`, async ({ page }) => {
    const es = language === 'es';
    await page.setViewportSize({ width: 360, height: 780 });
    await page.clock.install({ time: new Date('2026-10-17T18:00:00Z') });
    await enterDemo(page);
    await page.evaluate(({ key, lang }) => {
      const database = JSON.parse(localStorage.getItem('tac_demo_db')!);
      database.logs = {}; database.reports = [];
      localStorage.setItem('tac_demo_db', JSON.stringify(database));
      localStorage.removeItem(key); localStorage.setItem('ui_language', lang);
    }, { key: measurementKey, lang: language });
    await page.goto('/progress');
    await page.getByRole('button', { name: es ? 'Añadir mediciones' : 'Add measurements', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: es ? 'Báscula o fuente' : 'Scale or source', exact: true }).fill('Synthetic assessment');
    await dialog.getByRole('combobox', { name: es ? 'Método de medición' : 'Measurement method', exact: true }).click();
    await page.getByRole('option', { name: es ? 'Antropometría / pliegues' : 'Anthropometric / skinfolds', exact: true }).click();
    await dialog.getByLabel(es ? 'Fecha de medición' : 'Measurement date', { exact: true }).fill('2025-06-12');
    const valueLabel = es ? 'Valor' : 'Value';
    await dialog.getByRole('group', { name: es ? 'Peso' : 'Weight', exact: true }).getByRole('textbox', { name: valueLabel, exact: true }).fill('75,4');
    // Keep the initial body-fat and waist fields blank: absence is not zero.
    const choices = [
      { key: 'relaxed_arm_cm', en: 'Relaxed arm', es: 'Brazo relajado', unit: 'cm', value: '31,5' },
      { key: 'tensed_arm_cm', en: 'Tensed arm', es: 'Brazo en tensión', unit: 'cm', value: '33,2' },
      { key: 'calf_cm', en: 'Calf', es: 'Pantorrilla', unit: 'cm', value: '36,4' },
      { key: 'humerus_cm', en: 'Humerus breadth', es: 'Diámetro del húmero', unit: 'cm', value: '6,8' },
      { key: 'femur_cm', en: 'Femur breadth', es: 'Diámetro del fémur', unit: 'cm', value: '9,1' },
      { key: 'triceps_mm', en: 'Triceps skinfold', es: 'Pliegue de tríceps', unit: 'mm', value: '12,3' },
      { key: 'sum_6_skinfolds_mm', en: 'Sum of 6 skinfolds', es: 'Suma de 6 pliegues', unit: 'mm', value: '81,7' },
      { key: 'sum_8_skinfolds_mm', en: 'Sum of 8 skinfolds', es: 'Suma de 8 pliegues', unit: 'mm', value: '103,2' },
    ];
    for (const choice of choices) {
      const name = es ? choice.es : choice.en;
      // Common circumferences are ready in the initial form; advanced readings
      // still exercise the picker without creating duplicate metric rows.
      if (!['relaxed_arm_cm', 'tensed_arm_cm', 'calf_cm'].includes(choice.key)) {
        await dialog.getByRole('button', { name: es ? 'Añadir una medición' : 'Add a measurement', exact: true }).click();
        await dialog.getByRole('group', { name: es ? 'Otra medición' : 'Other measurement', exact: true }).getByRole('combobox', { name: es ? 'Medición' : 'Measurement', exact: true }).click();
        await page.getByRole('option', { name: `${name} (${choice.unit})`, exact: true }).click();
      }
      const field = dialog.getByRole('group', { name, exact: true });
      await expect(field.getByRole('textbox', { name: es ? 'Unidad' : 'Unit', exact: true })).toHaveValue(choice.unit);
      await field.getByRole('textbox', { name: valueLabel, exact: true }).fill(choice.value);
    }
    await dialog.getByRole('button', { name: es ? 'Guardar mediciones' : 'Save measurements', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).entries[0], measurementKey);
    expect(saved).toMatchObject({ source_name: 'Synthetic assessment', method: 'anthropometric', measured_at: '2025-06-12' });
    expect(saved.metrics).toHaveLength(choices.length + 1);
    expect(saved.metrics.find((item: { key: string }) => item.key === 'weight_kg')).toMatchObject({ value: 75.4, unit: 'kg' });
    expect(saved.metrics.some((item: { key: string }) => ['body_fat_pct', 'waist_cm', 'thighs_cm'].includes(item.key))).toBe(false);
    for (const choice of choices) expect(saved.metrics.find((item: { key: string }) => item.key === choice.key)).toMatchObject({ value: Number(choice.value.replace(',', '.')), unit: choice.unit });
    await page.reload();
    await page.getByRole('tab', { name: es ? 'Historial' : 'History', exact: true }).click();
    await page.getByRole('button', { name: es ? 'Ver lectura' : 'View reading', exact: true }).click();
    const details = page.getByRole('dialog');
    await expect(details).toContainText(es ? 'Brazo relajado' : 'Relaxed arm');
    await expect(details).toContainText('31.5 cm');
    await expect(details).toContainText('81.7 mm');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('a longer factual progress overview stays readable in the page and mobile coach dialog', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const sections = ['History coverage', 'Weight over time', 'Composition and circumferences', 'Earlier and recent changes', 'Training records', 'Sources and limitations', 'Future manual readings'];
  const paragraphs = [
    'This synthetic overview uses saved observations. Unknown measurements stay unknown, and every source keeps its own comparison group.',
    'A change between two dates describes the recorded readings. It does not establish why the change happened or make different measurement methods interchangeable.',
  ];
  const summary = sections.map(section => `## ${section}\n\n${paragraphs.join('\n\n')}\n\n- Compare like-for-like readings.\n- Keep the date, source and original units.`).join('\n\n');
  const fixture = { entries: [], revision: 1, memory: null, insights: null, jobs: [], factual_digest: {
    kind: 'progress-facts-v1', narrative_version: 2, status: 'ready', revision: 1, source_fingerprint: 'synthetic-long-digest', history_incomplete: false,
    range: { start_date: '2025-01-01', end_date: '2026-01-01', as_of: '2026-01-02' }, counts: { observations: 40, measurement_dates: 20 }, summary,
  } };
  await page.route('**/src/firebase/measurements.ts', route => route.fulfill({ contentType: 'application/javascript', body:
    `export * from '/src/firebase/measurements.ts?longFactualActual'; export async function getMeasurementWorkspace() { return ${JSON.stringify(fixture)}; }` }));
  let modelCalls = 0;
  await page.route('**/src/firebase/callables.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/firebase/callables.ts?longFactualNoAi';
    export async function chatFn() { await fetch('/__unexpected_long_summary_ai'); throw new Error('Unexpected AI request'); }` }));
  await page.route('**/__unexpected_long_summary_ai', route => { modelCalls++; return route.fulfill({ json: {} }); });
  await enterDemo(page);
  await page.goto('/progress');
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  const overview = page.getByTestId('measurement-factual-memory');
  await expect(overview.getByTestId('assistant-markdown').getByRole('heading')).toHaveCount(sections.length);
  expect(await overview.getByTestId('assistant-markdown').evaluate(element => getComputedStyle(element).maxHeight)).toBe('none');
  await overview.getByRole('heading', { name: sections.at(-1), exact: true }).scrollIntoViewIfNeeded();
  await expect(overview.getByRole('heading', { name: sections.at(-1), exact: true })).toBeInViewport();

  await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Coach memory', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'What your coach remembers', exact: true });
  await dialog.getByRole('tab', { name: 'Your progress', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: sections[0], exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveCount(sections.length + 1); // Dialog title plus sections.
  const contentHeight = await dialog.locator('.MuiDialogContent-root').evaluate(element => element.clientHeight);
  expect(contentHeight).toBeGreaterThan(780 * 0.5);
  await dialog.getByRole('heading', { name: sections.at(-1), exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('heading', { name: sections.at(-1), exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(modelCalls).toBe(0);
});
