import { test, expect, type Page } from '@playwright/test';
import { carryExerciseNotes } from '../src/lib/exerciseDefaults';
import type { Routine, WorkoutSession } from '../src/types/routine';
import type { DemoDb } from '../src/demo/db';
import { enterDemo, revealTrainingOptions } from './helpers';

test.use({ timezoneId: 'America/Costa_Rica', viewport: { width: 420, height: 850 } });

const ROUTINE_ID = 'workout-tools-plan';
const SESSION_ID = 'workout-tools-active';
const SESSION_PATH = `/routines/${ROUTINE_ID}/session/${SESSION_ID}`;

async function openToolsSession(page: Page, status: 'active' | 'completed' = 'active', restSeconds: number | null = 60) {
  const aiRequests: string[] = [];
  // The demo must remain offline even if an accidental paid request is introduced.
  await page.route(/plan_workout_session|cloudfunctions\.net|\.a\.run\.app|api\.openai\.com|generativelanguage\.googleapis\.com/, route => {
    aiRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.clock.install({ time: new Date('2026-10-18T15:59:00Z') });
  await enterDemo(page);
  await page.evaluate(({ routineId, sessionId, status, restSeconds }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.profile.workout_weight_unit = 'kg';
    db.routines = [{
      id: routineId, name: 'Workout tools plan', session_count: 1, last_session_at: '2026-10-16',
      exercises: [{
        id: 'bench-exercise', name: 'Bench Press', sets: 3, reps: 10, weight_kg: 60,
        weight_unit: 'kg', weight_unit_override: true, targets_revision: 'bench-prescription',
        ...(restSeconds !== null ? { rest_sec: restSeconds } : {}),
      }],
    }];
    db.sessions = [{
      id: 'workout-tools-history', routine_id: routineId, routine_name: 'Workout tools plan',
      date: '2026-10-16', status: 'completed', started_at: Date.now() - 172_860_000,
      completed_at: Date.now() - 172_800_000,
      exercises: [{
        name: 'Bench Press', routine_exercise_id: 'bench-exercise', routine_exercise_index: 0,
        targets_revision: 'bench-prescription', target_sets: 1, target_reps: 10, target_weight_kg: 55,
        sets: [{ weight_kg: 55, reps: 10, done: true }],
      }],
    }, {
      id: sessionId, routine_id: routineId, routine_name: 'Workout tools plan',
      date: '2026-10-18', status, started_at: Date.now() - 300_000,
      ...(status === 'completed' ? { completed_at: Date.now() - 60_000 } : {}),
      exercises: [{
        name: 'Bench Press', routine_exercise_id: 'bench-exercise', routine_exercise_index: 0,
        targets_revision: 'bench-prescription', weight_unit: 'kg', weight_unit_override: true,
        target_sets: 3, target_reps: 10, target_weight_kg: 60,
        ...(restSeconds !== null ? { rest_sec: restSeconds } : {}),
        sets: [
          { weight_kg: 60, reps: 10, done: true },
          { weight_kg: 57.5, reps: 9, done: false },
          { weight_kg: 55, reps: 8, done: false },
        ],
      }],
    }];
    localStorage.removeItem('tac_rest_timer_enabled');
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { routineId: ROUTINE_ID, sessionId: SESSION_ID, status, restSeconds });
  await page.goto(SESSION_PATH);
  await expect(page.getByRole('region', { name: 'Bench Press', exact: true })).toBeVisible();
  return aiRequests;
}

const readDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);
const pauseClock = async (page: Page) => page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1_000)));

test('the optional rest timer starts only after a newly completed set and supports pause, resume, completion and skip', async ({ page }) => {
  const aiRequests = await openToolsSession(page);
  await pauseClock(page);
  const before = await readDb(page);
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  const enabled = page.getByRole('switch', { name: 'Rest timer', exact: true });
  const timer = page.getByRole('timer', { name: 'Rest remaining', exact: true });
  const secondSet = bench.getByRole('checkbox', { name: 'Complete set 2 of Bench Press', exact: true });

  await expect(enabled).not.toBeChecked();
  await expect(timer).toHaveCount(0);
  await secondSet.check();
  await page.clock.runFor(1_000);
  await expect(timer).toHaveCount(0);
  await secondSet.uncheck();
  await page.clock.runFor(1_000);
  await enabled.check();
  await expect(timer).toHaveText('01:00');
  await expect(page.getByRole('button', { name: 'Start rest', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  await page.clock.runFor(5_000);
  await expect(timer).toHaveText('01:00');

  await secondSet.check();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.clock.runFor(10_000);
  await expect(timer).toHaveText('00:50');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.clock.runFor(20_000);
  await expect(timer).toHaveText('00:50');
  await page.screenshot({ path: test.info().outputPath('rest-timer-paused-mobile.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.clock.runFor(50_000);
  await expect(timer).toHaveText('00:00');
  await expect(page.getByText('Rest complete', { exact: true })).toBeVisible();

  await bench.getByRole('checkbox', { name: 'Complete set 3 of Bench Press', exact: true }).check();
  await expect(timer).toHaveText('01:00');
  await page.getByRole('button', { name: 'Skip rest', exact: true }).click();
  await expect(page.getByText('Rest skipped', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  await enabled.uncheck();
  await expect(timer).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('tac_rest_timer_enabled'))).toBe('false');
  await enabled.check();
  await page.clock.runFor(1_000);
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.clock.resume();
  await page.reload();
  await expect(enabled).toBeChecked();
  await expect(page.getByRole('button', { name: 'Start rest', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  const after = await readDb(page);
  expect(after.routines).toEqual(before.routines);
  expect(after.sessions.find(session => session.id === 'workout-tools-history'))
    .toEqual(before.sessions.find(session => session.id === 'workout-tools-history'));
  expect(after.sessions.find(session => session.id === SESSION_ID)!.exercises[0].sets.map(set => set.done)).toEqual([true, true, true]);
  expect(aiRequests).toEqual([]);
});

test('rest without an exercise prescription uses ninety seconds', async ({ page }) => {
  const aiRequests = await openToolsSession(page, 'active', null);
  await pauseClock(page);
  await page.getByRole('switch', { name: 'Rest timer', exact: true }).check();
  await page.getByRole('region', { name: 'Bench Press', exact: true })
    .getByRole('checkbox', { name: 'Complete set 2 of Bench Press', exact: true }).check();
  const timer = page.getByRole('timer', { name: 'Rest remaining', exact: true });
  await expect(timer).toHaveText('01:30');
  await page.clock.runFor(90_000);
  await expect(timer).toHaveText('00:00');
  await expect(page.getByText('Rest complete', { exact: true })).toBeVisible();
  expect((await readDb(page)).routines[0].exercises[0].rest_sec).toBeUndefined();
  expect(aiRequests).toEqual([]);
});

test('exercise suggestions require an explicit request and acceptance, preserve completed sets, and stay in this workout', async ({ page }) => {
  const aiRequests = await openToolsSession(page);
  const before = await readDb(page);
  const original = before.sessions.find(session => session.id === SESSION_ID)!.exercises[0];
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  await revealTrainingOptions(page);
  const substitute = bench.getByRole('button', { name: 'Find an alternative with AI', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Exercise alternatives', exact: true });

  await substitute.click();
  await expect(dialog.getByLabel('What would you like to change?', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Use this exercise', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Incline Push-Up', exact: true })).toHaveCount(0);
  await dialog.getByLabel('What would you like to change?', { exact: true }).fill('The bench is occupied; I have floor space.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.clock.runFor(300);
  await expect(dialog).toHaveCount(0);
  expect((await readDb(page)).sessions).toEqual(before.sessions);
  expect(aiRequests).toEqual([]);

  await substitute.click();
  await dialog.getByLabel('What would you like to change?', { exact: true }).fill('The bench is occupied; I have floor space.');
  await dialog.getByRole('button', { name: /^Suggest alternatives?$/ }).click();
  await page.clock.runFor(800);
  await expect(dialog.getByRole('heading', { name: 'Incline Push-Up', exact: true })).toBeVisible();
  await expect(dialog.getByText('2 sets × 9 reps', { exact: true })).toBeVisible();
  // Even a requested preview does not mutate the draft until it is accepted.
  expect((await readDb(page)).sessions).toEqual(before.sessions);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.clock.runFor(300);
  expect((await readDb(page)).sessions).toEqual(before.sessions);

  await substitute.click();
  await dialog.getByRole('button', { name: /^Suggest alternatives?$/ }).click();
  await page.clock.runFor(800);
  await expect(dialog.getByRole('heading', { name: 'Incline Push-Up', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('exercise-alternative-preview-mobile.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Use this exercise', exact: true }).click();
  await page.clock.runFor(1_000);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  const after = await readDb(page);
  const session = after.sessions.find(item => item.id === SESSION_ID)!;
  expect(session.exercises).toHaveLength(2);
  expect(session.exercises[0].name).toBe('Bench Press');
  expect(session.exercises[0].sets).toEqual(original.sets.filter(set => set.done));
  expect(session.exercises[0].routine_exercise_id).toBe(original.routine_exercise_id);
  expect(session.exercises[1]).toMatchObject({
    name: 'Incline Push-Up', target_sets: 2, target_reps: 9, target_weight_kg: 0,
    sets: [
      { reps: 9, weight_kg: 0, done: false },
      { reps: 9, weight_kg: 0, done: false },
    ],
  });
  expect(session.exercises[1].routine_exercise_id).toBeUndefined();
  expect(session.exercises[1].routine_exercise_index).toBeUndefined();
  expect(session.exercises[1].targets_revision).toBeUndefined();
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
  expect(after.sessions.find(item => item.id === 'workout-tools-history'))
    .toEqual(before.sessions.find(item => item.id === 'workout-tools-history'));

  await page.reload();
  await expect(bench.getByTestId('workout-set')).toHaveCount(1);
  await expect(bench.getByRole('checkbox', { name: 'Complete set 1 of Bench Press', exact: true })).toBeChecked();
  await revealTrainingOptions(page);
  await expect(bench.getByRole('button', { name: 'Find an alternative with AI', exact: true })).toBeDisabled();
  const alternative = page.getByRole('region', { name: 'Incline Push-Up', exact: true });
  await expect(alternative.getByTestId('workout-set')).toHaveCount(2);
  for (const checkbox of await alternative.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
  expect((await readDb(page)).sessions.find(item => item.id === SESSION_ID)!.exercises).toEqual(session.exercises);
  expect(aiRequests).toEqual([]);
});

test('completed workouts expose neither a rest timer nor exercise substitution', async ({ page }) => {
  const aiRequests = await openToolsSession(page, 'completed');
  const before = await readDb(page);
  await page.evaluate(() => localStorage.setItem('tac_rest_timer_enabled', 'true'));
  await page.reload();
  await expect(page.getByText('Completed workout · edit to make corrections', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Rest timer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('timer', { name: 'Rest remaining', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find an alternative with AI', exact: true })).toHaveCount(0);
  for (const checkbox of await page.getByRole('checkbox').all()) await expect(checkbox).toBeDisabled();
  await page.clock.runFor(90_000);
  const after = await readDb(page);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.routines).toEqual(before.routines);
  expect(aiRequests).toEqual([]);
});


test('exercise notes autosave, survive reload and carry into future workouts without changing history', async ({ page }) => {
  await openToolsSession(page);
  const before = await readDb(page);
  const notes = page.getByRole('region', { name: 'Bench Press', exact: true }).getByRole('textbox', { name: 'Exercise notes', exact: true });
  await expect(notes).not.toBeVisible();
  await page.getByTestId('exercise-notes').locator('summary').click();
  await notes.fill('Seat at 4.\nKeep a controlled tempo.');
  await page.clock.runFor(1200);
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  const saved = await readDb(page);
  expect(saved.routines[0].exercises[0].notes).toBe('Seat at 4.\nKeep a controlled tempo.');
  expect(saved.sessions.find(session => session.id === SESSION_ID)!.exercises[0].sets)
    .toEqual(before.sessions.find(session => session.id === SESSION_ID)!.exercises[0].sets);
  expect(saved.sessions.find(session => session.id === 'workout-tools-history'))
    .toEqual(before.sessions.find(session => session.id === 'workout-tools-history'));
  expect(saved.logs).toEqual(before.logs);
  await page.reload();
  await expect(notes).not.toBeVisible();
  await page.getByTestId('exercise-notes').locator('summary').click();
  await expect(notes).toHaveValue('Seat at 4.\nKeep a controlled tempo.');
  // Start a genuinely new workout from the saved routine, retaining the earlier snapshot.
  await page.evaluate(sessionId => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.sessions.find((session: { id: string }) => session.id === sessionId).status = 'completed';
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, SESSION_ID);
  await page.goto(`/routines/${ROUTINE_ID}`);
  await page.getByRole('button', { name: /Start.*workout|Start.*session/i }).first().click();
  await expect(notes).not.toBeVisible();
  await page.getByTestId('exercise-notes').locator('summary').click();
  await expect(notes).toHaveValue('Seat at 4.\nKeep a controlled tempo.');
  await notes.fill('');
  await page.clock.runFor(1200);
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(notes).not.toBeVisible();
  await page.getByTestId('exercise-notes').locator('summary').click();
  await expect(notes).toHaveValue('');
  const after = await readDb(page);
  expect(after.routines[0].exercises[0].notes).toBe('');
  expect(after.sessions.find(session => session.id === SESSION_ID)!.exercises[0].notes).toBe('Seat at 4.\nKeep a controlled tempo.');
});

test('rest countdown stays visible when scrolling through a workout on mobile and desktop', async ({ page }) => {
  await openToolsSession(page);
  await page.getByRole('switch', { name: 'Rest timer', exact: true }).check();
  await page.getByRole('button', { name: 'Start rest', exact: true }).click();
  for (const width of [420, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const timer = page.getByTestId('rest-timer');
    await expect(timer).toBeInViewport();
    const bounds = await timer.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeLessThan(30);
    await expect(timer.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});


test('persistent notes respect day ownership, legacy aliases, changed prescriptions and temporary alternatives', () => {
  const routine: Routine = { id: 'plan', name: 'Plan', exercises: [], days: [
    { id: 'push', name: 'Push', exercises: [{ id: 'bench', name: 'Bench Press', previous_names: ['Bench'], sets: 3, reps: 10, notes: 'Original' }] },
    { id: 'other', name: 'Other', exercises: [{ id: 'other-bench', name: 'Bench Press', sets: 3, reps: 10, notes: 'Other day' }] },
  ] };
  const session: WorkoutSession = { id: 'draft', routine_id: 'plan', routine_name: 'Plan', day_id: 'push', date: '2026-10-26', status: 'active',
    exercises: [{ name: 'Bench', routine_exercise_index: 0, notes: 'Original', target_sets: 3, target_reps: 10,
      sets: [{ reps: 10, weight_kg: 50, done: true }] }] };
  const before = structuredClone({ routine, session });
  const edited = [{ ...session.exercises[0], notes: 'Seat 4' }];
  const changes = carryExerciseNotes(routine, session, edited)!;
  expect(changes.days![0].exercises[0].notes).toBe('Seat 4');
  expect(changes.days![1]).toEqual(routine.days![1]);
  expect(carryExerciseNotes(routine, session, [{ ...edited[0], routine_defaults_excluded: true }])).toBeNull();
  expect(carryExerciseNotes(routine, session, [{ ...edited[0], routine_exercise_id: 'removed-exercise' }])).toBeNull();
  expect(carryExerciseNotes(routine, session, [{ ...edited[0], targets_revision: 'old-prescription' }])).toBeNull();
  expect(carryExerciseNotes(routine, session, [{ ...edited[0], name: 'Unrelated movement', routine_exercise_id: 'bench' }])).toBeNull();
  expect({ routine, session }).toEqual(before);
});


test('exercise notes collapse without losing a draft and stay closed on reload', async ({ page }) => {
  await openToolsSession(page);
  const disclosure = page.getByTestId('exercise-notes');
  const notes = disclosure.getByRole('textbox', { name: 'Exercise notes', exact: true });
  await expect(notes).not.toBeVisible();
  await disclosure.locator('summary').click();
  await notes.fill('Keep this note');
  await disclosure.locator('summary').click();
  await expect(notes).not.toBeVisible();
  await page.clock.runFor(1200);
  await page.reload();
  await expect(notes).not.toBeVisible();
  await disclosure.locator('summary').click();
  await expect(notes).toHaveValue('Keep this note');
});

test('workout order persists independently and undo follows a moved exercise', async ({ page }) => {
  const aiRequests = await openToolsSession(page);
  await page.evaluate(sessionId => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    const session = db.sessions.find(item => item.id === sessionId)!;
    // Include a legacy exercise without an ID and retain its original index.
    const extra = ['Row', 'Squat'].map((name, index) => ({
      name, routine_exercise_index: index + 1, target_sets: 1, target_reps: 8,
      sets: [{ weight_kg: 30 + index, reps: 8, done: true }],
    }));
    session.exercises.push(...extra);
    db.routines[0].exercises.push(...extra.map(exercise => ({ name: exercise.name, sets: 1, reps: 8 })));
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, SESSION_ID);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Squat', exact: true })).toBeVisible();
  const before = await readDb(page);
  const original = before.sessions.find(item => item.id === SESSION_ID)!;
  const bench = page.getByRole('region', { name: 'Bench Press', exact: true });
  const squat = page.getByRole('region', { name: 'Squat', exact: true });
  await revealTrainingOptions(page);
  await expect(bench.getByRole('button', { name: 'Move up', exact: true })).toBeDisabled();
  await expect(squat.getByRole('button', { name: 'Move down', exact: true })).toBeDisabled();
  // A pending set-removal undo must remain attached to Bench after reordering.
  await bench.getByRole('button', { name: 'Remove set 2', exact: true }).click();
  await bench.getByRole('button', { name: 'Move down', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await squat.getByRole('button', { name: 'Move up', exact: true }).click();
  await page.clock.runFor(1200);
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  const after = await readDb(page);
  const expected = [original.exercises[1], original.exercises[2], original.exercises[0]];
  expect(after.sessions.find(item => item.id === SESSION_ID)!.exercises).toEqual(expected);
  expect(after.routines).toEqual(before.routines);
  expect(after.logs).toEqual(before.logs);
  expect(after.sessions.filter(item => item.id !== SESSION_ID)).toEqual(before.sessions.filter(item => item.id !== SESSION_ID));
  await page.reload();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Row', 'Squat', 'Bench Press']);
  await expect(bench.getByRole('checkbox').first()).toBeChecked();
  expect((await readDb(page)).sessions.find(item => item.id === SESSION_ID)!.exercises).toEqual(expected);
  // Completion may carry loads forward, but must keep the routine's own order.
  await bench.getByRole('checkbox').nth(1).check();
  await bench.getByRole('checkbox').nth(2).check();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page).toHaveURL(/workout-history/);
  const finished = await readDb(page);
  expect(finished.routines[0].exercises.map(exercise => exercise.name)).toEqual(before.routines[0].exercises.map(exercise => exercise.name));
  expect(finished.sessions.find(item => item.id === SESSION_ID)!.exercises.map(exercise => exercise.name)).toEqual(['Row', 'Squat', 'Bench Press']);
  expect(finished.sessions.filter(item => item.id !== SESSION_ID)).toEqual(before.sessions.filter(item => item.id !== SESSION_ID));
  expect(aiRequests).toEqual([]);
});
