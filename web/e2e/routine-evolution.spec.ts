import { test, expect, type Page } from '@playwright/test';
import type { DemoDb } from '../src/demo/db';
import type { Routine, RoutineExercise, WorkoutSession } from '../src/types/routine';
import { enterDemo, revealTrainingOptions } from './helpers';

test.use({ timezoneId: 'America/Costa_Rica', locale: 'en-US' });

const ROUTINE_ID = 'evolving-routine';
const ORIGINAL = 'Original custom press';
const EXERCISE_ID = 'original-press';

function exercise(name = ORIGINAL, id = EXERCISE_ID): RoutineExercise {
  return { id, name, sets: 2, reps: 10, weight_kg: 40, weight_unit: 'kg' };
}

function session(id: string, date: string, name = ORIGINAL, identified = true): WorkoutSession {
  return {
    id, routine_id: ROUTINE_ID, routine_name: 'Evolving training plan', date, status: 'completed',
    completed_at: Date.parse(`${date}T18:00:00Z`),
    exercises: [{
      name, ...(identified ? { routine_exercise_id: EXERCISE_ID } : {}),
      target_sets: 2, target_reps: 10, weight_unit: 'kg',
      sets: [{ reps: 10, weight_kg: 40, done: true }, { reps: 9, weight_kg: 35, done: true }],
    }],
  };
}

async function seed(page: Page, routine: Routine = {
  id: ROUTINE_ID, name: 'Evolving training plan', exercises: [exercise()],
}, workouts: WorkoutSession[] = [session('latest', '2026-10-16'), session('older', '2026-10-09')]) {
  await page.clock.install({ time: new Date('2026-10-18T16:00:00Z') });
  await page.route('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json', route =>
    route.fulfill({ json: [] }));
  await enterDemo(page);
  await page.evaluate(({ selectedRoutine, sessions }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.profile.units = 'metric';
    db.profile.workout_weight_unit = 'kg';
    db.routines = [selectedRoutine];
    db.sessions = sessions;
    db.logs = {
      '2026-10-16': {
        date: '2026-10-16', measurements: {}, energy: 4, notes: 'Keep this historical note.', food_log: [],
        exercise_log: [
          { workout_session_id: 'latest', exercise: 'Original custom press', sets: 2, reps: 19, weight_kg: 40 },
          { exercise: 'Manual walk', duration_min: 25, notes: 'Not part of a routine.' },
        ],
      },
    };
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { selectedRoutine: routine, sessions: workouts });
  await page.goto(`/routines/${ROUTINE_ID}`);
  await expect(page.getByRole('heading', { name: 'Evolving training plan', exact: true })).toBeVisible();
}

async function stored(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);
}

function exerciseCard(page: Page, name: string) {
  return page.locator('.MuiCard-root')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Edit', exact: true }) });
}

async function renameExercise(page: Page, from: string, to: string) {
  await exerciseCard(page, from).getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByRole('combobox', { name: 'Exercise name', exact: true });
  await name.fill(to);
  await name.press('Escape');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(exerciseCard(page, to)).toBeVisible();
}

async function addExercise(page: Page, name: string) {
  await revealTrainingOptions(page);
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await page.getByRole('button', { name: 'Add custom exercise', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('combobox', { name: 'Exercise name', exact: true });
  await input.fill(name);
  await input.press('Escape');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(exerciseCard(page, name)).toBeVisible();
}

async function renameDay(page: Page, name: string) {
  await page.getByRole('button', { name: 'Edit day name', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit day name', exact: true });
  await dialog.getByLabel('Day name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tab', { name, selected: true })).toBeVisible();
}

async function selectProgressExercise(page: Page, name: string, historical = false) {
  await page.getByRole('combobox', { name: 'Exercise', exact: true }).click();
  await page.getByRole('option', { name: historical ? `${name} · History` : name, exact: true }).click();
}

async function selectProgressIdentity(page: Page, key: string) {
  await page.getByRole('combobox', { name: 'Exercise', exact: true }).click();
  await page.locator(`[role="option"][data-value="${key}"]`).click();
}

function progress(page: Page) {
  return page.getByRole('region', { name: 'Repetitions per set', exact: true });
}

async function expectOriginalProgress(page: Page) {
  const chart = progress(page);
  await expect(chart.locator('.recharts-wrapper')).toBeVisible();
  await expect(chart.getByText('Latest session · 2026-10-16', { exact: true })).toBeVisible();
  await expect(chart.getByText('19 total reps', { exact: true })).toBeVisible();
  await expect(chart.getByRole('group', { name: 'Set 1', exact: true }).getByText('40 kg', { exact: true })).toBeVisible();
  await expect(chart.getByRole('group', { name: 'Set 2', exact: true }).getByText('9 reps', { exact: true })).toBeVisible();
}

async function expectHistoryUnchanged(page: Page, before: DemoDb) {
  const after = await stored(page);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.logs).toEqual(before.logs);
}

test('renaming a stable exercise keeps its earlier progress and exact saved sessions and logs', async ({ page }) => {
  await seed(page);
  const before = await stored(page);
  await renameExercise(page, ORIGINAL, 'Renamed custom press');
  const routine = (await stored(page)).routines[0];
  expect(routine.exercises[0].id).toBe(EXERCISE_ID);
  await page.getByRole('button', { name: 'View progress', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Exercise', exact: true })).toHaveText('Renamed custom press');
  await expectOriginalProgress(page);
  await expect(progress(page).getByText('Complete another session to compare your repetitions.', { exact: true })).toHaveCount(0);
  await expectHistoryUnchanged(page, before);
  await page.reload();
  await expectOriginalProgress(page);
  await expectHistoryUnchanged(page, before);
});

test('removed exercises remain available in progress when new exercises are added to the plan', async ({ page }) => {
  await seed(page);
  const before = await stored(page);
  await exerciseCard(page, ORIGINAL).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('No exercises in this day yet.', { exact: false })).toBeVisible();
  await addExercise(page, 'New calf raise');
  await page.getByRole('button', { name: 'View progress', exact: true }).click();
  await selectProgressExercise(page, 'New calf raise');
  await expect(progress(page).getByText('Complete a set to see your repetitions here.', { exact: true })).toBeVisible();
  await selectProgressExercise(page, ORIGINAL, true);
  await expectOriginalProgress(page);
  const routine = (await stored(page)).routines[0];
  expect(routine.exercises.map(value => value.name)).toEqual(['New calf raise']);
  expect(routine.exercises[0].id).not.toBe(EXERCISE_ID);
  await expectHistoryUnchanged(page, before);
  await page.reload();
  await selectProgressExercise(page, ORIGINAL, true);
  await expectOriginalProgress(page);
  await expectHistoryUnchanged(page, before);
});

test('same exercise labels keep stable identities and ambiguous legacy progress separate', async ({ page }) => {
  const label = 'Shared press';
  const unidentified = exercise(label);
  delete unidentified.id;
  const values: [string, string, string | undefined, number, number][] = [
    ['press-a-session', '2026-10-16', 'press-a', 11, 41],
    ['press-b-session', '2026-10-15', 'press-b', 22, 52],
    ['legacy-press-session', '2026-10-14', undefined, 33, 63],
  ];
  const workouts = values.map(([id, date, stableId, reps, weight]) => ({
    ...session(id, date, label, false),
    exercises: [{ name: label, ...(stableId ? { routine_exercise_id: stableId } : {}),
      target_sets: 1, target_reps: reps, sets: [{ reps, weight_kg: weight, done: true }] }],
  }));
  await seed(page, { id: ROUTINE_ID, name: 'Evolving training plan',
    exercises: [exercise(label, 'press-a'), exercise(label, 'press-b'), unidentified] }, workouts);
  const before = await stored(page);
  await page.getByRole('button', { name: 'View progress', exact: true }).click();
  for (const [key, date, reps, weight] of [
    ['id:press-a', '2026-10-16', 11, 41],
    ['id:press-b', '2026-10-15', 22, 52],
    ['legacy:shared press', '2026-10-14', 33, 63],
  ] as const) {
    await selectProgressIdentity(page, key);
    const chart = progress(page);
    await expect(chart.getByText(`Latest session · ${date}`, { exact: true })).toBeVisible();
    await expect(chart.getByText(`${reps} total reps`, { exact: true })).toBeVisible();
    await expect(chart.getByRole('group', { name: 'Set 1', exact: true }).getByText(`${weight} kg`, { exact: true })).toBeVisible();
    // A second point here would mean another identity's history leaked into this chart.
    await expect(chart.getByText('Complete another session to compare your repetitions.', { exact: true })).toBeVisible();
  }
  await selectProgressIdentity(page, 'current:2:shared press');
  await expect(progress(page).getByText('Complete a set to see your repetitions here.', { exact: true })).toBeVisible();
  await expect(progress(page).locator('.recharts-wrapper')).toHaveCount(0);
  await expectHistoryUnchanged(page, before);
});

test('converting a flat routine preserves legacy history and active ownership through later day and exercise edits', async ({ page }) => {
  const completed = session('latest', '2026-10-16', ORIGINAL, false);
  const active: WorkoutSession = {
    ...session('unscoped-active', '2026-10-18', ORIGINAL, false), status: 'active', completed_at: undefined,
    started_at: Date.parse('2026-10-18T15:00:00Z'),
    exercises: [{ name: ORIGINAL, target_sets: 2, target_reps: 10,
      sets: [{ reps: 7, weight_kg: 42, done: false }, { reps: 6, weight_kg: 38, done: false }] }],
  };
  await seed(page, undefined, [active, completed]);
  const before = await stored(page);
  await page.getByRole('button', { name: 'Add day', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add day', exact: true });
  await dialog.getByLabel('Day name', { exact: true }).fill('Accessories');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const converted = (await stored(page)).routines[0];
  const first = converted.days![0];
  const second = converted.days![1];
  expect(first.includes_legacy_sessions).toBe(true);
  expect(second.includes_legacy_sessions).not.toBe(true);
  await expect(page.getByRole('tab', { name: 'Accessories', selected: true })).toBeVisible();
  await page.evaluate(() => {
    const firstDay = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find(button => button.textContent?.trim() === 'Day 1');
    const editDay = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === 'Edit day name');
    if (!firstDay || !editDay) throw new Error('Day tabs and edit action must be ready.');
    // Both events must share a browser task to exercise the uncommitted-router race.
    firstDay.click();
    editDay.click();
  });
  const editDay = page.getByRole('dialog', { name: 'Edit day name', exact: true });
  await expect(editDay.getByLabel('Day name', { exact: true })).toHaveValue('Day 1');
  await editDay.getByLabel('Day name', { exact: true }).fill('Foundation');
  await editDay.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editDay).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Foundation', selected: true })).toBeVisible();
  const renamedDays = (await stored(page)).routines[0].days!;
  expect(renamedDays[0]).toMatchObject({ id: first.id, name: 'Foundation', includes_legacy_sessions: true });
  expect(renamedDays[1]).toEqual(second);
  await expectHistoryUnchanged(page, before);
  await renameExercise(page, ORIGINAL, 'Renamed legacy press');
  await exerciseCard(page, 'Renamed legacy press').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume workout in progress', exact: true })).toBeEnabled();
  await addExercise(page, 'Replacement pull');
  await page.getByRole('tab', { name: 'Accessories', exact: true }).click();
  await addExercise(page, ORIGINAL);
  await expect(page.getByRole('button', { name: 'Start Workout', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume workout in progress', exact: true })).toHaveCount(0);
  await page.goto(`/routines/${ROUTINE_ID}?view=progress&day=${second.id}`);
  await expect(progress(page).getByText('Complete a set to see your repetitions here.', { exact: true })).toBeVisible();
  await expect(progress(page).getByText('19 total reps', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Foundation', exact: true }).click();
  await selectProgressExercise(page, ORIGINAL, true);
  await expectOriginalProgress(page);
  await expectHistoryUnchanged(page, before);
  await page.getByRole('button', { name: 'View exercises', exact: true }).click();
  await page.getByRole('button', { name: 'Resume workout in progress', exact: true }).click();
  await expect(page).toHaveURL(`/routines/${ROUTINE_ID}/session/unscoped-active`);
  const savedExercise = page.getByRole('region', { name: ORIGINAL, exact: true });
  await expect(savedExercise.getByLabel('Reps', { exact: true }).first()).toHaveValue('7');
  await expect(savedExercise.getByLabel('kg', { exact: true }).first()).toHaveValue('42');
  expect((await stored(page)).sessions).toHaveLength(2);
  await expectHistoryUnchanged(page, before);
  expect((await stored(page)).routines[0].days!.find(day => day.id === first.id)?.includes_legacy_sessions).toBe(true);
});

test('renamed days retain legacy day-name sessions through previous names without rewriting history', async ({ page }) => {
  const completed = { ...session('latest', '2026-10-16'), day_name: 'Original upper day' };
  const active = { ...session('named-active', '2026-10-18'), day_name: 'Original upper day', status: 'active' as const,
    completed_at: undefined, started_at: Date.parse('2026-10-18T15:00:00Z') };
  await seed(page, {
    id: ROUTINE_ID, name: 'Evolving training plan', exercises: [],
    days: [{ id: 'upper', name: 'Original upper day', exercises: [exercise()] },
      { id: 'lower', name: 'Lower day', exercises: [exercise('Leg curl', 'leg-curl')] }],
  }, [active, completed]);
  const before = await stored(page);
  await renameDay(page, 'Push focus');
  await renameDay(page, 'Upper revised');
  const renamed = (await stored(page)).routines[0].days![0];
  expect(renamed.id).toBe('upper');
  expect(renamed.previous_names).toEqual(expect.arrayContaining(['Original upper day', 'Push focus']));
  await page.getByRole('button', { name: 'View progress', exact: true }).click();
  await expectOriginalProgress(page);
  await page.reload();
  await expectOriginalProgress(page);
  await expect(page.getByRole('tab', { name: 'Upper revised', selected: true })).toBeVisible();
  await page.getByRole('button', { name: 'View exercises', exact: true }).click();
  await page.getByRole('button', { name: 'Resume workout in progress', exact: true }).click();
  await expect(page).toHaveURL(`/routines/${ROUTINE_ID}/session/named-active`);
  await expect(page.getByRole('region', { name: ORIGINAL, exact: true })).toBeVisible();
  await expectHistoryUnchanged(page, before);
});

test('converting a named flat legacy workout retains first-day ownership when a new day reuses its old label', async ({ page }) => {
  const oldName = 'Legacy flat workout';
  const completed = { ...session('latest', '2026-10-16', ORIGINAL, false), day_name: oldName };
  const active = { ...session('named-flat-active', '2026-10-18', ORIGINAL, false), day_name: oldName,
    status: 'active' as const, completed_at: undefined, started_at: Date.parse('2026-10-18T15:00:00Z') };
  await seed(page, undefined, [active, completed]);
  const before = await stored(page);
  await page.getByRole('button', { name: 'Add day', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add day', exact: true });
  await dialog.getByLabel('Day name', { exact: true }).fill(oldName);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const first = (await stored(page)).routines[0].days![0];
  expect(first.includes_legacy_sessions).toBe(true);
  await page.getByRole('tab', { name: 'Day 1', exact: true }).click();
  await renameDay(page, 'Inherited foundation');
  await page.getByRole('button', { name: 'View progress', exact: true }).click();
  await expectOriginalProgress(page);
  await page.getByRole('tab', { name: oldName, exact: true }).click();
  await expect(progress(page).getByText('Complete a set to see your repetitions here.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume workout in progress', exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const exercises = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === 'View exercises');
    const inherited = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find(button => button.textContent?.trim() === 'Inherited foundation');
    if (!exercises || !inherited) throw new Error('Progress view and inherited day must be ready.');
    exercises.click();
    inherited.click();
  });
  expect(new URL(page.url()).searchParams.get('view')).toBeNull();
  expect(new URL(page.url()).searchParams.get('day')).toBe(first.id);
  await expect(page.getByRole('button', { name: 'View progress', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume workout in progress', exact: true }).click();
  await expect(page).toHaveURL(`/routines/${ROUTINE_ID}/session/named-flat-active`);
  await expect(page.getByRole('region', { name: ORIGINAL, exact: true })).toBeVisible();
  await expectHistoryUnchanged(page, before);
});

test('loading earlier routine sessions restores progress for exercises older than the first history page', async ({ page }) => {
  const newer = Array.from({ length: 35 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 16 - index)).toISOString().slice(0, 10);
    return session(`newer-${String(index).padStart(2, '0')}`, date, 'Current press');
  });
  const retired = session('retired-history', '2025-01-05', 'Retired row');
  retired.exercises[0].routine_exercise_id = 'retired-row';
  retired.exercises[0].sets = [{ reps: 17, weight_kg: 23, done: true }];
  const oldActive = { ...session('old-active-draft', '2024-12-31', 'Current press'), status: 'active' as const,
    completed_at: undefined, started_at: Date.parse('2024-12-31T18:00:00Z') };
  oldActive.exercises[0].sets = [{ reps: 5, weight_kg: 29, done: false }];
  await seed(page, { id: ROUTINE_ID, name: 'Evolving training plan', exercises: [exercise('Current press')] }, [...newer, retired, oldActive]);
  const before = await stored(page);
  await page.getByRole('button', { name: 'View progress', exact: true }).click();
  await page.getByRole('combobox', { name: 'Exercise', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Retired row · History', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View exercises', exact: true }).click();
  await page.getByRole('button', { name: 'Resume workout in progress', exact: true }).click();
  await expect(page).toHaveURL(`/routines/${ROUTINE_ID}/session/old-active-draft`);
  await expect(page.getByRole('region', { name: 'Current press', exact: true }).getByLabel('Reps', { exact: true }).first()).toHaveValue('5');
  await expectHistoryUnchanged(page, before);
  await page.goto(`/routines/${ROUTINE_ID}?view=progress`);
  const earlier = page.getByRole('button', { name: 'Load earlier sessions', exact: true });
  await earlier.click();
  await selectProgressExercise(page, 'Retired row', true);
  await expect(progress(page).getByText('Latest session · 2025-01-05', { exact: true })).toBeVisible();
  await expect(progress(page).getByText('17 total reps', { exact: true })).toBeVisible();
  await expect(progress(page).getByRole('group', { name: 'Set 1', exact: true }).getByText('23 kg', { exact: true })).toBeVisible();
  await expect(progress(page).locator('.recharts-wrapper')).toBeVisible();
  await expect(earlier).toHaveCount(0);
  await expectHistoryUnchanged(page, before);
  await page.getByRole('button', { name: 'View exercises', exact: true }).click();
  await page.getByRole('button', { name: 'Resume workout in progress', exact: true }).click();
  await expect(page).toHaveURL(`/routines/${ROUTINE_ID}/session/old-active-draft`);
  await expect(page.getByRole('region', { name: 'Current press', exact: true })).toBeVisible();
  expect((await stored(page)).sessions).toHaveLength(37);
  await expectHistoryUnchanged(page, before);
});

test('rapid day selection starts and resumes the requested day before the router render commits', async ({ page }) => {
  await seed(page, {
    id: ROUTINE_ID, name: 'Evolving training plan', exercises: [],
    days: [{ id: 'upper', name: 'Upper day', exercises: [exercise()] },
      { id: 'lower', name: 'Lower day', exercises: [exercise('Lower squat', 'lower-squat')] }],
  }, [{ ...session('latest', '2026-10-16'), day_id: 'upper', day_name: 'Upper day' }]);
  const before = await stored(page);
  const selectLowerAndStart = () => page.evaluate(() => {
    const lower = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find(button => button.textContent?.trim() === 'Lower day');
    const start = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === 'Start Workout');
    if (!lower || !start || start.disabled) throw new Error('Upper day must be ready before the rapid selection.');
    // Keep both native events in one browser task: no locator wait or render can hide the race.
    lower.click();
    start.click();
  });
  await expect(page.getByRole('tab', { name: 'Upper day', selected: true })).toBeVisible();
  await selectLowerAndStart();
  await expect(page).toHaveURL(new RegExp(`/routines/${ROUTINE_ID}/session/`));
  await expect(page.getByRole('region', { name: 'Lower squat', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: ORIGINAL, exact: true })).toHaveCount(0);
  const started = await stored(page);
  const draft = started.sessions.find(value => value.status === 'active')!;
  expect(draft.day_id).toBe('lower');
  expect(draft.day_name).toBe('Lower day');
  expect(draft.exercises.map(value => value.name)).toEqual(['Lower squat']);
  expect(started.sessions.filter(value => value.id !== draft.id)).toEqual(before.sessions);
  expect(started.logs).toEqual(before.logs);

  await page.goto(`/routines/${ROUTINE_ID}?day=upper`);
  await expect(page.getByRole('tab', { name: 'Upper day', selected: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Workout', exact: true })).toBeEnabled();
  await selectLowerAndStart();
  await expect(page).toHaveURL(`/routines/${ROUTINE_ID}/session/${draft.id}`);
  await expect(page.getByRole('region', { name: 'Lower squat', exact: true })).toBeVisible();
  await expectHistoryUnchanged(page, started);
  expect((await stored(page)).sessions).toHaveLength(2);
});
