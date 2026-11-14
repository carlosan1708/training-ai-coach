import type { MeasurementEntry, MeasurementMetric } from '../types/measurement';

export const metricSeriesKey = (metric: Pick<MeasurementMetric, 'key' | 'unit'>) => JSON.stringify([metric.key, metric.unit]);
export const measurementSourceKey = (entry: Pick<MeasurementEntry, 'source_name' | 'method'>) => JSON.stringify([entry.source_name.trim().toLowerCase(), entry.method.trim().toLowerCase()]);

/** Dates have no intraday ordering. Aggregate repeats without changing the saved facts. */
export function metricTrendPoints(entries: MeasurementEntry[], metric: Pick<MeasurementMetric, 'key' | 'unit'>, source: string) {
  const days = new Map<string, number[]>();
  for (const entry of entries) {
    if (!entry.measured_at || measurementSourceKey(entry) !== source) continue;
    const value = entry.metrics.find(candidate => metricSeriesKey(candidate) === metricSeriesKey(metric))?.value;
    if (value === undefined || !Number.isFinite(value) || value < 0) continue;
    days.set(entry.measured_at, [...(days.get(entry.measured_at) ?? []), value]);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const value = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return { date, value, count: values.length };
  });
}
