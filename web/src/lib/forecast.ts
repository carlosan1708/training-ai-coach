/**
 * Client-side goal forecasting: linear regression over recent weight logs
 * projects when the user reaches their goal weight, and flags stalls.
 */

export interface WeightPoint {
  date: string; // YYYY-MM-DD
  weight: number;
}

export type ForecastStatus =
  | 'insufficient' // fewer than 5 weight entries
  | 'no_goal'      // no goal weight in the profile
  | 'reached'      // within 0.5 kg of goal
  | 'on_track'     // trending toward the goal
  | 'stalled'      // flat trend
  | 'moving_away'; // trending away from the goal

export interface Forecast {
  status: ForecastStatus;
  currentWeight?: number;
  /** Regression slope expressed per week (negative = losing). */
  trendPerWeekKg?: number;
  /** Estimated date of reaching the goal (only for on_track). */
  etaDate?: Date;
  daysToGoal?: number;
}

const DAY_MS = 86400000;
const STALL_THRESHOLD_PER_WEEK = 0.1; // kg/week considered "flat"

export const forecastGoal = (
  points: WeightPoint[],
  goalKg?: number | null
): Forecast => {
  const sorted = [...points]
    .filter((p) => p.weight > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length < 5) return { status: 'insufficient' };

  const current = sorted[sorted.length - 1].weight;
  const t0 = new Date(sorted[0].date).getTime();
  const xs = sorted.map((p) => (new Date(p.date).getTime() - t0) / DAY_MS);
  const ys = sorted.map((p) => p.weight);

  // least-squares slope (kg per day)
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slopePerDay = den === 0 ? 0 : num / den;
  const trendPerWeekKg = Math.round(slopePerDay * 7 * 100) / 100;

  if (goalKg == null) return { status: 'no_goal', currentWeight: current, trendPerWeekKg };
  if (Math.abs(current - goalKg) <= 0.5) {
    return { status: 'reached', currentWeight: current, trendPerWeekKg };
  }
  if (Math.abs(trendPerWeekKg) < STALL_THRESHOLD_PER_WEEK) {
    return { status: 'stalled', currentWeight: current, trendPerWeekKg };
  }

  const movingTowardGoal = (goalKg - current) * slopePerDay > 0;
  if (!movingTowardGoal) {
    return { status: 'moving_away', currentWeight: current, trendPerWeekKg };
  }

  const daysToGoal = Math.round((goalKg - current) / slopePerDay);
  if (daysToGoal > 365) {
    // technically on track but too slow to give a meaningful date
    return { status: 'stalled', currentWeight: current, trendPerWeekKg };
  }
  return {
    status: 'on_track',
    currentWeight: current,
    trendPerWeekKg,
    daysToGoal,
    etaDate: new Date(Date.now() + daysToGoal * DAY_MS),
  };
};
