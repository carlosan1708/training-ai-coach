import { test, expect, type Page } from '@playwright/test';
import { enterDemo, revealTrainingOptions } from './helpers';
import type { DemoDb } from '../src/demo/db';
import type { Routine, RoutineExercise, WorkoutSession } from '../src/types/routine';
import { carrySessionDefaults, findRecordedExerciseReference, rememberSessionDefaults, resolveExerciseDefaults, rollbackSessionDefaults } from '../src/lib/exerciseDefaults';
import { classifyRecordedLoad, suggestedLoadBasis } from '../src/lib/loadBasis';
import { exerciseTargetsChanged } from '../src/lib/sessionCompletion';
import { exercisesWithChangedDefaults } from '../src/lib/workoutExerciseAddition';

test.use({ timezoneId: 'America/Costa_Rica', locale: 'en-US', viewport: { width: 420, height: 850 } });

const ROUTINE_ID = 'convention-recovery';
const SESSION_ID = 'recovery-active';
const NAME = 'Retained custom press';
const FIRST_KG = 13.6077711; // 30 lb, stored exactly once in kilograms.
const SECOND_KG = 11.33980925; // 25 lb.
const RAW_DEFAULTS = [{ reps: 12, weight_kg: FIRST_KG }, { reps: 11, weight_kg: SECOND_KG }];

function fixture(mode: 'blocked' | 'historical-only' | 'active' = 'blocked') {
  const exercise: RoutineExercise = {
    id: 'retained-press', name: NAME, sets: 2, reps: 12, rest_sec: 60,
    weight_unit: 'lb', weight_unit_override: true, load_basis: mode === 'historical-only' ? 'per_dumbbell' : 'total',
    targets_revision: 'current-target',
    ...(mode === 'historical-only' ? {} : { set_defaults: structuredClone(RAW_DEFAULTS) }),
    ...(mode !== 'active' ? { load_basis_review_required: true } : {}),
  };
  const routine: Routine = { id: ROUTINE_ID, name: 'Synthetic convention recovery', exercises: [exercise] };
  const history: WorkoutSession = {
    id: 'recorded-history', routine_id: ROUTINE_ID, routine_name: routine.name, date: '2026-10-16', status: 'completed',
    started_at: Date.parse('2026-10-16T15:00:00Z'), completed_at: Date.parse('2026-10-16T16:00:00Z'),
    notes: 'Original completed history must stay byte-for-byte equivalent.',
    exercises: [{ name: NAME, routine_exercise_id: exercise.id, routine_exercise_index: 0,
      targets_revision: exercise.targets_revision, load_basis: exercise.load_basis, weight_unit: 'lb', weight_unit_override: true,
      target_sets: 2, target_reps: 10, target_weight_kg: 18.1436948,
      sets: [{ reps: 10, weight_kg: 18.1436948, done: true }, { reps: 9, weight_kg: 15.87573295, done: true }] }],
  };
  const active: WorkoutSession = {
    id: SESSION_ID, routine_id: ROUTINE_ID, routine_name: routine.name, date: '2026-10-18', status: 'active',
    started_at: Date.parse('2026-10-18T15:55:00Z'), notes: 'Keep the active exercise numbers and completed flags.',
    exercises: [{ name: NAME, routine_exercise_id: exercise.id, routine_exercise_index: 0,
      targets_revision: exercise.targets_revision, load_basis: 'total', weight_unit: 'lb', weight_unit_override: true,
      target_sets: 2, target_reps: 10, target_weight_kg: 27.2155422,
      sets: [{ reps: 10, weight_kg: 27.2155422, done: true }, { reps: 9, weight_kg: 24.94758035, done: false }] }],
  };
  return { routine, history, active };
}

async function seed(page: Page, mode: 'blocked' | 'historical-only' | 'active' = 'blocked') {
  const cloudRequests: string[] = [];
  await page.route(/cloudfunctions\.net|\.a\.run\.app|api\.openai\.com|generativelanguage\.googleapis\.com/, route => {
    cloudRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.route('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json', route =>
    route.fulfill({ json: [] }));
  await page.clock.install({ time: new Date('2026-10-18T16:00:00Z') });
  await enterDemo(page);
  await page.evaluate(({ routine, history, active, mode }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.profile.units = 'metric';
    db.profile.workout_weight_unit = 'lb';
    db.routines = [routine];
    db.sessions = mode === 'active' ? [history, active] : [history];
    db.logs = {
      [history.date]: { date: history.date, measurements: { waist_cm: 80 }, energy: 4, notes: 'Preserve original notes.', food_log: [],
        exercise_log: [{ workout_session_id: history.id, exercise: history.exercises[0].name, sets: 2, reps: 10,
          weight_kg: history.exercises[0].sets[0].weight_kg, weight_unit: 'lb' }, { exercise: 'Manual walk', duration_min: 25 }] },
      [active.date]: { date: active.date, measurements: { arms_cm: 34 }, energy: 3, notes: 'Keep today’s manual entries.',
        food_log: [], exercise_log: [{ exercise: 'Manual walk', duration_min: 15 }] },
    };
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { ...fixture(mode), mode });
  await page.goto(mode === 'active' ? `/routines/${ROUTINE_ID}/session/${SESSION_ID}` : `/routines/${ROUTINE_ID}`);
  return cloudRequests;
}

const readDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);
const exercise = (db: DemoDb) => db.routines[0].exercises[0];

function card(page: Page, name = NAME) {
  return page.locator('.MuiCard-root').filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Edit', exact: true }) });
}

async function editExercise(page: Page, name = NAME) {
  await card(page, name).getByRole('button', { name: 'Edit', exact: true }).click();
  return page.getByRole('dialog');
}

function expectHistoryPreserved(after: DemoDb, before: DemoDb) {
  expect(after.sessions.filter(session => session.status === 'completed')).toEqual(before.sessions.filter(session => session.status === 'completed'));
  expect(after.logs).toEqual(before.logs);
}

test('recorded routine weights remain visible and survive a name/rest edit while unconfirmed workout weights stay blocked', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const cloudRequests = await seed(page);
  const before = await readDb(page);
  await expect(card(page).getByRole('region', { name: 'Recorded weight reference', exact: true })).toContainText('30 lb');
  const dialog = await editExercise(page);
  await expect(dialog.getByLabel('Weight (lb)', { exact: true })).toHaveValue('30');
  await dialog.getByRole('button', { name: 'Use recorded weights with this convention', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('region', { name: 'Recorded weight reference', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('recorded-weight-reference-320.png'), animations: 'disabled' });
  const renamed = 'Renamed retained press';
  const name = dialog.getByRole('combobox', { name: 'Exercise name', exact: true });
  await name.fill(renamed);
  await name.press('Escape');
  await dialog.getByLabel('Rest (sec)', { exact: true }).fill('90');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const edited = await readDb(page);
  expect(exercise(edited)).toMatchObject({ name: renamed, rest_sec: 90, load_basis: 'total', load_basis_review_required: true });
  expect(exercise(edited).set_defaults).toEqual(RAW_DEFAULTS);
  expect(exercise(edited).targets_revision).toBe(exercise(before).targets_revision);
  expectHistoryPreserved(edited, before);
  await expect(card(page, renamed).getByRole('region', { name: 'Recorded weight reference', exact: true })).toContainText('30 lb');
  const changedBasis = await editExercise(page, renamed);
  await changedBasis.getByRole('radio', { name: 'Weight per dumbbell', exact: true }).check();
  await changedBasis.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(changedBasis).toBeHidden();
  const stillBlocked = await readDb(page);
  expect(exercise(stillBlocked).load_basis_review_required).toBe(true);
  expect(exercise(stillBlocked).set_defaults).toEqual(RAW_DEFAULTS);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  const active = page.getByRole('region', { name: renamed, exact: true });
  for (const weight of await active.getByLabel('lb', { exact: true }).all()) await expect(weight).toHaveValue('0');
  expectHistoryPreserved(await readDb(page), before);
  expect(cloudRequests).toEqual([]);
});

test('explicitly confirming another weight convention reuses exact recorded numbers without a dumbbell multiplier or unit change', async ({ page }) => {
  const cloudRequests = await seed(page);
  const before = await readDb(page);
  const dialog = await editExercise(page);
  await dialog.getByRole('radio', { name: 'Weight per dumbbell', exact: true }).check();
  await expect(dialog.getByLabel('Weight (lb)', { exact: true })).toHaveValue('30');
  await dialog.getByRole('button', { name: 'Use recorded weights with this convention', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const confirmed = await readDb(page);
  expect(exercise(confirmed)).toMatchObject({ load_basis: 'per_dumbbell', load_basis_review_required: false,
    weight_unit: 'lb', weight_unit_override: true });
  expect(exercise(confirmed).set_defaults).toEqual(RAW_DEFAULTS);
  expectHistoryPreserved(confirmed, before);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  const active = page.getByRole('region', { name: NAME, exact: true });
  await expect(active.getByLabel('lb', { exact: true }).nth(0)).toHaveValue('30');
  await expect(active.getByLabel('lb', { exact: true }).nth(1)).toHaveValue('25');
  const started = (await readDb(page)).sessions.find(session => session.status === 'active')!;
  expect(started.exercises[0].sets).toEqual(RAW_DEFAULTS.map(set => ({ ...set, done: false })));
  expectHistoryPreserved(await readDb(page), before);
  expect(cloudRequests).toEqual([]);
});

test('historical-only recorded weights stay a reference and are not adopted by an unrelated routine edit', async ({ page }) => {
  const cloudRequests = await seed(page, 'historical-only');
  const before = await readDb(page);
  await expect(card(page).getByRole('region', { name: 'Recorded weight reference', exact: true })).toContainText('40 lb');
  const dialog = await editExercise(page);
  await expect(dialog.getByLabel('Weight (lb)', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Rest (sec)', { exact: true }).fill('90');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = await readDb(page);
  expect(exercise(after).set_defaults).toBeUndefined();
  expect(exercise(after).weight_kg).toBeUndefined();
  expect(exercise(after).load_basis_review_required).toBe(true);
  expectHistoryPreserved(after, before);
  expect(cloudRequests).toEqual([]);
});

test('adopting a historical-only reference requires confirmation and preserves today’s reps and the source unit', async ({ page }) => {
  const cloudRequests = await seed(page, 'historical-only');
  const before = await readDb(page);
  const dialog = await editExercise(page);
  await expect(dialog.getByLabel('Weight (lb)', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Use recorded weights with this convention', exact: true }).click();
  await expect(dialog.getByLabel('Weight (lb)', { exact: true })).toHaveValue('40');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const confirmed = await readDb(page);
  const expected = [{ reps: 12, weight_kg: 18.1436948 }, { reps: 12, weight_kg: 15.87573295 }];
  expect(exercise(confirmed)).toMatchObject({ load_basis: 'per_dumbbell', load_basis_review_required: false,
    weight_unit: 'lb', weight_unit_override: true, set_defaults: expected });
  expectHistoryPreserved(confirmed, before);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  const active = page.getByRole('region', { name: NAME, exact: true });
  await expect(active.getByLabel('lb', { exact: true }).nth(0)).toHaveValue('40');
  await expect(active.getByLabel('lb', { exact: true }).nth(1)).toHaveValue('35');
  for (const input of await active.getByLabel('Reps', { exact: true }).all()) await expect(input).toHaveValue('12');
  expectHistoryPreserved(await readDb(page), before);
  expect(cloudRequests).toEqual([]);
});

test('entering a new working weight resolves review when no recorded reference exists', async ({ page }) => {
  const cloudRequests = await seed(page, 'historical-only');
  const unrecorded = 'Unrecorded machine press';
  await page.evaluate(name => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.routines[0].exercises[0] = { ...db.routines[0].exercises[0], id: 'unrecorded-machine', name, load_basis: 'machine_display' };
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, unrecorded);
  await page.reload();
  const before = await readDb(page);
  const dialog = await editExercise(page, unrecorded);
  await expect(dialog.getByRole('button', { name: 'Use recorded weights with this convention', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('region', { name: 'Recorded weight reference', exact: true })).toHaveCount(0);
  await dialog.getByLabel('Weight (lb)', { exact: true }).fill('22');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = await readDb(page);
  expect(exercise(after)).toMatchObject({ load_basis: 'machine_display', load_basis_review_required: false, load_basis_confirmed: true });
  expect(exercise(after).set_defaults).toEqual(Array.from({ length: 2 }, () => ({ reps: 12, weight_kg: 22 * 0.45359237 })));
  expectHistoryPreserved(after, before);
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await page.waitForURL('**/session/**');
  const active = page.getByRole('region', { name: unrecorded, exact: true });
  for (const weight of await active.getByLabel('lb', { exact: true }).all()) await expect(weight).toHaveValue('22');
  expectHistoryPreserved(await readDb(page), before);
  expect(cloudRequests).toEqual([]);
});

test('classifying an active exercise updates same-revision future defaults and discarding restores the original convention and values', async ({ page }) => {
  const cloudRequests = await seed(page, 'active');
  const before = await readDb(page);
  const original = before.sessions.find(session => session.id === SESSION_ID)!;
  const active = page.getByRole('region', { name: NAME, exact: true });
  await revealTrainingOptions(page);
  await active.getByRole('radio', { name: 'Weight per dumbbell', exact: true }).check();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  const saved = await readDb(page);
  expect(exercise(saved)).toMatchObject({ load_basis: 'per_dumbbell', weight_unit: 'lb', weight_unit_override: true,
    targets_revision: 'current-target', defaults_session_id: SESSION_ID,
    set_defaults: original.exercises[0].sets.map(({ reps, weight_kg }) => ({ reps, weight_kg })) });
  expect(saved.sessions.find(session => session.id === SESSION_ID)!.exercises[0].sets).toEqual(original.exercises[0].sets);
  expect(resolveExerciseDefaults(saved.routines[0], 0, saved.sessions).sets).toEqual(original.exercises[0].sets.map(set => ({ ...set, done: false })));
  expectHistoryPreserved(saved, before);
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Cancel workout', exact: true }).click();
  await page.getByRole('dialog', { name: 'Cancel this workout?', exact: true })
    .getByRole('button', { name: 'Discard workout', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/routines/${ROUTINE_ID}`));
  const discarded = await readDb(page);
  expect(exercise(discarded)).toEqual(exercise(before));
  expect(discarded.sessions.find(session => session.id === SESSION_ID)).toBeUndefined();
  expectHistoryPreserved(discarded, before);
  expect(cloudRequests).toEqual([]);
});

test('new custom exercises default to machine display while an existing explicit dumbbell convention stays selected', async ({ page }) => {
  const cloudRequests = await seed(page, 'historical-only');
  const before = await readDb(page);
  const existing = await editExercise(page);
  await revealTrainingOptions(page);
  await expect(existing.getByRole('radio', { name: 'Weight per dumbbell', exact: true })).toBeChecked();
  await existing.getByRole('button', { name: 'Cancel', exact: true }).click();
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await page.getByRole('button', { name: 'Add custom exercise', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: 'Weight shown on the machine', exact: true })).toBeChecked();
  const name = dialog.getByRole('combobox', { name: 'Exercise name', exact: true });
  await name.fill('My custom cable station');
  await name.press('Escape');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = await readDb(page);
  expect(after.routines[0].exercises[1]).toMatchObject({ name: 'My custom cable station', load_basis: 'machine_display' });
  expect(exercise(after)).toEqual(exercise(before));
  expectHistoryPreserved(after, before);
  expect(cloudRequests).toEqual([]);
});

test('recorded references stay immutable, stale target revisions cannot update defaults, and recognized new exercises keep their convention', () => {
  const { routine, history, active } = fixture();
  const before = structuredClone({ routine, history, active });
  const recorded = findRecordedExerciseReference(routine, 0, [history]);
  expect(recorded).toMatchObject({ source: 'current', sets: RAW_DEFAULTS, weight_unit: 'lb' });
  expect(resolveExerciseDefaults(routine, 0, [history]).sets.map(set => set.weight_kg)).toEqual([0, 0]);
  const stale = { ...active, exercises: [classifyRecordedLoad({ ...active.exercises[0], targets_revision: 'stale-target' }, 'per_dumbbell')] };
  expect(carrySessionDefaults(routine, stale)).toBeNull();
  expect(suggestedLoadBasis({ name: 'My custom cable station' })).toBe('machine_display');
  expect(suggestedLoadBasis({ name: 'Dumbbell Lateral Raise', equipment: 'dumbbell' })).toBe('per_dumbbell');
  expect(suggestedLoadBasis({ name: 'Barbell Squat', equipment: 'barbell' })).toBe('total');
  expect({ routine, history, active }).toEqual(before);
  const historicalOnly = fixture('historical-only');
  historicalOnly.history.exercises[0].sets.push({ reps: 0, weight_kg: 0, done: false });
  const historicalBefore = structuredClone(historicalOnly);
  const historicalReference = findRecordedExerciseReference(historicalOnly.routine, 0, [historicalOnly.history]);
  expect(historicalReference).toMatchObject({ source: 'history', sets: [
    { reps: 10, weight_kg: 18.1436948 }, { reps: 9, weight_kg: 15.87573295 },
  ] });
  expect(historicalOnly).toEqual(historicalBefore);
});

test('confirming an unchanged active convention carries its metadata immediately even when its saved numeric defaults already match', () => {
  const { routine, active } = fixture('active');
  const values = active.exercises[0].sets.map(({ reps, weight_kg }) => ({ reps, weight_kg }));
  routine.exercises[0] = { ...routine.exercises[0], set_defaults: values, defaults_session_id: active.id,
    load_basis_review_required: true, load_basis_confirmed: false };
  active.exercises[0] = { ...active.exercises[0], load_basis_review_required: true, load_basis_confirmed: false };
  const before = structuredClone({ routine, active });
  const classified = classifyRecordedLoad(active.exercises[0], 'total');
  expect(classified.sets).toEqual(active.exercises[0].sets);
  expect(exerciseTargetsChanged(active.exercises, [classified])).toBe(true);
  const changed = exercisesWithChangedDefaults(active.exercises, [classified]);
  expect(changed[0].routine_defaults_excluded).not.toBe(true);
  const patch = carrySessionDefaults(routine, { ...active, exercises: changed });
  expect(patch).not.toBeNull();
  expect(patch!.exercises![0]).toMatchObject({ load_basis: 'total', load_basis_confirmed: true, load_basis_review_required: false,
    load_basis_note: classified.load_basis_note, targets_revision: 'current-target', defaults_session_id: active.id,
    set_defaults: values });
  const withBackup = { ...active, ...rememberSessionDefaults(routine, active, 2_000) };
  const rollback = rollbackSessionDefaults({ ...routine, ...patch, updated_at: 2_000 }, withBackup);
  expect(rollback!.defaults.exercises![0]).toEqual(routine.exercises[0]);
  expect({ routine, active }).toEqual(before);
});
