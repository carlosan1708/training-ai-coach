import * as db from './db';
import { isDateKey, localDateKey, shiftDateKey } from '../lib/dates';
import i18n from '../i18n';
import { measurementSourceKey, metricTrendPoints } from '../lib/measurementTrends';
import type { FactualProgressDigest, MeasurementDraft, MeasurementEntry, MeasurementJob, MeasurementMetric, MeasurementSaveResult, MeasurementSectionData, MeasurementWorkspaceData, MeasurementWorkspaceRequest, ProgressInsight } from '../types/measurement';

export const MEASUREMENT_DEMO_KEY = 'tac_demo_measurements_v1';
interface DemoState {
  entries: MeasurementEntry[];
  removed: string[];
  revision: number;
  jobs: (MeasurementJob & { created: number; days: number })[];
  requests: Record<string, MeasurementSaveResult>;
  summaries?: Record<string, { hash: string; summary: string }>;
  insights?: ProgressInsight;
  source_hash?: string;
}
const read = (): DemoState => {
  try { return JSON.parse(localStorage.getItem(MEASUREMENT_DEMO_KEY) ?? 'null') ?? { entries: [], removed: [], revision: 0, jobs: [], requests: {} }; }
  catch { return { entries: [], removed: [], revision: 0, jobs: [], requests: {} }; }
};
const write = (state: DemoState) => localStorage.setItem(MEASUREMENT_DEMO_KEY, JSON.stringify(state));
const id = () => `demo-${crypto.randomUUID()}`;
const metric = (key: string, label: string, value: number, unit: string): MeasurementMetric => ({ key, label, value, unit, confidence: 'high' });

function legacyEntries(logLimit = 500): MeasurementEntry[] {
  const reports = db.getReports();
  const paths = new Set(reports.map(report => report.storage_path).filter(Boolean));
  const urls = new Set(reports.map(report => report.download_url).filter(Boolean));
  const output: MeasurementEntry[] = [];
  for (const log of db.getDailyLogHistory(logLimit)) {
    const metrics: MeasurementMetric[] = [];
    if (log.weight_kg != null) metrics.push(metric('weight_kg', 'Weight', log.weight_kg, 'kg'));
    if (log.body_fat_pct != null) metrics.push(metric('body_fat_pct', 'Body fat', log.body_fat_pct, '%'));
    for (const [key, value] of Object.entries(log.measurements ?? {})) {
      if (typeof value === 'number') metrics.push(metric(key, key.replace('_cm', '').replaceAll('_', ' '), value, 'cm'));
    }
    if (metrics.length) output.push({ id: `legacy_manual_${log.date}`, legacy_ref: { kind: 'manual', id: log.date }, measured_at: log.date, source_name: 'Manual', method: 'manual', metrics });
    const embedded = log.body_composition_report;
    if (embedded && !paths.has(embedded.report_storage_path ?? '') && !urls.has(embedded.report_url ?? '')) {
      const values = reportMetrics(embedded as Record<string, unknown>);
      if (values.length) output.push({ id: `legacy_log_report_${log.date}`, legacy_ref: { kind: 'log_report', id: log.date }, measured_at: embedded.report_date ?? null, source_name: embedded.source_app ?? 'Report', method: embedded.fat_method ?? (embedded.skinfolds ? 'anthropometric' : 'bia'), metrics: values, source_storage_path: embedded.report_storage_path, source_download_url: embedded.report_url });
    }
  }
  for (const report of reports) {
    output.push({ id: `legacy_report_${report.id}`, legacy_ref: { kind: 'report', id: report.id }, measured_at: report.report_date ?? (String(report.extracted_data.report_date ?? '') || null), source_name: report.source_app ?? 'Report', method: String(report.extracted_data.fat_method ?? (report.extracted_data.skinfolds ? 'anthropometric' : 'bia')), metrics: reportMetrics(report.extracted_data), summary: report.ai_summary, summary_status: 'legacy', source_storage_path: report.storage_path, source_download_url: report.download_url });
  }
  return output;
}

function reportMetrics(report: Record<string, unknown>): MeasurementMetric[] {
  const output: MeasurementMetric[] = [];
  for (const [key, value] of Object.entries(report)) {
    if (key === 'weight_control') continue;
    if (typeof value === 'number' && Number.isFinite(value)) output.push(metric(key, key.replace(/_(kg|cm|pct|mm)$/, '').replaceAll('_', ' '), value, key.endsWith('_pct') ? '%' : key.endsWith('_kg') ? 'kg' : key.endsWith('_cm') ? 'cm' : key.endsWith('_mm') ? 'mm' : ''));
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const child of reportMetrics(value as Record<string, unknown>)) output.push({ ...child, key: ['segmental_fat', 'segmental_muscle', 'bia', 'somatotype'].includes(key) ? `${key}_${child.key}` : child.key, label: `${key.replaceAll('_', ' ')} ${child.label}` });
    }
  }
  return output;
}

const entryHash = (entry: MeasurementEntry) => JSON.stringify([entry.id, entry.measured_at, entry.source_name, entry.method, entry.metrics, entry.notes, entry.revision]);
const sourceHash = (entries: MeasurementEntry[]) => JSON.stringify([entries.map(entryHash), db.getWorkoutSessions().map(session => [session.id, session.status, session.date, session.exercises, session.duration_min])]);
const spanish = () => i18n.language.startsWith('es');

function allEntries(state: DemoState, logLimit = 500): MeasurementEntry[] {
  const canonical = new Set(state.entries.map(entry => entry.id));
  return [...state.entries, ...legacyEntries(logLimit).filter(entry => !state.removed.includes(entry.id!) && !canonical.has(entry.id))]
    .map(entry => { const cached = state.summaries?.[entry.id!]; return cached?.hash === entryHash(entry) ? { ...entry, summary: cached.summary, summary_status: 'ready' } : entry; })
    .sort((a, b) => (b.measured_at ?? '').localeCompare(a.measured_at ?? '') || (b.id ?? '').localeCompare(a.id ?? ''));
}

function trackingContext(entries: MeasurementEntry[]): NonNullable<ProgressInsight['tracking_context']> {
  const today = localDateKey();
  const groups = new Map<string, { source_name: string; method: string; latest_date: string | null; historical: boolean }>();
  for (const entry of entries) {
    if (entry.measured_at && (!isDateKey(entry.measured_at) || entry.measured_at > today)) continue;
    const method = entry.method.trim().toLowerCase();
    const historical = ['anthropometric', 'isak', 'skinfold'].includes(method);
    if (!historical && !['manual', 'bia'].includes(method)) continue;
    const key = measurementSourceKey(entry), existing = groups.get(key);
    if (!existing) groups.set(key, { source_name: entry.source_name, method, latest_date: entry.measured_at, historical });
    else if (entry.measured_at && (!existing.latest_date || entry.measured_at > existing.latest_date)) existing.latest_date = entry.measured_at;
  }
  const ordered = [...groups.values()].sort((a, b) => measurementSourceKey(a).localeCompare(measurementSourceKey(b)));
  const historical = ordered.filter(source => source.historical).slice(0, 50), ongoing = ordered.filter(source => !source.historical).slice(0, 50);
  return {
    historical_sources: historical.map(({ source_name, method, latest_date }) => ({ source_name, method, latest_date, role: 'historical_reference', follow_up_required: false })),
    ongoing_sources: ongoing.map(({ source_name, method, latest_date }) => ({ source_name, method, latest_date, role: 'ongoing_tracking_option' })),
    omitted_sources: groups.size - historical.length - ongoing.length,
    policy: 'Historical reports remain available; future third-party reports are optional, never a requirement. Own measurements start a separate source/method baseline.',
  };
}

function analysis(entries: MeasurementEntry[], revision: number, days = 90): ProgressInsight {
  const today = localDateKey(), start = shiftDateKey(today, -(days - 1));
  const dated = entries.filter(entry => entry.measured_at && isDateKey(entry.measured_at) && entry.measured_at <= today);
  const filtered = dated.filter(entry => entry.measured_at! >= start);
  const groups = new Map<string, { entry: MeasurementEntry; value: MeasurementMetric }[]>();
  for (const entry of filtered) for (const value of entry.metrics) {
    const key = JSON.stringify([value.key, value.unit, measurementSourceKey(entry)]);
    groups.set(key, [...(groups.get(key) ?? []), { entry, value }]);
  }
  const comparisons: ProgressInsight['comparisons'] = [];
  for (const readings of groups.values()) {
    readings.sort((a, b) => a.entry.measured_at!.localeCompare(b.entry.measured_at!));
    const first = readings[0]; const last = readings.at(-1)!;
    if (readings.length < 2 || first.entry.measured_at === last.entry.measured_at) continue;
    const points = metricTrendPoints(filtered, last.value, measurementSourceKey(last.entry));
    if (points.length < 2) continue;
    const startValue = points[0].value; const endValue = points.at(-1)!.value;
    const endpointIds = readings.filter(reading => reading.entry.measured_at === first.entry.measured_at || reading.entry.measured_at === last.entry.measured_at).map(reading => reading.entry.id!);
    comparisons.push({ key: last.value.key, label: last.value.label, unit: last.value.unit, start_date: first.entry.measured_at!, end_date: last.entry.measured_at!, start_value: startValue, end_value: endValue, delta: Math.round((endValue - startValue) * 100000) / 100000, aggregation: 'daily_median', reading_count: readings.length, source_name: last.entry.source_name, method: last.entry.method, source_ids: endpointIds });
  }
  const sessions = db.getWorkoutSessions().filter(session => session.status === 'completed' && isDateKey(session.date) && session.date >= start && session.date <= today);
  const completedSets = sessions.flatMap(session => session.exercises.flatMap(exercise => exercise.sets)).filter(set => set.done);
  const context = trackingContext(entries), es = spanish();
  const ongoingReadings = filtered.filter(entry => ['manual', 'bia'].includes(entry.method.trim().toLowerCase()));
  const dateSummary = ongoingReadings.map(entry => entry.measured_at!).sort().at(-1);
  const ongoingComparison = comparisons.some(comparison => ['manual', 'bia'].includes(comparison.method?.trim().toLowerCase() ?? ''));
  const lines = [es
    ? (ongoingReadings.length ? `Tus lecturas guardadas de seguimiento propio: ${ongoingReadings.length} en ${days} días (última: ${dateSummary}).` : `En ${days} días: ninguna medición propia con fecha.`)
    : (ongoingReadings.length ? `Your own readings in ${days} days: ${ongoingReadings.length} (latest: ${dateSummary}).` : `In ${days} days: no dated personal measurements.`),
  es ? `${sessions.length} ${sessions.length === 1 ? 'entrenamiento completado' : 'entrenamientos completados'} y ${completedSets.length} ${completedSets.length === 1 ? 'serie completada' : 'series completadas'}.`
    : `${sessions.length} completed ${sessions.length === 1 ? 'workout' : 'workouts'} and ${completedSets.length} completed ${completedSets.length === 1 ? 'set' : 'sets'}.`];
  if (ongoingReadings.length && !ongoingComparison) {
    lines.push(es ? 'Tus mediciones propias usan un punto de partida independiente; aún no establecen un cambio.' : 'Your own measurements form a separate baseline; no comparable change is established yet.');
    if (context.historical_sources.length) lines.push(es ? 'No necesitas informes nuevos.' : 'New reports are not required.');
  } else {
    if (context.historical_sources.length) lines.push(es ? 'Los informes se conservan como referencia histórica; no necesitas informes nuevos.' : 'Reports remain historical references; new reports are not required.');
    if (ongoingComparison) lines.push(es ? 'Los cambios comparan la misma fuente, método y unidad.' : 'Changes compare the same source, method and unit.');
  }
  if (!ongoingReadings.length && !sessions.length) lines.push(es ? 'Tu próximo entrenamiento completado puede iniciar un registro útil de actividad.' : 'Your next completed workout can start a useful activity record.');
  const summary = lines.join(' ');
  return { id: `demo-insight-${revision}`, revision, days, summary,
    wins: sessions.length ? [spanish() ? `Registraste ${sessions.length} entrenamientos completados.` : `You recorded ${sessions.length} completed workouts.`] : [],
    focus: [ongoingReadings.length
      ? (es ? 'Registra tu próxima medición propia con la misma fuente, método y condiciones.' : 'Record your next home measurement using the same source, method and conditions.')
      : (es ? 'Registra tu próximo entrenamiento completado con sus series, repeticiones y cargas.' : 'Log your next completed workout with its sets, repetitions and loads.')],
    tracking_context: context, comparisons, workouts: { sessions: sessions.length, days, completed_sets: completedSets.length, total_volume_kg: completedSets.reduce((sum, set) => sum + set.reps * set.weight_kg, 0) }, status: 'ready', created_at: Date.now() };

}

function factualDigest(entries: MeasurementEntry[], revision: number): FactualProgressDigest {
  const today = localDateKey();
  const tracking = trackingContext(entries);
  const dated = entries.filter(entry => entry.measured_at && isDateKey(entry.measured_at) && entry.measured_at <= today);
  const dates = [...new Set(dated.map(entry => entry.measured_at!))].sort();
  const days = dates.length ? Math.max(1, Math.ceil((Date.parse(today) - Date.parse(dates[0])) / 86400000) + 1) : 1;
  const all = analysis(dated, revision, days), recent = analysis(dated, revision, 90);
  const es = spanish();
  const number = (value: number) => new Intl.NumberFormat(es ? 'es' : 'en', { maximumFractionDigits: 3 }).format(value);
  const metricLabel = (item: { key: string; label: string }) => i18n.t(`measurementWorkspace.metrics.${item.key}`, { defaultValue: item.label });
  const comparisonLine = (item: ProgressInsight['comparisons'][number]) => {
    const deltaUnit = item.unit === '%' ? (spanish() ? 'puntos porcentuales' : 'percentage points') : item.unit;
    return `- ${metricLabel(item)} (${item.source_name}, ${item.method}): ${number(item.start_value)} ${item.unit} (${item.start_date}) → ${number(item.end_value)} ${item.unit} (${item.end_date}); ${item.delta > 0 ? '+' : ''}${number(item.delta)} ${deltaUnit}.`;
  };
  const lines = [es ? '## Resumen de todo tu historial' : '## Full-history overview',
    es ? `${entries.length} lecturas en ${dates.length} fechas de medición. Este resumen se calcula con tus registros guardados, sin generar una interpretación con IA.`
      : `${entries.length} readings across ${dates.length} measurement dates. This overview is calculated from saved records without generating an AI interpretation.`,
    dates.length ? `${dates[0]} → ${dates.at(-1)}` : es ? 'Todavía no hay fechas válidas para comparar.' : 'There are no valid measurement dates to compare yet.',
    es ? '## Tu peso a lo largo del tiempo' : '## Your weight over time'];
  const weightSources = new Map(dated.filter(entry => entry.metrics.some(item => item.key === 'weight_kg' && item.unit === 'kg' && Number.isFinite(item.value) && item.value > 0)).map(entry => [measurementSourceKey(entry), entry]));
  for (const [source, entry] of [...weightSources].slice(0, 4)) {
    const points = metricTrendPoints(dated, { key: 'weight_kg', unit: 'kg' }, source);
    const first = points[0], last = points.at(-1)!;
    const values = points.map(point => point.value);
    lines.push(`- ${entry.source_name} (${entry.method}): ${number(first.value)} kg (${first.date}) → ${number(last.value)} kg (${last.date}). `
      + (es ? `Rango de medianas diarias: ${number(Math.min(...values))}–${number(Math.max(...values))} kg en ${points.length} fechas.`
        : `Daily-median range: ${number(Math.min(...values))}–${number(Math.max(...values))} kg across ${points.length} dates.`));
  }
  if (!weightSources.size) lines.push(es ? 'No hay peso guardado con fecha válida; no se estima a partir de otros indicadores.' : 'No dated weight is saved; it is not estimated from other measurements.');
  lines.push(es ? '## Composición y perímetros' : '## Composition and circumferences');
  const composition = all.comparisons.filter(item => item.key !== 'weight_kg').slice(0, 10);
  lines.push(...composition.map(comparisonLine));
  if (!composition.length) lines.push(es ? 'Aún no hay dos fechas comparables para estos indicadores. Una medición aislada sigue guardada, pero no demuestra una tendencia.' : 'These measurements do not yet have two comparable dates. A single reading remains saved, but does not establish a trend.');
  lines.push(es ? '## Historial completo y últimos 90 días' : '## Full history and the last 90 days',
    es ? `${recent.workouts.sessions} entrenamientos completados y ${dated.filter(entry => entry.measured_at! >= shiftDateKey(today, -89)).length} lecturas en los últimos 90 días. El cambio reciente puede diferir del cambio desde la primera medición.`
      : `${recent.workouts.sessions} completed workouts and ${dated.filter(entry => entry.measured_at! >= shiftDateKey(today, -89)).length} readings in the last 90 days. Recent changes can differ from changes since the first reading.`);
  lines.push(...recent.comparisons.slice(0, 6).map(comparisonLine));
  if (!recent.comparisons.length) lines.push(es ? 'No hay dos fechas comparables dentro de esta ventana reciente; no se rellena con un cambio de cero.' : 'There are not two comparable dates within the recent window; an unknown change is not filled with zero.');
  const sessions = db.getWorkoutSessions().filter(session => session.status === 'completed' && isDateKey(session.date) && session.date <= today);
  const sets = sessions.flatMap(session => session.exercises.flatMap(exercise => exercise.sets)).filter(set => set.done);
  const measurementSessions = dates.length ? sessions.filter(session => session.date >= dates[0] && session.date <= dates.at(-1)!).length : 0;
  lines.push(es ? '## Entrenamientos registrados' : '## Recorded workouts',
    es ? `${sessions.length} entrenamientos completados y ${sets.length} series completadas en todo el historial disponible. En el periodo de mediciones hay ${measurementSessions} entrenamientos completados.`
      : `${sessions.length} completed workouts and ${sets.length} completed sets across available history. There are ${measurementSessions} completed workouts within the measurement period.`,
    es ? 'Las asociaciones con entrenamientos no demuestran causalidad. El volumen registrado no mide por sí solo la fuerza, y una sesión sin completar no cuenta como entrenamiento completado.'
      : 'Workout associations do not prove causation. Recorded volume alone does not measure strength, and an unfinished session does not count as a completed workout.',
    es ? '## Fuentes y límites' : '## Sources and limitations',
    es ? 'Medianas diarias; fuentes y métodos separados. Una báscula BIA, una cinta y una evaluación antropométrica no son intercambiables. La masa en kg y la proporción en % son indicadores distintos.'
      : 'Daily medians; separate sources and methods. A BIA scale, tape measurements and an anthropometric assessment are not interchangeable. Mass in kg and proportion in % are separate measurements.',
    es ? `${entries.length - dated.length} lecturas sin fecha válida o con fecha futura quedan fuera de las tendencias. Los datos ausentes son desconocidos, no ceros. Este resumen no determina causas ni hace un diagnóstico.`
      : `${entries.length - dated.length} undated, invalid-date or future readings stay out of trends. Missing values are unknown, not zeros. This overview does not establish causes or provide a diagnosis.`);
  if (tracking.historical_sources.length) lines.push(es
    ? `Referencias históricas: ${tracking.historical_sources.slice(0, 6).map(source => source.source_name).join('; ')}. Sus mediciones se conservan como evidencia de esas fechas; no necesitas obtener nuevos informes. Puedes continuar con tu báscula o mediciones propias, con su fuente y método como referencia independiente.`
    : `Historical references: ${tracking.historical_sources.slice(0, 6).map(source => source.source_name).join('; ')}. Their measurements remain evidence of those dates; new reports are not required. Tracking can continue with your own scale or manual measurements, under their own source and method as an independent baseline.`);
  lines.push(
    es ? '## Tus próximas mediciones manuales' : '## Your next manual readings',
    es ? 'Puedes añadir más adelante el peso y los perímetros que hayas medido, con su fecha, unidad y fuente. Conserva la misma referencia de medición para compararlos. No necesitas repetir todos los campos de un informe profesional.'
      : 'You can later add the weight and circumferences you have measured, with their date, unit and source. Keep the same measurement reference for comparisons. You do not need to repeat every field from a professional report.',
    es ? 'Deja en blanco lo que no hayas medido. Los pliegues y sus sumas usan mm; los perímetros usan cm. Guarda las mediciones caseras con su propia fuente y método, separadas del informe anterior.'
      : 'Leave values blank when you have not measured them. Skinfolds and their sums use mm; circumferences use cm. Save home measurements under their own source and method, separately from the earlier report.');
  return { kind: 'progress-facts-v1', narrative_version: 3, tracking_context: tracking, status: 'ready', summary: lines.join('\n\n'), revision,
    source_fingerprint: sourceHash(entries), range: { start_date: dates[0] ?? null, end_date: dates.at(-1) ?? null, as_of: today },
    counts: { observations: entries.length, measurement_dates: dates.length }, history_incomplete: false };
}

export function getWorkspace(): MeasurementWorkspaceData;
export function getWorkspace(input: MeasurementWorkspaceRequest): MeasurementSectionData;
export function getWorkspace(input?: MeasurementWorkspaceRequest): MeasurementWorkspaceData | MeasurementSectionData {
  const state = read();
  let changed = false;
  let entries = allEntries(state, input?.section === 'references' ? 5001 : 500);
  // Reference hints only read confirmed facts, without completing jobs or computing workout context.
  if (input?.section === 'references') {
    const before = input.beforeDate === undefined ? localDateKey() : input.beforeDate;
    if (typeof before !== 'string' || !isDateKey(before) || before > localDateKey()) throw new Error('Choose a valid measurement date on or before today.');
    for (const value of [input.sourceName, input.method, input.excludeEntryId]) {
      if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 200)) throw new Error('Choose a valid measurement reference filter.');
    }
    if (Boolean(input.sourceName) !== Boolean(input.method)) throw new Error('Choose both a source and method for a preferred reference.');
    const more = entries.length > 5000;
    return { section: 'references', revision: state.revision,
      reference_entries: priorMeasurementReferences(entries.slice(0, 5000), before, input), has_more: more,
      warnings: more ? ['Older readings may be outside this bounded reference history; the latest prior reading may be unavailable.'] : [] };
  }
  for (const job of [...state.jobs].reverse()) if (job.status === 'pending' && Date.now() - job.created > 900) {
    job.status = job.revision === state.revision ? 'ready' : 'stale'; changed = true;
    if (job.status === 'ready') {
      state.summaries ??= {};
      for (const entry of entries) state.summaries[entry.id!] = { hash: entryHash(entry), summary: `${entry.measured_at ?? (spanish() ? 'Fecha sin especificar' : 'Date not specified')} · ${entry.source_name}: ${entry.metrics.map(value => `${value.label} ${value.value} ${value.unit}`).join(', ')}.` };
      state.insights = analysis(entries, state.revision, job.days);
      state.source_hash = sourceHash(entries);
    }
  }
  if (changed) write(state);
  entries = allEntries(state);
  // Keep saved demo narratives aligned with the current tracking policy without changing records.
  const savedInsights = state.insights ? analysis(entries, state.insights.revision, state.insights.days) : undefined;
  const insights = savedInsights ? { ...savedInsights, status: savedInsights.revision === state.revision && state.source_hash === sourceHash(entries) ? 'ready' : 'stale' } : null;
  const latest = state.jobs.find(job => job.revision === state.revision);
  const memory = insights?.status === 'ready' ? { revision: state.revision, status: 'ready', summary: insights.summary, entry_summaries: entries.map(entry => ({ entry_id: entry.id!, revision: entry.revision, summary: entry.summary ?? '' })) }
    : latest ? { revision: state.revision, status: latest.status, summary: '', job_id: latest.id, error_reason: latest.error_reason } : null;
  if (!input) return { entries, revision: state.revision, jobs: state.jobs.slice(0, 20), insights, memory, factual_digest: factualDigest(entries, state.revision) };
  const base = { section: input.section, revision: state.revision, warnings: [] };
  if (input.section === 'jobs') return { ...base, jobs: state.jobs.slice(0, 20) };
  if (input.section === 'summary') return { ...base, insights, memory, factual_digest: factualDigest(entries, state.revision) };
  if (input.section === 'history') {
    const start = input.cursor ? Number(atob(input.cursor).replace('demo-history:', '')) : 0;
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('Invalid history cursor');
    const size = input.pageSize ?? 20;
    const page = entries.slice(start, start + size);
    const more = start + page.length < entries.length;
    return { ...base, entries: page, has_more: more, next_cursor: more ? btoa(`demo-history:${start + page.length}`) : null, order: 'record_date_desc' };
  }
  const start = shiftDateKey(localDateKey(), -((input.days ?? 90) - 1));
  const period = entries.filter(entry => entry.measured_at && entry.measured_at >= start && entry.measured_at <= localDateKey());
  const options = [...new Map(period.flatMap(entry => entry.metrics).map(item => [JSON.stringify([item.key, item.unit]), { key: item.key, label: item.label, unit: item.unit }])).values()];
  const matching = period.filter(entry => entry.metrics.some(item => item.key === input.metricKey && (input.metricUnit === undefined || item.unit === input.metricUnit)));
  const sources = [...new Map(matching.map(entry => [measurementSourceKey(entry), { source_name: entry.source_name, method: entry.method }])).values()];
  const filtered = input.metricKey && input.sourceName && input.method ? matching.filter(entry => measurementSourceKey(entry) === measurementSourceKey({ source_name: input.sourceName!, method: input.method! }))
    .map(entry => ({ ...entry, metrics: entry.metrics.filter(item => item.key === input.metricKey && (input.metricUnit === undefined || item.unit === input.metricUnit)) })) : [];
  return { ...base, entries: filtered, metric_options: options, source_options: sources, has_more: false };
}

const referenceMetricUnits: Record<string, string> = { weight_kg: 'kg', body_fat_pct: '%', relaxed_arm_cm: 'cm', tensed_arm_cm: 'cm', waist_cm: 'cm', thighs_cm: 'cm', calf_cm: 'cm' };
const referenceMetricAliases: Record<string, string> = { weight: 'weight_kg', peso: 'weight_kg', body_fat: 'body_fat_pct', body_fat_percentage: 'body_fat_pct', grasa_corporal: 'body_fat_pct', waist: 'waist_cm', thighs: 'thighs_cm' };

/** Read-only projection of each latest prior metric; repeat readings remain saved separately. */
function priorMeasurementReferences(entries: MeasurementEntry[], before: string, input: MeasurementWorkspaceRequest): MeasurementEntry[] {
  const preferred = input.sourceName && input.method ? measurementSourceKey({ source_name: input.sourceName, method: input.method }) : undefined;
  const candidates = new Map<string, { entry: MeasurementEntry; metric: MeasurementMetric }[]>();
  for (const entry of entries) {
    if (!entry.measured_at || !isDateKey(entry.measured_at) || entry.measured_at >= before || (input.excludeEntryId !== undefined && entry.id === input.excludeEntryId)) continue;
    for (const metric of entry.metrics) {
      const rawKey = (metric.key || metric.label).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
      const key = referenceMetricAliases[rawKey] ?? rawKey;
      if (referenceMetricUnits[key] !== metric.unit || typeof metric.value !== 'number' || !Number.isFinite(metric.value) || metric.value < 0) continue;
      candidates.set(key, [...(candidates.get(key) ?? []), { entry, metric }]);
    }
  }
  return Object.keys(referenceMetricUnits).flatMap(key => {
    const all = candidates.get(key) ?? [];
    const matches = preferred ? all.filter(row => measurementSourceKey(row.entry) === preferred) : [];
    const rows = matches.length ? matches : all;
    if (!rows.length) return [];
    rows.sort((a, b) => a.entry.measured_at!.localeCompare(b.entry.measured_at!) || (a.entry.id ?? '').localeCompare(b.entry.id ?? ''));
    const latest = rows.at(-1)!;
    const repeats = rows.filter(row => row.entry.measured_at === latest.entry.measured_at && measurementSourceKey(row.entry) === measurementSourceKey(latest.entry));
    const values = repeats.map(row => row.metric.value).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const value = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return [{ id: latest.entry.id, measured_at: latest.entry.measured_at, source_name: latest.entry.source_name, method: latest.entry.method,
      metrics: [{ key, label: latest.metric.label, unit: referenceMetricUnits[key], value }],
      reference_aggregation: 'daily_median' as const, reference_reading_count: repeats.length,
      reference_source_ids: [...new Set(repeats.flatMap(row => row.entry.id ? [row.entry.id] : []))].sort() }];
  });
}

function normalizeTextMetric(label: string, value: number, unit: string): MeasurementMetric {
  const rawValue = value; const rawUnit = unit;
  const lower = label.toLowerCase();
  let key = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_');
  const weight = /^(weight|peso|body weight)$/.test(lower);
  if (weight) key = 'weight_kg';
  else if (/body fat|grasa corporal|fat percentage|porcentaje de grasa/.test(lower) && unit === '%') key = 'body_fat_pct';
  else if (/^(waist|cintura)$/.test(lower)) key = 'waist_cm';
  else if (/^(chest|pecho)$/.test(lower)) key = 'chest_cm';
  else if (/^(hips?|caderas?)$/.test(lower)) key = 'hips_cm';
  else if (/^(arms?|brazos?)$/.test(lower)) key = 'arms_cm';
  else if (/^(thighs?|muslos?)$/.test(lower)) key = 'thighs_cm';
  else if (/^(height|altura|talla)$/.test(lower)) key = 'height_cm';
  else if (/skeletal muscle|m[uú]sculo esquel[eé]tico/.test(lower)) key = unit === '%' ? 'skeletal_muscle_pct' : 'skeletal_muscle_kg';
  else if (/muscle mass|masa muscular/.test(lower)) key = unit === '%' ? 'muscle_mass_pct' : 'muscle_mass_kg';
  const result: MeasurementMetric = { key, label, value, unit, raw_value: rawValue, raw_unit: rawUnit, confidence: 'medium', evidence: `${label}: ${rawValue} ${rawUnit}` };
  try {
    if (!unit && /_(kg|cm|mm|pct)$/.test(key)) throw new Error('Missing unit');
    return normalizeMetric(result);
  } catch {
    return { ...result, key: `unmapped_${key}_reading`, confidence: 'low' };
  }
}

export async function parseImport(input: { storagePath?: string; text?: string }): Promise<MeasurementDraft> {
  await new Promise(resolve => setTimeout(resolve, 400));
  const importId = id();
  if (!input.text) return { import_id: importId, status: 'review', warnings: ['Demo extraction uses simulated values. Your original file stays in this browser.'], entries: [{ measured_at: null, source_name: 'Demo scale', method: 'bia', metrics: [metric('weight_kg', 'Weight', 78.2, 'kg'), metric('body_fat_pct', 'Body fat', 19.4, '%'), metric('skeletal_muscle_kg', 'Skeletal muscle', 34.8, 'kg')] }] };
  const text = input.text.trim();
  const entries: MeasurementEntry[] = [];
  let measuredAt: string | null = null;
  let metrics: MeasurementMetric[] = [];
  const flush = () => { if (metrics.length) entries.push({ measured_at: measuredAt, source_name: 'Pasted report', method: 'unknown', metrics }); metrics = []; };
  for (const line of text.split(/[\n;]/)) {
    const reportDate = line.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    if (reportDate) { flush(); measuredAt = reportDate; continue; }
    const match = line.trim().match(/^([^\d:=]+?)\s*[:=]\s*(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z%][a-zA-Z0-9/%²]*)?\s*$/i);
    if (match) metrics.push(normalizeTextMetric(match[1].trim(), Number(match[2].replace(',', '.')), match[3]?.toLowerCase() ?? ''));
  }
  flush();
  if (!entries.length) throw new Error('No readable measurements found. Use one metric per line, for example: Weight: 78.2 kg.');
  return { import_id: importId, status: 'review', warnings: [spanish() ? 'La demostración usa un analizador local de texto; producción usa OpenAI.' : 'Demo mode uses a local text parser; production uses OpenAI.', ...(entries.some(entry => !entry.measured_at) ? [spanish() ? 'La fecha no aparece en el informe. Puedes confirmarla o dejarla en blanco.' : 'No measurement date was found. Confirm it or keep the reading undated.'] : []), ...(entries.some(entry => entry.metrics.some(value => value.confidence === 'low')) ? [spanish() ? 'Revisa las unidades desconocidas con el informe original; no se han supuesto ni convertido.' : 'Check unclear units against the original report; they have been kept without guessing or converting.'] : [])], entries };

}

function commit(state: DemoState, entryIds: string[], requestId: string): MeasurementSaveResult {
  if (state.requests[requestId]) return state.requests[requestId];
  state.revision += 1;
  state.jobs = state.jobs.map(job => ({ ...job, status: job.status === 'ready' || job.status === 'pending' ? 'stale' : job.status }));
  const jobId = id();
  state.jobs.unshift({ id: jobId, kind: 'summary', status: 'pending', revision: state.revision, created: Date.now(), days: 90 });
  const result: MeasurementSaveResult = { entry_ids: entryIds, revision: state.revision, job_id: jobId, status: 'pending' };
  state.requests[requestId] = result;
  state.requests = Object.fromEntries(Object.entries(state.requests).slice(-200));
  write(state);
  return result;
}

function normalizeMetric(input: MeasurementMetric): MeasurementMetric {
  const metric = { ...input, raw_value: input.raw_value ?? input.value, raw_unit: input.raw_unit ?? input.unit };
  const unit = metric.unit.toLowerCase().trim();
  if (metric.key.endsWith('_kg')) {
    if (/^(lb|lbs|pounds?)$/.test(unit)) metric.value *= 0.45359237;
    else if (unit === 'g') metric.value /= 1000;
    else if (unit !== 'kg') throw new Error('Check the mass unit.');
    metric.unit = 'kg';
  } else if (metric.key.endsWith('_cm')) {
    if (/^(in|inch|inches)$/.test(unit)) metric.value *= 2.54;
    else if (unit === 'm') metric.value *= 100;
    else if (unit === 'mm') metric.value /= 10;
    else if (unit !== 'cm') throw new Error('Check the length unit.');
    metric.unit = 'cm';
  }
  metric.value = Math.round(metric.value * 100000) / 100000;
  return metric;
}

function clearLegacy(entry: MeasurementEntry | undefined) {
  if (!entry?.legacy_ref) return;
  const data = JSON.parse(localStorage.getItem(db.DB_KEY) ?? '{}') as db.DemoDb;
  const { kind, id } = entry.legacy_ref;
  if (kind === 'manual' && data.logs?.[id]) {
    delete data.logs[id].weight_kg; delete data.logs[id].body_fat_pct; data.logs[id].measurements = {};
  } else {
    if (kind === 'report') data.reports = (data.reports ?? []).filter(report => report.id !== id);
    for (const [date, log] of Object.entries(data.logs ?? {})) {
      const report = log.body_composition_report;
      if ((kind === 'log_report' && date === id) || (entry.source_storage_path && report?.report_storage_path === entry.source_storage_path) ||
          (entry.source_download_url && report?.report_url === entry.source_download_url)) delete log.body_composition_report;
    }
  }
  localStorage.setItem(db.DB_KEY, JSON.stringify(data));
}

export async function saveEntries(entries: MeasurementEntry[], importId: string | undefined, requestId: string): Promise<MeasurementSaveResult> {
  const state = read();
  if (state.requests[requestId]) return state.requests[requestId];
  const confirmed = entries.map(entry => ({ ...entry, metrics: entry.metrics.map(normalizeMetric), id: id(), import_id: importId, revision: 1, summary: undefined, summary_status: 'pending' }));
  state.entries.unshift(...confirmed);
  return commit(state, confirmed.map(entry => entry.id), requestId);
}

export async function updateEntry(entryId: string, entry: MeasurementEntry, requestId: string): Promise<MeasurementSaveResult> {
  const state = read();
  if (state.requests[requestId]) return state.requests[requestId];
  state.removed.push(entryId);
  state.entries = state.entries.filter(existing => existing.id !== entryId);
  const next = { ...entry, metrics: entry.metrics.map(normalizeMetric), id: entryId, revision: (entry.revision ?? 0) + 1, summary: undefined, summary_status: 'pending' };
  delete state.summaries?.[entryId];
  clearLegacy(allEntries(state).find(existing => existing.id === entryId) ?? entry);
  state.entries.unshift(next);
  return commit(state, [next.id], requestId);
}

export async function deleteEntry(entryId: string, requestId: string): Promise<void> {
  const state = read();
  if (state.requests[requestId]) return;
  clearLegacy(allEntries(state).find(entry => entry.id === entryId));
  state.removed.push(entryId);
  state.entries = state.entries.filter(entry => entry.id !== entryId);
  delete state.summaries?.[entryId];
  commit(state, [], requestId);
}

export async function generateInsights(days: number): Promise<void> {
  const state = read();
  if (state.jobs.some(job => job.revision === state.revision && job.status === 'pending' && job.days === days)) return;
  state.jobs.unshift({ id: id(), kind: 'insight', status: 'pending', revision: state.revision, created: Date.now(), days });
  write(state);
}

export async function retryJob(jobId: string): Promise<void> {
  const state = read(); const job = state.jobs.find(item => item.id === jobId);
  if (job) { job.status = 'pending'; job.created = Date.now(); job.revision = state.revision; write(state); }
}
