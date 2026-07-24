/**
 * Sample data for demo mode: a realistic profile, 4 weeks of daily logs,
 * two routines with exercise-demo images, and a session history that shows
 * visible progressive overload in the charts.
 */
import type { UserProfile } from '../types/user';
import type { DailyLog } from '../types/log';
import type { Routine, RoutineExercise, SessionSet, WorkoutSession } from '../types/routine';
import i18n from '../i18n';
import { DB_KEY, type DemoDb } from './db';

/** Seed copy follows the UI language so a Spanish user sees a Spanish demo. */
const es = () => (i18n.language || 'en').startsWith('es');
const L = (en: string, esText: string) => (es() ? esText : en);

/** Routine names are referenced by the demo chat/report copy — keep in sync. */
const UPPER_NAME = () => L('Upper Body Strength', 'Fuerza de Tren Superior');
const LOWER_NAME = () => L('Lower Body Power', 'Potencia de Tren Inferior');
const MEAL_PLAN_NAME = () => L('Hypertrophy Meal Plan', 'Plan de Comidas de Hipertrofia');

const iso = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
};

const PROFILE: UserProfile = {
  name: 'Alex',
  age: 29,
  biological_sex: 'male',
  height_cm: 178,
  goal_weight_kg: 75,
  dietary_style: 'omnivore',
  intolerances: ['lactose'],
  disliked_foods: ['mushrooms'],
  preferred_cuisines: ['mediterranean', 'mexican'],
  meals_per_day: 4,
  caloric_target: 2400,
  training_goal: 'muscle_gain',
  equipment: 'gym',
  training_days_per_week: 4,
  session_length_min: 60,
  movement_restrictions: '',
  health_notes: '',
  units: 'metric',
  ui_language: 'en',
  response_language: 'en',
  coaching_tone: 'motivational',
  onboarding_complete: true,
  created_at: Date.now(),
  updated_at: Date.now(),
};

// Library entries (yuhonas/free-exercise-db ids + image frames)
export const LIB = {
  bench:    { id: 'Barbell_Bench_Press_-_Medium_Grip', name: 'Barbell Bench Press - Medium Grip', muscle: 'chest',       images: ['Barbell_Bench_Press_-_Medium_Grip/0.jpg', 'Barbell_Bench_Press_-_Medium_Grip/1.jpg'] },
  row:      { id: 'Bent_Over_Barbell_Row',             name: 'Bent Over Barbell Row',             muscle: 'middle back', images: ['Bent_Over_Barbell_Row/0.jpg', 'Bent_Over_Barbell_Row/1.jpg'] },
  ohp:      { id: 'Standing_Military_Press',           name: 'Standing Military Press',           muscle: 'shoulders',   images: ['Standing_Military_Press/0.jpg', 'Standing_Military_Press/1.jpg'] },
  pulldown: { id: 'Wide-Grip_Lat_Pulldown',            name: 'Wide-Grip Lat Pulldown',            muscle: 'lats',        images: ['Wide-Grip_Lat_Pulldown/0.jpg', 'Wide-Grip_Lat_Pulldown/1.jpg'] },
  curl:     { id: 'Barbell_Curl',                      name: 'Barbell Curl',                      muscle: 'biceps',      images: ['Barbell_Curl/0.jpg', 'Barbell_Curl/1.jpg'] },
  pushdown: { id: 'Triceps_Pushdown',                  name: 'Triceps Pushdown',                  muscle: 'triceps',     images: ['Triceps_Pushdown/0.jpg', 'Triceps_Pushdown/1.jpg'] },
  squat:    { id: 'Barbell_Squat',                     name: 'Barbell Squat',                     muscle: 'quadriceps',  images: ['Barbell_Squat/0.jpg', 'Barbell_Squat/1.jpg'] },
  rdl:      { id: 'Romanian_Deadlift',                 name: 'Romanian Deadlift',                 muscle: 'hamstrings',  images: ['Romanian_Deadlift/0.jpg', 'Romanian_Deadlift/1.jpg'] },
  legpress: { id: 'Leg_Press',                         name: 'Leg Press',                         muscle: 'quadriceps',  images: ['Leg_Press/0.jpg', 'Leg_Press/1.jpg'] },
  legcurl:  { id: 'Lying_Leg_Curls',                   name: 'Lying Leg Curls',                   muscle: 'hamstrings',  images: ['Lying_Leg_Curls/0.jpg', 'Lying_Leg_Curls/1.jpg'] },
  calf:     { id: 'Standing_Calf_Raises',              name: 'Standing Calf Raises',              muscle: 'calves',      images: ['Standing_Calf_Raises/0.jpg', 'Standing_Calf_Raises/1.jpg'] },
  plank:    { id: 'Plank',                             name: 'Plank',                             muscle: 'abdominals',  images: ['Plank/0.jpg', 'Plank/1.jpg'] },
};

type LibEntry = (typeof LIB)[keyof typeof LIB];

const exercise = (
  lib: LibEntry,
  sets: number,
  reps: number,
  weight: number,
  rest = 90,
  notes?: string
): RoutineExercise => ({
  name: lib.name,
  muscle_group: lib.muscle,
  images: lib.images,
  library_id: lib.id,
  sets,
  reps,
  weight_kg: weight,
  rest_sec: rest,
  ...(notes ? { notes } : {}),
});

const buildUpper = (): RoutineExercise[] => [
  exercise(LIB.bench, 4, 8, 60, 120, L('Control the negative', 'Controla la fase negativa')),
  exercise(LIB.row, 4, 10, 50, 90),
  exercise(LIB.ohp, 3, 8, 35, 120),
  exercise(LIB.pulldown, 3, 12, 55, 90),
  exercise(LIB.curl, 3, 12, 25, 60),
  exercise(LIB.pushdown, 3, 12, 30, 60),
];

const buildLower = (): RoutineExercise[] => [
  exercise(LIB.squat, 4, 6, 90, 180, L('Brace hard, hit depth', 'Aprieta el core, llega a la profundidad')),
  exercise(LIB.rdl, 3, 10, 70, 120),
  exercise(LIB.legpress, 3, 12, 140, 90),
  exercise(LIB.legcurl, 3, 12, 40, 60),
  exercise(LIB.calf, 4, 15, 60, 60),
  exercise(LIB.plank, 3, 45, 0, 60, L('Seconds, not reps', 'Segundos, no repeticiones')),
];

const completedSets = (sets: number, reps: number, weight: number): SessionSet[] =>
  Array.from({ length: sets }, () => ({ reps, weight_kg: weight, done: true }));

/** A finished session where every exercise progressed by `step` increments. */
const buildSession = (
  routineId: string,
  routineName: string,
  base: RoutineExercise[],
  daysAgo: number,
  step: number
): Omit<WorkoutSession, 'id'> => {
  const exercises = base.map((ex) => {
    const inc = ex.weight_kg && ex.weight_kg > 0 ? step * (ex.weight_kg >= 60 ? 5 : 2.5) : 0;
    const weight = (ex.weight_kg ?? 0) + inc;
    return {
      name: ex.name,
      images: ex.images,
      target_sets: ex.sets,
      target_reps: ex.reps,
      target_weight_kg: weight,
      sets: completedSets(ex.sets, ex.reps, weight),
    };
  });
  const volume = exercises.reduce(
    (sum, e) => sum + e.sets.reduce((s, st) => s + st.weight_kg * st.reps, 0),
    0
  );
  return {
    routine_id: routineId,
    routine_name: routineName,
    date: iso(daysAgo),
    status: 'completed',
    exercises,
    total_volume_kg: volume,
    duration_min: 52 + Math.round(Math.random() * 12),
    started_at: Date.now(),
    completed_at: Date.now(),
  };
};

export const seedDemoDb = () => {
  const upperId = 'demo-routine-upper';
  const lowerId = 'demo-routine-lower';
  const upperName = UPPER_NAME();
  const lowerName = LOWER_NAME();
  const upper = buildUpper();
  const lower = buildLower();

  const routines: Routine[] = [
    {
      id: upperId,
      name: upperName,
      description: L('Compound-first push/pull day for muscle gain.', 'Día de empuje/tirón con básicos primero para ganar músculo.'),
      exercises: upper,
      session_count: 4,
      last_session_at: iso(2),
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    {
      id: lowerId,
      name: lowerName,
      description: L('Squat-focused leg day with posterior chain work.', 'Día de pierna centrado en sentadilla con trabajo de cadena posterior.'),
      exercises: lower,
      session_count: 3,
      last_session_at: iso(4),
      created_at: Date.now(),
      updated_at: Date.now(),
    },
  ];

  const sessions: WorkoutSession[] = [
    buildSession(upperId, upperName, upper, 23, 0),
    buildSession(upperId, upperName, upper, 16, 1),
    buildSession(upperId, upperName, upper, 9, 2),
    buildSession(upperId, upperName, upper, 2, 3),
    buildSession(lowerId, lowerName, lower, 18, 0),
    buildSession(lowerId, lowerName, lower, 11, 1),
    buildSession(lowerId, lowerName, lower, 4, 2),
  ].map((s, i) => ({ ...s, id: `demo-session-${i}` }));

  // 4 weeks of daily logs: weight drifting from 78.6 → 77.2 with noise
  const logs: Record<string, DailyLog> = {};
  for (let i = 27; i >= 0; i--) {
    const weight = 77.2 + (i / 27) * 1.4 + (Math.sin(i * 1.7) * 0.25);
    logs[iso(i)] = {
      date: iso(i),
      weight_kg: Math.round(weight * 10) / 10,
      measurements: {},
      energy: 3 + ((i * 7) % 3),
      notes: i === 1 ? L('Slept badly, a bit tired today', 'Dormí mal, un poco cansado hoy') : '',
      food_log: [],
      exercise_log: [],
    };
  }

  const lang: 'en' | 'es' = es() ? 'es' : 'en';
  const db: DemoDb = {
    profile: { ...PROFILE, ui_language: lang, response_language: lang },
    logs,
    routines,
    sessions,
    meal_plans: [
      {
        id: 'demo-plan-1',
        name: MEAL_PLAN_NAME(),
        active: true,
        storage_path: 'demo/meal-plan',
        download_url: '',
        file_type: 'application/pdf',
        ai_summary: L(
          'A 2,400 kcal muscle-gain plan: 180g protein across 4 meals, complex carbs around training, and healthy fats at dinner. Lactose-free.',
          'Un plan de 2.400 kcal para ganar músculo: 180 g de proteína en 4 comidas, carbohidratos complejos alrededor del entrenamiento y grasas saludables en la cena. Sin lactosa.'
        ),
        extracted_content: {
          plan_name: MEAL_PLAN_NAME(),
          dietary_type: 'bulking',
          daily_calories: 2400,
          macros: { protein_g: 180, carbs_g: 260, fat_g: 70 },
          meals: [
            { name: L('Breakfast', 'Desayuno'), time: '07:30', foods: [{ name: L('Oats with berries', 'Avena con frutos rojos'), portion: '80g' }, { name: L('Egg whites', 'Claras de huevo'), portion: '200g' }] },
            { name: L('Lunch', 'Almuerzo'), time: '13:00', foods: [{ name: L('Chicken breast', 'Pechuga de pollo'), portion: '180g' }, { name: L('Rice', 'Arroz'), portion: '150g' }] },
            { name: L('Pre-workout', 'Pre-entreno'), time: '17:00', foods: [{ name: L('Banana + whey (lactose-free)', 'Plátano + whey (sin lactosa)'), portion: '1 + 30g' }] },
            { name: L('Dinner', 'Cena'), time: '20:30', foods: [{ name: L('Salmon', 'Salmón'), portion: '160g' }, { name: L('Potatoes + salad', 'Patatas + ensalada'), portion: '200g' }] },
          ],
          notes: [L('Drink 3L of water daily', 'Bebe 3 L de agua al día'), L('Lactose-free dairy only', 'Solo lácteos sin lactosa')],
        },
        created_at: Date.now(),
      },
    ],
    reports: [],
  };

  localStorage.setItem(DB_KEY, JSON.stringify(db));
};
