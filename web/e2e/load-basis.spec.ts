import { expect, test } from '@playwright/test';
import { enterDemo } from './helpers';
import { carrySessionDefaults, resolveExerciseDefaults } from '../src/lib/exerciseDefaults';
import type { Routine, WorkoutSession } from '../src/types/routine';

test('a basis change blocks stale draft defaults and ambiguous weights without rewriting snapshots', () => {
  const routine: Routine = { id: 'synthetic', name: 'Synthetic', exercises: [{ id: 'press', name: 'Press', sets: 2,
    reps: 10, load_basis: 'per_dumbbell', load_basis_review_required: true, set_defaults: [{ reps: 9, weight_kg: 50 }] }] };
  const old: WorkoutSession = { id: 'old', routine_id: routine.id, routine_name: routine.name, status: 'completed', date: '2020-01-01',
    exercises: [{ name: 'Press', routine_exercise_id: 'press', load_basis: 'total', target_sets: 2, target_reps: 10,
      sets: [{ weight_kg: 50, reps: 9, done: true }] }] };
  const before = structuredClone({ routine, old });
  expect(resolveExerciseDefaults(routine, 0, [old]).sets.map(set => set.weight_kg)).toEqual([0, 0]);
  expect(carrySessionDefaults(routine, old)).toBeNull();
  expect({ routine, old }).toEqual(before);
  const current = structuredClone(old);
  current.exercises[0].load_basis = 'per_dumbbell';
  current.exercises[0].sets = [{ weight_kg: 25, reps: 9, done: true }];
  const patch = carrySessionDefaults(routine, current)!;
  expect(patch.exercises![0].set_defaults).toEqual([{ weight_kg: 25, reps: 9 }]);
  expect(patch.exercises![0].load_basis_review_required).toBe(false);
});

for (const language of ['en', 'es']) for (const width of [360, 1280]) {
  test(`explicit dumbbell guidance and legacy history stay distinct in ${language} at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await enterDemo(page);
    await page.evaluate(({ language }) => {
      const db = JSON.parse(localStorage.getItem('tac_demo_db')!);
      db.profile.workout_weight_unit = 'lb';
      db.profile.ui_language = language;
      db.routines = [{ id: 'basis-demo', name: 'Load convention', exercises: [{ id: 'lateral', name: 'Dumbbell lateral raise',
        sets: 2, reps: 12, load_basis: 'per_dumbbell', load_basis_review_required: true,
        set_defaults: [{ reps: 12, weight_kg: 13.6077711 }] }] }];
      db.sessions = [{ id: 'basis-old', routine_id: 'basis-demo', routine_name: 'Load convention', status: 'completed', date: '2020-01-01',
        exercises: [{ name: 'Dumbbell lateral raise', routine_exercise_id: 'lateral', target_sets: 2, target_reps: 12,
          sets: [{ weight_kg: 13.6077711, reps: 12, done: true }] }] }];
      localStorage.setItem('tac_demo_db', JSON.stringify(db));
      localStorage.setItem('ui_language', language);
    }, { language });
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!).sessions[0]);
    await page.goto('/routines/basis-demo');
    const basis = language === 'es' ? 'Peso por mancuerna' : 'Weight per dumbbell';
    await expect(page.getByText(basis, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: language === 'es' ? 'Empezar entrenamiento' : 'Start Workout', exact: true }).click();
    await page.waitForURL('**/session/**');
    const exercise = page.getByRole('region', { name: 'Dumbbell lateral raise', exact: true });
    await expect(exercise.getByTestId('load-basis-guidance').getByText(basis, { exact: true })).toBeVisible();
    await expect(exercise.getByText(language === 'es' ? /Dos mancuernas de 15 lb: anota 15 lb/ : /Two 15 lb dumbbells: enter 15 lb/)).toBeVisible();
    await expect(exercise.getByLabel('lb', { exact: true }).first()).toHaveValue('0');
    for (const input of await exercise.getByLabel('lb', { exact: true }).all()) await input.fill('15');
    for (const checkbox of await exercise.getByRole('checkbox').all()) await checkbox.check();
    await page.getByRole('button', { name: language === 'es' ? 'Terminar entrenamiento' : 'Finish workout', exact: true }).click();
    await page.waitForURL('**/workout-history?**');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tac_demo_db')!));
    expect(saved.sessions.find((session: WorkoutSession) => session.id === 'basis-old')).toEqual(original);
    const latest = saved.sessions.find((session: WorkoutSession) => session.id !== 'basis-old');
    expect(latest.exercises[0].load_basis).toBe('per_dumbbell');
    expect(latest.exercises[0].sets[0].weight_kg).toBeCloseTo(6.80388555, 8);
    expect(saved.routines[0].exercises[0].load_basis_review_required).toBe(false);
    await expect(page.getByText(basis, { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
