import { test, expect, type Page } from '@playwright/test';
import { enterDemo, revealTrainingOptions } from './helpers';

test.use({ hasTouch: true, viewport: { width: 320, height: 740 } });

async function seedEditableWorkouts(page: Page) {
  await enterDemo(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.profile.units = 'metric';
    const exercise = { name: 'Bench Press', routine_exercise_id: 'bench', target_sets: 2, target_reps: 10,
      weight_unit: 'kg', sets: [{ reps: 10, weight_kg: 20, done: true }, { reps: 8, weight_kg: 25, done: true }] };
    db.routines = [{ id: 'editable-routine', name: 'Saved working routine', session_count: 2, last_session_at: '2026-10-15',
      exercises: [{ id: 'bench', name: 'Bench Press', sets: 2, reps: 12, weight_kg: 35,
        weight_unit: 'kg', set_defaults: [{ reps: 12, weight_kg: 35 }, { reps: 11, weight_kg: 35 }] }] }];
    db.sessions = [
      { id: 'edit-completed', routine_id: 'editable-routine', routine_name: 'Original upper workout',
        day_id: 'upper', day_name: 'Upper A', date: '2026-10-15', status: 'completed', notes: 'Original notes',
        started_at: new Date('2026-10-15T17:00:00').getTime(), completed_at: new Date('2026-10-15T18:00:00').getTime(),
        duration_min: 60, duration_sec: 3600, exercises: [exercise] },
      { id: 'edit-legacy', routine_id: 'editable-routine', routine_name: 'Legacy workout', date: '2026-10-13',
        status: 'completed', exercises: [{ ...exercise, sets: [{ reps: 10, weight_kg: 20, done: true }] }] },
      { id: 'unrelated-workout', routine_id: 'deleted-routine', routine_name: 'Independent workout', date: '2026-10-14',
        status: 'completed', exercises: [{ ...exercise, name: 'Row' }] },
    ];
    db.logs = {
      '2026-10-15': { date: '2026-10-15', weight_kg: 75, measurements: { waist_cm: 80 }, notes: 'Keep this note',
        exercise_log: [
          { exercise: 'Bench Press', sets: 2, reps: 9, weight_kg: 25, weight_unit: 'kg', workout_session_id: 'edit-completed' },
          { exercise: 'Manual walking', duration_min: 20, notes: 'Independent manual entry' },
        ] },
      '2026-10-16': { date: '2026-10-16', weight_kg: 74.8,
        exercise_log: [{ exercise: 'Morning cycling', duration_min: 15 }] },
    };
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.goto('/workout-history?session=edit-completed');
  await expect(page.getByRole('table', { name: 'Completed sets for Bench Press', exact: true })).toBeVisible();
}

const readDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));

test('edits historical details, exact times, completed sets and pounds without changing future targets', async ({ page }) => {
  await seedEditableWorkouts(page);
  const before = await readDb(page);
  await revealTrainingOptions(page);
  await page.getByTestId('session-edit-completed').getByRole('button', { name: 'Edit workout', exact: true }).tap();
  const editor = page.getByRole('dialog', { name: 'Edit workout', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: 'Workout name', exact: true }).fill('Corrected upper workout');
  await editor.getByLabel('Day name', { exact: true }).fill('Upper corrected');
  await editor.getByLabel('Workout date', { exact: true }).fill('2026-10-16');
  await editor.getByLabel('Started at', { exact: true }).fill('2026-10-16T17:00');
  await editor.getByLabel('Completed at', { exact: true }).fill('2026-10-16T18:05:30');
  await expect(editor.getByTestId('editor-duration')).toHaveText('Duration: 1:05:30');
  await editor.getByLabel('Workout notes', { exact: true }).fill('Corrected after training');
  const first = editor.getByRole('region', { name: 'Exercise 1', exact: true });
  await first.getByRole('combobox', { name: 'Exercise name', exact: true }).fill('Incline Bench Press');
  await revealTrainingOptions(page);
  await first.getByRole('button', { name: 'Remove set 2', exact: true }).tap();
  const firstSet = first.getByRole('region', { name: 'Set 1', exact: true });
  await firstSet.getByRole('button', { name: 'lb', exact: true }).tap();
  await firstSet.getByLabel('Weight (lb)', { exact: true }).fill('100');
  await firstSet.getByLabel('Reps', { exact: true }).fill('9');
  await first.getByRole('button', { name: 'Add set', exact: true }).tap();
  const secondSet = first.getByRole('region', { name: 'Set 2', exact: true });
  await secondSet.getByLabel('Reps', { exact: true }).fill('7');
  await secondSet.getByRole('checkbox', { name: 'Set completed', exact: true }).check();
  await editor.getByRole('button', { name: 'Add exercise', exact: true }).tap();
  const added = editor.getByRole('region', { name: 'Exercise 2', exact: true });
  await added.getByRole('combobox', { name: 'Exercise name', exact: true }).fill('Lateral Raise');
  await added.getByLabel('Reps', { exact: true }).fill('12');
  await added.getByLabel('Weight (kg)', { exact: true }).fill('5');
  await added.getByRole('checkbox', { name: 'Set completed', exact: true }).check();
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await editor.getByRole('textbox', { name: 'Workout name', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('workout-editor-mobile.png'), animations: 'disabled' });
  await editor.getByRole('button', { name: 'Save changes', exact: true }).tap();
  await expect(editor).not.toBeVisible();
  const db = await readDb(page);
  const saved = db.sessions.find((session: { id: string }) => session.id === 'edit-completed');
  expect(saved).toMatchObject({ routine_name: 'Corrected upper workout', day_name: 'Upper corrected',
    date: '2026-10-16', notes: 'Corrected after training', status: 'completed', duration_sec: 3930, duration_min: 66 });
  expect(saved.exercises).toHaveLength(2);
  expect(saved.exercises[0]).toMatchObject({ name: 'Incline Bench Press', weight_unit: 'lb', sets: [
    { reps: 9, weight_kg: 45.359237, done: true }, { reps: 7, weight_kg: 45.359237, done: true },
  ] });
  expect(db.routines[0].exercises).toEqual(before.routines[0].exercises);
  expect(db.routines[0].session_count).toBe(2);
  expect(db.routines[0].last_session_at).toBe('2026-10-16');
  expect(db.logs['2026-10-15']).toMatchObject({ weight_kg: 75, measurements: { waist_cm: 80 }, notes: 'Keep this note' });
  expect(db.logs['2026-10-15'].exercise_log).toEqual([{ exercise: 'Manual walking', duration_min: 20, notes: 'Independent manual entry' }]);
  expect(db.logs['2026-10-16'].weight_kg).toBe(74.8);
  expect(db.logs['2026-10-16'].exercise_log[0]).toEqual({ exercise: 'Morning cycling', duration_min: 15 });
  expect(db.logs['2026-10-16'].exercise_log.filter((entry: { workout_session_id?: string }) => entry.workout_session_id === saved.id)).toHaveLength(2);
  await page.reload();
  await revealTrainingOptions(page);
  await page.getByTestId('session-edit-completed').getByRole('button', { name: 'Edit workout', exact: true }).tap();
  await expect(editor.getByRole('textbox', { name: 'Workout name', exact: true })).toHaveValue('Corrected upper workout');
  await expect(editor.getByLabel('Completed at', { exact: true })).toHaveValue('2026-10-16T18:05:30');
});

test('cancels draft edits without changing the workout or its daily log', async ({ page }) => {
  await seedEditableWorkouts(page);
  const before = await readDb(page);
  await revealTrainingOptions(page);
  await page.getByTestId('session-edit-completed').getByRole('button', { name: 'Edit workout', exact: true }).tap();
  const editor = page.getByRole('dialog', { name: 'Edit workout', exact: true });
  await editor.getByRole('textbox', { name: 'Workout name', exact: true }).fill('Discard this draft');
  await editor.getByRole('button', { name: 'Remove exercise 1', exact: true }).tap();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(editor).not.toBeVisible();
  expect(await readDb(page)).toEqual(before);
  await revealTrainingOptions(page);
  await page.getByTestId('session-edit-completed').getByRole('button', { name: 'Edit workout', exact: true }).tap();
  await expect(editor.getByRole('textbox', { name: 'Workout name', exact: true })).toHaveValue('Original upper workout');
  await expect(editor.getByRole('region', { name: 'Exercise 1', exact: true })).toBeVisible();
});

test('flushes active autosaves before editing and keeps the corrected values through completion', async ({ page }) => {
  await seedEditableWorkouts(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    const session = db.sessions.find((session: { id: string }) => session.id === 'edit-completed');
    session.status = 'active';
    session.started_at = Date.now() - 600_000;
    delete session.completed_at;
    delete session.duration_min;
    delete session.duration_sec;
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.goto('/routines/editable-routine/session/edit-completed');
  await page.getByLabel('Reps', { exact: true }).first().fill('9');
  // Do not wait for the debounce: opening the editor must flush this change.
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Edit workout', exact: true }).tap();
  const editor = page.getByRole('dialog', { name: 'Edit workout', exact: true });
  await expect(editor.getByLabel('Reps', { exact: true }).first()).toHaveValue('9');
  await expect(editor.getByLabel('Completed at', { exact: true })).toHaveCount(0);
  await editor.getByLabel('Reps', { exact: true }).first().fill('13');
  await editor.getByLabel('Weight (kg)', { exact: true }).first().fill('60');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).tap();
  await expect(editor).not.toBeVisible();
  await expect(page.getByLabel('Reps', { exact: true }).first()).toHaveValue('13');
  const edited = await readDb(page);
  expect(edited.sessions.find((session: { id: string }) => session.id === 'edit-completed').exercises[0].sets[0])
    .toMatchObject({ reps: 13, weight_kg: 60 });
  expect(edited.routines[0].exercises[0].set_defaults[0]).toMatchObject({ reps: 13, weight_kg: 60 });
  await page.getByLabel('Reps', { exact: true }).first().fill('14');
  await page.getByRole('button', { name: 'Finish workout', exact: true }).tap();
  await expect(page).toHaveURL(/\/workout-history\?session=edit-completed&saved=1$/);
  const db = await readDb(page);
  const finished = db.sessions.find((session: { id: string }) => session.id === 'edit-completed');
  expect(finished.status).toBe('completed');
  expect(finished.exercises[0].sets[0]).toMatchObject({ reps: 14, weight_kg: 60 });
  expect(finished.duration_sec).toBeGreaterThanOrEqual(600);
  expect(db.routines[0].exercises[0].set_defaults[0]).toMatchObject({ reps: 14, weight_kg: 60 });
});

test('requires confirmation to delete and preserves manual logs, other workouts and routine defaults', async ({ page }) => {
  await seedEditableWorkouts(page);
  const before = await readDb(page);
  const session = page.getByTestId('session-edit-completed');
  await session.getByRole('button', { name: 'Delete workout', exact: true }).tap();
  const confirm = page.getByRole('dialog', { name: 'Delete this workout?', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).tap();
  expect(await readDb(page)).toEqual(before);
  await session.getByRole('button', { name: 'Delete workout', exact: true }).tap();
  await confirm.getByRole('button', { name: 'Delete workout', exact: true }).tap();
  await expect(session).toHaveCount(0);
  const db = await readDb(page);
  expect(db.sessions).toEqual(before.sessions.filter((session: { id: string }) => session.id !== 'edit-completed'));
  expect(db.routines[0].session_count).toBe(1);
  expect(db.routines[0].last_session_at).toBe('2026-10-13');
  expect(db.routines[0].exercises).toEqual(before.routines[0].exercises);
  expect(db.logs['2026-10-15']).toMatchObject({ weight_kg: 75, measurements: { waist_cm: 80 }, notes: 'Keep this note' });
  expect(db.logs['2026-10-15'].exercise_log).toEqual([{ exercise: 'Manual walking', duration_min: 20, notes: 'Independent manual entry' }]);
  expect(db.logs['2026-10-16']).toEqual(before.logs['2026-10-16']);
  await page.reload();
  await expect(session).toHaveCount(0);
});

for (const concurrentRoutineEdit of [false, true]) {
  test(`discards an explicitly edited active workout ${concurrentRoutineEdit ? 'while preserving newer routine targets' : 'and restores its original routine defaults'}`, async ({ page }) => {
    await seedEditableWorkouts(page);
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
      const session = db.sessions.find((saved: { id: string }) => saved.id === 'edit-completed');
      session.status = 'active';
      delete session.completed_at;
      delete session.duration_min;
      delete session.duration_sec;
      localStorage.setItem('tac_demo_db', JSON.stringify(db));
    });
    const before = await readDb(page);
    await page.goto('/routines/editable-routine/session/edit-completed');
    await revealTrainingOptions(page);
    await page.getByRole('button', { name: 'Edit workout', exact: true }).tap();
    const editor = page.getByRole('dialog', { name: 'Edit workout', exact: true });
    await editor.getByLabel('Reps', { exact: true }).first().fill('13');
    await editor.getByLabel('Weight (kg)', { exact: true }).first().fill('60');
    await editor.getByRole('button', { name: 'Save changes', exact: true }).tap();
    await expect(editor).not.toBeVisible();
    expect((await readDb(page)).routines[0].exercises[0].set_defaults[0].weight_kg).toBe(60);
    if (concurrentRoutineEdit) {
      // A second client deliberately changes the prescription after the draft saved.
      await page.evaluate(() => {
        const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
        db.routines[0].name = 'Changed on another device';
        db.routines[0].updated_at = Date.now() + 1;
        db.routines[0].exercises[0] = { ...db.routines[0].exercises[0], targets_revision: 'other-device',
          reps: 15, weight_kg: 70, set_defaults: [{ reps: 15, weight_kg: 70 }, { reps: 15, weight_kg: 70 }] };
        localStorage.setItem('tac_demo_db', JSON.stringify(db));
      });
    }
    const expectedRoutines = concurrentRoutineEdit ? (await readDb(page)).routines : before.routines;
    await revealTrainingOptions(page);
    await page.getByRole('button', { name: 'Cancel workout', exact: true }).tap();
    await page.getByRole('dialog', { name: 'Cancel this workout?', exact: true })
      .getByRole('button', { name: 'Discard workout', exact: true }).tap();
    await expect(page).toHaveURL('/routines/editable-routine');
    const after = await readDb(page);
    expect(after.routines).toEqual(expectedRoutines);
    expect(after.sessions).toEqual(before.sessions.filter((saved: { id: string }) => saved.id !== 'edit-completed'));
    expect(after.logs).toEqual(before.logs);
  });
}

test('keeps unknown legacy times empty and blocks invalid chronology, names and sets', async ({ page }) => {
  await seedEditableWorkouts(page);
  await page.goto('/workout-history?session=edit-legacy');
  await revealTrainingOptions(page);
  await page.getByTestId('session-edit-legacy').getByRole('button', { name: 'Edit workout', exact: true }).tap();
  const editor = page.getByRole('dialog', { name: 'Edit workout', exact: true });
  await expect(editor.getByLabel('Started at', { exact: true })).toHaveValue('');
  await expect(editor.getByLabel('Completed at', { exact: true })).toHaveValue('');
  await expect(editor.getByTestId('editor-duration')).toHaveText('Duration: Not recorded');
  await editor.getByRole('textbox', { name: 'Workout name', exact: true }).fill('');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).tap();
  await expect(editor.getByText('Enter a workout name and a name for each exercise.', { exact: true })).toBeVisible();
  await editor.getByRole('textbox', { name: 'Workout name', exact: true }).fill('Corrected legacy workout');
  await editor.getByLabel('Started at', { exact: true }).fill('2026-10-13T18:00');
  await expect(editor.getByText('Add both start and completion times to calculate the duration.', { exact: true })).toBeVisible();
  await editor.getByLabel('Completed at', { exact: true }).fill('2026-10-13T17:00');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).tap();
  await expect(editor.getByText('Completion must be at or after the start time.', { exact: true }).first()).toBeVisible();
  await editor.getByLabel('Started at', { exact: true }).fill('');
  await editor.getByLabel('Completed at', { exact: true }).fill('');
  await editor.getByLabel('Reps', { exact: true }).fill('2.5');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).tap();
  await expect(editor.getByText('Every exercise needs at least one set.', { exact: false })).toBeVisible();
  await editor.getByLabel('Reps', { exact: true }).fill('11');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).tap();
  await expect(editor).not.toBeVisible();
  const saved = (await readDb(page)).sessions.find((session: { id: string }) => session.id === 'edit-legacy');
  expect(saved.started_at).toBeNull();
  expect(saved.completed_at).toBeNull();
  expect(saved.duration_sec).toBeUndefined();
  expect(saved.exercises[0].sets[0].reps).toBe(11);
});

test('supports adding and removing exercises in Spanish mobile landscape without overflow', async ({ page }) => {
  await seedEditableWorkouts(page);
  await page.getByRole('button', { name: 'Language', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Español', exact: true }).tap();
  await page.getByTestId('session-edit-completed').getByRole('button', { name: 'Editar entrenamiento', exact: true }).tap();
  const editor = page.getByRole('dialog', { name: 'Editar entrenamiento', exact: true });
  await expect(editor.getByRole('textbox', { name: 'Nombre del entrenamiento', exact: true })).toBeVisible();
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 844, height: 390 });
  await editor.getByRole('button', { name: 'Añadir ejercicio', exact: true }).tap();
  const added = editor.getByRole('region', { name: 'Ejercicio 2', exact: true });
  await added.getByRole('combobox', { name: 'Nombre del ejercicio', exact: true }).fill('Curl');
  await added.getByRole('combobox', { name: 'Nombre del ejercicio', exact: true }).press('Escape');
  await revealTrainingOptions(page);
  await added.getByRole('button', { name: 'Eliminar serie 1', exact: true }).tap();
  await expect(added.getByText('No hay series. Añade una antes de guardar.', { exact: true })).toBeVisible();
  await added.getByRole('button', { name: 'Añadir serie', exact: true }).tap();
  await expect(added.getByRole('region', { name: 'Serie 1', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Eliminar ejercicio 2', exact: true }).tap();
  await expect(editor.getByRole('region', { name: 'Ejercicio 2', exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Guardar cambios', exact: true }).tap();
  await expect(editor).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
