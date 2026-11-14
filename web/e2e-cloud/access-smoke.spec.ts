import { test, expect, signIn } from './fixtures';
import { qaAccounts } from './guard';

test('public QA welcome still offers Google sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the demo', exact: true })).toBeVisible();
});

test('approved A can browse personal training and measurements', async ({ page }) => {
  await signIn(page, 'approvedA');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Welcome, QA!', exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  for (const name of ['Today', 'Train', 'Progress', 'Coach']) await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Train', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'QA Athlete A baseline routine', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your progress, in perspective', exact: true })).toBeVisible();
  await expect(page.getByText('QA Athlete A synthetic scale', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('QA Athlete B synthetic scale', { exact: false })).toHaveCount(0);
});

test('approved B cannot enter owner pages or see A measurements', async ({ page }) => {
  await signIn(page, 'approvedB');
  await page.goto('/progress');
  await expect(page.getByText('QA Athlete B synthetic scale', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('QA Athlete A synthetic scale', { exact: false })).toHaveCount(0);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'A stronger community', exact: true })).toHaveCount(0);
});

test('pending synthetic account stays behind the approval gate', async ({ page }) => {
  await signIn(page, 'pending');
  await expect(page).toHaveURL(/\/pending-approval$/);
  await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeVisible();
  await page.goto('/progress');
  await expect(page).toHaveURL(/\/pending-approval$/);
  await expect(page.getByRole('heading', { name: 'Your progress, in perspective', exact: true })).toHaveCount(0);
});

test('rejected synthetic account stays behind the declined gate', async ({ page }) => {
  await signIn(page, 'rejected');
  await expect(page).toHaveURL(/\/rejected$/);
  await page.goto('/routines');
  await expect(page).toHaveURL(/\/rejected$/);
  await expect(page.getByRole('heading', { name: 'Workout Routines', exact: true })).toHaveCount(0);
});

test('owner can read usage and people metadata without private health content', async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'A stronger community', exact: true })).toBeVisible();
  await expect(page.getByText('Personal health details and chat content stay private.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await page.getByLabel('Find a person', { exact: true }).fill(qaAccounts().pending.email);
  await expect(page.getByText('QA Pending', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve access', exact: true })).toBeVisible();
  await expect(page.getByText('QA Athlete A synthetic scale', { exact: false })).toHaveCount(0);
  // This smoke test deliberately leaves status, invitations, workouts and reports unchanged.
});
