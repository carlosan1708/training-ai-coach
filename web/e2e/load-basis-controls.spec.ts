import { expect, test, type Page } from '@playwright/test';
import { enterDemo, revealTrainingOptions } from './helpers';
import type { DemoDb } from '../src/demo/db';

const readDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);

async function seed(page: Page, language: string) {
  await enterDemo(page);
  await page.evaluate(language => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.profile.ui_language = language;
    db.profile.workout_weight_unit = 'lb';
    db.routines = [{ id: 'conventions', name: 'Synthetic conventions', exercises: [{ id: 'raise', name: 'Dumbbell lateral raise',
      sets: 3, reps: 12, weight_kg: 10, load_basis: 'per_dumbbell', targets_revision: 'current-target' }] }];
    const exercise = { name: 'Dumbbell lateral raise', routine_exercise_id: 'raise', weight_unit: 'kg' as const,
      target_sets: 3, target_reps: 12, target_weight_kg: 20, targets_revision: 'older-target', notes: 'Keep exercise notes',
      sets: [{ weight_kg: 20, reps: 12, done: true }, { weight_kg: 17.5, reps: 10, done: true }] };
    db.sessions = [
      { id: 'recorded', routine_id: 'conventions', routine_name: 'Synthetic conventions', date: '2020-01-02', status: 'completed',
        started_at: 1578000000000, completed_at: 1578004800000, notes: 'Keep workout notes', exercises: [exercise] },
      { id: 'older', routine_id: 'conventions', routine_name: 'Synthetic conventions', date: '2020-01-01', status: 'completed',
        exercises: [{ ...exercise, load_basis: 'total' }] },
      { id: 'draft', routine_id: 'conventions', routine_name: 'Synthetic conventions', date: '2020-01-03', status: 'active',
        exercises: [{ ...exercise, load_basis: 'per_dumbbell', sets: [exercise.sets[0], { ...exercise.sets[1], done: false }] }] },
    ];
    db.logs = { '2020-01-02': { date: '2020-01-02', weight_kg: 75, notes: 'Keep daily notes', measurements: { waist_cm: 80 },
      exercise_log: [{ exercise: exercise.name, sets: 2, reps: 11, weight_kg: 20, workout_session_id: 'recorded' },
        { exercise: 'Walk', duration_min: 20, notes: 'Manual entry' }] } };
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
    localStorage.setItem('ui_language', language);
  }, language);
}

for (const language of ['en', 'es']) for (const width of [360, 1280]) {
  test(`historical load choices classify only the saved exercise in ${language} at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page, language);
    const before = await readDb(page);
    const edit = language === 'es' ? 'Editar entrenamiento' : 'Edit workout';
    const total = language === 'es' ? 'Peso total' : 'Total weight';
    const perDumbbell = language === 'es' ? 'Peso por mancuerna' : 'Weight per dumbbell';
    const clear = language === 'es' ? 'Dejar sin confirmar' : 'Leave unconfirmed';
    await page.goto('/workout-history?session=recorded');
    await page.getByTestId('session-recorded').getByRole('button', { name: edit, exact: true }).click();
    const editor = page.getByRole('dialog', { name: edit, exact: true });
    const group = editor.getByRole('radiogroup');
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(0);
    await revealTrainingOptions(page);
    await group.getByRole('radio', { name: total, exact: true }).check();
    await editor.getByRole('button', { name: language === 'es' ? 'Cancelar' : 'Cancel', exact: true }).click();
    await expect(editor).not.toBeVisible();
    expect(await readDb(page)).toEqual(before);

    await page.getByTestId('session-recorded').getByRole('button', { name: edit, exact: true }).click();
    await revealTrainingOptions(page);
    await group.getByRole('radio', { name: total, exact: true }).check();
    await editor.getByRole('button', { name: clear, exact: true }).click();
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(0);
    await revealTrainingOptions(page);
    await group.getByRole('radio', { name: perDumbbell, exact: true }).check();
    expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`historical-load-choice-${language}-${width}.png`), animations: 'disabled' });
    await editor.getByRole('button', { name: language === 'es' ? 'Guardar cambios' : 'Save changes', exact: true }).click();
    await expect(editor).not.toBeVisible();
    const after = await readDb(page);
    const original = before.sessions.find(session => session.id === 'recorded')!;
    const saved = after.sessions.find(session => session.id === 'recorded')!;
    expect(saved).toMatchObject({ id: original.id, routine_id: original.routine_id, date: original.date,
      started_at: original.started_at, completed_at: original.completed_at, status: 'completed', notes: original.notes });
    expect(saved.exercises[0]).toMatchObject({ ...original.exercises[0], load_basis: 'per_dumbbell', load_basis_review_required: false });
    expect(after.routines[0].exercises).toEqual(before.routines[0].exercises);
    expect(after.sessions.filter(session => session.id !== 'recorded')).toEqual(before.sessions.filter(session => session.id !== 'recorded'));
    const log = after.logs['2020-01-02'];
    expect(log).toMatchObject({ weight_kg: 75, notes: 'Keep daily notes', measurements: { waist_cm: 80 } });
    expect(log.exercise_log!.filter(entry => !entry.workout_session_id)).toEqual(before.logs['2020-01-02'].exercise_log!.filter(entry => !entry.workout_session_id));
    expect(log.exercise_log!.filter(entry => entry.workout_session_id === 'recorded')).toHaveLength(1);
    expect(log.exercise_log!.find(entry => entry.workout_session_id === 'recorded')!.load_basis).toBe('per_dumbbell');
    await page.goto('/routines/conventions?view=progress');
    const progress = page.getByRole('region', { name: language === 'es' ? 'Repeticiones por serie' : 'Repetitions per set', exact: true });
    await expect(progress.getByTestId('load-basis-guidance').getByText(perDumbbell, { exact: true })).toBeVisible();
    await expect(progress.getByText(language === 'es' ? /Los criterios de peso difieren/ : /Weight conventions differ/)).toBeVisible();
    expect((await readDb(page)).sessions).toEqual(after.sessions);
    await page.goto('/workout-history?session=recorded');
    await page.getByTestId('session-recorded').getByRole('button', { name: edit, exact: true }).click();
    await revealTrainingOptions(page);
    await expect(group.getByRole('radio', { name: perDumbbell, exact: true })).toBeChecked();
    // Clearing a known saved choice must also persist through a save/reload.
    await editor.getByRole('button', { name: clear, exact: true }).click();
    await editor.getByRole('button', { name: language === 'es' ? 'Guardar cambios' : 'Save changes', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.reload();
    const cleared = await readDb(page);
    expect(cleared.sessions.find(session => session.id === 'recorded')!.exercises[0].load_basis).toBeUndefined();
    expect(cleared.sessions.find(session => session.id === 'recorded')!.exercises[0].sets).toEqual(original.exercises[0].sets);
    expect(cleared.logs['2020-01-02'].exercise_log!.find(entry => entry.workout_session_id === 'recorded')!.load_basis).toBeUndefined();
  });
}

test('active choices autosave without converting completed sets or rewriting the template or other sessions', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await seed(page, 'en');
  const before = await readDb(page);
  await page.goto('/routines/conventions/session/draft');
  const card = page.getByRole('region', { name: 'Dumbbell lateral raise', exact: true });
  await revealTrainingOptions(page);
  await card.getByRole('radio', { name: 'Total weight', exact: true }).check();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await revealTrainingOptions(page);
  await expect(card.getByRole('radio', { name: 'Total weight', exact: true })).toBeChecked();
  const after = await readDb(page);
  const original = before.sessions.find(session => session.id === 'draft')!;
  const saved = after.sessions.find(session => session.id === 'draft')!;
  expect(saved.exercises[0]).toMatchObject({ ...original.exercises[0], load_basis: 'total' });
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
  expect(after.sessions.filter(session => session.id !== 'draft')).toEqual(before.sessions.filter(session => session.id !== 'draft'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('routine choices change future prescriptions while preserving historical and active snapshots', async ({ page }) => {
  await seed(page, 'en');
  const before = await readDb(page);
  await page.goto('/routines/conventions');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: 'Weight per dumbbell', exact: true })).toBeChecked();
  await dialog.getByRole('radio', { name: 'Total weight', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const after = await readDb(page);
  expect(after.routines[0].exercises[0]).toMatchObject({ id: 'raise', load_basis: 'total', load_basis_review_required: true });
  expect(after.routines[0].exercises[0].targets_revision).not.toBe('current-target');
  expect(after.sessions).toEqual(before.sessions);
  expect(after.logs).toEqual(before.logs);
});

test('generated exercises retain the AI recording convention when saved', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/routines');
  await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Generate', exact: true }).click();
  await page.waitForURL(/\/routines\/[^/]+$/);
  const db = await readDb(page);
  const generated = db.routines.find(routine => routine.name === 'AI Full Body Express')!;
  expect(generated.exercises.find(exercise => exercise.name === 'Barbell Squat')!.load_basis).toBe('total');
  expect(generated.exercises.find(exercise => exercise.name === 'Plank')!.load_basis).toBeUndefined();
  await expect(page.getByTestId('load-basis-guidance').filter({ hasText: 'Total weight' }).first()).toBeVisible();
});
