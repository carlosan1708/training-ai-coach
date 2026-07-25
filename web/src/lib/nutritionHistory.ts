import type { DailyLog, FoodLogEntry } from '../types/log';
import { sumNutrition, type NutritionTotals } from './nutrition';

export interface DailyNutrition extends NutritionTotals {
  date: string; // YYYY-MM-DD
  mealCount: number;
  logged: boolean; // had at least one meal with nutrition
}

export interface NutritionTrends {
  days: DailyNutrition[]; // oldest first, one entry per day that has a log
  avg: NutritionTotals; // averaged over LOGGED days only
  loggedDays: number;
  daysOnCalorieTarget: number; // within ±10% of calGoal
  bestProteinDay?: DailyNutrition;
}

/** A meal "counts" if it carries nutrition — same filter as MealsTab/NutritionCard. */
const hasNutrition = (f: FoodLogEntry) => f.calories != null || (f.items?.length ?? 0) > 0;

const EMPTY: NutritionTotals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

/** One DailyNutrition per log, using only the meals that carry nutrition. */
export function buildDailyNutrition(logs: DailyLog[]): DailyNutrition[] {
  return logs.map((log) => {
    const meals = (log.food_log ?? []).filter(hasNutrition);
    const totals = sumNutrition(meals);
    return {
      date: log.date,
      ...totals,
      mealCount: meals.length,
      logged: meals.length > 0,
    };
  });
}

/**
 * Aggregate the per-day rows into headline trends. Averages are taken over
 * LOGGED days only, so a run of empty days never drags them toward zero.
 * On-target counts days whose calories are within ±10% of `calGoal`; when
 * `calGoal` is null the band is undefined, so the count stays 0.
 * Rounding is left to the view.
 */
export function summarizeTrends(
  days: DailyNutrition[],
  calGoal: number | null,
): NutritionTrends {
  const logged = days.filter((d) => d.logged);
  const loggedDays = logged.length;

  const sum = logged.reduce<NutritionTotals>(
    (acc, d) => ({
      calories: acc.calories + d.calories,
      protein_g: acc.protein_g + d.protein_g,
      carbs_g: acc.carbs_g + d.carbs_g,
      fat_g: acc.fat_g + d.fat_g,
    }),
    { ...EMPTY },
  );

  const avg: NutritionTotals = loggedDays
    ? {
        calories: sum.calories / loggedDays,
        protein_g: sum.protein_g / loggedDays,
        carbs_g: sum.carbs_g / loggedDays,
        fat_g: sum.fat_g / loggedDays,
      }
    : { ...EMPTY };

  const daysOnCalorieTarget =
    calGoal != null && calGoal > 0
      ? logged.filter((d) => Math.abs(d.calories - calGoal) <= 0.1 * calGoal).length
      : 0;

  const bestProteinDay = logged.reduce<DailyNutrition | undefined>(
    (best, d) => (!best || d.protein_g > best.protein_g ? d : best),
    undefined,
  );

  return { days, avg, loggedDays, daysOnCalorieTarget, bestProteinDay };
}
