import type { MeasurementEntry } from '../types/measurement';
import type { WeightPoint } from './forecast';
import { measurementSourceKey, metricTrendPoints } from './measurementTrends';

/** Forecast the latest source only; changing devices must not manufacture a trend. */
export function latestWeightSeries(entries: MeasurementEntry[]): { source: string; method: string; repeated: boolean; points: WeightPoint[] } {
  const groups = new Map<string, MeasurementEntry>();
  const valid = entries.filter(entry => {
    const weight = entry.metrics.find(metric => metric.key === 'weight_kg' && metric.unit === 'kg');
    return entry.measured_at && weight && Number.isFinite(weight.value) && weight.value > 0;
  });
  for (const entry of valid) {
    const key = measurementSourceKey(entry);
    if (!groups.has(key)) groups.set(key, entry);
  }
  const series = [...groups].map(([key, entry]) => {
    const days = metricTrendPoints(valid, { key: 'weight_kg', unit: 'kg' }, key).slice(-30);
    return { source: entry.source_name, method: entry.method, repeated: days.some(point => point.count > 1), points: days.map(({ date, value }) => ({ date, weight: value })) };
  });
  series.sort((a, b) => b.points.at(-1)!.date.localeCompare(a.points.at(-1)!.date) || b.points.length - a.points.length);
  return series[0] ?? { source: '', method: '', repeated: false, points: [] };
}
