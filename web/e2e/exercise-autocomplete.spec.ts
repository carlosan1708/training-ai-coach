import { expect, test, type Locator, type Page } from '@playwright/test';
import type { DemoDb } from '../src/demo/db';
import { enterDemo, revealTrainingOptions } from './helpers';

test.use({ timezoneId: 'America/Costa_Rica', locale: 'en-US', viewport: { width: 420, height: 850 } });

const ROUTINE_ID = 'autocomplete-routine';
const SESSION_ID = 'autocomplete-history';
const HISTORY_DATE = '2026-10-15';
const LIBRARY_NAME = 'Dumbbell Lateral Raise';
const LIBRARY_ID = 'Synthetic_Lateral_Raise';
const IMAGES = [`${LIBRARY_ID}/0.jpg`, `${LIBRARY_ID}/1.jpg`];
const LIBRARY_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

async function seed(page: Page, options: { active?: boolean; unavailableLibrary?: boolean } = {}) {
  const cloudRequests: string[] = [];
  await page.route(/cloudfunctions\.net|\.a\.run\.app|api\.openai\.com|generativelanguage\.googleapis\.com/, route => {
    cloudRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.route(LIBRARY_URL, route => options.unavailableLibrary
    ? route.fulfill({ status: 503, body: 'Synthetic unavailable library' })
    : route.fulfill({ json: [{ id: LIBRARY_ID, name: LIBRARY_NAME, primaryMuscles: ['shoulders'],
      secondaryMuscles: [], equipment: 'dumbbell', instructions: ['Raise with control.'], images: IMAGES }] }));
  await page.route('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/**', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#348866"/></svg>',
  }));
  await page.clock.install({ time: new Date('2026-10-18T16:00:00Z') });
  await enterDemo(page);
  await page.evaluate(({ routineId, sessionId, date, isActive }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.profile.units = 'metric';
    db.profile.workout_weight_unit = 'kg';
    db.routines = [{ id: routineId, name: 'Preserved routine', session_count: isActive ? 1 : 2,
      last_session_at: isActive ? '2026-10-13' : date, exercises: [
        { id: 'bench-stable', name: 'Bench Press', sets: 2, reps: 12, weight_kg: 50, weight_unit: 'lb',
          weight_unit_override: true, set_defaults: [{ reps: 12, weight_kg: 50 }, { reps: 11, weight_kg: 48 }] },
        { id: 'row-stable', name: 'Cable Row', sets: 1, reps: 7, weight_kg: 20, weight_unit: 'kg',
          weight_unit_override: true },
      ] }];
    db.sessions = [{ id: sessionId, routine_id: routineId, routine_name: 'Historical upper workout',
      date, status: isActive ? 'active' : 'completed', notes: 'Preserve historical notes',
      started_at: new Date('2026-10-15T16:00:00Z').getTime(),
      ...(isActive ? {} : { completed_at: new Date('2026-10-15T17:00:00Z').getTime(), duration_sec: 3600, duration_min: 60 }),
      exercises: [
        { name: 'Bench Press', notes: 'Saved bench note', routine_exercise_id: 'bench-stable', routine_exercise_index: 0,
          target_sets: 2, target_reps: 10, weight_unit: 'lb', weight_unit_override: true,
          sets: [{ reps: 10, weight_kg: 45.359237, done: true }, { reps: 8, weight_kg: 40.8233133, done: !isActive }] },
        { name: 'Cable Row', notes: 'Saved row note', routine_exercise_id: 'row-stable', routine_exercise_index: 1,
          target_sets: 1, target_reps: 7, weight_unit: 'kg', weight_unit_override: true,
          sets: [{ reps: 7, weight_kg: 20, done: true }] },
      ] }, {
      id: 'unrelated-history', routine_id: routineId, routine_name: 'Older preserved workout', date: '2026-10-13',
      status: 'completed', exercises: [{ name: 'Cable Row', routine_exercise_id: 'row-stable', target_sets: 1,
        target_reps: 5, weight_unit: 'kg', sets: [{ reps: 5, weight_kg: 15, done: true }] }],
    }];
    db.logs = { [date]: { date, weight_kg: 74, measurements: { waist_cm: 80 }, energy: 4,
      notes: 'Keep health notes', food_log: [{ meal: 'Lunch', description: 'Saved meal', adherent: true, timestamp: '12:00' }],
      exercise_log: [{ exercise: 'Bench Press', workout_session_id: sessionId, sets: 2, reps: 9, weight_kg: 45.359237, weight_unit: 'lb' },
        { exercise: 'Cable Row', workout_session_id: sessionId, sets: 1, reps: 7, weight_kg: 20, weight_unit: 'kg' },
        { exercise: 'Manual walk', duration_min: 20, notes: 'Independent manual activity' }] },
    '2026-10-13': { date: '2026-10-13', measurements: {}, energy: 3, notes: 'Older preserved day', food_log: [],
      exercise_log: [{ exercise: 'Cable Row', workout_session_id: 'unrelated-history', sets: 1, reps: 5, weight_kg: 15 }] } };
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { routineId: ROUTINE_ID, sessionId: SESSION_ID, date: HISTORY_DATE, isActive: !!options.active });
  await page.goto(options.active ? `/routines/${ROUTINE_ID}/session/${SESSION_ID}` : `/workout-history?session=${SESSION_ID}`);
  return cloudRequests;
}

const readDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);
const saved = (db: DemoDb) => db.sessions.find(session => session.id === SESSION_ID)!;

async function openEditor(page: Page, active = false) {
  await revealTrainingOptions(page);
  const button = active ? page.getByRole('button', { name: 'Edit workout', exact: true })
    : page.getByTestId(`session-${SESSION_ID}`).getByRole('button', { name: 'Edit workout', exact: true });
  await button.click();
  const editor = page.getByRole('dialog', { name: 'Edit workout', exact: true });
  await expect(editor).toBeVisible();
  return editor;
}

async function addLibraryDraft(page: Page, editor: Locator) {
  await editor.getByRole('button', { name: 'Add exercise', exact: true }).click();
  const added = editor.getByRole('region', { name: 'Exercise 3', exact: true });
  await added.getByRole('combobox', { name: 'Exercise name', exact: true }).fill('lateral');
  await page.getByRole('option', { name: new RegExp(LIBRARY_NAME) }).click();
  await expect(added.getByRole('combobox', { name: 'Exercise name', exact: true })).toHaveValue(LIBRARY_NAME);
  await expect(added.getByRole('img', { name: `Preview of ${LIBRARY_NAME}`, exact: true })).toBeVisible();
  return added;
}

function expectOtherDataPreserved(after: DemoDb, before: DemoDb) {
  expect(after.sessions.find(session => session.id === 'unrelated-history')).toEqual(before.sessions.find(session => session.id === 'unrelated-history'));
  expect(after.logs['2026-10-13']).toEqual(before.logs['2026-10-13']);
  expect(after.routines[0].exercises).toEqual(before.routines[0].exercises);
  expect(after.routines[0].session_count).toBe(before.routines[0].session_count);
  expect(after.routines[0].last_session_at).toBe(before.routines[0].last_session_at);
  const log = after.logs[HISTORY_DATE];
  const old = before.logs[HISTORY_DATE];
  expect({ weight_kg: log.weight_kg, measurements: log.measurements, energy: log.energy, notes: log.notes, food_log: log.food_log })
    .toEqual({ weight_kg: old.weight_kg, measurements: old.measurements, energy: old.energy, notes: old.notes, food_log: old.food_log });
  expect(log.exercise_log.filter(entry => !entry.workout_session_id))
    .toEqual(expect.arrayContaining(old.exercise_log.filter(entry => !entry.workout_session_id)));
}

test('historical library additions animate and persist without changing existing sets, units, dates or routine targets', async ({ page }) => {
  const cloud = await seed(page);
  const before = await readDb(page);
  const editor = await openEditor(page);
  const added = await addLibraryDraft(page, editor);
  const preview = added.getByRole('img', { name: `Preview of ${LIBRARY_NAME}`, exact: true });
  const firstFrame = await preview.getAttribute('src');
  await page.clock.runFor(950);
  await expect(preview).not.toHaveAttribute('src', firstFrame!);
  await added.getByLabel('Reps', { exact: true }).fill('14');
  await added.getByLabel('Weight (kg)', { exact: true }).fill('5');
  await added.getByRole('checkbox', { name: 'Set completed', exact: true }).check();
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toBeHidden();
  const after = await readDb(page);
  expect(saved(after)).toMatchObject({ id: SESSION_ID, status: 'completed', date: HISTORY_DATE,
    started_at: saved(before).started_at, completed_at: saved(before).completed_at, duration_sec: 3600, notes: saved(before).notes });
  expect(saved(after).exercises.slice(0, 2)).toEqual(saved(before).exercises);
  expect(saved(after).exercises[2]).toMatchObject({ name: LIBRARY_NAME, library_id: LIBRARY_ID, images: IMAGES,
    routine_defaults_excluded: true, weight_unit: 'kg', sets: [{ reps: 14, weight_kg: 5, done: true }] });
  expect(saved(after).exercises[2].routine_exercise_id).toBeTruthy();
  expectOtherDataPreserved(after, before);
  expect(after.logs[HISTORY_DATE].exercise_log.filter(entry => entry.workout_session_id === SESSION_ID)).toHaveLength(3);
  await page.reload();
  const history = page.getByTestId(`session-${SESSION_ID}`);
  await expect(history.getByRole('table', { name: `Completed sets for ${LIBRARY_NAME}`, exact: true })).toContainText('5 kg');
  await expect(history.getByRole('img', { name: 'exercise demo', exact: true })).toBeVisible();
  await openEditor(page);
  await expect(editor.getByRole('region', { name: 'Exercise 3', exact: true })
    .getByRole('img', { name: `Preview of ${LIBRARY_NAME}`, exact: true })).toBeVisible();
  expect(cloud).toEqual([]);
});

test('cancelling library selection or typing a custom historical name leaves saved history and logs unchanged', async ({ page }) => {
  const cloud = await seed(page);
  const before = await readDb(page);
  const editor = await openEditor(page);
  const added = await addLibraryDraft(page, editor);
  await added.getByRole('combobox', { name: 'Exercise name', exact: true }).fill('My custom movement');
  await added.getByLabel('Exercise notes', { exact: true }).click();
  await expect(added.getByRole('img', { name: `Preview of ${LIBRARY_NAME}`, exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toBeHidden();
  expect(await readDb(page)).toEqual(before);
  await openEditor(page);
  await expect(editor.getByRole('region', { name: 'Exercise 3', exact: true })).toHaveCount(0);
  expect(cloud).toEqual([]);
});

test('the active workout editor keeps completed and entered sets while attaching a temporary library exercise', async ({ page }) => {
  const cloud = await seed(page, { active: true });
  const before = await readDb(page);
  const editor = await openEditor(page, true);
  await addLibraryDraft(page, editor);
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toBeHidden();
  const after = await readDb(page);
  expect(saved(after).exercises.slice(0, 2)).toEqual(saved(before).exercises);
  expect(saved(after).status).toBe('active');
  expect(saved(after).exercises[2]).toMatchObject({ name: LIBRARY_NAME, library_id: LIBRARY_ID, images: IMAGES,
    routine_defaults_excluded: true, routine_addition: true, sets: [{ reps: 10, weight_kg: 0, done: false }] });
  expectOtherDataPreserved(after, before);
  expect(after.logs).toEqual(before.logs);
  await page.reload();
  await expect(page.getByRole('region', { name: LIBRARY_NAME, exact: true }).getByRole('img', { name: 'exercise demo', exact: true })).toBeVisible();
  expect(cloud).toEqual([]);
});

test('daily exercise logs save selected library previews and free custom names alongside existing entries', async ({ page }) => {
  const cloud = await seed(page);
  const before = await readDb(page);
  await page.goto(`/log?tab=2&date=${HISTORY_DATE}`);
  await expect(page.getByRole('combobox', { name: 'Exercise', exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'Add Exercise', exact: true }).click();
  await page.getByRole('combobox', { name: 'Exercise', exact: true }).last().fill('lateral');
  await page.getByRole('option', { name: new RegExp(LIBRARY_NAME) }).click();
  await expect(page.getByRole('img', { name: `Preview of ${LIBRARY_NAME}`, exact: true })).toBeVisible();
  await page.getByLabel('Sets', { exact: true }).last().fill('2');
  await page.getByLabel('Reps', { exact: true }).last().fill('14');
  await page.getByLabel('Weight (kg)', { exact: true }).last().fill('5');
  await page.getByRole('button', { name: 'Add Exercise', exact: true }).click();
  await page.getByRole('combobox', { name: 'Exercise', exact: true }).last().fill('My own balance drill');
  await page.getByLabel('Sets', { exact: true }).last().fill('1');
  await page.getByRole('button', { name: 'Save Exercises', exact: true }).click();
  await expect(page.getByText('Exercise log saved!', { exact: true })).toBeVisible();
  const after = await readDb(page);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.routines).toEqual(before.routines);
  expectOtherDataPreserved(after, before);
  expect(after.logs[HISTORY_DATE].exercise_log.slice(0, 3)).toEqual(before.logs[HISTORY_DATE].exercise_log);
  expect(after.logs[HISTORY_DATE].exercise_log[3]).toMatchObject({ exercise: LIBRARY_NAME, library_id: LIBRARY_ID,
    images: IMAGES, sets: 2, reps: 14, weight_kg: 5 });
  expect(after.logs[HISTORY_DATE].exercise_log[4].exercise).toBe('My own balance drill');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Exercise', exact: true }).nth(3)).toHaveValue(LIBRARY_NAME);
  await expect(page.getByRole('combobox', { name: 'Exercise', exact: true }).nth(4)).toHaveValue('My own balance drill');
  await expect(page.getByRole('img', { name: `Preview of ${LIBRARY_NAME}`, exact: true })).toBeVisible();
  expect(cloud).toEqual([]);
});

test('an unavailable exercise library still permits custom daily-log entries without touching workout history', async ({ page }) => {
  const cloud = await seed(page, { unavailableLibrary: true });
  const before = await readDb(page);
  await page.goto(`/log?tab=2&date=${HISTORY_DATE}`);
  await page.getByRole('button', { name: 'Add Exercise', exact: true }).click();
  await page.getByRole('combobox', { name: 'Exercise', exact: true }).last().fill('Offline mobility drill');
  await expect(page.getByText('The exercise library is unavailable. You can still enter a custom exercise.', { exact: true }).last()).toBeVisible();
  await page.getByLabel('Sets', { exact: true }).last().fill('1');
  await page.getByRole('button', { name: 'Save Exercises', exact: true }).click();
  await expect(page.getByText('Exercise log saved!', { exact: true })).toBeVisible();
  const after = await readDb(page);
  expect(after.logs[HISTORY_DATE].exercise_log.at(-1)).toMatchObject({ exercise: 'Offline mobility drill', sets: 1 });
  expect(after.logs[HISTORY_DATE].exercise_log.slice(0, 3)).toEqual(before.logs[HISTORY_DATE].exercise_log);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.routines).toEqual(before.routines);
  expectOtherDataPreserved(after, before);
  expect(cloud).toEqual([]);
});

test('Spanish keyboard selection works in routine search and custom configuration at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const cloud = await seed(page);
  const before = await readDb(page);
  await page.goto(`/routines/${ROUTINE_ID}`);
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Español', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir ejercicio', exact: true }).click();
  const picker = page.getByRole('dialog');
  const search = picker.getByRole('combobox', { name: 'Busca entre 870+ ejercicios...', exact: true });
  await search.fill('lateral');
  await expect(page.getByRole('option', { name: new RegExp(LIBRARY_NAME) })).toBeVisible();
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', /option-0$/);
  const preview = picker.getByRole('img', { name: `Vista previa de ${LIBRARY_NAME}`, exact: true });
  await expect(preview).toBeVisible();
  const frame = await preview.getAttribute('src');
  await page.clock.runFor(950);
  await expect(preview).not.toHaveAttribute('src', frame!);
  await search.press('Enter');
  const config = page.getByRole('dialog');
  await expect(config.getByRole('heading', { name: LIBRARY_NAME, exact: true })).toBeVisible();
  await config.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await picker.getByRole('button', { name: 'Añadir ejercicio personalizado', exact: true }).click();
  const input = config.getByRole('combobox', { name: 'Nombre del ejercicio', exact: true });
  await input.fill('lateral');
  await expect(page.getByRole('option', { name: new RegExp(LIBRARY_NAME) })).toBeVisible();
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', /option-0$/);
  await input.press('Enter');
  await expect(input).toHaveValue(LIBRARY_NAME);
  const configuredPreview = config.getByRole('img', { name: `Vista previa de ${LIBRARY_NAME}`, exact: true });
  await expect(configuredPreview).toBeVisible();
  const brokenGifUrl = 'https://synthetic.invalid/broken-exercise.gif';
  let brokenGifRequests = 0;
  await page.route(brokenGifUrl, route => {
    brokenGifRequests += 1;
    return route.fulfill({ contentType: 'image/gif', body: 'Synthetic invalid image' });
  });
  const gifUrl = config.getByLabel('URL del GIF', { exact: true });
  await gifUrl.fill(brokenGifUrl);
  await expect.poll(() => configuredPreview.getAttribute('src')).toBeNull();
  expect(brokenGifRequests).toBeGreaterThan(0);
  await gifUrl.fill('');
  await expect(configuredPreview).toHaveAttribute('src', /Synthetic_Lateral_Raise\/[01]\.jpg$/);
  await expect.poll(() => configuredPreview.evaluate(element =>
    element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
  expect(await config.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('spanish-exercise-autocomplete-mobile.png'), animations: 'disabled' });
  await config.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(config).toBeHidden();
  const after = await readDb(page);
  expect(after.routines[0].exercises.slice(0, 2)).toEqual(before.routines[0].exercises);
  expect(after.routines[0].exercises[2]).toMatchObject({ name: LIBRARY_NAME, library_id: LIBRARY_ID, images: IMAGES });
  expect(after.routines[0].exercises[2].id).toBeTruthy();
  expect(after.sessions).toEqual(before.sessions);
  expect(after.logs).toEqual(before.logs);
  expect(cloud).toEqual([]);
});
