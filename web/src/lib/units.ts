export type WeightUnit = 'kg' | 'lb';

/** Exact international pound; stored weights always remain kilograms. */
const KG_PER_LB = 0.45359237;

export const getDefaultWeightUnit = (units?: 'metric' | 'imperial'): WeightUnit =>
  units === 'imperial' ? 'lb' : 'kg';

interface WorkoutUnitPreference {
  units?: 'metric' | 'imperial';
  workout_weight_unit?: WeightUnit;
}

interface ExerciseUnitPreference {
  weight_unit?: WeightUnit;
  weight_unit_override?: boolean;
}

/** Workout loads have their own preference; body measurements remain metric. */
export const getWorkoutWeightUnit = (profile?: WorkoutUnitPreference | null): WeightUnit =>
  profile?.workout_weight_unit ?? getDefaultWeightUnit(profile?.units);

/** Explicit machine choices survive; legacy generated units follow the profile. */
export const getExerciseWeightUnit = (
  profile: WorkoutUnitPreference | null | undefined,
  exercise: ExerciseUnitPreference,
): WeightUnit => exercise.weight_unit && (exercise.weight_unit_override || !profile?.workout_weight_unit)
  ? exercise.weight_unit : getWorkoutWeightUnit(profile);

export const toKilograms = (value: number, unit: WeightUnit): number =>
  unit === 'lb' ? value * KG_PER_LB : value;

export const fromKilograms = (kilograms: number, unit: WeightUnit): number =>
  unit === 'lb' ? kilograms / KG_PER_LB : kilograms;

export const formatWeightValue = (kilograms: number, unit: WeightUnit): string =>
  String(Number(fromKilograms(kilograms, unit).toFixed(2)));

export const formatWeight = (kilograms: number, unit: WeightUnit = 'kg'): string =>
  `${formatWeightValue(kilograms, unit)} ${unit}`;
