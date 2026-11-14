import { expect, test, type Page } from '@playwright/test';
import { enterDemo } from './helpers';
import type { Message } from '../src/types/chat';

const formattedReply = `# Your weekly progress

You completed **three workouts** and kept a *steady pace*.

## A friendly plan

- Keep your warm-up gentle.
- Rest between sets.

1. Review your last session.
2. Choose a comfortable load.

| Metric | Last week | This week |
| --- | --- | --- |
| Sessions | 2 | 3 |
| Body weight | 72 kg | 71.8 kg |

> Small steps add up.

Use \`comfortable effort\` as your guide.`;

async function openCoach(page: Page) {
  await enterDemo(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
  await expect(page.getByRole('textbox')).toBeVisible();
}

async function setHistoricalMessages(page: Page, content: string) {
  const messages: Message[] = [
    { id: 'historical-user', role: 'user', content: 'Review my previous week', timestamp: '2026-10-17T12:00:00Z' },
    { id: 'historical-assistant', role: 'assistant', content, timestamp: '2026-10-17T12:00:01Z' },
  ];
  await page.evaluate(async stored => {
    const modulePath = '/src/store/chatStore.ts';
    const { useChatStore } = await import(modulePath);
    useChatStore.getState().setMessages(stored);
  }, messages);
}

test('new coach replies render headings, emphasis, lists and tables while user messages stay plain', async ({ page }) => {
  await page.route('**/src/firebase/callables.ts', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export * from '/src/firebase/callables.ts?markdownActual';
      export async function chatFn() { return { data: { reply: ${JSON.stringify(formattedReply)} } }; }`,
  }));
  await openCoach(page);
  const userMessage = '# My **literal** question';
  await page.getByRole('textbox').fill(userMessage);
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const reply = page.getByTestId('assistant-markdown');
  await expect(reply.getByRole('heading', { name: 'Your weekly progress', level: 2 })).toBeVisible();
  await expect(reply.getByRole('heading', { name: 'A friendly plan', level: 3 })).toBeVisible();
  await expect(reply.locator('strong')).toHaveText('three workouts');
  await expect(reply.locator('em')).toHaveText('steady pace');
  await expect(reply.locator('ul > li')).toHaveCount(2);
  await expect(reply.locator('ol > li')).toHaveCount(2);
  await expect(reply.getByRole('table').getByRole('row')).toHaveCount(3);
  await expect(reply.getByRole('cell', { name: '71.8 kg', exact: true })).toBeVisible();
  await expect(reply.locator('blockquote')).toHaveText('Small steps add up.');
  await expect(reply.locator('code')).toHaveText('comfortable effort');
  await expect(page.getByText(userMessage, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My literal question' })).toHaveCount(0);
});

test('historical assistant messages use the same Markdown renderer after returning to Coach', async ({ page }) => {
  await openCoach(page);
  await setHistoricalMessages(page, formattedReply);
  await page.getByRole('navigation').getByRole('button', { name: 'Train', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Coach', exact: true }).click();
  const reply = page.getByTestId('assistant-markdown');
  await expect(reply.getByRole('heading', { name: 'Your weekly progress', level: 2 })).toBeVisible();
  await expect(reply.locator('strong')).toHaveText('three workouts');
  await expect(reply.getByRole('table')).toHaveCount(1);
  await expect(page.getByTestId('assistant-markdown')).toHaveCount(1);
});

test('Markdown blocks scripts, raw HTML, unsafe links and remote images while preserving safe links', async ({ page }) => {
  let trackingRequests = 0;
  await page.route('https://tracking.invalid/**', route => { trackingRequests += 1; return route.abort(); });
  await openCoach(page);
  await setHistoricalMessages(page, `## Safe content

[Secure resource](https://example.test/guide?week=1)
[HTTP resource](http://example.test/guide)
[Email coach](mailto:coach@example.test)
[Unsafe script](javascript:alert%281%29)
[Unsafe data](data:text/html,test)
[Relative destination](/admin)

![Tracking image description](https://tracking.invalid/pixel.png)

<script>window.__markdownExecuted = true</script>

<img src="https://tracking.invalid/raw.png" onerror="window.__markdownExecuted = true">

<iframe src="https://tracking.invalid/frame"></iframe>

Text with <b>raw HTML emphasis</b> remains readable.`);
  const reply = page.getByTestId('assistant-markdown');
  await expect(reply.getByRole('heading', { name: 'Safe content', level: 3 })).toBeVisible();
  for (const [name, href] of [
    ['Secure resource', 'https://example.test/guide?week=1'],
    ['HTTP resource', 'http://example.test/guide'],
    ['Email coach', 'mailto:coach@example.test'],
  ]) {
    const link = reply.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  for (const label of ['Unsafe script', 'Unsafe data', 'Relative destination']) {
    await expect(reply.getByText(label, { exact: true })).toBeVisible();
    await expect(reply.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }
  await expect(reply.getByText('Tracking image description', { exact: true })).toBeVisible();
  await expect(reply).toContainText('raw HTML emphasis');
  await expect(reply.locator('script, img, iframe, b')).toHaveCount(0);
  await expect(reply.getByRole('link')).toHaveCount(3);
  expect(await page.evaluate(() => '__markdownExecuted' in window)).toBe(false);
  expect(trackingRequests).toBe(0);
});

for (const width of [320, 768, 1440]) {
  test(`wide Markdown tables scroll within the message at ${width}px without page overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openCoach(page);
    const columns = Array.from({ length: 12 }, (_, index) => `Week ${index + 1}`);
    const table = `# A longer progress view

| ${columns.join(' | ')} |
| ${columns.map(() => '---').join(' | ')} |
| ${columns.map(() => '72.0 kg, steady progress').join(' | ')} |

One long reference: https://example.test/${'training-progress-'.repeat(20)}

\`\`\`text
${'a-long-code-example-'.repeat(30)}
\`\`\``;
    await setHistoricalMessages(page, table);
    const reply = page.getByTestId('assistant-markdown');
    await expect(reply.getByRole('table')).toBeVisible();
    const dimensions = await reply.getByRole('table').evaluate(tableElement => {
      const scroller = tableElement.parentElement!;
      return { client: scroller.clientWidth, scroll: scroller.scrollWidth };
    });
    expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bubble = await reply.boundingBox();
    expect(bubble!.x + bubble!.width).toBeLessThanOrEqual(width);
    await reply.getByRole('table').evaluate(tableElement => { tableElement.parentElement!.scrollLeft = 200; });
    expect(await reply.getByRole('table').evaluate(tableElement => tableElement.parentElement!.scrollLeft)).toBeGreaterThan(0);
    await expect(page.getByRole('textbox')).toBeInViewport();
    await page.getByRole('textbox').fill('The composer is still usable');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  });
}
