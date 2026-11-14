import { expect, test, type Page } from '@playwright/test';

async function openOwnerSpace(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.waitForURL('**/dashboard');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'A stronger community' })).toBeVisible();
}
async function invite(page: Page, email: string) {
  await page.getByRole('button', { name: 'Invite someone', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email address', { exact: true }).fill(email);
  await dialog.getByRole('button', { name: 'Create & send invitation' }).click();
  const field = dialog.getByLabel('Private invitation link');
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  await expect(dialog.getByText('Test invitation captured.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  return link;
}

test('owner overview shows metadata and pending access decisions persist', async ({ page }) => {
  await openOwnerSpace(page);
  await expect(page.getByText('Active today', { exact: true })).toBeVisible();
  await expect(page.getByText('Personal health details and chat content stay private.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await page.getByLabel('Find a person').fill('Jordan');
  await page.getByRole('button', { name: 'Approve access', exact: true }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await page.getByLabel('Find a person').fill('Jordan');
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
});

test('invitation resend replaces the link and revocation persists', async ({ page }) => {
  await openOwnerSpace(page);
  const first = await invite(page, 'friend@example.test');
  await page.getByRole('tab', { name: 'Invitations', exact: true }).click();
  await page.getByRole('button', { name: 'Resend & get link', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Private invitation link')).toBeVisible();
  expect(await dialog.getByLabel('Private invitation link').inputValue()).not.toEqual(first);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Invitations', exact: true }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
});

test('a matching signed-in account can accept its invitation', async ({ page }) => {
  await openOwnerSpace(page);
  const link = await invite(page, 'demo@training-ai-coach.app');
  await page.goto(link);
  await expect(page.getByRole('heading', { name: "You're in. Let's make progress." })).toBeVisible();
  await expect(page).toHaveURL(/\/invite$/);
  await page.getByRole('button', { name: "Let's get started" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('wrong-email invitation explains how to switch accounts', async ({ page }) => {
  await openOwnerSpace(page);
  const link = await invite(page, 'other@example.test');
  await page.goto(link);
  await expect(page.getByText('This invitation belongs to another email.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use a different account' })).toBeVisible();
});
