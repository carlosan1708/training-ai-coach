import { expect, test } from '@playwright/test';
import { enterDemo, TINY_PNG } from './helpers';

const KEY = 'tac_demo_measurements_v1';
const reading = { measured_at: '2026-10-14', source_name: 'Fitdays', method: 'bia', metrics: [
  { key: 'weight_kg', label: 'Weight', value: 77.4, unit: 'kg' },
  { key: 'left_arm_muscle_reference_pct', label: 'Left arm muscle relative to standard', value: 122.9, unit: '%' },
] };

for (const [language, committed, closeAfterFailure] of [['en', false, false], ['es', true, false], ['en', true, true]] as const) {
  test(`smart-scale save retry retains the image and extracted results; committed=${committed}, close=${closeAfterFailure}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await page.route('**/src/firebase/storage.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
      export * from '/src/firebase/storage.ts?saveFirstStorage';
      export async function uploadBodyCompositionReport(uid,file,progress){
        window.uploads=(window.uploads??0)+1;progress(100);
        return {storagePath:'demo/retained-scale.png',downloadUrl:URL.createObjectURL(file)};
      }
      export async function deleteStoredFile(){window.deletedOriginals=(window.deletedOriginals??0)+1;}` }));
    await page.route('**/src/firebase/measurements.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
      export * from '/src/firebase/measurements.ts?saveFirstBoundary';
      import {saveMeasurementEntries as realSave} from '/src/firebase/measurements.ts?saveFirstBoundary';
      export async function parseMeasurementImport(){window.reads=(window.reads??0)+1;return ${JSON.stringify({ import_id: 'synthetic-save-first', status: 'review', warnings: [], entries: [reading] })};}
      export async function saveMeasurementEntries(...args){
        window.saveAttempts=(window.saveAttempts??0)+1;
        (window.requestIds??=[]).push(args[2]);
        if(window.saveAttempts===1){${committed ? 'await realSave(...args);' : ''}throw {code:'functions/unavailable'};}
        return realSave(...args);
      }` }));
    await enterDemo(page);
    await page.evaluate(language => {
      localStorage.setItem('ui_language', language);
      const db=JSON.parse(localStorage.getItem('tac_demo_db')!);db.profile.ui_language=language;
      localStorage.setItem('tac_demo_db',JSON.stringify(db));localStorage.removeItem('tac_demo_measurements_v1');
    },language);
    const originalWorkouts = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions);
    await page.goto('/progress');
    await page.getByRole('button',{name:language==='es'?'Añadir mediciones':'Add measurements',exact:true}).first().click();
    const dialog=page.getByRole('dialog');
    await dialog.getByRole('tab',{name:language==='es'?'Subir informe':'Upload report',exact:true}).click();
    await dialog.locator('input[type=file]').setInputFiles({name:'synthetic-smart-scale.png',mimeType:'image/png',buffer:TINY_PNG});
    const image=await dialog.getByRole('img').getAttribute('src');
    await dialog.getByRole('button',{name:language==='es'?'Guardar informe':'Save report',exact:true}).click();
    await expect(dialog.getByRole('alert')).toContainText(language==='es'?'El informe ya se leyó':'Your report was read');
    await expect(dialog.getByRole('img')).toHaveAttribute('src',image!);
    await expect(dialog.getByTestId('measurement-draft-0')).toHaveCount(0);
    const beforeRetry=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null'),KEY);
    expect(beforeRetry?.entries.length??0).toBe(committed?1:0);
    if(closeAfterFailure){
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
      await expect(dialog).not.toBeVisible();
      expect(await page.evaluate(()=>(window as Window & {deletedOriginals?:number}).deletedOriginals??0)).toBe(0);
      expect(beforeRetry.entries[0].source_storage_path).toBe('demo/retained-scale.png');
      return;
    }
    await dialog.getByRole('button',{name:language==='es'?'Reintentar guardado':'Retry saving',exact:true}).click();
    await expect(dialog).not.toBeVisible();
    const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),KEY);
    expect(saved.entries).toHaveLength(1);
    expect(saved.jobs).toHaveLength(1);
    expect(saved.entries[0].metrics).toEqual(expect.arrayContaining(reading.metrics.map(metric=>expect.objectContaining(metric))));
    if(committed)expect(saved.entries[0].id).toBe(beforeRetry.entries[0].id);
    const calls=await page.evaluate(()=>({uploads:(window as Window & {uploads:number}).uploads,reads:(window as Window & {reads:number}).reads,ids:(window as Window & {requestIds:string[]}).requestIds,deleted:(window as Window & {deletedOriginals?:number}).deletedOriginals??0}));
    expect(calls.uploads).toBe(1);expect(calls.reads).toBe(1);expect(calls.ids[0]).toBe(calls.ids[1]);expect(calls.deleted).toBe(0);
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('tac_demo_db')!).sessions)).toEqual(originalWorkouts);
  });
}

test('an invalid body-fat share remains editable without blocking legitimate reference ratios', async ({ page }) => {
  await page.route('**/src/firebase/measurements.ts', route=>route.fulfill({contentType:'application/javascript',body:`
    export * from '/src/firebase/measurements.ts?invalidShare';
    export async function parseMeasurementImport(){return ${JSON.stringify({import_id:'synthetic-invalid-share',warnings:[],status:'review',entries:[{...reading,metrics:[{key:'body_fat_pct',label:'Body fat',value:120,unit:'%'},...reading.metrics]}]})};}` }));
  await enterDemo(page);
  await page.evaluate(key=>localStorage.removeItem(key),KEY);
  await page.goto('/progress');
  await page.getByRole('button',{name:'Add measurements',exact:true}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('tab',{name:'Upload report',exact:true}).click();
  await dialog.locator('input[type=file]').setInputFiles({name:'synthetic-invalid.png',mimeType:'image/png',buffer:TINY_PNG});
  await dialog.getByRole('button',{name:'Save report',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('One reading needs a correction');
  expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
  await dialog.getByRole('textbox',{name:'Value',exact:true}).first().fill('20');
  await dialog.getByRole('button',{name:'Save report',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).entries[0],KEY);
  expect(saved.metrics[0].value).toBe(20);
  expect(saved.metrics.at(-1).value).toBe(122.9);
});
