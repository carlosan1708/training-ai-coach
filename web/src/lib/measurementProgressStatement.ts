import type { MeasurementEntry, ProgressInsight } from '../types/measurement';
import { measurementSourceKey } from './measurementTrends';
import { isDateKey } from './dates';

export interface UploadedProgress {
  entries: MeasurementEntry[];
  revision: number;
  jobId: string;
}

const PRIORITY = ['weight_kg', 'body_fat_pct', 'waist_cm', 'skeletal_muscle_kg', 'muscle_mass_kg',
  'lean_mass_kg', 'relaxed_arm_cm', 'tensed_arm_cm', 'thighs_cm', 'calf_cm'];

/** Display limits never rewrite saved narratives or numerical evidence. */
export function conciseStatement(text: string | undefined, limit: number) {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
  return words.length <= limit ? words.join(' ') : words.slice(0, limit).join(' ') + '…';
}

export function uploadedProgressEvidence(upload: UploadedProgress, insight: ProgressInsight | null) {
  const entry = [...upload.entries].sort((a, b) => (b.measured_at ?? '').localeCompare(a.measured_at ?? ''))[0];
  const dated = !!entry?.measured_at && isDateKey(entry.measured_at);
  const source = entry ? measurementSourceKey(entry) : '';
  const priority = (key: string) => PRIORITY.indexOf(key);
  const comparisons = dated ? (insight?.comparisons ?? []).filter(item =>
    item.end_date === entry.measured_at && item.start_date < item.end_date
    && measurementSourceKey({ source_name: item.source_name ?? '', method: item.method ?? '' }) === source
    && PRIORITY.includes(item.key)
    && entry.metrics.some(metric => metric.key === item.key && metric.unit === item.unit)
    && [item.start_value, item.end_value, item.delta].every(Number.isFinite))
    .sort((a, b) => priority(a.key) - priority(b.key)).slice(0, 2) : [];
  const readings = (entry?.metrics ?? []).filter(metric => PRIORITY.includes(metric.key) && Number.isFinite(metric.value))
    .sort((a, b) => priority(a.key) - priority(b.key)).slice(0, 2);
  return { entry, dated, comparisons, readings };
}
