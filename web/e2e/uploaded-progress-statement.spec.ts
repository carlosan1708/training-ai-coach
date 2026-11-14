import { expect, test, type Page } from '@playwright/test';
import { enterDemo, TINY_PNG } from './helpers';

const key = 'tac_demo_measurements_v1';
const reading = { measured_at: '2026-10-20', source_name: 'Fitdays (synthetic)', method: 'bia', metrics: [
  { key: 'weight_kg', label: 'Weight', value: 77.4, unit: 'kg' },
  { key: 'body_fat_pct', label: 'Body fat', value: 20, unit: '%' },
  { key: 'waist_cm', label: 'Waist', value: 80, unit: 'cm' },
] };
const comparisons = reading.metrics.map((metric, index) => ({ ...metric, start_value: [78, 21, 81][index],
  end_value: metric.value, delta: [-.6, -1, -1][index], start_date: '2026-10-06', end_date: reading.measured_at,
  source_name: reading.source_name, method: reading.method, aggregation: 'daily_median' }));
type Scenario = 'comparable' | 'baseline' | 'incompatible' | 'undated' | 'read-failure' | 'stale' | 'failed' | 'qa-paused';

async function upload(page: Page, scenario: Scenario, language = 'en') {
  await page.route(/\/src\/firebase\/measurements\.ts(?:\?t=\d+)?$/, route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/firebase/measurements.ts?progressActual';
    import {getMeasurementWorkspace as actual,saveMeasurementEntries as save} from '/src/firebase/measurements.ts?progressActual';
    export async function parseMeasurementImport(){window.extractions=(window.extractions??0)+1;return ${JSON.stringify({import_id:'synthetic-progress',status:'review',warnings:[],entries:[{...reading,measured_at:scenario==='undated'?null:reading.measured_at}]})};}
    export async function saveMeasurementEntries(...args){window.saves=(window.saves??0)+1;return save(...args);}
    export async function generateProgressInsights(){throw new Error('No additional analysis request allowed');}
    export async function getMeasurementWorkspace(input){
      const state=JSON.parse(localStorage.getItem('${key}')??'null');
      if(input?.section==='jobs' && state){return {section:'jobs',revision:state.revision,jobs:state.jobs.map(job=>({...job,
        status:window.finishProgress?${JSON.stringify(scenario==='failed'||scenario==='qa-paused'?'failed':'ready')}:'pending',
        error_reason:${JSON.stringify(scenario==='qa-paused'?'QA_AI_PAUSED':'PROVIDER_ERROR')}
      }))};}
      if(input?.section==='summary' && state){
        window.summaryReads=(window.summaryReads??0)+1;
        if(${JSON.stringify(scenario)}==='read-failure' && window.summaryReads===1)throw new Error('Synthetic read failure');
        const revision=state.revision+${scenario==='stale'?1:0};
        return {section:'summary',revision,insights:{revision,status:'ready',days:90,
          summary:'Weight and estimated body fat are lower across comparable readings. This alone does not establish muscle gain.',
          wins:[],focus:['Keep training consistently and repeat measurements under the same conditions.','This second next step must stay in the full analysis.'],
          comparisons:${JSON.stringify(scenario==='baseline'?[]:scenario==='incompatible'?[
            {...comparisons[0],source_name:'Another scale'}, {...comparisons[0],method:'manual'},
            {...comparisons[0],end_date:'2026-10-21'}, {...comparisons[0],unit:'lb'},
            {...comparisons[0],start_date:reading.measured_at},
          ]:comparisons)},workouts:{sessions:4}}};
      }
      return actual(input);
    }` }));
  await enterDemo(page);
  await page.evaluate(({key,language}) => {
    localStorage.removeItem(key); localStorage.setItem('ui_language',language);
    const db=JSON.parse(localStorage.getItem('tac_demo_db')!);db.profile.ui_language=language;
    localStorage.setItem('tac_demo_db',JSON.stringify(db));
  },{key,language});
  const before = await page.evaluate(() => localStorage.getItem('tac_demo_db'));
  await page.goto('/progress');
  await page.getByRole('button',{name:language==='es'?'Añadir mediciones':'Add measurements',exact:true}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('tab',{name:language==='es'?'Subir informe':'Upload report',exact:true}).click();
  await dialog.locator('input[type=file]').setInputFiles({name:'synthetic-progress.png',mimeType:'image/png',buffer:TINY_PNG});
  await dialog.getByRole('button',{name:language==='es'?'Guardar informe':'Save report',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  const card=page.getByTestId('uploaded-progress-statement');
  await expect(card).toBeVisible();
  await expect(card.getByRole('status')).toContainText(language==='es'?'Guardado':'Saved');
  expect(await page.evaluate(()=>(window as Window & {summaryReads?:number}).summaryReads??0)).toBe(0);
  expect(await page.evaluate(()=>localStorage.getItem('tac_demo_db'))).toBe(before);
  await page.evaluate(()=>{(window as Window & {finishProgress?:boolean}).finishProgress=true;});
  return card;
}

test('upload automatically shows a short evidenced statement and one action without opening Summary or requesting another analysis',async({page},testInfo)=>{
  await page.setViewportSize({width:1280,height:900});
  const card=await upload(page,'comparable');
  await expect(card).toContainText('Weight and estimated body fat are lower');
  await expect(card).toContainText('Keep training consistently');
  await expect(card).not.toContainText('second next step');
  const evidence=card.getByTestId('progress-statement-evidence');
  await expect(evidence.locator('li')).toHaveCount(2);
  await expect(evidence).toContainText('78 kg (2026-10-06) → 77.4 kg (2026-10-20)');
  await expect(evidence).toContainText('-1 percentage points');
  await expect(card).toContainText('Fitdays (synthetic)');
  await expect(card).toContainText('daily medians');
  await page.waitForTimeout(2000);
  const counts=await page.evaluate(()=>({reads:(window as Window & {summaryReads:number}).summaryReads,
    extractions:(window as Window & {extractions:number}).extractions,saves:(window as Window & {saves:number}).saves}));
  expect(counts).toEqual({reads:1,extractions:1,saves:1});
  await card.screenshot({path:testInfo.outputPath('progress-desktop.png')});
  await page.setViewportSize({width:360,height:800});
  await card.screenshot({path:testInfo.outputPath('progress-mobile.png')});
  expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

for(const scenario of ['baseline','incompatible','undated','stale','failed','qa-paused','read-failure'] as const){
  test(`saved progress stays factual and recoverable: ${scenario}`,async({page},testInfo)=>{
    const es=scenario==='undated';
    const card=await upload(page,scenario,es?'es':'en');
    if(scenario==='read-failure'){
      await expect(card).toContainText('could not be loaded');
      await card.getByRole('button',{name:'Try again',exact:true}).click();
      await expect(card).toContainText('Weight and estimated body fat are lower');
      expect(await page.evaluate(()=>(window as Window & {summaryReads:number}).summaryReads)).toBe(2);
      expect(await page.evaluate(()=>(window as Window & {saves:number}).saves)).toBe(1);
    }else if(scenario==='failed'){
      await expect(card).toContainText('Coaching could not finish');
      await expect(card.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
    }else if(scenario==='qa-paused'){
      await expect(card).toContainText('paused');
      await expect(card.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
    }else if(scenario==='stale'){
      await expect(card).toContainText('Your records changed');
      await expect(card.getByRole('button',{name:'View full analysis',exact:true})).toBeVisible();
    }else{
      await expect(card).toContainText(es?'no tiene fecha':'No comparable change');
      await expect(card).not.toContainText('Weight and estimated body fat are lower');
      await expect(card.getByTestId('progress-statement-evidence').locator('li')).toHaveCount(2);
      await expect(card).toContainText('77');
      if(es)await card.screenshot({path:testInfo.outputPath('progress-es-mobile.png')});
    }
    expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).entries.length,key)).toBe(1);
  });
}
