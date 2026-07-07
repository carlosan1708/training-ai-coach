import type { FoodLogEntry } from '../types/log';
import type { UserProfile } from '../types/user';

export interface NutritionTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export const sumNutrition = (entries: FoodLogEntry[]): NutritionTotals =>
  entries.reduce(
    (acc, e) => ({
      calories: acc.calories + (e.calories || 0),
      protein_g: acc.protein_g + (e.protein_g || 0),
      carbs_g: acc.carbs_g + (e.carbs_g || 0),
      fat_g: acc.fat_g + (e.fat_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

/** Daily calorie target from the profile (falls back to a sane default). */
export const calorieTarget = (profile?: UserProfile | null): number | null => {
  const c = profile?.caloric_target;
  return typeof c === 'number' && c > 0 ? c : null;
};

/**
 * Estimated daily protein target in grams (~1.8 g per kg bodyweight).
 * Uses the goal weight when available, otherwise returns null.
 */
export const proteinTarget = (profile?: UserProfile | null): number | null => {
  const kg = profile?.goal_weight_kg;
  return typeof kg === 'number' && kg > 0 ? Math.round(kg * 1.8) : null;
};
