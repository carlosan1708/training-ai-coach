import { expect, test, type Page } from '@playwright/test';
import { enterDemo } from './helpers';
import type { Message } from '../src/types/chat';

const databaseKey = 'tac_demo_db';
const memoryKey = 'tac_demo_coach_memory_v1';
const quotaKey = 'tac_demo_chat_usage_v1';

async function openCoach(page: Page, language: 'en' | 'es' = 'en') {
  await enterDemo(page);
  if (language === 'es') {
    await page.getByRole('button', { name: 'Language', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Español', exact: true }).click();
  }
  await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
  await expect(page.getByRole('textbox')).toBeVisible();
}

async function savedState(page: Page) {
  return page.evaluate(({ databaseKey, memoryKey, quotaKey }) => ({
    sessions: (JSON.parse(localStorage.getItem(databaseKey)!).chat_sessions ?? []) as { id: string; messages: Message[] }[],
    memory: localStorage.getItem(memoryKey),
    quota: localStorage.getItem(quotaKey),
  }), { databaseKey, memoryKey, quotaKey });
}

async function currentSession(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/store/chatStore.ts';
    const { useChatStore } = await import(modulePath);
    const { ownerUid, generation, sessionId, messages, sending } = useChatStore.getState();
    return { ownerUid, generation, sessionId, messages, sending };
  });
}

for (const language of ['en', 'es'] as const) {
  test(`New chat is visible at 320px and starts a separate persisted demo conversation in ${language}`, async ({ page }) => {
    const es = language === 'es';
    await page.setViewportSize({ width: 320, height: 780 });
    await page.clock.install({ time: new Date('2026-10-17T18:00:00Z') });
    await openCoach(page, language);
    const newChat = page.getByRole('button', { name: es ? 'Nuevo chat' : 'New chat', exact: true });
    const send = page.getByRole('button', { name: es ? 'Enviar' : 'Send', exact: true });
    const composer = page.getByRole('textbox');
    await expect(newChat).toBeInViewport();
    await expect(newChat).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const initial = await savedState(page);
    expect(initial.sessions).toHaveLength(0);
    for (let index = 0; index < 3; index++) await newChat.click();
    expect(await savedState(page)).toEqual(initial);
    expect(await currentSession(page)).toMatchObject({ sessionId: null, messages: [], sending: false });

    const firstMessage = es ? 'Recuerda que prefiero caminar por la mañana.' : 'Remember that I prefer morning walks.';
    const remembered = es ? 'prefiero caminar por la mañana.' : 'I prefer morning walks.';
    await composer.fill(firstMessage);
    await send.click();
    await expect(composer).toBeEnabled();
    await expect(page.getByTestId('assistant-markdown')).toHaveCount(1);
    const first = await savedState(page);
    expect(first.sessions).toHaveLength(1);
    expect(first.sessions[0].messages).toHaveLength(2);
    expect(first.sessions[0].messages[0]).toMatchObject({ role: 'user', content: firstMessage });
    expect(first.sessions[0].messages[1].role).toBe('assistant');
    expect(first.memory).toContain(remembered);
    expect(JSON.parse(first.quota!).count).toBe(1);
    expect((await currentSession(page)).sessionId).toBe(first.sessions[0].id);

    await composer.fill(es ? 'Un borrador sin enviar' : 'An unsent draft');
    await newChat.click();
    await expect(composer).toHaveValue('');
    await expect(page.getByRole('log')).not.toContainText(firstMessage);
    await expect(page.getByTestId('assistant-markdown')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await currentSession(page)).toMatchObject({ sessionId: null, messages: [], sending: false });
    expect(await savedState(page)).toEqual(first);
    for (let index = 0; index < 3; index++) await newChat.click();
    expect(await savedState(page)).toEqual(first);

    const secondMessage = es ? '¿Qué recuerdas sobre mí?' : 'What do you remember about me?';
    await composer.fill(secondMessage);
    await send.click();
    await expect(composer).toBeEnabled();
    await expect(page.getByTestId('assistant-markdown')).toContainText(remembered);
    const second = await savedState(page);
    expect(second.sessions).toHaveLength(2);
    expect(second.sessions.find(session => session.id === first.sessions[0].id)).toEqual(first.sessions[0]);
    const secondId = (await currentSession(page)).sessionId;
    expect(secondId).not.toBe(first.sessions[0].id);
    const next = second.sessions.find(session => session.id === secondId)!;
    expect(next.messages).toHaveLength(2);
    expect(next.messages[0]).toMatchObject({ role: 'user', content: secondMessage });
    expect(next.messages.some(message => message.content === firstMessage)).toBe(false);
    expect(second.memory).toBe(first.memory);
    expect(JSON.parse(second.quota!).count).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('New chat stays disabled during a pending reply and does not detach its persisted session', async ({ page }) => {
  let release!: () => void;
  const pendingReply = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/src/firebase/callables.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/firebase/callables.ts?newChatPendingActual';
    export async function chatFn() {
      const response = await fetch('/__new_chat_pending_reply');
      return { data: await response.json() };
    }` }));
  await page.route('**/__new_chat_pending_reply', async route => {
    requests++;
    await pendingReply;
    await route.fulfill({ json: { reply: 'The synthetic pending reply completed.' } });
  });
  await openCoach(page);
  const newChat = page.getByRole('button', { name: 'New chat', exact: true });
  await page.getByRole('textbox').fill('Keep this conversation attached while waiting');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(newChat).toBeDisabled();
  const active = await currentSession(page);
  expect(active.sessionId).toBeTruthy();
  expect(active.sending).toBe(true);
  try {
    // Even a synthetic click cannot reset the disabled conversation action.
    await newChat.dispatchEvent('click');
    expect(await currentSession(page)).toEqual(active);
  } finally {
    release();
  }
  await expect(page.getByTestId('assistant-markdown')).toContainText('The synthetic pending reply completed.');
  await expect(newChat).toBeEnabled();
  const finished = await savedState(page);
  expect(finished.sessions).toHaveLength(1);
  expect(finished.sessions[0].id).toBe(active.sessionId);
  expect(finished.sessions[0].messages).toHaveLength(2);
  await newChat.click();
  expect(await currentSession(page)).toMatchObject({ sessionId: null, messages: [], sending: false });
  expect(await savedState(page)).toEqual(finished);
  expect(requests).toBe(1);
});

test('New chat clears a failed reply and its restore draft without creating another empty session', async ({ page }) => {
  await page.route('**/src/firebase/callables.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/firebase/callables.ts?newChatFailureActual';
    export async function chatFn() { throw { details: { reason: 'QA_AI_PAUSED' } }; }` }));
  await openCoach(page);
  await page.getByRole('textbox').fill('A synthetic message whose reply fails');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('AI is paused in QA.');
  await page.getByRole('button', { name: 'Restore message', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveValue('A synthetic message whose reply fails');
  const failed = await savedState(page);
  expect(failed.sessions).toHaveLength(1);
  expect(failed.sessions[0].messages).toHaveLength(1);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restore message', exact: true })).toHaveCount(0);
  await expect(page.getByRole('log')).not.toContainText('A synthetic message whose reply fails');
  expect(await currentSession(page)).toMatchObject({ sessionId: null, messages: [], sending: false });
  expect(await savedState(page)).toEqual(failed);
});

test('an account switch discards an in-flight reply without adding it to either conversation', async ({ page }) => {
  let release!: () => void;
  const pendingReply = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/src/firebase/callables.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/firebase/callables.ts?newChatAccountActual';
    export async function chatFn() {
      const response = await fetch('/__new_chat_late_reply');
      return { data: await response.json() };
    }` }));
  await page.route('**/__new_chat_late_reply', async route => {
    requests++;
    await pendingReply;
    await route.fulfill({ json: { reply: 'This old reply belongs only to the original account.' } });
  });
  await openCoach(page);
  await page.getByRole('textbox').fill('The original account started this request');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  const original = await currentSession(page);
  const originalSaved = await savedState(page);
  expect(originalSaved.sessions[0].messages).toHaveLength(1);

  // Exercise the real auth setter; demo mode keeps every listener local. The
  // alternate identity has no seeded profile, so no real sign-in is attempted.
  await page.evaluate(async () => {
    const authPath = '/src/store/authStore.ts';
    const { useAuthStore } = await import(authPath);
    const current = useAuthStore.getState().currentUser;
    useAuthStore.getState().setCurrentUser({ ...current, uid: 'synthetic-other-demo-user' });
  });
  const switched = await currentSession(page);
  expect(switched).toMatchObject({ ownerUid: 'synthetic-other-demo-user', sessionId: null, messages: [], sending: false });
  expect(switched.generation).toBeGreaterThan(original.generation);
  const completed = page.waitForResponse('**/__new_chat_late_reply');
  release();
  await (await completed).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await currentSession(page)).toEqual(switched);
  expect(await savedState(page)).toEqual(originalSaved);

  await page.evaluate(async () => {
    const authPath = '/src/store/authStore.ts', demoPath = '/src/demo/index.ts';
    const [{ useAuthStore }, { DEMO_USER }] = await Promise.all([import(authPath), import(demoPath)]);
    useAuthStore.getState().setCurrentUser(DEMO_USER);
  });
  await expect(page.getByRole('textbox')).toBeVisible();
  await expect(page.getByRole('log')).not.toContainText('This old reply belongs only to the original account.');
  await expect(page.getByTestId('assistant-markdown')).toHaveCount(0);
  expect((await currentSession(page)).sessionId).toBeNull();
  expect(await savedState(page)).toEqual(originalSaved);
});
