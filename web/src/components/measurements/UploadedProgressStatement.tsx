import { useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getMeasurementWorkspace } from '../../firebase/measurements';
import type { MeasurementJob, ProgressInsight } from '../../types/measurement';
import { conciseStatement, uploadedProgressEvidence, type UploadedProgress } from '../../lib/measurementProgressStatement';

export default function UploadedProgressStatement({ upload, uid, jobs, revision, insight, pollingPaused, onRefreshStatus, onRetry, onDetails }: {
  upload: UploadedProgress; uid: string; jobs: MeasurementJob[]; revision: number;
  insight: ProgressInsight | null; pollingPaused: boolean;
  onRefreshStatus: () => void; onRetry: () => Promise<void>; onDetails: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tk = (key: string, options?: Record<string, unknown>) => t(`measurementWorkspace.progressStatement.${key}`, options);
  const job = jobs.find(item => item.id === upload.jobId);
  const current = revision === upload.revision;
  const ready = current && job?.status === 'ready';
  const provided = current && insight?.revision === upload.revision && insight.status === 'ready' ? insight : null;
  const [loaded, setLoaded] = useState<{ revision: number; insight: ProgressInsight | null } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!ready || provided) return;
    let active = true;
    // One read when the existing background job completes; never launch a
    // second model request or load summary data during ordinary navigation.
    void getMeasurementWorkspace({ section: 'summary' }).then(data => {
      if (active) { setLoaded({ revision: data.revision, insight: data.insights ?? null }); setLoadFailed(false); }
    }).catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [uid, upload.jobId, upload.revision, ready, provided, attempt]);
  const result = provided ?? (current && loaded?.revision === upload.revision && loaded.insight?.revision === upload.revision
    && loaded.insight.status === 'ready' ? loaded.insight : null);
  const { entry, dated, comparisons, readings } = uploadedProgressEvidence(upload, result);
  const pending = current && !result && !loadFailed && (!job || job.status === 'pending' || job.status === 'processing' || (ready && !loaded));
  const failed = current && job?.status === 'failed';
  const qaPaused = failed && job.error_reason === 'QA_AI_PAUSED';
  const stale = !current || job?.status === 'stale' || (ready && !!loaded && !result);
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value);
  const metricLabel = (key: string, label: string) => t(`measurementWorkspace.metrics.${key}`, { defaultValue: label });
  const summary = pending ? tk('preparing') : qaPaused ? t('redesign.qa.aiPaused') : failed ? tk('failed') : loadFailed && !result ? tk('loadFailed') : stale ? tk('stale')
    : !dated ? tk('undated') : !comparisons.length ? tk('baseline') : conciseStatement(result?.summary, 45);
  const action = result && comparisons.length && result.focus?.[0] ? conciseStatement(result.focus?.[0], 30)
    : tk(!dated ? 'addDate' : 'nextReading');
  return <Card data-testid="uploaded-progress-statement" variant="outlined" sx={{ borderColor: 'primary.light', bgcolor: '#f8f5ff' }}>
    <CardContent><Stack spacing={1.5}>
      <Typography component="h2" variant="h6" fontWeight={800}>{tk('title')}</Typography>
      <Stack direction="row" gap={1} alignItems="center" role="status">
        {pending && <CircularProgress size={16} sx={{ flexShrink: 0 }} />}
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{summary}</Typography>
      </Stack>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }} data-testid="progress-statement-evidence">
        {comparisons.length ? comparisons.map(item => <Typography component="li" variant="body2" key={`${item.key}:${item.unit}`} sx={{ mb: .5 }}>
          {metricLabel(item.key, item.label)}: {number(item.start_value)} {item.unit} ({item.start_date}) → {number(item.end_value)} {item.unit} ({item.end_date})
          {' · '}{item.delta > 0 ? '+' : ''}{number(item.delta)} {item.unit === '%' ? tk('percentagePoints') : item.unit}
        </Typography>) : readings.map(item => <Typography component="li" variant="body2" key={item.key}>
          {metricLabel(item.key, item.label)}: {number(item.value)} {item.unit} · {entry.measured_at ?? t('measurementWorkspace.unknownDate')}
        </Typography>)}
      </Box>
      {entry && <Typography variant="caption" color="text.secondary">{entry.source_name} · {t(`measurementWorkspace.${({ bia: 'methodBia', manual: 'methodManual', anthropometric: 'methodAnthro' } as Record<string, string>)[entry.method] ?? 'methodUnknown'}`)}{comparisons.length ? ` · ${tk('dailyMedians')}` : ''}</Typography>}
      <Typography variant="body2"><Box component="span" fontWeight={800}>{tk('nextStep')} </Box>{action}</Typography>
      <Stack direction="row" gap={1} flexWrap="wrap">
        {loadFailed && !result && <Button size="small" onClick={() => setAttempt(value => value + 1)}>{t('measurementWorkspace.retry')}</Button>}
        {failed && !qaPaused && <Button size="small" disabled={retrying} onClick={async () => { setRetrying(true); try { await onRetry(); } finally { setRetrying(false); } }}>{t('measurementWorkspace.retry')}</Button>}
        {pending && pollingPaused && <Button size="small" onClick={onRefreshStatus}>{t('redesign.qa.refreshStatus')}</Button>}
        {(result || stale) && <Button size="small" onClick={onDetails}>{tk('details')}</Button>}
      </Stack>
    </Stack></CardContent>
  </Card>;
}
