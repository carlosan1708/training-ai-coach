import { test, expect } from '@playwright/test';
import { enterDemo } from './helpers';

test('routine weight unit overrides historical unit and converts machine entry once', async ({ page }) => {
  await enterDemo(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
    db.routines = [{ id:'unit-plan', name:'Machine plan', exercises:[{
      name:'Machine press', sets:2, reps:10, weight_kg:45.359237, weight_unit:'lb',
      targets_revision:'manual-override',
    }] }];
    db.sessions = [{id:'prior', routine_id:'unit-plan', routine_name:'Machine plan', status:'completed', date:'2020-01-01',
      exercises:[{name:'Machine press', target_sets:2, target_reps:10, weight_unit:'kg', sets:[{reps:10,weight_kg:40,done:true}]}]}];
    localStorage.setItem('tac_demo_db',JSON.stringify(db));
  });
  await page.goto('/routines/unit-plan');
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Weight (lb)',{exact:true})).toHaveValue('100');
  await dialog.getByLabel('Weight (lb)',{exact:true}).fill('110');
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('button',{name:/Start Workout/}).click();
  await page.waitForURL('**/session/**');
  await expect(page.getByLabel('lb',{exact:true}).first()).toHaveValue('110');
  const exercise = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions[0].exercises[0]);
  expect(exercise.weight_unit).toBe('lb');
  expect(exercise.sets[0].weight_kg).toBeCloseTo(49.8951607,7);
});

test('body weight stays in kilograms and clearing removes the stored value', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/log');
  await expect(page.getByRole('button',{name:'lb',exact:true})).toHaveCount(0);
  await page.getByLabel('Body weight (kg)',{exact:true}).fill('80');
  await page.getByRole('button',{name:'Save Log',exact:true}).click();
  await expect(page.getByText('Log saved!',{exact:true})).toBeVisible();
  await page.reload();
  const weight = page.getByLabel('Body weight (kg)',{exact:true});
  await expect(weight).toHaveValue('80');
  await weight.fill('');
  await page.getByRole('button',{name:'Save Log',exact:true}).click();
  await expect(page.getByText('Log saved!',{exact:true})).toBeVisible();
  const date = await page.getByLabel('Log date',{exact:true}).inputValue();
  expect(await page.evaluate(date => JSON.parse(localStorage.getItem('tac_demo_db')!).logs[date].weight_kg,date)).toBeNull();
  await page.reload();
  await expect(page.getByLabel('Body weight (kg)',{exact:true})).toHaveValue('');
});
