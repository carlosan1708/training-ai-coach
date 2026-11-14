import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Button, Card, CardActions, CardContent, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { getDailyLogHistory, type BodyCompositionReportDoc } from '../../firebase/firestore';
import type { BodyCompositionReport, DailyLog } from '../../types/log';

const PAGE_SIZE = 100;
const TAPE_LABELS = {
  waist_cm: 'measurements.waist', chest_cm: 'measurements.chest', hips_cm: 'measurements.hips',
  arms_cm: 'measurements.arms', thighs_cm: 'measurements.thighs',
} as const;

interface Entry {
  id: string;
  date: string;
  log?: DailyLog;
  report?: BodyCompositionReport;
  original?: BodyCompositionReportDoc;
  url?: string;
}

interface Props {
  uid?: string;
  reports: BodyCompositionReportDoc[];
  reportsLoading: boolean;
  reportsError: boolean;
  refreshKey: number;
  renderReport: (report: BodyCompositionReport) => ReactNode;
  onAdd: () => void;
  onRetryReports: () => void;
  onDelete: (report: BodyCompositionReportDoc) => void;
  deletingId: string | null;
}

function hasManualValues(log: DailyLog) {
  return log.weight_kg != null || log.body_fat_pct != null ||
    Object.values(log.measurements ?? {}).some((value) => value != null);
}

function safeReportUrl(url?: string) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : undefined;
  } catch { return undefined; }
}

export default function MeasurementHistory({ uid, reports, reportsLoading, reportsError, refreshKey,
  renderReport, onAdd, onRetryReports, onDelete, deletingId }: Props) {
  const { t, i18n } = useTranslation();
  const [history, setHistory] = useState<{ uid?: string; logs: DailyLog[]; hasMore: boolean }>({ logs: [], hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'initial' | 'more' | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [preview, setPreview] = useState(false);
  const [filter, setFilter] = useState<'all' | 'reports' | 'manual'>('all');

  useEffect(() => {
    let cancelled = false;
    if (!uid) return;
    setLoading(true);
    setError(null);
    getDailyLogHistory(uid, PAGE_SIZE).then((logs) => {
      if (!cancelled) setHistory({ uid, logs, hasMore: logs.length === PAGE_SIZE });
    }).catch(() => {
      if (!cancelled) setError('initial');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [uid, refreshKey, retry]);

  const loadMore = async () => {
    if (!uid || loading || history.uid !== uid) return;
    const before = history.logs.at(-1)?.date;
    if (!before) return;
    setLoading(true);
    setError(null);
    try {
      const logs = await getDailyLogHistory(uid, PAGE_SIZE, before);
      setHistory((previous) => previous.uid === uid ? {
        uid, logs: [...previous.logs, ...logs].filter((log, index, all) => all.findIndex((item) => item.date === log.date) === index),
        hasMore: logs.length === PAGE_SIZE,
      } : previous);
    } catch { setError('more'); }
    finally { setLoading(false); }
  };

  const entries = useMemo(() => {
    const logs = history.uid === uid ? history.logs : [];
    const originals = new Map(reports.map((report) => [report.download_url, report]));
    const seenUrls = new Set<string>();
    const result: Entry[] = logs.filter((log) => hasManualValues(log) || log.body_composition_report).map((log) => {
      const report = log.body_composition_report;
      const url = report?.report_url;
      if (url) seenUrls.add(url);
      return { id: `log-${log.date}`, date: log.date, log, report, url,
        original: url ? originals.get(url) : undefined };
    });
    for (const original of reports) {
      if (seenUrls.has(original.download_url)) continue;
      const report = original.extracted_data as BodyCompositionReport;
      result.push({ id: `report-${original.id}`, date: original.report_date ?? report.report_date ?? '',
        original, report, url: original.download_url });
    }
    return result.sort((a, b) => b.date.localeCompare(a.date));
  }, [history, uid, reports]);

  const dateLabel = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })
    : value || t('measurements.unknownDate');
  const reportUrl = safeReportUrl(selected?.url);
  const reportIsPdf = selected?.original?.file_type === 'pdf' || !!reportUrl?.split('?')[0].toLowerCase().endsWith('.pdf');
  const visibleEntries = entries.filter((entry) => filter === 'all' ||
    (filter === 'reports' ? !!entry.report : !!entry.log && hasManualValues(entry.log)));

  return (
    <Stack spacing={2} data-testid="measurement-history" sx={{ '& .MuiButton-root': { minHeight: 44 } }}>
      <Box>
        <Typography variant="h6" fontWeight={700}>{t('measurementHistory.title')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('measurementHistory.hint')}</Typography>
      </Box>
      <Button variant="contained" onClick={onAdd}>{t('measurementHistory.newEntry')}</Button>
      <ToggleButtonGroup value={filter} exclusive onChange={(_, value) => { if (value) setFilter(value); }}
        aria-label={t('measurementHistory.filterLabel')} fullWidth size="small"
        sx={{ '& .MuiToggleButton-root': { minHeight: 44, px: 1, minWidth: 0 } }}>
        <ToggleButton value="all">{t('measurementHistory.filterAll')}</ToggleButton>
        <ToggleButton value="reports">{t('measurementHistory.filterReports')}</ToggleButton>
        <ToggleButton value="manual">{t('measurementHistory.filterMeasurements')}</ToggleButton>
      </ToggleButtonGroup>

      {reportsError && <Alert severity="warning" action={<Button onClick={onRetryReports}>{t('measurementHistory.retry')}</Button>}>
        {t('measurementHistory.reportsError')}
      </Alert>}
      {error && <Alert severity="warning" action={<Button onClick={() => error === 'more' ? void loadMore() : setRetry((value) => value + 1)}>{t('measurementHistory.retry')}</Button>}>
        {t('measurementHistory.loadError')}
      </Alert>}
      {!loading && !reportsLoading && !error && visibleEntries.length === 0 && (
        <Alert severity="info">{t('measurementHistory.empty')}</Alert>
      )}

      {visibleEntries.map((entry) => {
        const manual = entry.log && hasManualValues(entry.log);
        const summaryWeight = entry.log?.weight_kg ?? entry.report?.weight_kg;
        const summaryFat = entry.log?.body_fat_pct ?? entry.report?.body_fat_pct;
        return (
          <Card key={entry.id} variant="outlined" data-testid={`measurement-record-${entry.id}`}>
            <CardContent sx={{ pb: 1 }}>
              <Typography variant="subtitle1" fontWeight={700}>{dateLabel(entry.date)}</Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5, mb: 1 }}>
                {manual && <Chip label={t('measurementHistory.manual')} size="small" variant="outlined" />}
                {entry.report && <Chip label={entry.report.source_app || entry.original?.source_app || t('measurementHistory.report')} size="small" color="primary" variant="outlined" />}
              </Stack>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {summaryWeight != null && <Typography variant="body2">{t('measurements.weight')}: <strong>{summaryWeight} kg</strong></Typography>}
                {summaryFat != null && <Typography variant="body2">{t('measurements.bodyFatPct')}: <strong>{summaryFat}%</strong></Typography>}
                {entry.log?.measurements?.waist_cm != null && <Typography variant="body2">{t('measurements.waist')}: <strong>{entry.log.measurements.waist_cm} cm</strong></Typography>}
                {entry.report?.skeletal_muscle_kg != null && <Typography variant="body2">{t('measurements.muscleKg')}: <strong>{entry.report.skeletal_muscle_kg} kg</strong></Typography>}
                {entry.report?.muscle_mass_kg != null && <Typography variant="body2">{t('measurements.muscleKgComp')}: <strong>{entry.report.muscle_mass_kg} kg</strong></Typography>}
              </Stack>
            </CardContent>
            <CardActions sx={{ px: 2, flexWrap: 'wrap', gap: 0.5 }}>
              <Button size="small" startIcon={<VisibilityIcon />} onClick={() => { setSelected(entry); setPreview(false); }}>
                {t('measurementHistory.viewDetails')}
              </Button>
              {safeReportUrl(entry.url) && <Button size="small" component="a" href={safeReportUrl(entry.url)} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNewIcon />}>
                {t('measurementHistory.original')}
              </Button>}
            </CardActions>
          </Card>
        );
      })}

      {(loading || reportsLoading) && <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>}
      {history.uid === uid && history.hasMore && <Button variant="outlined" onClick={loadMore} disabled={loading}>
        {t('measurementHistory.loadOlder')}
      </Button>}

      <Dialog open={!!selected} onClose={() => setSelected(null)} fullWidth maxWidth="sm" scroll="paper"
        sx={{ '& .MuiButton-root': { minHeight: 44 } }}>
        <DialogTitle>{t('measurementHistory.detailTitle')} — {selected && dateLabel(selected.date)}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">{t('measurementHistory.readOnly')}</Typography>
            {selected?.log && hasManualValues(selected.log) && <>
              <Typography variant="subtitle1" fontWeight={600}>{t('measurementHistory.manual')}</Typography>
              <Grid container spacing={1}>
                {selected.log.weight_kg != null && <Grid size={{ xs: 6 }}><Typography variant="body2">{t('measurements.weight')}: <strong>{selected.log.weight_kg} kg</strong></Typography></Grid>}
                {selected.log.body_fat_pct != null && <Grid size={{ xs: 6 }}><Typography variant="body2">{t('measurements.bodyFatManual')}: <strong>{selected.log.body_fat_pct}%</strong></Typography></Grid>}
                {Object.entries(TAPE_LABELS).map(([key, label]) => {
                  const value = selected.log?.measurements?.[key as keyof typeof TAPE_LABELS];
                  return value != null ? <Grid key={key} size={{ xs: 6 }}><Typography variant="body2">{t(label)}: <strong>{value} cm</strong></Typography></Grid> : null;
                })}
              </Grid>
            </>}
            {selected?.report && <>
              <Divider />
              <Typography variant="subtitle1" fontWeight={600}>{t('measurementHistory.report')}</Typography>
              {selected.report.report_date && <Typography variant="body2">{t('measurementHistory.reportDate')}: {dateLabel(selected.report.report_date)}</Typography>}
              {renderReport(selected.report)}
              {selected.original?.ai_summary && <Alert severity="info">{selected.original.ai_summary}</Alert>}
            </>}
            {reportUrl && <>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                <Button variant="outlined" startIcon={<OpenInNewIcon />} component="a" href={reportUrl} target="_blank" rel="noopener noreferrer">{t('measurementHistory.original')}</Button>
                <Button onClick={() => setPreview((value) => !value)}>{preview ? t('measurementHistory.hidePreview') : t('measurementHistory.preview')}</Button>
              </Stack>
              {preview && (reportIsPdf ? <Box component="iframe" title={t('measurementHistory.original')} src={reportUrl} sx={{ width: '100%', height: 460, border: 0 }} />
                : <Box component="img" src={reportUrl} alt={t('measurementHistory.original')} sx={{ maxWidth: '100%', maxHeight: 540, objectFit: 'contain' }} />)}
              {preview && <Typography variant="caption" color="text.secondary">{t('measurementHistory.previewHint')}</Typography>}
            </>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {selected?.original ? <Button color="error" disabled={deletingId === selected.original.id} onClick={() => {
            onDelete(selected.original!); setSelected(null);
          }}>{t('common.delete')}</Button> : <span />}
          <Button onClick={() => setSelected(null)}>{t('measurementHistory.close')}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
