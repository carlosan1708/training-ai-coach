import { expect, test, type Locator, type Page } from '@playwright/test';
import type { DemoDb } from '../src/demo/db';
import { enterDemo } from './helpers';

test.use({ timezoneId: 'America/Costa_Rica' });

async function seedScheduledCard(page: Page, language: 'en' | 'es', completed: boolean) {
  await page.clock.install({ time: new Date('2026-10-18T18:00:00Z') });
  await enterDemo(page);
  await page.evaluate(({ language, completed }) => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    const routineId = 'synthetic-hero-routine';
    const dayId = 'synthetic-sunday';
    db.profile.preferred_routine_id = routineId;
    db.profile.ui_language = language;
    db.routines = [{
      id: routineId, name: 'Synthetic current routine', exercises: [], session_count: completed ? 2 : 1,
      days: [
        { id: dayId, name: 'Synthetic Sunday workout', scheduled_weekdays: [0], exercises: [{ id: 'synthetic-squat', name: 'Squat', sets: 2, reps: 8, weight_kg: 30 }] },
        { id: 'synthetic-friday', name: 'Synthetic Friday workout', scheduled_weekdays: [5], exercises: [{ id: 'synthetic-row', name: 'Row', sets: 2, reps: 10, weight_kg: 20 }] },
      ],
    }];
    const historicalSession = {
      id: 'synthetic-historical-session', routine_id: routineId, routine_name: 'Synthetic current routine',
      day_id: dayId, day_name: 'Synthetic Sunday workout', date: '2025-06-01', status: 'completed' as const,
      started_at: 1748800800000, completed_at: 1748802600000, duration_min: 30,
      exercises: [{ name: 'Squat', routine_exercise_id: 'synthetic-squat', target_sets: 2, target_reps: 8, target_weight_kg: 30,
        sets: [{ reps: 8, weight_kg: 30, done: true }, { reps: 7, weight_kg: 32.5, done: true }] }],
    };
    db.sessions = [historicalSession];
    if (completed) db.sessions.push({ ...historicalSession, id: 'synthetic-today-session', date: '2026-10-18',
      started_at: Date.now() - 1_800_000, completed_at: Date.now() });
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
    localStorage.setItem('ui_language', language);
  }, { language, completed });
  await page.reload();
}

async function historySnapshot(page: Page) {
  return page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!) as DemoDb;
    return { sessions: db.sessions, routines: db.routines, logs: db.logs, reports: db.reports,
      canonicalMeasurements: localStorage.getItem('tac_demo_measurements_v1') };
  });
}

async function assertReadableAction(button: Locator) {
  const appearance = await button.evaluate(element => {
    const style = getComputedStyle(element);
    const card = element.closest('.MuiCard-root');
    return { foreground: style.color, background: style.backgroundColor, opacity: style.opacity,
      gradient: card ? getComputedStyle(card).backgroundImage : '' };
  });
  const parseColor = (color: string) => color.replace(/rgba?\(|\)/g, '').split(',').map(Number);
  const foreground = parseColor(appearance.foreground);
  const background = parseColor(appearance.background);
  const stops = [...appearance.gradient.matchAll(/rgba?\([^)]+\)/g)].map(match => parseColor(match[0]));
  expect(stops.length).toBeGreaterThanOrEqual(2);
  expect(appearance.opacity).toBe('1');
  const luminance = (rgb: number[]) => rgb.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = stops.map(stop => {
    const alpha = background[3] ?? 1;
    const composedBackground = stop.map((channel, index) => background[index] * alpha + channel * (1 - alpha));
    const textAlpha = foreground[3] ?? 1;
    const composedText = composedBackground.map((channel, index) => foreground[index] * textAlpha + channel * (1 - textAlpha));
    const values = [luminance(composedText), luminance(composedBackground)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  });
  // Check both gradient ends so the label remains readable as the actions wrap.
  expect(Math.min(...contrast), `Button colors ${appearance.foreground} on ${appearance.background} over ${appearance.gradient}`).toBeGreaterThanOrEqual(4.5);
}

for (const language of ['en', 'es'] as const) {
  for (const width of [360, 1280]) {
    for (const completed of [false, true]) {
      test(`the ${completed ? 'completed' : 'pending'} workout card keeps Change day readable and non-mutating in ${language} at ${width}px`, async ({ page }, testInfo) => {
        const es = language === 'es';
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await seedScheduledCard(page, language, completed);
        const actionName = es ? 'Cambiar día' : 'Change day';
        const changeDay = page.getByRole('button', { name: actionName, exact: true });
        const card = page.locator('.MuiCard-root').filter({ has: changeDay });
        await expect(card.getByRole('heading', { name: 'Synthetic current routine', exact: true })).toBeVisible();
        await expect(card.getByText(completed ? es ? 'Completado' : 'Completed' : es ? 'Pendiente' : 'Pending', { exact: true })).toBeVisible();
        await expect(changeDay).toHaveText(actionName);
        await expect(changeDay).toBeVisible();
        await expect(changeDay).toBeEnabled();
        await assertReadableAction(changeDay);
        const before = await historySnapshot(page);
        await changeDay.hover();
        await page.clock.runFor(300);
        await assertReadableAction(changeDay);
        if (completed && !es) await card.screenshot({ path: testInfo.outputPath(`completed-workout-card-${width}.png`), animations: 'disabled' });
        await changeDay.click();
        const dialog = page.getByRole('dialog', { name: actionName, exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('combobox', { name: es ? /^Día de entrenamiento/ : /^Training day/ })).toBeEnabled();
        await dialog.getByRole('button', { name: es ? 'Cancelar' : 'Cancel', exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page).toHaveURL(/\/dashboard$/);
        expect(await historySnapshot(page)).toEqual(before);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      });
    }
  }
}
