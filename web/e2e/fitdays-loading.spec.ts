import { expect, test } from '@playwright/test';
import { enterDemo, TINY_PNG } from './helpers';

const fixture = { import_id: 'synthetic-recovered-fitdays', status: 'review', warnings: [], entries: [{
  measured_at: '2026-10-20', source_name: 'Fitdays', method: 'bia',
  metrics: [{ key: 'weight_kg', label: 'Weight', value: 80, unit: 'kg' }],
}] };

for (const [language, width] of [['en', 1280], ['es', 360]] as const) {
  test(`Fitdays upload and slow extraction recover without reuploading or changing history in ${language}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.clock.install();
    await page.route('**/src/firebase/storage.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
      export * from '/src/firebase/storage.ts?realUpload';
      export function uploadBodyCompositionReport(uid,file,progress) {
        window.uploadCalls=(window.uploadCalls??0)+1;
        progress(37);
        return new Promise(resolve=>window.finishUpload=()=>{progress(100);resolve({storagePath:'demo/synthetic.png',downloadUrl:URL.createObjectURL(file)})});
      }` }));
    await page.route('**/src/firebase/measurements.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
      export * from '/src/firebase/measurements.ts?realImport';
      export function parseMeasurementImport(){
        window.extractCalls=(window.extractCalls??0)+1;
        return new Promise((resolve,reject)=>{
          window.failReading=()=>reject({code:'functions/deadline-exceeded'});
          window.finishReading=()=>resolve(${JSON.stringify(fixture)});
        });
      }` }));
    await enterDemo(page);
    await page.evaluate(language => { localStorage.setItem('ui_language',language); const db=JSON.parse(localStorage.getItem('tac_demo_db')!);db.profile.ui_language=language;localStorage.setItem('tac_demo_db',JSON.stringify(db)); }, language);
    const original = await page.evaluate(() => localStorage.getItem('tac_demo_db'));
    await page.goto('/progress');
    await page.getByRole('button', { name: language === 'es' ? 'Añadir mediciones' : 'Add measurements', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: language === 'es' ? 'Subir informe' : 'Upload report', exact: true }).click();
    await dialog.locator('input[type=file]').setInputFiles({ name: 'synthetic-fitdays.png', mimeType: 'image/png', buffer: TINY_PNG });
    const picture = dialog.getByRole('img');
    const preview = await picture.getAttribute('src');
    await dialog.getByRole('button', { name: language === 'es' ? 'Guardar informe' : 'Save report', exact: true }).click();
    const progress = dialog.getByTestId('measurement-import-status');
    await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow','37');
    await expect(dialog.getByTestId('measurement-submit')).toBeDisabled();
    await page.evaluate(() => (window as Window & { finishUpload: () => void }).finishUpload());
    await expect(progress.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    await page.clock.fastForward(152_000);
    await expect(progress).toContainText(language === 'es' ? 'Seguimos leyendo' : 'Still reading');
    await expect(progress).toBeInViewport({ ratio: 0.9 });
    expect(await page.evaluate(() => localStorage.getItem('tac_demo_db'))).toBe(original);
    await page.screenshot({ path: test.info().outputPath(`fitdays-reading-${language}.png`), animations: 'disabled' });
    await page.evaluate(() => (window as Window & { failReading: () => void }).failReading());
    await expect(dialog.getByRole('alert')).toContainText(language === 'es' ? 'La lectura tardó demasiado' : 'Reading took too long');
    await expect(picture).toHaveAttribute('src',preview!);
    await dialog.getByRole('button', { name: language === 'es' ? 'Reintentar' : 'Try again', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as Window & { extractCalls: number }).extractCalls)).toBe(2);
    expect(await page.evaluate(() => (window as Window & { uploadCalls: number }).uploadCalls)).toBe(1);
    await page.evaluate(() => (window as Window & { finishReading: () => void }).finishReading());
    await expect(dialog).not.toBeVisible();
    await expect(progress).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_measurements_v1')!).entries[0]);
    expect(saved.measured_at).toBe(fixture.entries[0].measured_at);
    expect(saved.metrics[0]).toMatchObject(fixture.entries[0].metrics[0]);
    expect(saved.source_storage_path).toBe('demo/synthetic.png');
    expect(await page.evaluate(() => (window as Window & { uploadCalls: number }).uploadCalls)).toBe(1);
    expect(await page.evaluate(() => (window as Window & { extractCalls: number }).extractCalls)).toBe(2);
  });
}

test('real callable client keeps waiting past 70 seconds for a 152-second extraction', async ({ page }) => {
  await page.clock.install();
  let finish: (() => Promise<void>) | undefined;
  await page.route(/https:\/\/.*cloudfunctions\.net\/parse_measurement_import/, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*' } });
    await new Promise<void>(resolve => { finish = async () => { await route.fulfill({ json: { result: fixture }, headers: { 'Access-Control-Allow-Origin':'*' } }); resolve(); }; });
  });
  await page.route('**/__fitdays-client', route => route.fulfill({ contentType: 'text/html', body: `<script type="module">
    import {parseMeasurementImport} from '/src/firebase/measurements.ts';
    window.state='pending';parseMeasurementImport({text:'Synthetic report'}).then(result=>{window.state='ready';window.result=result},error=>{window.state=error.code});
  </script>` }));
  await page.goto('/__fitdays-client');
  await expect.poll(() => !!finish).toBe(true);
  await page.clock.fastForward(152_000);
  expect(await page.evaluate(() => (window as Window & { state: string }).state)).toBe('pending');
  await finish!();
  await expect.poll(() => page.evaluate(() => (window as Window & { state: string }).state)).toBe('ready');
});

test('upload URL lookup failure rejects cleanly instead of leaving the form waiting forever', async ({ page }) => {
  await page.route('**/src/firebase/config.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export const storage={};' }));
  await page.route('**/node_modules/.vite/deps/firebase_storage.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const ref=()=>({}); export const deleteObject=()=>{};
    export const getDownloadURL=async()=>{throw {code:'storage/unauthorized'}};
    export const uploadBytesResumable=()=>({snapshot:{ref:{}},on:(name,progress,error,done)=>{progress({bytesTransferred:50,totalBytes:100});done()}});
  ` }));
  await page.route('**/__fitdays-upload', route => route.fulfill({ contentType: 'text/html', body: `<script type="module">
    import {uploadBodyCompositionReport} from '/src/firebase/storage.ts';
    window.state='pending';uploadBodyCompositionReport('synthetic',new File(['synthetic'],'test.png'),pct=>window.progress=pct)
      .then(()=>window.state='ready',error=>window.state=error.code);
  </script>` }));
  await page.goto('/__fitdays-upload');
  await expect.poll(() => page.evaluate(() => (window as Window & { state: string }).state)).toBe('storage/unauthorized');
  expect(await page.evaluate(() => (window as Window & { progress: number }).progress)).toBe(50);
});
