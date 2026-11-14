import { expect, test } from '@playwright/test';
import { latestWeightSeries } from '../src/lib/measurementWeights';
import { measurementSourceKey, metricSeriesKey, metricTrendPoints } from '../src/lib/measurementTrends';
import type { MeasurementEntry } from '../src/types/measurement';

const reading = (date: string | null, source: string, method: string, value: number): MeasurementEntry => ({
  measured_at: date, source_name: source, method,
  metrics: [{ key: 'weight_kg', label: 'Weight', unit: 'kg', value }],
});

test('goal forecasting keeps scales and methods separate, including a new one-reading source', () => {
  const entries = [reading('2026-10-17', 'New scale', 'bia', 78), reading('2026-10-16', 'Old scale', 'bia', 85), reading('2026-10-15', 'Old scale', 'bia', 86)];
  expect(latestWeightSeries(entries)).toMatchObject({ source: 'New scale', method: 'bia', repeated: false, points: [{ date: '2026-10-17', weight: 78 }] });
  expect(latestWeightSeries([reading('2026-10-18', 'New scale', 'manual', 82), ...entries]).points).toEqual([{ date: '2026-10-18', weight: 82 }]);
});

test('goal forecasting ignores undated readings and uses order-independent daily medians', () => {
  const entries = [reading(null, 'Other', 'bia', 60), reading('2026-10-17', 'Home', 'manual', 79), reading('2026-10-17', 'Home', 'manual', 80), reading('2026-10-16', 'Home', 'manual', 81)];
  expect(latestWeightSeries(entries)).toMatchObject({ repeated: true, points: [
    { date: '2026-10-16', weight: 81 }, { date: '2026-10-17', weight: 79.5 },
  ] });
  expect(latestWeightSeries([...entries].reverse()).points).toEqual(latestWeightSeries(entries).points);
});

test('chart series distinguish metric units and device methods and collapse same-day repeats', () => {
  const entry = (date: string | null, value: number, unit = 'ticks', method = 'manual'): MeasurementEntry => ({
    measured_at: date, source_name: 'Tape', method, metrics: [{ key: 'custom_length', label: 'Length', value, unit }],
  });
  const entries = [entry('2026-10-17', 32), entry('2026-10-17', 34), entry('2026-10-16', 36), entry('2026-10-17', 100, 'ticks', 'bia'), entry('2026-10-17', 2, 'cm'), entry(null, 900)];
  expect(metricSeriesKey(entries[0].metrics[0])).not.toBe(metricSeriesKey(entries[4].metrics[0]));
  const points = metricTrendPoints(entries, entries[0].metrics[0], measurementSourceKey(entries[0]));
  expect(points).toEqual([{ date: '2026-10-16', value: 36, count: 1 }, { date: '2026-10-17', value: 33, count: 2 }]);
  expect(metricTrendPoints(entries.slice(0, 2), entries[0].metrics[0], measurementSourceKey(entries[0]))).toHaveLength(1);
  expect(metricTrendPoints(entries, entries[4].metrics[0], measurementSourceKey(entries[0]))).toEqual([{ date: '2026-10-17', value: 2, count: 1 }]);
});
