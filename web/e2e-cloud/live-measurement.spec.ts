import { test, expect, signIn } from './fixtures';

function syntheticReport(date: string) {
  const lines = ['Training Coach QA - SYNTHETIC MEASUREMENT REPORT', 'Source: QA synthetic scale',
    'Method: BIA body composition scale', 'Measurement date: ' + date,
    'Weight: 78.4 kg', 'Body fat: 21.3 %', 'Waist: 84 cm'];
  const stream = 'BT /F1 13 Tf 45 760 Td ' + lines.map((line, index) => (index ? '0 -26 Td ' : '') + '(' + line + ') Tj').join(' ') + ' ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream'];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(pdf);
}

test('explicit live AI: upload, review and summarize one synthetic measurement report', async ({ page }) => {
  test.skip(process.env.QA_LIVE_AI_TESTS !== 'true', 'Requires a separately requested paid live-AI QA run.');
  test.setTimeout(300_000);
  const date = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const runId = (process.env.QA_RUN_ID || 'manual-' + Date.now()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const source = 'QA live ' + runId;
  await signIn(page, 'approvedB');
  await page.goto('/progress');
  await page.getByRole('button', { name: 'Add measurements', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Upload report', exact: true }).click();
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'qa-synthetic-' + runId + '.pdf', mimeType: 'application/pdf', buffer: syntheticReport(date) });
  await dialog.getByRole('button', { name: 'Extract measurements', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review your measurements', exact: true })).toBeVisible({ timeout: 150_000 });
  await expect(dialog.getByLabel('Measurement date', { exact: true }).first()).toHaveValue(date);
  const values = await dialog.getByLabel('Value', { exact: true }).evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
  expect(values).toContain('78.4');
  expect(values).toContain('21.3');
  expect(values).toContain('84');
  await dialog.getByLabel('Scale or source', { exact: false }).first().fill(source);
  await dialog.getByLabel('Notes (optional)', { exact: true }).first().fill('Synthetic QA live-AI run ' + runId + '. No personal data.');
  await dialog.getByRole('button', { name: 'Save measurements', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(source, { exact: false }).first()).toBeVisible();
  // Saving enqueues the real summary worker. Never turn this into a default smoke test.
  await expect(page.getByText('Your saved progress memory', { exact: true })).toBeVisible({ timeout: 150_000 });
  // Keep the one reviewed reading as QA evidence. Its source/notes identify this run;
  // deleting it also enqueues AI work, so cleanup requires its own explicit scope.
});
