import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { enterDemo } from './helpers';

test.use({ locale: 'en-US', timezoneId: 'America/Costa_Rica' });

for (const width of [320, 1280]) {
  test(`returning users reach saved routines and workout history before creation and measurement detail at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await enterDemo(page);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
    await page.goto('/routines');
    const routine = page.getByRole('heading', { name: 'Upper Body Strength', exact: true });
    await expect(routine).toBeVisible();
    const creation = page.getByRole('button', { name: 'Generate with AI', exact: true });
    expect((await routine.boundingBox())!.y).toBeLessThan((await creation.boundingBox())!.y);
    await page.goto('/progress');
    const history = page.getByRole('button', { name: 'Explore your history', exact: true });
    await expect(history).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`progress-actions-${width}.png`), animations: 'disabled' });
    await history.click();
    await expect(page).toHaveURL(/\/workout-history$/);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
    expect(after.routines).toEqual(before.routines);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.logs).toEqual(before.logs);
  });
}

test('four main destinations and mobile account actions remain easy to reach', async ({ page }) => {
  await enterDemo(page);
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  for (const name of ['Today', 'Train', 'Progress', 'Coach']) {
    await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await navigation.getByRole('button', { name: 'Train', exact: true }).click();
  await expect(page).toHaveURL(/\/routines$/);
  await expect(page.getByRole('heading', { name: 'Workout Routines', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole('button', { name: 'Explore your history', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Coach', exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Sign Out', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Your profile', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
});

test('profile changes persist and optional body information clears without changing recorded loads', async ({ page }) => {
  await enterDemo(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.profile.workout_weight_unit = 'lb';
    db.profile.units = 'metric';
    localStorage.setItem('tac_demo_db', JSON.stringify(db));
  });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  await page.goto('/profile');
  await page.getByLabel('Full Name', { exact: false }).fill('Alex Training');
  await page.getByLabel('Age', { exact: true }).fill('');
  await page.getByLabel('Height (cm)', { exact: true }).fill('');
  await page.getByLabel('Goal Weight (kg)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Your profile is up to date.', { exact: true })).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
  expect(after.profile.name).toBe('Alex Training');
  expect(after.profile.age).toBeUndefined();
  expect(after.profile.height_cm).toBeUndefined();
  expect(after.profile.goal_weight_kg).toBeUndefined();
  expect(after.profile.workout_weight_unit).toBe('lb');
  expect(after.profile.units).toBe('metric');
  expect(after.logs).toEqual(before.logs);
  expect(after.sessions).toEqual(before.sessions);
  await page.reload();
  await expect(page.getByLabel('Full Name', { exact: false })).toHaveValue('Alex Training');
  await expect(page.getByLabel('Goal Weight (kg)', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: /^Your training Goals/ }).click();
  await expect(page.getByRole('combobox', { name: /^Workout weights/ })).toHaveText('lb');
});

for (const viewport of [{ width: 320, height: 740 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
  test('responsive pages and chat composer fit at ' + viewport.width + 'px', async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterDemo(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const route of ['/dashboard', '/routines', '/progress', '/profile', '/chat']) {
      await page.goto(route);
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (route === '/chat') {
        const composer = page.getByRole('textbox');
        await expect(composer).toBeInViewport();
        await composer.fill('How should I train today?');
        await composer.focus();
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
        const bounds = await composer.boundingBox();
        expect(bounds!.y + bounds!.height).toBeLessThan(viewport.height - (viewport.width < 900 ? 70 : 0));
      }
    }
    expect(errors).toEqual([]);
  });
}

for (const viewport of [{ width: 390, height: 844, label: 'mobile' }, { width: 1440, height: 1000, label: 'desktop' }]) {
  test('capture redesigned pages on ' + viewport.label, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterDemo(page);
    const directory = path.resolve('test-results/design');
    await mkdir(directory, { recursive: true });
    for (const [label, route] of [['today', '/dashboard'], ['train', '/routines'], ['progress', '/progress']] as const) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (label === 'today') await expect(page.getByText('WINS', { exact: true })).toBeVisible();
      if (label === 'train') await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.complete ? undefined : new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
        window.setTimeout(resolve, 3000);
      }))));
      await page.screenshot({ path: path.join(directory, viewport.label + '-' + label + '.png'), fullPage: true, animations: 'disabled' });
    }
    await page.goto('/routines');
    await page.getByText('Lower Body Power', { exact: true }).click();
    await page.getByRole('button', { name: /Start Workout|Resume workout/, exact: true }).click();
    await page.waitForURL('**/session/**');
    await expect(page.getByRole('button', { name: 'Finish workout', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(directory, viewport.label + '-session.png'), fullPage: true, animations: 'disabled' });
  });
}
