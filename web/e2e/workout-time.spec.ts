import { test, expect, type Page } from '@playwright/test';
import { enterDemo } from './helpers';
import {
  elapsedSeconds, formatElapsedTime, timestampMillis, toLocalDateTimeInput, parseLocalDateTimeInput,
} from '../src/lib/workoutTime';
import type { WorkoutSession } from '../src/types/routine';

test.use({ timezoneId: 'America/New_York', viewport: { width: 320, height: 700 } });

const session = (values: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 'timed-session', routine_id: 'timed-plan', routine_name: 'Timed workout', date: '2026-10-16',
  status: 'active', started_at: '2026-10-16T16:00:00.000Z',
  exercises: [{
    name: 'Bench Press', target_sets: 1, target_reps: 10, target_weight_kg: 40,
    sets: [{ reps: 10, weight_kg: 40, done: true }],
  }],
  ...values,
});

async function seedSessions(page: Page, sessions: WorkoutSession[]) {
  await page.evaluate((sessions) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.routines = [{ id: 'timed-plan', name: 'Timed workout', exercises: [], session_count: 0 }];
    db.sessions = sessions;
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  }, sessions);
}

test('timestamp normalization and elapsed duration preserve recorded start and completion', () => {
  const millis = Date.parse('2026-10-16T16:00:00.250Z');
  expect(timestampMillis(millis)).toBe(millis);
  expect(timestampMillis(new Date(millis))).toBe(millis);
  expect(timestampMillis('2026-10-16T16:00:00.250Z')).toBe(millis);
  expect(timestampMillis({ seconds: Math.floor(millis / 1000), nanoseconds: 250_000_000 })).toBe(millis);
  expect(timestampMillis({ _seconds: Math.floor(millis / 1000), _nanoseconds: 250_000_000 })).toBe(millis);
  expect(timestampMillis({ toMillis: () => millis })).toBe(millis);
  expect(timestampMillis(0)).toBe(0);
  for (const value of [undefined, null, '', 'invalid', Infinity, new Date(NaN), {}, { seconds: NaN }]) {
    expect(timestampMillis(value)).toBeNull();
  }
  expect(timestampMillis({ toMillis: () => { throw new Error('Invalid timestamp'); } })).toBeNull();
  expect(elapsedSeconds(session(), Date.parse('2026-10-16T16:59:12.900Z'))).toBe(3552);
  expect(elapsedSeconds(session({ status: 'completed', completed_at: '2026-10-16T16:59:12.900Z' }), 0)).toBe(3552);
  expect(elapsedSeconds(session({ status: 'completed', started_at: null, duration_min: 59 }))).toBe(3540);
  expect(elapsedSeconds(session({ status: 'completed', started_at: null, duration_min: 59, duration_sec: 3552 }))).toBe(3552);
  expect(elapsedSeconds(session({ started_at: null, duration_min: 59 }))).toBeNull();
  expect(elapsedSeconds(session({ status: 'completed', completed_at: '2026-10-16T15:59:00Z', duration_min: 59 }))).toBeNull();
  expect(formatElapsedTime(3552)).toBe('59:12');
  expect(formatElapsedTime(3600)).toBe('1:00:00');
  expect(formatElapsedTime(10922)).toBe('3:02:02');
  expect(formatElapsedTime(0)).toBe('00:00');
  const local = toLocalDateTimeInput(millis);
  expect(parseLocalDateTimeInput(local)).toBe(Math.floor(millis / 1000) * 1000);
  for (const value of ['2026-02-30T12:00', '2026-13-01T12:00', '2026-01-01T24:00', '2026-01-01T12:60', '', 'invalid']) {
    expect(parseLocalDateTimeInput(value)).toBeNull();
  }
});

test('datetime-local preserves local calendar fields and rejects nonexistent DST clock times', async ({ page }) => {
  await enterDemo(page);
  const result = await page.evaluate(async () => {
    // Load the browser's timezone-aware implementation from Vite, not the test worker's timezone.
    const moduleUrl = '/src/lib/workoutTime.ts';
    const time = await import(moduleUrl);
    return {
      local: time.toLocalDateTimeInput('2026-10-16T01:05:29Z'),
      parsed: time.parseLocalDateTimeInput('2026-10-15T21:05:29'),
      gap: time.parseLocalDateTimeInput('2026-03-08T02:30'),
      valid: time.parseLocalDateTimeInput('2026-03-08T03:30'),
      leap: time.parseLocalDateTimeInput('2024-02-29T12:30'),
      nonLeap: time.parseLocalDateTimeInput('2026-02-29T12:30'),
    };
  });
  expect(result.local).toBe('2026-10-15T21:05:29');
  expect(result.parsed).toBe(Date.parse('2026-10-16T01:05:29Z'));
  expect(result.gap).toBeNull();
  expect(result.valid).toBe(Date.parse('2026-03-08T07:30:00Z'));
  expect(result.leap).not.toBeNull();
  expect(result.nonLeap).toBeNull();
});

test('active timer continues from persisted start after reload and stops on completion', async ({ page }) => {
  await enterDemo(page);
  // Control Date while allowing lazy routes and React scheduling to run.
  await page.clock.setFixedTime(new Date('2026-10-16T16:05:10Z'));
  await seedSessions(page, [session()]);
  await page.goto('/routines/timed-plan/session/timed-session');
  await expect(page.getByTestId('workout-elapsed')).toHaveText('05:10');
  await expect(page.getByTestId('workout-started').locator('time')).toHaveAttribute('datetime', '2026-10-16T16:00:00.000Z');
  await page.clock.setFixedTime(new Date('2026-10-16T16:05:12Z'));
  await expect(page.getByTestId('workout-elapsed')).toHaveText('05:12');
  await page.reload();
  await expect(page.getByTestId('workout-elapsed')).toHaveText('05:12');
  await page.clock.setFixedTime(new Date('2026-10-16T16:05:13Z'));
  await expect(page.getByTestId('workout-elapsed')).toHaveText('05:13');
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page).toHaveURL(/\/workout-history\?session=timed-session&saved=1$/);
  const timing = page.getByTestId('session-timed-session').getByTestId('workout-timing');
  await expect(timing.getByTestId('workout-elapsed')).toHaveText('05:13');
  await expect(timing.getByTestId('workout-completed').locator('time')).toHaveAttribute('datetime', '2026-10-16T16:05:13.000Z');
  await page.clock.setFixedTime(new Date('2026-10-16T16:05:16Z'));
  await expect(timing.getByTestId('workout-elapsed')).toHaveText('05:13');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('history shows exact completed time and legacy duration without inventing missing timestamps', async ({ page }) => {
  await enterDemo(page);
  await seedSessions(page, [
    session({ status: 'completed', completed_at: '2026-10-16T16:59:12Z', duration_min: 60 }),
    session({ id: 'legacy-time', routine_name: 'Legacy time', status: 'completed', started_at: null, duration_min: 59 }),
    session({ id: 'unknown-time', routine_name: 'Unknown time', status: 'completed', started_at: null }),
  ]);
  await page.goto('/workout-history?session=timed-session');
  const exact = page.getByTestId('session-timed-session').getByTestId('workout-timing');
  await expect(exact.getByTestId('workout-elapsed')).toHaveText('59:12');
  await expect(exact.getByTestId('workout-started').locator('time')).toHaveAttribute('datetime', '2026-10-16T16:00:00.000Z');
  await expect(exact.getByTestId('workout-completed').locator('time')).toHaveAttribute('datetime', '2026-10-16T16:59:12.000Z');
  const legacy = page.getByTestId('session-legacy-time');
  await legacy.getByRole('button', { name: /^View sets for Legacy time/ }).click();
  await expect(legacy.getByTestId('workout-elapsed')).toHaveText('59:00');
  await expect(legacy.getByTestId('workout-started')).toHaveText('Not recorded');
  await expect(legacy.getByTestId('workout-completed')).toHaveText('Not recorded');
  const unknown = page.getByTestId('session-unknown-time');
  await unknown.getByRole('button', { name: /^View sets for Unknown time/ }).click();
  await expect(unknown.getByTestId('workout-elapsed')).toHaveText('Not recorded');
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Español' }).click();
  await expect(unknown.getByTestId('workout-elapsed')).toHaveText('Sin registrar');
  await expect(unknown.getByTestId('workout-started')).toHaveText('Sin registrar');
});
