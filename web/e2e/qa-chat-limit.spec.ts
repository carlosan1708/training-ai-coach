import { expect, test } from '@playwright/test';
import { enterDemo } from './helpers';

for (const language of ['en', 'es'] as const) {
  test(`demo daily chat limit is clear in ${language} and restores the draft without retrying`, async ({ page }) => {
    let attempts = 0;
    await page.clock.install();
    await page.route('**/src/firebase/callables.ts', route => route.fulfill({ contentType: 'application/javascript', body:
      `export * from '/src/firebase/callables.ts?chatLimitActual';
       export async function chatFn() { await fetch('/__qa_chat_attempt', { method: 'POST' });
         throw { code: 'functions/resource-exhausted', details: { reason: 'QA_MANUAL_CHAT_LIMIT' } }; }` }));
    await page.route('**/__qa_chat_attempt', route => { attempts += 1; return route.fulfill({ json: {} }); });
    await enterDemo(page);
    if (language === 'es') {
      await page.getByRole('button', { name: 'Language', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Español', exact: true }).click();
    }
    await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
    const composer = page.getByRole('textbox');
    const message = language === 'es' ? 'Revisemos mi entrenamiento mañana' : 'Review my training tomorrow';
    await composer.fill(message);
    await page.getByRole('button', { name: language === 'es' ? 'Enviar' : 'Send', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(language === 'es'
      ? 'La demostración incluye 10 mensajes al día.'
      : 'The demo includes 10 chat messages per day.');
    await expect(composer).toHaveValue('');
    expect(attempts).toBe(1);
    await page.getByRole('button', { name: language === 'es' ? 'Recuperar mensaje' : 'Restore message', exact: true }).click();
    await expect(composer).toHaveValue(message);
    await page.clock.fastForward(60_000);
    expect(attempts).toBe(1);
    await expect(composer).toHaveValue(message);
  });
}

test('the separate closed-QA reason still shows the existing paused-AI message', async ({ page }) => {
  await page.route('**/src/firebase/callables.ts', route => route.fulfill({ contentType: 'application/javascript', body:
    `export * from '/src/firebase/callables.ts?chatPausedActual';
     export async function chatFn() { throw { details: { reason: 'QA_AI_PAUSED' } }; }` }));
  await enterDemo(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('textbox').fill('Synthetic paused chat');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('AI is paused in QA. Ask to open a temporary test window, or explore the demo.');
  await expect(page.getByRole('alert')).not.toContainText('today’s QA chat limit');
});
