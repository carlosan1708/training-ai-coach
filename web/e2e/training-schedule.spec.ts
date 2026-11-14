import { test, expect, type Page } from '@playwright/test';
import type { DemoDb } from '../src/demo/db';
import { enterDemo } from './helpers';

test.use({ timezoneId: 'America/Costa_Rica' });

const SUNDAY = '2026-10-18';
const PREFERRED_ID = 'preferred-plan';
const SUNDAY_ID = 'sunday-strength';

async function seedSchedule(page: Page, time = '2026-10-18T16:00:00Z') {
  await page.clock.install({ time: new Date(time) });
  await enterDemo(page);
  await page.evaluate(({ preferredId, sundayId, date }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.profile.preferred_routine_id = preferredId;
    db.routines = [
      {
        id: 'newer-plan', name: 'Newest unused plan', session_count: 0,
        created_at: Date.now(), scheduled_weekdays: [0],
        exercises: [{ name: 'Bench Press', sets: 3, reps: 10, weight_kg: 20 }],
      },
      {
        id: preferredId, name: 'Preferred training plan', session_count: 0,
        created_at: Date.now() - 86_400_000, exercises: [],
        days: [
          {
            id: 'friday-strength', name: 'Friday strength', scheduled_weekdays: [5],
            exercises: [{ name: 'Bench Press', sets: 3, reps: 10, weight_kg: 20 }],
          },
          {
            id: sundayId, name: 'Sunday strength', scheduled_weekdays: [0],
            exercises: [{ name: 'Squat', sets: 3, reps: 8, weight_kg: 30 }],
          },
        ],
      },
    ];
    // Neither another routine nor another day of this routine completes Sunday's plan.
    db.sessions = [
      {
        id: 'unrelated-completion', routine_id: 'newer-plan', routine_name: 'Newest unused plan',
        date, status: 'completed', exercises: [], completed_at: Date.now(),
      },
      {
        id: 'other-day-completion', routine_id: preferredId, routine_name: 'Preferred training plan',
        day_id: 'friday-strength', day_name: 'Friday strength', date,
        status: 'completed', exercises: [], completed_at: Date.now() - 60_000,
      },
    ];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { preferredId: PREFERRED_ID, sundayId: SUNDAY_ID, date: SUNDAY });
  await page.reload();
  await expect(page.getByText('Welcome, Alex!', { exact: true })).toBeVisible();
}

test('Sunday shows the preferred routine and its pending scheduled day despite unrelated completions', async ({ page }) => {
  await seedSchedule(page);
  const savedSets = [
    { reps: 11, weight_kg: 42.5 },
    { reps: 9, weight_kg: 40 },
    { reps: 8, weight_kg: 37.5 },
  ];
  await page.evaluate(({ preferredId, sundayId, sets }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    const exercise = db.routines.find(routine => routine.id === preferredId)!.days!
      .find(day => day.id === sundayId)!.exercises[0];
    exercise.set_defaults = sets;
    exercise.weight_unit = 'lb';
    exercise.weight_unit_override = true;
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { preferredId: PREFERRED_ID, sundayId: SUNDAY_ID, sets: savedSets });
  await page.reload();
  await expect(page.getByText('Preferred training plan', { exact: true })).toBeVisible();
  await expect(page.getByText('Sunday strength', { exact: true })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${SUNDAY}: workout pending`, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Newest unused plan', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('sunday-pending-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: test.info().outputPath('sunday-pending-desktop.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 420, height: 850 });
  await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/routines/${PREFERRED_ID}/session/[^/?]+$`));
  await expect(page.getByText('Squat', { exact: true })).toBeVisible();
  await expect(page.getByText('Bench Press', { exact: true })).toHaveCount(0);
  const sessionUrl = page.url();
  const started = await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb)
    .sessions.filter(session => session.status === 'active'));
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({
    routine_id: PREFERRED_ID, day_id: SUNDAY_ID, day_name: 'Sunday strength', date: SUNDAY,
    exercises: [{
      name: 'Squat', weight_unit: 'lb', weight_unit_override: true,
      target_sets: 3, target_reps: 11, target_weight_kg: 42.5,
      sets: savedSets.map(set => ({ ...set, done: false })),
    }],
  });
  expect(started[0].exercises).toHaveLength(1);
  expect(started[0].ai_insight).toBeUndefined();
  expect(started[0].exercises[0].ai_note).toBeUndefined();
  expect(started[0].exercises[0].change).toBeUndefined();
  await page.goto('/dashboard');
  await expect(page.getByText('PICK UP WHERE YOU LEFT OFF', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume workout in progress', exact: true }).click();
  await expect(page).toHaveURL(sessionUrl);
  const resumed = await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).sessions);
  expect(resumed.filter(session => session.status === 'active').map(session => session.id)).toEqual([started[0].id]);
  expect(resumed).toHaveLength(3);
});

test('changing today to Friday swaps dated assignments and starts directly without rewriting the weekly plan or history', async ({ page }) => {
  await seedSchedule(page);
  // Friday's earlier completion is history, so the chosen workout is still due today.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.sessions.find(session => session.id === 'other-day-completion')!.date = '2026-10-16';
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.reload();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);
  await page.getByRole('button', { name: 'Change day', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change day', exact: true });
  await dialog.getByRole('combobox', { name: /^Training day/ }).click();
  await page.getByRole('option', { name: 'Friday strength', exact: true }).click();
  await expect(dialog.getByText('Train your choice today. Sunday strength moves to 2026-10-23 for this swap.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('swap-day-mobile.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Swap and start', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/routines/${PREFERRED_ID}/session/[^/?]+$`));
  await expect(page.getByText('Bench Press', { exact: true })).toBeVisible();
  await expect(page.getByText('Squat', { exact: true })).toHaveCount(0);
  const sessionUrl = page.url();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb);
  const routine = after.routines.find(item => item.id === PREFERRED_ID)!;
  expect(routine.schedule_overrides).toEqual({
    [SUNDAY]: ['friday-strength'],
    '2026-10-23': [SUNDAY_ID],
  });
  expect(routine.days).toEqual(before.routines.find(item => item.id === PREFERRED_ID)!.days);
  expect(after.sessions.filter(session => session.status === 'completed')).toEqual(before.sessions);
  const active = after.sessions.filter(session => session.status === 'active');
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({
    routine_id: PREFERRED_ID, day_id: 'friday-strength', day_name: 'Friday strength',
    date: SUNDAY, exercises: [{ name: 'Bench Press' }],
  });
  expect(active[0].exercises).toHaveLength(1);
  expect(active[0].ai_insight).toBeUndefined();
  await page.goto('/dashboard');
  await page.reload();
  await expect(page.getByText('Friday strength', { exact: true })).toBeVisible();
  await expect(page.getByText('PICK UP WHERE YOU LEFT OFF', { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${SUNDAY}: workout pending`, { exact: true })).toBeVisible();
  await expect(page.getByText('Sunday strength', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Español' }).click();
  await expect(page.getByText('RETOMA DONDE LO DEJASTE', { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${SUNDAY}: entrenamiento pendiente`, { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('domingo-intercambiado-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Reanudar entrenamiento en curso', exact: true }).click();
  await expect(page).toHaveURL(sessionUrl);
  const resumed = await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).sessions);
  expect(resumed.filter(session => session.status === 'active').map(session => session.id)).toEqual([active[0].id]);
  expect(resumed.filter(session => session.status === 'completed')).toEqual(before.sessions);
});

test('a matching Sunday completion fulfills the scheduled workout', async ({ page }) => {
  await seedSchedule(page);
  await page.evaluate(({ preferredId, sundayId, date }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.sessions.push({
      id: 'sunday-completed', routine_id: preferredId, routine_name: 'Preferred training plan',
      day_id: sundayId, day_name: 'Sunday strength', date,
      status: 'completed', exercises: [], completed_at: Date.now(),
    });
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { preferredId: PREFERRED_ID, sundayId: SUNDAY_ID, date: SUNDAY });
  await page.reload();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${SUNDAY}: workout completed`, { exact: true })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toHaveCount(0);
});

test('an unfinished workout takes precedence and resumes its exact session', async ({ page }) => {
  await seedSchedule(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.sessions.unshift({
      id: 'active-workout', routine_id: 'newer-plan', routine_name: 'Newest unused plan',
      date: '2026-10-17', status: 'active', started_at: Date.now() - 86_400_000,
      exercises: [{
        name: 'Bench Press', target_sets: 1, target_reps: 10, target_weight_kg: 20,
        sets: [{ reps: 10, weight_kg: 20, done: false }],
      }],
    });
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Newest unused plan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume workout in progress', exact: true }).click();
  await expect(page).toHaveURL('/routines/newer-plan/session/active-workout');
  await expect(page.getByText('Bench Press', { exact: true })).toBeVisible();
});

test('a legacy Domingo day is scheduled without rewriting the saved routine', async ({ page }) => {
  await seedSchedule(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    const day = db.routines[1].days![1];
    day.name = 'Domingo';
    delete day.scheduled_weekdays;
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.reload();
  await expect(page.getByText('Domingo', { exact: true })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${SUNDAY}: workout pending`, { exact: true })).toBeVisible();
  const day = await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).routines[1].days![1]);
  expect(day.scheduled_weekdays).toBeUndefined();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Español' }).click();
  await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
  await expect(page.getByText('Rutina preferida', { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${SUNDAY}: entrenamiento pendiente`, { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('domingo-pendiente-mobile.png'), fullPage: true, animations: 'disabled' });
});

test('Sunday stays pending in the local evening and becomes a rest day after local midnight', async ({ page }) => {
  // UTC is already Monday; Costa Rica remains Sunday until 06:00 UTC.
  await seedSchedule(page, '2026-10-19T05:59:30Z');
  await expect(page.getByText('Sunday strength', { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${SUNDAY}: workout pending`, { exact: true })).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(page.getByText('Rest day', { exact: true })).toBeVisible();
  await expect(page.getByLabel('2026-10-19: rest day', { exact: true })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toHaveCount(0);
});

test('choosing a preferred routine persists through reload and changes Today', async ({ page }) => {
  await seedSchedule(page);
  await page.goto('/routines/newer-plan');
  await page.getByRole('button', { name: 'Make preferred', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preferred routine', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).profile.preferred_routine_id)).toBe('newer-plan');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Preferred routine', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Newest unused plan', exact: true })).toBeVisible();
  await page.goto('/routines/newer-plan');
  await page.getByRole('button', { name: 'Preferred routine', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Make preferred', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).profile.preferred_routine_id)).toBeNull();
});

test('explicit Sunday scheduling is saved per day, including an empty schedule override', async ({ page }) => {
  await seedSchedule(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.sessions = [];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.goto(`/routines/${PREFERRED_ID}?day=${SUNDAY_ID}`);
  await page.getByRole('button', { name: /^Training days/ }).click();
  const sunday = page.getByRole('button', { name: 'Sunday', exact: true });
  const save = page.getByRole('button', { name: 'Save days', exact: true });
  await expect(sunday).toHaveAttribute('aria-pressed', 'true');
  await sunday.click();
  await expect(sunday).toHaveAttribute('aria-pressed', 'false');
  await save.click();
  await expect(save).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: /^Training days/ }).click();
  await expect(sunday).toHaveAttribute('aria-pressed', 'false');
  const disabled = await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).routines[1]);
  expect(disabled.days![1].scheduled_weekdays).toEqual([]);
  expect(disabled.days![0].scheduled_weekdays).toEqual([5]);
  await page.goto('/dashboard');
  await expect(page.getByText('Rest day', { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${SUNDAY}: rest day`, { exact: true })).toBeVisible();
  await page.goto(`/routines/${PREFERRED_ID}?day=${SUNDAY_ID}`);
  await page.getByRole('button', { name: /^Training days/ }).click();
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await save.click();
  await expect(save).toBeDisabled();
  const reassigned = await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).routines[1]);
  expect(reassigned.days![1].scheduled_weekdays).toEqual([1]);
  await page.goto('/dashboard');
  await expect(page.getByLabel(`${SUNDAY}: rest day`, { exact: true })).toBeVisible();
  await page.goto(`/routines/${PREFERRED_ID}?day=${SUNDAY_ID}`);
  await page.getByRole('button', { name: /^Training days/ }).click();
  await sunday.click();
  await expect(sunday).toHaveAttribute('aria-pressed', 'true');
  await save.click();
  await expect(save).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: /^Training days/ }).click();
  await expect(sunday).toHaveAttribute('aria-pressed', 'true');
  const enabled = await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).routines[1]);
  expect(enabled.days![1].scheduled_weekdays).toEqual([1, 0]);
  expect(enabled.days![0]).toEqual(disabled.days![0]);
  await page.goto('/dashboard');
  await expect(page.getByLabel(`${SUNDAY}: workout pending`, { exact: true })).toBeVisible();
});

test('choosing another workout already scheduled today preserves both assignments', async ({ page }) => {
  await seedSchedule(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.sessions = [];
    db.routines[1].days![0].scheduled_weekdays = [0];
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  await page.reload();
  const before = await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).routines[1]);
  await page.getByRole('button', { name: 'Change day', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change day', exact: true });
  await dialog.getByRole('combobox', { name: /^Training day/ }).click();
  await page.getByRole('option', { name: 'Sunday strength', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Swap and start', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/routines/${PREFERRED_ID}/session/[^/?]+$`));
  await expect(page.getByText('Squat', { exact: true })).toBeVisible();
  const after = await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).routines[1]);
  expect(after).toEqual(before);
});

test('a draft older than paginated history is visible and quick start resumes it without duplication', async ({ page }) => {
  await seedSchedule(page);
  await page.evaluate(({ routineId, dayId, date }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    db.sessions = Array.from({ length: 120 }, (_, index) => ({
      id: `newer-${index}`, routine_id: routineId, routine_name: 'Preferred training plan',
      date, day_id: 'friday-strength', day_name: 'Friday strength', status: 'completed', exercises: [],
    }));
    db.sessions.push({
      id: 'older-active', routine_id: routineId, routine_name: 'Preferred training plan',
      date: '2026-08-01', day_id: dayId, day_name: 'Sunday strength', status: 'active',
      exercises: [{ name: 'Squat', target_sets: 1, target_reps: 8,
        sets: [{ reps: 8, weight_kg: 30, done: false }] }],
    });
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, { routineId: PREFERRED_ID, dayId: SUNDAY_ID, date: SUNDAY });
  await page.reload();
  await expect(page.getByText('Workout for 2026-08-01', { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${SUNDAY}: workout pending`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Sunday strength.*Pending/ }).click();
  await expect(page).toHaveURL(`/routines/${PREFERRED_ID}/session/older-active`);
  const sessions = await page.evaluate(() => (JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb).sessions);
  expect(sessions).toHaveLength(121);
  expect(sessions.filter(session => session.status === 'active').map(session => session.id)).toEqual(['older-active']);
});
