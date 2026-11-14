import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, IconButton, InputLabel, MenuItem, Select, Skeleton, Stack, Tab, Tabs, TextField, Typography, useMediaQuery } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import MarkdownMessage from '../chat/MarkdownMessage';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../firebase/config';
import { useAuthStore } from '../../store/authStore';
import { isDemoMode } from '../../demo';
import { deleteStoredFile, uploadBodyCompositionReport } from '../../firebase/storage';
import { useMeasurementJobPolling } from '../../hooks/useMeasurementJobPolling';
import { isQaAiPaused } from '../../lib/aiErrors';
import { measurementImportError } from '../../lib/measurementImportErrors';
import MeasurementImportStatus, { type ImportPhase } from './MeasurementImportStatus';
import UploadedProgressStatement from './UploadedProgressStatement';
import type { UploadedProgress } from '../../lib/measurementProgressStatement';
import { deleteMeasurementEntry, generateProgressInsights, getMeasurementWorkspace, measurementRequestId, parseMeasurementImport, retryMeasurementJob, saveMeasurementEntries, updateMeasurementEntry } from '../../firebase/measurements';
import type { MeasurementEntry, MeasurementJob, MeasurementMetric, MeasurementSection, MeasurementWorkspaceData, MeasurementWorkspaceRequest } from '../../types/measurement';
import { isDateKey, localDateKey } from '../../lib/dates';
import { measurementSourceKey, metricSeriesKey, metricTrendPoints } from '../../lib/measurementTrends';

const DEFAULT_METRICS = [
  ['weight_kg', 'kg'], ['body_fat_pct', '%'], ['waist_cm', 'cm'], ['chest_cm', 'cm'], ['hips_cm', 'cm'], ['arms_cm', 'cm'], ['thighs_cm', 'cm'],
  ['relaxed_arm_cm', 'cm'], ['tensed_arm_cm', 'cm'], ['calf_cm', 'cm'], ['humerus_cm', 'cm'], ['femur_cm', 'cm'],
  ['body_fat_kg', 'kg'], ['lean_mass_kg', 'kg'], ['muscle_mass_kg', 'kg'], ['skeletal_muscle_kg', 'kg'], ['body_water_pct', '%'], ['bmi', ''],
  ['height_cm', 'cm'], ['skeletal_muscle_pct', '%'], ['muscle_mass_pct', '%'], ['bone_mass_kg', 'kg'], ['bone_mass_pct', '%'],
  ['protein_kg', 'kg'], ['protein_pct', '%'], ['body_water_kg', 'kg'], ['subcutaneous_fat_pct', '%'],
  ['visceral_fat_level', 'index'], ['bmr_kcal', 'kcal'], ['metabolic_age', 'years'], ['body_score', 'score'], ['asmi', 'kg/m²'], ['waist_hip_ratio', ''],
  ['triceps_mm', 'mm'], ['subscapular_mm', 'mm'], ['pectoral_mm', 'mm'], ['iliac_crest_mm', 'mm'], ['supraspinale_mm', 'mm'],
  ['abdominal_mm', 'mm'], ['medial_thigh_mm', 'mm'], ['medial_calf_mm', 'mm'], ['axillary_mm', 'mm'], ['sum_6_skinfolds_mm', 'mm'], ['sum_8_skinfolds_mm', 'mm'], ['custom', ''],
] as const;
const PREFIX = 'measurementWorkspace.';
const EMPTY_ENTRIES: MeasurementEntry[] = [];
const MANUAL_METRIC_KEYS = ['weight_kg', 'body_fat_pct', 'waist_cm', 'relaxed_arm_cm', 'tensed_arm_cm', 'thighs_cm', 'calf_cm'];
const BODY_SHARE_KEYS = new Set(['body_fat_pct', 'muscle_mass_pct', 'skeletal_muscle_pct', 'body_water_pct', 'bone_mass_pct', 'protein_pct', 'subcutaneous_fat_pct', 'residual_mass_pct']);
const REPORT_HIGHLIGHTS = new Set(['weight_kg', 'body_fat_pct', 'muscle_mass_kg', 'skeletal_muscle_kg']);
type DraftMetric = Omit<MeasurementMetric, 'value'> & { value: string };
type DraftEntry = Omit<MeasurementEntry, 'metrics'> & { metrics: DraftMetric[] };
const toDraft = (entry: MeasurementEntry): DraftEntry => ({ ...entry, metrics: entry.metrics.map(metric => ({ ...metric, value: String(metric.value) })) });

function validEntries(drafts: DraftEntry[]): MeasurementEntry[] | null {
  if (!drafts.length) return null;
  const entries: MeasurementEntry[] = [];
  for (const entry of drafts) {
    if ((entry.measured_at && (!isDateKey(entry.measured_at) || entry.measured_at > localDateKey())) || !entry.source_name.trim()) return null;
    const metrics: MeasurementMetric[] = [];
    for (const metric of entry.metrics) {
      if (metric.value.trim() === '') continue;
      const value = Number(metric.value.replace(',', '.'));
      if (!Number.isFinite(value) || value < 0 || !metric.label.trim() || !metric.key.trim()) return null;
      if (BODY_SHARE_KEYS.has(metric.key) && value > 100) return null;
      if (!metric.unit.trim() && /_(kg|cm|mm|pct)$/.test(metric.key)) return null;
      if (metrics.some(existing => existing.key === metric.key)) return null;
      if (metric.key === 'weight_kg' && value <= 0) return null;
      metrics.push({ ...metric, value });
    }
    if (!metrics.length) return null;
    entries.push({ ...entry, source_name: entry.source_name.trim(), metrics });
  }
  return entries;
}

type ProgressSection = Exclude<MeasurementSection, 'jobs' | 'references'>;
export default function MeasurementWorkspace({ initialDate, selectedSection, onSectionChange }: {
  initialDate?: string; selectedSection?: ProgressSection | null; onSectionChange?: (section: ProgressSection) => void;
}) {
  const { t, i18n } = useTranslation();
  const smallScreen = useMediaQuery('(max-width:599px)');
  const { currentUser } = useAuthStore();
  const uid = currentUser?.uid;
  const [workspace, setWorkspace] = useState<MeasurementWorkspaceData | null>(null);
  const selectionMode = selectedSection !== undefined;
  const section = selectionMode ? selectedSection : 'all';
  const [loading, setLoading] = useState(!selectionMode);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploadedProgress, setUploadedProgress] = useState<UploadedProgress | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'manual' | 'upload' | 'paste'>('manual');
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [references, setReferences] = useState<{ request: string; entries: MeasurementEntry[]; incomplete?: boolean; failed?: boolean } | null>(null);
  const [referenceAttempt, setReferenceAttempt] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imagePreviewRef = useRef<string | null>(null);
  const [originalPreview, setOriginalPreview] = useState<{ entryId?: string; url: string; kind: 'image' | 'pdf' | 'file' } | null>(null);
  const [originalLoading, setOriginalLoading] = useState(false);
  const [importId, setImportId] = useState<string>();
  const [uploadEditing, setUploadEditing] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [importPhase, setImportPhase] = useState<ImportPhase | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [formError, setFormError] = useState('');
  const [selected, setSelected] = useState<MeasurementEntry | null>(null);
  const [deleting, setDeleting] = useState<MeasurementEntry | null>(null);
  const [days, setDays] = useState(90);
  const [trendKey, setTrendKey] = useState(selectionMode ? '' : metricSeriesKey({ key: 'weight_kg', unit: 'kg' }));
  const [trendSource, setTrendSource] = useState('');
  const [visibleCount, setVisibleCount] = useState(10);
  const [jobData, setJobData] = useState<{ revision: number; jobs: MeasurementJob[] } | null>(null);
  const jobGeneration = useRef(0);
  const jobState = useRef('');
  const activeUid = useRef(uid);
  activeUid.current = uid;
  const requestId = useRef(measurementRequestId());
  const stagedPath = useRef<string | null>(null);
  const stagedOriginal = useRef<string | null>(null);
  const stagedMayBeSaved = useRef(false);
  const generation = useRef(0);
  const tk = (key: string, options?: Record<string, unknown>) => t(`${PREFIX}${key}`, options);
  const errorLabel = (key: string) => key === 'qaAiPaused' ? t('redesign.qa.aiPaused') : tk(key);
  const label = (metric: Pick<MeasurementMetric, 'key' | 'label'>) => t(`${PREFIX}metrics.${metric.key}`, { defaultValue: metric.label });
  const methodLabel = (method: string) => tk(({ manual: 'methodManual', bia: 'methodBia', anthropometric: 'methodAnthro', unknown: 'methodUnknown' } as Record<string, string>)[method] ?? 'methodUnknown');
  const chooseFile = useCallback((next: File | null) => {
    setFormError('');
    if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    const preview = next?.type.startsWith('image/') && next.size <= 10 * 1024 * 1024 ? URL.createObjectURL(next) : null;
    imagePreviewRef.current = preview; setImagePreview(preview); setFile(next);
  }, []);
  useEffect(() => () => { if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current); }, []);
  const trendRequest = section === 'trends' ? JSON.stringify({ days, trendKey, trendSource }) : '';
  const referenceDraft = drafts[0];
  const referenceRequest = open && mode === 'manual' && drafts.length === 1
    && referenceDraft.measured_at && isDateKey(referenceDraft.measured_at) && referenceDraft.measured_at <= localDateKey()
    ? JSON.stringify({ section: 'references', beforeDate: referenceDraft.measured_at,
      ...(referenceDraft.source_name.trim() ? { sourceName: referenceDraft.source_name.trim(), method: referenceDraft.method } : {}),
      ...(editingId ? { excludeEntryId: editingId } : {}) }) : '';
  const referenceKey = JSON.stringify([uid, referenceRequest, referenceAttempt]);
  useEffect(() => {
    if (!uid || !referenceRequest) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void getMeasurementWorkspace(JSON.parse(referenceRequest) as MeasurementWorkspaceRequest).then(data => {
        if (current) setReferences({ request: referenceKey, entries: data.reference_entries ?? [], incomplete: data.has_more });
      }).catch(() => {
        if (current) setReferences({ request: referenceKey, entries: [], failed: true });
      });
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [uid, referenceRequest, referenceKey]);
  const activeReferences = references?.request === referenceKey ? references : null;
  const previousReading = (metric: DraftMetric) => {
    if (!referenceRequest || !MANUAL_METRIC_KEYS.includes(metric.key) || !activeReferences || activeReferences.failed) return null;
    const entry = activeReferences.entries.find(entry => entry.metrics.some(previous => previous.key === metric.key));
    const previous = entry?.metrics.find(previous => previous.key === metric.key);
    return entry && previous ? tk((entry.reference_reading_count ?? 1) > 1 ? 'previousReadingMedian' : 'previousReading', { value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 }).format(previous.value),
      unit: previous.unit, date: entry.measured_at, source: entry.source_name, method: methodLabel(entry.method) }) : tk('noPreviousReading');
  };

  const load = useCallback(async (quiet = false, cursor?: string) => {
    if (!uid || !section) return;
    const current = ++generation.current;
    if (cursor) setLoadingMore(true);
    else if (!quiet) { setLoading(true); setWorkspace(null); }
    try {
      let data: MeasurementWorkspaceData;
      if (section === 'all') data = await getMeasurementWorkspace();
      else {
        const request: MeasurementWorkspaceRequest = { section };
        if (section === 'history') { request.pageSize = 10; if (cursor) request.cursor = cursor; }
        if (section === 'trends') {
          const filters = JSON.parse(trendRequest) as { days: number; trendKey: string; trendSource: string };
          request.days = filters.days;
          if (filters.trendKey) { const [key, unit] = JSON.parse(filters.trendKey) as [string, string]; request.metricKey = key; request.metricUnit = unit; }
          if (filters.trendSource) { const [sourceName, method] = JSON.parse(filters.trendSource) as [string, string]; request.sourceName = sourceName; request.method = method; }
        }
        data = { entries: [], memory: null, insights: null, jobs: [], ...await getMeasurementWorkspace(request) };
      }
      if (generation.current === current) {
        setWorkspace(previous => {
          if (section === 'history' && previous && (cursor || quiet)) {
            const rows = new Map((cursor ? previous.entries : data.entries).map(entry => [entry.id, entry]));
            for (const entry of cursor ? data.entries : previous.entries) if (cursor || !rows.has(entry.id)) rows.set(entry.id, entry);
            return { ...data, entries: [...rows.values()], ...(quiet && !cursor ? { next_cursor: previous.next_cursor, has_more: previous.has_more } : {}) };
          }
          return data;
        }); setError('');
      }
    } catch {
      if (generation.current === current) setError('loadError');
    } finally { if (generation.current === current) { setLoading(false); setLoadingMore(false); } }
  }, [uid, section, trendRequest]);
  const latestLoad = useRef(load);
  latestLoad.current = load;

  useEffect(() => {
    setUploadedProgress(null);
    setWorkspace(null); setVisibleCount(10); setOpen(false); setDrafts([]); setSelected(null); setOriginalPreview(null); setDeleting(null); chooseFile(null); setText(''); setWarnings([]); setImportId(undefined); setEditingId(undefined); setBusy(false); setJobData(null); jobState.current = ''; jobGeneration.current += 1;
    if (stagedPath.current) { void deleteStoredFile(stagedPath.current).catch(() => {}); stagedPath.current = null; stagedOriginal.current = null; }
    return () => { generation.current += 1; };
  }, [uid, chooseFile]);

  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);

  const jobs = selectionMode ? jobData?.jobs ?? [] : workspace?.jobs ?? [];
  const pendingJob = jobs.find(job => job.revision === (selectionMode ? jobData?.revision : workspace?.revision) && (job.status === 'pending' || job.status === 'processing'));
  const pending = !!pendingJob;
  const pollJob = useCallback(async (refreshSection = true) => {
    if (!selectionMode) { await load(true); return; }
    if (!uid) return;
    const current = ++jobGeneration.current;
    const owner = uid;
    let data;
    try { data = await getMeasurementWorkspace({ section: 'jobs' }); }
    catch { if (owner === activeUid.current) setError('loadError'); return; }
    if (owner !== activeUid.current || current !== jobGeneration.current) return;
    const next = JSON.stringify((data.jobs ?? []).map(job => [job.id, job.status, job.revision]));
    const changed = jobState.current !== next;
    jobState.current = next;
    setJobData({ revision: data.revision, jobs: data.jobs ?? [] });
    if (changed && refreshSection) await latestLoad.current(true);
  }, [load, selectionMode, uid]);
  const pollPendingJob = useCallback(() => pollJob(), [pollJob]);
  const polling = useMeasurementJobPolling(pendingJob ? `${uid}:${pendingJob.id}:${pendingJob.revision}` : null, pollPendingJob);

  const emptyDraft = (): DraftEntry => ({ measured_at: initialDate ?? localDateKey(), source_name: 'Manual', method: 'manual', metrics: MANUAL_METRIC_KEYS.map(key => ({ key, label: t(`${PREFIX}metrics.${key}`), unit: DEFAULT_METRICS.find(([candidate]) => candidate === key)![1], value: '' })) });
  const begin = () => { requestId.current = measurementRequestId(); setReferences(null); setEditingId(undefined); setImportId(undefined); setUploadEditing(false); setDrafts([emptyDraft()]); setWarnings([]); setText(''); chooseFile(null); setMode('manual'); setFormError(''); setOpen(true); };
  const edit = (entry: MeasurementEntry) => { requestId.current = measurementRequestId(); setReferences(null); setEditingId(entry.id); setImportId(entry.import_id); setDrafts([toDraft(entry)]); setWarnings([]); setMode('manual'); setFormError(''); setSelected(null); setOpen(true); };
  const close = () => {
    if (busy) return;
    setOpen(false);
    chooseFile(null);
    resetStaged();
  };
  const resetStaged = () => { if (stagedPath.current && !stagedMayBeSaved.current) void deleteStoredFile(stagedPath.current).catch(() => {}); stagedPath.current = null; stagedOriginal.current = null; stagedMayBeSaved.current = false; };
  const switchMode = (next: 'manual' | 'upload' | 'paste') => { resetStaged(); chooseFile(null); requestId.current = measurementRequestId(); setMode(next); setUploadEditing(false); setFormError(''); setWarnings([]); setImportId(undefined); setDrafts(next === 'manual' ? [emptyDraft()] : []); };
  const changeEntry = (index: number, fields: Partial<DraftEntry>) => { requestId.current = measurementRequestId(); setDrafts(previous => previous.map((entry, i) => i === index ? { ...entry, ...fields } : entry)); };
  const changeMetric = (entryIndex: number, metricIndex: number, fields: Partial<DraftMetric>) => changeEntry(entryIndex, { metrics: drafts[entryIndex].metrics.map((metric, i) => i === metricIndex ? { ...metric, ...fields } : metric) });

  const extract = async () => {
    if (!uid || busy) return;
    if (mode === 'upload' && (!file || file.size > 10 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setFormError('fileInvalid'); return; }
    if (mode === 'paste' && !text.trim()) return;
    setBusy(true); setFormError('');
    setUploadProgress(0);
    setImportPhase(mode === 'upload' && !stagedPath.current ? 'uploading' : 'extracting');
    const owner = uid;
    let uploading = false;
    try {
      let storagePath: string | undefined;
      if (mode === 'upload' && file) {
        if (!stagedPath.current) { uploading = true; const uploaded = await uploadBodyCompositionReport(uid, file, percent => {
          if (owner === activeUid.current) setUploadProgress(percent);
        });
          if (owner !== activeUid.current) { void deleteStoredFile(uploaded.storagePath).catch(() => {}); return; }
          stagedPath.current = uploaded.storagePath; stagedOriginal.current = uploaded.downloadUrl; }
        storagePath = stagedPath.current;
      }
      uploading = false;
      setImportPhase('extracting');
      const result = await parseMeasurementImport({ storagePath, text: mode === 'paste' ? text : undefined, requestId: requestId.current });
      if (owner !== activeUid.current) return;
      if (!result.entries.length || !result.entries.some(entry => entry.metrics.length)) { setFormError('noExtractedReadings'); return; }
      const nextDrafts = result.entries.map(entry => toDraft({ ...entry, ...(isDemoMode() && stagedPath.current ? { source_storage_path: stagedPath.current, source_download_url: stagedOriginal.current ?? undefined } : {}) }));
      setDrafts(nextDrafts); setWarnings(result.warnings ?? []); setImportId(result.import_id);
      if (mode === 'upload') {
        const entries = validEntries(nextDrafts);
        if (!entries) { setUploadEditing(true); setFormError('importNeedsEdit'); return; }
        setImportPhase('saving');
        try { await persist(entries, result.import_id, owner); }
        catch (failure) { if (owner === activeUid.current) { setUploadEditing(false); setFormError(isQaAiPaused(failure) ? 'qaAiPaused' : 'importSaveFailed'); } }
      }
    } catch (failure) { if (owner === activeUid.current) setFormError(isQaAiPaused(failure) ? 'qaAiPaused' : measurementImportError(failure, uploading)); }
    finally { if (owner === activeUid.current) { setBusy(false); setImportPhase(null); } }
  };

  const persist = async (entries: MeasurementEntry[], sourceImportId: string | undefined, owner: string | undefined) => {
    // A failed response can arrive after the server committed the save. Keep
    // that report's original file even if the user closes or selects a new one.
    if (mode === 'upload') stagedMayBeSaved.current = true;
    const result = editingId ? await updateMeasurementEntry(editingId, entries[0], requestId.current)
      : await saveMeasurementEntries(entries, sourceImportId, requestId.current);
    if (owner !== activeUid.current) return;
    setUploadedProgress(mode === 'upload' ? { entries: entries.map((entry, index) => ({ ...entry, id: result.entry_ids[index] })), revision: result.revision, jobId: result.job_id } : null);
    if (selectionMode) {
      const jobs: MeasurementJob[] = [{ id: result.job_id, kind: 'summary', status: 'pending', revision: result.revision }];
      setJobData({ revision: result.revision, jobs }); jobState.current = JSON.stringify(jobs.map(job => [job.id, job.status, job.revision]));
      if (!section || mode === 'upload') onSectionChange?.('history');
    }
    stagedPath.current = null; stagedOriginal.current = null; chooseFile(null); setOpen(false); setNotice(mode === 'upload' ? 'reportSaved' : 'saved');
    await load();
  };

  const save = async () => {
    if (busy) return;
    const entries = validEntries(drafts);
    if (!entries) { setFormError(drafts.some(entry => entry.measured_at && !isDateKey(entry.measured_at)) ? 'dateMissing' : 'invalid'); return; }
    setBusy(true); setFormError('');
    if (mode === 'upload') setImportPhase('saving');
    const owner = uid;
    try { await persist(entries, importId, owner); }
    catch (failure) { if (owner === activeUid.current) { if (mode === 'upload') setUploadEditing(false); setFormError(isQaAiPaused(failure) ? 'qaAiPaused' : mode === 'upload' ? 'importSaveFailed' : 'error'); } }
    finally { if (owner === activeUid.current) { setBusy(false); setImportPhase(null); } }
  };

  const remove = async () => {
    if (!deleting?.id) return;
    setBusy(true);
    try { await deleteMeasurementEntry(deleting.id, requestId.current); setUploadedProgress(null); setDeleting(null); setSelected(null); await load(); if (selectionMode) await pollJob(false); }
    catch (failure) { setError(isQaAiPaused(failure) ? 'qaAiPaused' : 'error'); }
    finally { setBusy(false); }
  };

  const refreshInsights = async () => {
    setBusy(true);
    try { await generateProgressInsights(days); if (selectionMode) await pollJob(false); await load(true); }
    catch (failure) { setError(isQaAiPaused(failure) ? 'qaAiPaused' : 'error'); }
    finally { setBusy(false); }
  };

  const original = async (entry: MeasurementEntry) => {
    const source = entry as MeasurementEntry & { source_storage_path?: string; source_download_url?: string; storage_path?: string; original_url?: string };
    setOriginalLoading(true);
    try {
      const path = source.source_storage_path ?? source.storage_path;
      const url = path && !isDemoMode() ? await getDownloadURL(ref(storage, path)) : source.source_download_url ?? source.original_url;
      if (!url) return;
      const parsed = new URL(url, window.location.origin);
      if (['https:', 'blob:'].includes(parsed.protocol)) {
        const extension = (path ?? parsed.pathname).toLowerCase();
        setOriginalPreview({ entryId: entry.id, url: parsed.href,
          kind: /\.pdf$/.test(extension) ? 'pdf' : /\.(?:xlsx?|csv|docx?)$/.test(extension) ? 'file' : 'image' });
      }
    } catch { setError('error'); }
    finally { setOriginalLoading(false); }
  };

  const entries = workspace?.entries ?? EMPTY_ENTRIES;
  const metricOptions = useMemo(() => selectionMode ? workspace?.metric_options ?? [] : [...new Map(entries.flatMap(entry => entry.metrics).map(metric => [metricSeriesKey(metric), metric])).values()], [entries, selectionMode, workspace?.metric_options]);
  const effectiveMetric = metricOptions.find(metric => metricSeriesKey(metric) === trendKey) ?? (selectionMode ? undefined : metricOptions[0]);
  const sourceOptions = useMemo(() => selectionMode ? (workspace?.source_options ?? []).map(entry => [JSON.stringify([entry.source_name, entry.method]), entry] as const)
    : [...new Map(entries.filter(entry => entry.metrics.some(metric => effectiveMetric && metricSeriesKey(metric) === metricSeriesKey(effectiveMetric))).map(entry => [measurementSourceKey(entry), entry])).entries()], [entries, effectiveMetric, selectionMode, workspace?.source_options]);
  const source = sourceOptions.some(([key]) => key === trendSource) ? trendSource : selectionMode ? undefined : sourceOptions[0]?.[0];
  const sourceEntry = sourceOptions.find(([key]) => key === source)?.[1];
  const points = useMemo(() => effectiveMetric && sourceEntry ? metricTrendPoints(entries, effectiveMetric, measurementSourceKey(sourceEntry)) : [], [entries, sourceEntry, effectiveMetric]);
  const insight = workspace?.insights?.status !== 'stale' && workspace?.insights?.revision === workspace?.revision ? workspace?.insights : null;
  const currentComparisons = insight?.comparisons?.filter(comparison => ['manual', 'bia'].includes(comparison.method?.trim().toLowerCase() ?? '')) ?? [];
  const failed = jobs.find(job => job.status === 'failed' && job.revision === (selectionMode ? jobData?.revision : workspace?.revision))
    ?? (workspace?.memory?.status === 'failed' && workspace.memory.job_id ? { id: workspace.memory.job_id, error_reason: workspace.memory.error_reason } : undefined);
  const selectedHighlights = selected?.metrics.filter(metric => REPORT_HIGHLIGHTS.has(metric.key)).slice(0, 4) ?? [];
  if (!selectedHighlights.length && selected) selectedHighlights.push(...selected.metrics.slice(0, 4));
  const selectedAdditional = selected?.metrics.filter(metric => !selectedHighlights.includes(metric)) ?? [];
  const canViewOriginal = (entry: MeasurementEntry) => !!(entry as MeasurementEntry & { source_storage_path?: string; source_download_url?: string; storage_path?: string; original_url?: string }).source_storage_path || !!entry.source_download_url || !!entry.storage_path || !!entry.original_url;
  const factualSummary = workspace?.factual_digest?.summary && <Accordion data-testid="measurement-factual-memory" variant="outlined" disableGutters defaultExpanded={selectionMode}>
    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography fontWeight={800}>{t('coachMemory.progress')}</Typography></AccordionSummary>
    <AccordionDetails sx={{ minWidth: 0 }}><Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('coachMemory.progressHint')}</Typography><MarkdownMessage content={workspace.factual_digest.summary} /></AccordionDetails>
  </Accordion>;

  return <Stack spacing={3} data-testid="measurement-workspace" data-entry-date={initialDate ?? ''}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }}>
      <Box><Typography variant="h5" fontWeight={800}>{tk('title')}</Typography><Typography color="text.secondary" sx={{ mt: .75, maxWidth: 600 }}>{tk('subtitle')}</Typography></Box>
      <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={begin} sx={{ flexShrink: 0 }}>{tk('add')}</Button>
    </Stack>
    {isDemoMode() && <Alert severity="info" variant="outlined">{tk('demo')}</Alert>}
    {selectionMode && <Stack role="tablist" aria-label={tk('sectionsLabel')} direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
      {(['summary', 'trends', 'history'] as const).map(value => <Button key={value} role="tab" aria-selected={section === value} aria-label={tk(`sections.${value}.title`)}
        variant={section === value ? 'contained' : 'outlined'} onClick={() => onSectionChange?.(value)} sx={{ flex: 1, textAlign: 'left', justifyContent: 'flex-start', p: 2, borderRadius: 3 }}>
        <Box><Typography component="span" display="block" fontWeight={800}>{tk(`sections.${value}.title`)}</Typography><Typography component="span" display="block" variant="body2" sx={{ mt: .5, opacity: .85 }}>{tk(`sections.${value}.hint`)}</Typography></Box>
      </Button>)}
    </Stack>}
    {selectionMode && !section && <Alert severity="info" variant="outlined">{tk('chooseSection')}</Alert>}
    {error && <Alert severity="error" action={<Button onClick={() => load()}>{tk('retry')}</Button>}>{errorLabel(error)}</Alert>}
    {workspace?.insights?.status === 'stale' && !pending && <Alert severity="info">{tk('stale')}</Alert>}
    {notice && <Alert severity="success" onClose={() => setNotice('')}>{tk(notice)}</Alert>}
    {uploadedProgress && uid && <UploadedProgressStatement key={`${uid}:${uploadedProgress.jobId}:${uploadedProgress.revision}`} upload={uploadedProgress} uid={uid}
      jobs={jobs} revision={(selectionMode ? jobData?.revision : workspace?.revision) ?? uploadedProgress.revision} insight={insight ?? null}
      pollingPaused={polling.paused} onRefreshStatus={() => { polling.resume(); void pollJob(); }}
      onRetry={async () => { try { await retryMeasurementJob(uploadedProgress.jobId); polling.resume(); await pollJob(); } catch (failure) { setError(isQaAiPaused(failure) ? 'qaAiPaused' : 'error'); } }}
      onDetails={() => { if (selectionMode) onSectionChange?.('summary'); else document.querySelector('[data-testid="measurement-insights"]')?.scrollIntoView({ block: 'start' }); }} />}
    {workspace?.warnings?.map((warning, index) => <Alert key={index} severity="info">{warning}</Alert>)}
    {pending && !uploadedProgress && <Alert severity="info" action={polling.paused && <Button onClick={() => { polling.resume(); void pollJob(); }}>{t('redesign.qa.refreshStatus')}</Button>}>
      {polling.paused ? t('redesign.qa.pollingPaused') : tk('preparing')}
    </Alert>}
    {failed && !uploadedProgress && <Alert severity={failed.error_reason === 'QA_AI_PAUSED' ? 'info' : 'warning'} action={<Button onClick={async () => { try { await retryMeasurementJob(failed.id); polling.resume(); await pollJob(); } catch (failure) { setError(isQaAiPaused(failure) ? 'qaAiPaused' : 'error'); } }}>{tk('retry')}</Button>}>{failed.error_reason === 'QA_AI_PAUSED' ? t('redesign.qa.aiPaused') : tk('failed')}</Alert>}
    {loading && !workspace ? <Stack spacing={2}><Skeleton variant="rounded" height={180} /><Skeleton variant="rounded" height={140} /></Stack> : <>
      {section === 'summary' && factualSummary}
      {(section === 'summary' || section === 'all') && <Card data-testid="measurement-insights" sx={{ background: 'linear-gradient(125deg, #f2edff, #fff 70%)', border: '1px solid #e6ddfa' }}><CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" gap={1}><AutoAwesomeRoundedIcon color="primary" /><Typography variant="h6" fontWeight={800}>{tk('insights')}</Typography></Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} alignItems={{ sm: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 180 }}><InputLabel id={"measurement-period-" + section}>{tk('range')}</InputLabel><Select labelId={"measurement-period-" + section} value={days} label={tk('range')} onChange={event => setDays(Number(event.target.value))}>{[30, 90, 180, 365].map(value => <MenuItem key={value} value={value}>{tk('days', { count: value })}</MenuItem>)}</Select></FormControl>
            <Button variant="outlined" onClick={refreshInsights} disabled={busy || pending} startIcon={pending ? <CircularProgress size={16} /> : <AutoAwesomeRoundedIcon />}>{tk('refresh')}</Button>
          </Stack>
          {insight ? <><Typography sx={{ lineHeight: 1.8 }}>{insight.summary}</Typography>
            {!!insight.tracking_context?.historical_sources.length && <Alert severity="info" variant="outlined" data-testid="measurement-historical-context">{tk('historicalReportHint', { sources: [...new Set(insight.tracking_context.historical_sources.map(source => source.source_name))].slice(0, 3).join(', ') + (new Set(insight.tracking_context.historical_sources.map(source => source.source_name)).size > 3 ? '…' : '') })}</Alert>}
            <Stack direction="row" flexWrap="wrap" gap={1}><Chip label={tk('workouts', { count: insight.workouts?.sessions ?? 0 })} /><Chip variant="outlined" label={tk('sets', { count: insight.workouts?.completed_sets ?? 0 })} /></Stack>
            {!!currentComparisons.length && <Stack direction="row" flexWrap="wrap" gap={1} data-testid="measurement-current-comparisons">{currentComparisons.slice(0, 6).map((comparison, index) => <Box key={`${comparison.key}-${index}`} sx={{ bgcolor: 'background.paper', p: 1.5, borderRadius: 3, minWidth: 125 }}><Typography variant="caption" color="text.secondary">{t(`${PREFIX}metrics.${comparison.key}`, { defaultValue: comparison.label })}</Typography><Typography fontWeight={800}>{comparison.delta > 0 ? '+' : ''}{comparison.delta} {comparison.unit}</Typography><Typography variant="caption">{comparison.start_value} → {comparison.end_value} {comparison.unit}</Typography></Box>)}</Stack>}
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={3}>{[['wins', insight.wins], ['focus', insight.focus]].map(([key, items]) => Array.isArray(items) && items.length > 0 && <Box key={String(key)} sx={{ flex: 1 }}><Typography fontWeight={700} gutterBottom>{tk(String(key))}</Typography>{items.map((item, index) => <Typography key={index} variant="body2" color="text.secondary" sx={{ mb: .75 }}>• {item}</Typography>)}</Box>)}</Stack>
          </> : !pending && <Typography color="text.secondary">{tk('noInsight')}</Typography>}
          <Typography variant="caption" color="text.secondary">{tk('comparability')}</Typography>
        </Stack>
      </CardContent></Card>}
      {(section === 'trends' || section === 'all') && <Card variant="outlined" data-testid="measurement-trends"><CardContent><Stack spacing={2}>
        <Typography variant="h6" fontWeight={800}>{tk('trend')}</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
          <FormControl size="small" fullWidth><InputLabel id="measurement-trend-metric">{tk('metric')}</InputLabel><Select labelId="measurement-trend-metric" value={effectiveMetric ? metricSeriesKey(effectiveMetric) : ''} label={tk('metric')} onChange={event => { setTrendKey(event.target.value); if (selectionMode) setTrendSource(''); }}><MenuItem value="" disabled>{tk('chooseMetric')}</MenuItem>{metricOptions.map(metric => <MenuItem key={metricSeriesKey(metric)} value={metricSeriesKey(metric)}>{label(metric)}{metric.unit ? ` (${metric.unit})` : ''}</MenuItem>)}</Select></FormControl>
          <FormControl size="small" fullWidth disabled={selectionMode && !effectiveMetric}><InputLabel id="measurement-trend-source">{tk('sourceFilter')}</InputLabel><Select labelId="measurement-trend-source" value={source ?? ''} label={tk('sourceFilter')} onChange={event => setTrendSource(event.target.value)}><MenuItem value="" disabled>{tk('chooseSource')}</MenuItem>{sourceOptions.map(([key, entry]) => <MenuItem key={key} value={key}>{entry.source_name} · {methodLabel(entry.method)}</MenuItem>)}</Select></FormControl>
          {selectionMode && <FormControl size="small" sx={{ minWidth: 160 }}><InputLabel id={"measurement-period-" + section}>{tk('range')}</InputLabel><Select labelId={"measurement-period-" + section} value={days} label={tk('range')} onChange={event => setDays(Number(event.target.value))}>{[30, 90, 180, 365, 730].map(value => <MenuItem key={value} value={value}>{tk('days', { count: value })}</MenuItem>)}</Select></FormControl>}
        </Stack>
        {points.length >= 2 ? <Box sx={{ height: 210, width: '100%', minWidth: 0 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}><XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={28} /><YAxis domain={['auto', 'auto']} width={45} tick={{ fontSize: 11 }} /><Tooltip /><Line dataKey="value" name={effectiveMetric ? label(effectiveMetric) : ''} stroke="#6d28d9" strokeWidth={3} dot={{ r: 3 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></Box> : <Typography color="text.secondary">{tk(selectionMode && (!effectiveMetric || !source) ? 'chooseTrend' : 'noTrend')}</Typography>}
        {points.some(point => point.count > 1) && <Typography variant="caption" color="text.secondary">{tk('dailyMedian')}</Typography>}
      </Stack></CardContent></Card>}
      {(section === 'history' || section === 'all') && <Stack spacing={1.5} data-testid="measurement-history"><Typography variant="h6" fontWeight={800}>{tk('history')}</Typography>
        {selectionMode && workspace?.legacy_record_order && <Typography variant="caption" color="text.secondary">{tk('legacyOrder')}</Typography>}
        {entries.length === 0 && selectionMode && workspace?.has_more ? <Alert severity="info">{tk('historyScanning')}</Alert> : entries.length === 0 ? <Card variant="outlined"><CardContent sx={{ textAlign: 'center', py: 5 }}><Typography variant="h6" fontWeight={800}>{tk('empty')}</Typography><Typography color="text.secondary" sx={{ mt: 1, mb: 2 }}>{tk('emptyHint')}</Typography><Button variant="contained" onClick={begin} startIcon={<AddRoundedIcon />}>{tk('add')}</Button></CardContent></Card> : (selectionMode ? entries : entries.slice(0, visibleCount)).map((entry, index) => <Card data-testid={`measurement-entry-${entry.id ?? index}`} key={entry.id ?? index} variant="outlined"><CardContent sx={{ '&:last-child': { pb: 2 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}><Box><Typography fontWeight={800}>{entry.measured_at ?? tk('unknownDate')}</Typography><Typography variant="body2" color="text.secondary">{entry.source_name} · {methodLabel(entry.method)}</Typography></Box><Button size="small" onClick={() => { setSelected(entry); setOriginalPreview(null); }}>{tk('view')}</Button></Stack>
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1.5 }}>{entry.metrics.slice(0, 5).map((metric, i) => <Chip key={`${metric.key}-${i}`} size="small" variant="outlined" label={`${label(metric)}: ${metric.value} ${metric.unit}`} />)}</Stack>
          {entry.summary && <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{entry.summary}</Typography>}
        </CardContent></Card>)}
        {(selectionMode ? workspace?.has_more && workspace.next_cursor : entries.length > visibleCount) && <Button variant="outlined" disabled={loadingMore} onClick={() => selectionMode ? void load(false, workspace?.next_cursor ?? undefined) : setVisibleCount(count => count + 10)} startIcon={loadingMore ? <CircularProgress size={16} /> : undefined}>{tk('loadMore')}</Button>}
        {workspace?.has_more && (!selectionMode || !workspace.next_cursor) && <Alert severity="info">{tk('more')}</Alert>}
      </Stack>}
      {!selectionMode && factualSummary}
      {(section === 'summary' || section === 'all') && workspace?.memory?.status === 'ready' && workspace.memory.summary && <Card data-testid="measurement-memory" variant="outlined"><CardContent><Typography fontWeight={800}>{tk('memory')}</Typography><Typography variant="caption" color="text.secondary">{tk('memoryHint')}</Typography><Box sx={{ mt: 1.5 }}><MarkdownMessage content={workspace.memory.summary} /></Box></CardContent></Card>}
    </>}

    <Dialog open={open} onClose={close} fullScreen={mode !== 'manual' && smallScreen} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ fontWeight: 800 }}>{mode === 'upload' ? tk('upload') : drafts.length && mode === 'paste' ? tk('reviewTitle') : tk(mode === 'manual' ? 'manualTitle' : 'paste')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {!editingId && <Tabs value={mode} onChange={(_, value) => switchMode(value)} variant="scrollable" scrollButtons="auto"><Tab value="manual" label={tk('manual')} disabled={busy} /><Tab value="upload" label={tk('upload')} disabled={busy} /><Tab value="paste" label={tk('paste')} disabled={busy} /></Tabs>}
          {formError && <Alert severity="error">{errorLabel(formError)}</Alert>}
          {importPhase && <MeasurementImportStatus key={importPhase} phase={importPhase} progress={uploadProgress} />}
          {mode === 'upload' && <><Button component="label" variant="outlined" startIcon={<UploadFileRoundedIcon />} disabled={busy}>{file?.name ?? tk('chooseFile')}<input hidden type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => { resetStaged(); chooseFile(event.target.files?.[0] ?? null); setImportId(undefined); setUploadEditing(false); setWarnings([]); setDrafts([]); requestId.current = measurementRequestId(); }} /></Button><Typography variant="caption" color="text.secondary">{tk('fileHint')}</Typography>
            {imagePreview && <Box component="figure" sx={{ m: 0, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: '#faf9fe' }}>
              <Box component="img" src={imagePreview} alt={tk('selectedImage')} sx={{ display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain' }} />
              <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" gap={1} sx={{ mt: 1 }}><Typography component="figcaption" variant="caption" color="text.secondary">{tk('imageHint')}</Typography><Button component="a" href={imagePreview} target="_blank" rel="noopener noreferrer" size="small" sx={{ flexShrink: 0 }}>{tk('openImage')}</Button></Stack>
            </Box>}
          </>}
          {mode === 'paste' && <TextField label={tk('textLabel')} disabled={busy} value={text} onChange={event => { setText(event.target.value); setDrafts([]); requestId.current = measurementRequestId(); }} multiline minRows={5} placeholder={tk('textExample')} helperText={tk('textHint')} slotProps={{ htmlInput: { maxLength: 60000 } }} />}
          {mode === 'paste' && <Button variant="contained" onClick={extract} disabled={busy || !text.trim()} startIcon={importPhase ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeRoundedIcon />}>{tk(importPhase === 'uploading' ? 'uploadingReport' : importPhase ? 'analyzing' : formError && formError !== 'fileInvalid' ? 'retry' : 'analyze')}</Button>}
          {mode === 'upload' && <Typography variant="body2" color="text.secondary">{tk('saveReportHint')}</Typography>}
          {warnings.length > 0 && (mode === 'upload' ? <Accordion disableGutters><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="body2">{tk('reportNotes', { count: warnings.length })}</Typography></AccordionSummary><AccordionDetails><Stack spacing={1}>{warnings.map((warning, index) => <Typography variant="body2" key={index}>{warning}</Typography>)}</Stack></AccordionDetails></Accordion> : warnings.map((warning, index) => <Alert severity="info" key={index}>{warning}</Alert>))}
          {mode === 'upload' && drafts.length > 0 && !uploadEditing && <Stack spacing={1} data-testid="import-save-retry">
            {drafts.map((entry, index) => <Typography key={index} variant="body2">{entry.measured_at ?? tk('unknownDate')} · {entry.source_name} · {tk('reportReadings', { count: entry.metrics.length })}</Typography>)}
          </Stack>}
          {drafts.length > 0 && (mode !== 'upload' || uploadEditing) && <Typography variant="body2" color="text.secondary">{tk('reviewHint')}</Typography>}
          {referenceRequest && <Box data-testid="measurement-reference-status" aria-live="polite">
            <Typography variant="caption" color="text.secondary">{tk('previousReadingHint')}</Typography>
            {!activeReferences && <Typography variant="caption" component="p" color="text.secondary">{tk('previousReadingLoading')}</Typography>}
            {activeReferences?.failed && <Stack direction="row" alignItems="center" gap={1}><Typography variant="caption" color="text.secondary">{tk('previousReadingError')}</Typography><Button size="small" onClick={() => setReferenceAttempt(attempt => attempt + 1)}>{tk('retry')}</Button></Stack>}
            {activeReferences?.incomplete && <Typography variant="caption" component="p" color="text.secondary">{tk('previousReadingIncomplete')}</Typography>}
          </Box>}
          {(mode !== 'upload' || uploadEditing) && drafts.map((entry, entryIndex) => <Stack data-testid={`measurement-draft-${entryIndex}`} spacing={2} key={entryIndex} sx={{ pt: 1 }}>
            {drafts.length > 1 && <Stack direction="row" justifyContent="space-between"><Typography fontWeight={700}>{tk('reading', { count: entryIndex + 1 })}</Typography><IconButton aria-label={tk('removeEntry')} onClick={() => setDrafts(previous => previous.filter((_, i) => i !== entryIndex))}><DeleteOutlineRoundedIcon /></IconButton></Stack>}
            <TextField type="date" label={tk('date')} value={entry.measured_at ?? ''} onChange={event => changeEntry(entryIndex, { measured_at: event.target.value })} helperText={entry.measured_at ? undefined : tk('dateUnknownHint')} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: localDateKey() } }} />
            <TextField label={tk('source')} value={entry.source_name} onChange={event => changeEntry(entryIndex, { source_name: event.target.value })} helperText={tk('sourceHint')} required />
            <FormControl><InputLabel id={`measurement-method-${entryIndex}`}>{tk('method')}</InputLabel><Select labelId={`measurement-method-${entryIndex}`} value={['manual', 'bia', 'anthropometric', 'unknown'].includes(entry.method) ? entry.method : 'unknown'} label={tk('method')} onChange={event => changeEntry(entryIndex, { method: event.target.value })}>{[['manual', 'methodManual'], ['bia', 'methodBia'], ['anthropometric', 'methodAnthro'], ['unknown', 'methodUnknown']].map(([value, key]) => <MenuItem key={value} value={value}>{tk(key)}</MenuItem>)}</Select></FormControl>
            {entry.metrics.map((metric, metricIndex) => <Box key={metricIndex} role="group" aria-label={label(metric) || tk('metrics.custom')} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><Stack spacing={1.5}>
              <Stack direction="row" gap={1} alignItems="center"><FormControl fullWidth size="small"><InputLabel id={`measurement-type-${entryIndex}-${metricIndex}`}>{tk('label')}</InputLabel><Select labelId={`measurement-type-${entryIndex}-${metricIndex}`} label={tk('label')} value={DEFAULT_METRICS.some(([key]) => key === metric.key) ? metric.key : 'custom'} onChange={event => { const found = DEFAULT_METRICS.find(([key]) => key === event.target.value)!; changeMetric(entryIndex, metricIndex, { key: found[0] === 'custom' ? `custom_${metricIndex + 1}` : found[0], label: found[0] === 'custom' ? '' : t(`${PREFIX}metrics.${found[0]}`), unit: found[1] }); }}>{DEFAULT_METRICS.map(([key, unit]) => <MenuItem key={key} value={key}>{t(`${PREFIX}metrics.${key}`)}{unit ? ` (${unit})` : ''}</MenuItem>)}</Select></FormControl><IconButton aria-label={tk('removeMetric')} onClick={() => changeEntry(entryIndex, { metrics: entry.metrics.filter((_, i) => i !== metricIndex) })}><DeleteOutlineRoundedIcon /></IconButton></Stack>
              {!DEFAULT_METRICS.some(([key]) => key === metric.key) && <TextField size="small" label={tk('label')} value={metric.label} onChange={event => changeMetric(entryIndex, metricIndex, { label: event.target.value })} />}
              <Stack direction="row" gap={1}><TextField size="small" fullWidth label={tk('value')} value={metric.value} onChange={event => changeMetric(entryIndex, metricIndex, { value: event.target.value })} slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-describedby': previousReading(metric) ? `measurement-previous-${entryIndex}-${metricIndex}` : undefined } }} /><TextField size="small" sx={{ width: 90, flexShrink: 0 }} label={tk('unit')} value={metric.unit} onChange={event => changeMetric(entryIndex, metricIndex, { unit: event.target.value })} /></Stack>
              {previousReading(metric) && <Typography id={`measurement-previous-${entryIndex}-${metricIndex}`} data-testid={`measurement-previous-${metric.key}`} variant="caption" color="text.secondary">{previousReading(metric)}</Typography>}
              {metric.raw_value != null && String(metric.raw_value) !== '' && <Typography variant="caption" color="text.secondary">{tk('rawReading', { value: metric.raw_value, unit: metric.raw_unit ?? metric.unit })}</Typography>}
              {metric.confidence === 'low' && <Chip size="small" color="warning" variant="outlined" label={tk('lowConfidence')} sx={{ alignSelf: 'flex-start', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }} />}
              {metric.evidence && <Typography variant="caption" color="text.secondary">{metric.evidence}</Typography>}
            </Stack></Box>)}
            <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => changeEntry(entryIndex, { metrics: [...entry.metrics, { key: `custom_${entry.metrics.length + 1}`, label: '', value: '', unit: '' }] })}>{tk('addMetric')}</Button>
            <TextField label={tk('notes')} value={entry.notes ?? ''} onChange={event => changeEntry(entryIndex, { notes: event.target.value })} multiline minRows={2} />
            {entryIndex < drafts.length - 1 && <Divider />}
          </Stack>)}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}><Button onClick={close} disabled={busy}>{tk('cancel')}</Button><Button data-testid="measurement-submit" variant="contained" onClick={mode === 'upload' && !drafts.length ? extract : save} disabled={busy || (mode === 'upload' ? !file : !drafts.length)} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>{tk(mode === 'upload' ? importPhase === 'saving' ? 'savingReport' : formError === 'importSaveFailed' ? 'retrySaveReport' : formError && formError !== 'fileInvalid' && !drafts.length ? 'retry' : 'saveReport' : 'save')}</Button></DialogActions>
    </Dialog>

    <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="sm" fullWidth><DialogTitle>{tk('details')}</DialogTitle><DialogContent><Stack spacing={2}>
      <Typography fontWeight={700}>{selected?.measured_at ?? tk('unknownDate')} · {selected?.source_name}</Typography>
      {selectedHighlights.map((metric, index) => <Stack key={index} direction="row" justifyContent="space-between" gap={2}><Typography>{label(metric)}</Typography><Typography fontWeight={700}>{metric.value} {metric.unit}</Typography></Stack>)}
      {!!selectedAdditional.length && <Accordion disableGutters><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography>{tk('additionalReadings', { count: selectedAdditional.length })}</Typography></AccordionSummary><AccordionDetails><Stack spacing={1.5}>{selectedAdditional.map((metric, index) => <Stack key={index} direction="row" justifyContent="space-between" gap={2}><Typography>{label(metric)}</Typography><Typography fontWeight={700}>{metric.value} {metric.unit}</Typography></Stack>)}</Stack></AccordionDetails></Accordion>}
      {selected?.summary && <Typography color="text.secondary">{selected.summary}</Typography>}
      {selected?.notes && <Typography variant="body2">{selected.notes}</Typography>}
      {selected && canViewOriginal(selected) && <Button disabled={originalLoading} startIcon={originalLoading ? <CircularProgress size={16} /> : <OpenInNewRoundedIcon />} onClick={() => original(selected)}>{tk('original')}</Button>}
      {originalPreview && originalPreview.entryId === selected?.id && <Box>
        {originalPreview.kind === 'pdf' ? <Box component="iframe" title={tk('original')} src={originalPreview.url} sx={{ width: '100%', height: 460, border: 0 }} />
          : originalPreview.kind === 'image' && <Box component="img" alt={tk('original')} src={originalPreview.url} sx={{ width: '100%', maxHeight: 600, objectFit: 'contain' }} />}
        <Button component="a" href={originalPreview.url} target="_blank" rel="noopener noreferrer">{tk('openOriginal')}</Button>
      </Box>}
    </Stack></DialogContent><DialogActions sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}><Button color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => { requestId.current = measurementRequestId(); setDeleting(selected); }}>{tk('delete')}</Button><Button startIcon={<EditOutlinedIcon />} onClick={() => selected && edit(selected)}>{tk('edit')}</Button><Button onClick={() => setSelected(null)}>{tk('close')}</Button></DialogActions></Dialog>
    <Dialog open={!!deleting} onClose={() => !busy && setDeleting(null)}><DialogTitle>{tk('deleteTitle')}</DialogTitle><DialogContent>{tk('deleteHint')}</DialogContent><DialogActions><Button onClick={() => setDeleting(null)} disabled={busy}>{tk('cancel')}</Button><Button color="error" variant="contained" onClick={remove} disabled={busy}>{tk('delete')}</Button></DialogActions></Dialog>
  </Stack>;
}
