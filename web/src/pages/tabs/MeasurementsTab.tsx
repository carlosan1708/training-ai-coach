import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  IconButton,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import MonitorWeightIcon from '@mui/icons-material/MonitorWeight';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { serverTimestamp } from 'firebase/firestore';
import { useAuthStore } from '../../store/authStore';
import {
  upsertDailyLog,
  getBodyCompositionReports,
  addBodyCompositionReport,
  deleteBodyCompositionReport,
  type BodyCompositionReportDoc,
} from '../../firebase/firestore';
import { uploadBodyCompositionReport, deleteStoredFile } from '../../firebase/storage';
import { parseBodyCompositionReportFn as parseBodyCompositionReport } from '../../firebase/callables';
import { useDailyLog } from '../../hooks/useDailyLog';
import type { Measurements, BodyCompositionReport } from '../../types/log';

interface Props { date: string }

const TAPE_FIELDS: { key: keyof Measurements; label: string }[] = [
  { key: 'waist_cm', label: 'measurements.waist' },
  { key: 'chest_cm', label: 'measurements.chest' },
  { key: 'hips_cm', label: 'measurements.hips' },
  { key: 'arms_cm', label: 'measurements.arms' },
  { key: 'thighs_cm', label: 'measurements.thighs' },
];

const BIA_FIELDS: { key: keyof BodyCompositionReport; label: string; unit: string; precision: number }[] = [
  { key: 'weight_kg',           label: 'measurements.weight',       unit: 'kg',   precision: 1 },
  { key: 'body_fat_pct',        label: 'measurements.bodyFatPct',   unit: '%',    precision: 1 },
  { key: 'body_fat_kg',         label: 'measurements.bodyFatKg',    unit: 'kg',   precision: 1 },
  { key: 'skeletal_muscle_pct', label: 'measurements.musclePct',    unit: '%',    precision: 1 },
  { key: 'skeletal_muscle_kg',  label: 'measurements.muscleKg',     unit: 'kg',   precision: 1 },
  { key: 'bone_mass_kg',        label: 'measurements.boneMass',     unit: 'kg',   precision: 2 },
  { key: 'body_water_pct',      label: 'measurements.bodyWater',    unit: '%',    precision: 1 },
  { key: 'protein_kg',          label: 'measurements.protein',      unit: 'kg',   precision: 1 },
  { key: 'bmi',                 label: 'measurements.bmi',          unit: '',     precision: 1 },
  { key: 'visceral_fat_level',  label: 'measurements.visceralFat',  unit: '',     precision: 0 },
  { key: 'body_score',          label: 'measurements.bodyScore',    unit: '/100', precision: 0 },
  { key: 'metabolic_age',       label: 'measurements.metabolicAge', unit: 'y',    precision: 0 },
];

const ISAK_MAIN_FIELDS: { key: keyof BodyCompositionReport; label: string; unit: string; precision: number }[] = [
  { key: 'weight_kg',          label: 'measurements.weight',       unit: 'kg', precision: 1 },
  { key: 'height_cm',          label: 'measurements.height',       unit: 'cm', precision: 1 },
  { key: 'bmi',                label: 'measurements.bmi',          unit: '',   precision: 1 },
  { key: 'body_fat_pct',       label: 'measurements.bodyFatPct',   unit: '%',  precision: 1 },
  { key: 'body_fat_kg',        label: 'measurements.bodyFatKg',    unit: 'kg', precision: 1 },
  { key: 'muscle_mass_pct',    label: 'measurements.muscleComp',   unit: '%',  precision: 1 },
  { key: 'muscle_mass_kg',     label: 'measurements.muscleKgComp', unit: 'kg', precision: 1 },
  { key: 'bone_mass_pct',      label: 'measurements.bonePct',      unit: '%',  precision: 1 },
  { key: 'bone_mass_kg',       label: 'measurements.boneMass',     unit: 'kg', precision: 2 },
  { key: 'residual_mass_pct',  label: 'measurements.residualPct',  unit: '%',  precision: 1 },
  { key: 'residual_mass_kg',   label: 'measurements.residualKg',   unit: 'kg', precision: 1 },
  { key: 'lean_mass_kg',       label: 'measurements.leanMass',     unit: 'kg', precision: 1 },
  { key: 'sum_6_skinfolds_mm', label: 'measurements.sum6',         unit: 'mm', precision: 1 },
  { key: 'sum_8_skinfolds_mm', label: 'measurements.sum8',         unit: 'mm', precision: 1 },
];

const isISAK = (r: BodyCompositionReport | Record<string, unknown>) =>
  !!(r as BodyCompositionReport).skinfolds ||
  !!(r as BodyCompositionReport).muscle_mass_kg ||
  String((r as BodyCompositionReport).source_app ?? '').toLowerCase().includes('isak') ||
  String((r as BodyCompositionReport).source_app ?? '').toLowerCase().includes('holway');

function StatBox({ label, value, unit, precision }: { label: string; value: number; unit: string; precision: number }) {
  const display = precision === 0 ? String(value) : value.toFixed(precision);
  return (
    <Box sx={{ p: 1, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body2" fontWeight={700}>{display}{unit}</Typography>
    </Box>
  );
}

function ReportDetail({ data }: { data: BodyCompositionReport }) {
  const { t } = useTranslation();
  const showBIA = !isISAK(data);

  return (
    <Stack spacing={1.5}>
      {showBIA ? (
        <>
          <Grid container spacing={1}>
            {BIA_FIELDS.filter(({ key }) => data[key] != null).map(({ key, label, unit, precision }) => (
              <Grid key={key} size={{ xs: 6, sm: 4 }}>
                <StatBox label={t(label)} value={data[key] as number} unit={unit} precision={precision} />
              </Grid>
            ))}
          </Grid>
          {data.segmental_fat && Object.values(data.segmental_fat).some(v => v != null) && (
            <>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('measurements.segmentalFat')}</Typography>
              <Grid container spacing={1}>
                {Object.entries(data.segmental_fat).filter(([, v]) => v != null).map(([k, v]) => (
                  <Grid key={k} size={{ xs: 6, sm: 4 }}>
                    <StatBox label={k.replace(/_kg$/, '').replace(/_/g, ' ')} value={v as number} unit=" kg" precision={1} />
                  </Grid>
                ))}
              </Grid>
            </>
          )}
          {data.weight_control && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {data.weight_control.recommended_weight_kg != null && <Chip size="small" label={`${t('measurements.targetWeight')}: ${data.weight_control.recommended_weight_kg} kg`} />}
              {data.weight_control.fat_to_lose_kg != null && <Chip size="small" color="warning" label={`${t('measurements.fatToLose')}: ${data.weight_control.fat_to_lose_kg} kg`} />}
              {data.weight_control.muscle_to_gain_kg != null && <Chip size="small" color="success" label={`${t('measurements.muscleToGain')}: ${data.weight_control.muscle_to_gain_kg} kg`} />}
            </Box>
          )}
        </>
      ) : (
        <>
          {data.fat_method && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              <Chip size="small" label={`${t('measurements.method')}: ${data.fat_method}`} variant="outlined" />
              {data.sum_6_skinfolds_mm != null && <Chip size="small" label={`Σ6: ${data.sum_6_skinfolds_mm} mm`} />}
              {data.sum_8_skinfolds_mm != null && <Chip size="small" label={`Σ8: ${data.sum_8_skinfolds_mm} mm`} />}
            </Box>
          )}
          <Grid container spacing={1}>
            {ISAK_MAIN_FIELDS.filter(({ key }) => data[key] != null).map(({ key, label, unit, precision }) => (
              <Grid key={key} size={{ xs: 6, sm: 4 }}>
                <StatBox label={t(label)} value={data[key] as number} unit={unit} precision={precision} />
              </Grid>
            ))}
          </Grid>
          {data.skinfolds && Object.values(data.skinfolds).some(v => v != null) && (
            <>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('measurements.skinfolds')}</Typography>
              <Grid container spacing={1}>
                {Object.entries(data.skinfolds).filter(([, v]) => v != null).map(([k, v]) => (
                  <Grid key={k} size={{ xs: 6, sm: 4 }}>
                    <StatBox label={t(`measurements.sf_${k.replace('_mm', '')}`)} value={v as number} unit=" mm" precision={1} />
                  </Grid>
                ))}
              </Grid>
            </>
          )}
          {data.girths && Object.values(data.girths).some(v => v != null) && (
            <>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('measurements.girths')}</Typography>
              <Grid container spacing={1}>
                {Object.entries(data.girths).filter(([, v]) => v != null).map(([k, v]) => (
                  <Grid key={k} size={{ xs: 6, sm: 4 }}>
                    <StatBox label={t(`measurements.girth_${k.replace('_cm', '')}`)} value={v as number} unit=" cm" precision={1} />
                  </Grid>
                ))}
              </Grid>
            </>
          )}
          {data.somatotype && (
            <>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('measurements.somatotype')}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {data.somatotype.dominant && <Chip size="small" color="primary" label={data.somatotype.dominant} />}
                {data.somatotype.endomorph != null && <Chip size="small" label={`Endo: ${data.somatotype.endomorph}`} variant="outlined" />}
                {data.somatotype.mesomorph != null && <Chip size="small" label={`Meso: ${data.somatotype.mesomorph}`} variant="outlined" />}
                {data.somatotype.ectomorph != null && <Chip size="small" label={`Ecto: ${data.somatotype.ectomorph}`} variant="outlined" />}
              </Box>
            </>
          )}
        </>
      )}
    </Stack>
  );
}

export default function MeasurementsTab({ date }: Props) {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const { log, loading: logLoading } = useDailyLog(date);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tape measurements state
  const [values, setValues] = useState<Record<string, string>>({});
  const [bodyFat, setBodyFat] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Upload / extraction state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<{ dataUrl: string; isPdf: boolean } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [pendingReport, setPendingReport] = useState<{ report: BodyCompositionReport; summary: string | null } | null>(null);

  // Past reports list state
  const [reports, setReports] = useState<BodyCompositionReportDoc[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (log?.measurements) {
      const m = log.measurements;
      setValues({
        waist_cm: m.waist_cm != null ? String(m.waist_cm) : '',
        chest_cm: m.chest_cm != null ? String(m.chest_cm) : '',
        hips_cm: m.hips_cm != null ? String(m.hips_cm) : '',
        arms_cm: m.arms_cm != null ? String(m.arms_cm) : '',
        thighs_cm: m.thighs_cm != null ? String(m.thighs_cm) : '',
      });
    }
    if (log?.body_fat_pct != null) setBodyFat(String(log.body_fat_pct));
  }, [log]);

  const loadReports = async () => {
    if (!currentUser) return;
    setReportsLoading(true);
    try {
      const docs = await getBodyCompositionReports(currentUser.uid);
      // Sort by report_date desc, fall back to created_at order (already desc from query)
      docs.sort((a, b) => {
        const da = a.report_date ?? '';
        const db_ = b.report_date ?? '';
        if (da && db_) return db_.localeCompare(da);
        return da ? -1 : db_ ? 1 : 0;
      });
      setReports(docs);
    } finally {
      setReportsLoading(false);
    }
  };

  useEffect(() => { loadReports(); }, [currentUser]);

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPendingReport(null);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const reader = new FileReader();
    reader.onload = () => setFilePreview({ dataUrl: reader.result as string, isPdf });
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!filePreview || !currentUser || !selectedFile) return;
    setAnalyzing(true);
    setAnalyzeError('');
    try {
      const [header, imageData] = filePreview.dataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] ?? (filePreview.isPdf ? 'application/pdf' : 'image/jpeg');

      const [extractResult, uploadResult] = await Promise.all([
        parseBodyCompositionReport({ imageData, mimeType }),
        uploadBodyCompositionReport(currentUser.uid, selectedFile),
      ]);

      if (extractResult.data.report.error) {
        setAnalyzeError(t('measurements.reportNotRecognized'));
      } else {
        const report = extractResult.data.report;
        const summary = extractResult.data.summary ?? null;

        // Save to the reports collection
        await addBodyCompositionReport(currentUser.uid, {
          source_app: report.source_app,
          report_date: report.report_date,
          ai_summary: summary ?? undefined,
          download_url: uploadResult.downloadUrl,
          storage_path: uploadResult.storagePath,
          file_type: selectedFile.type.includes('pdf') ? 'pdf' : 'image',
          extracted_data: report as unknown as Record<string, unknown>,
        });

        // Also embed in today's daily log for chat context
        await upsertDailyLog(currentUser.uid, date, {
          body_composition_report: {
            ...report,
            report_url: uploadResult.downloadUrl,
            report_storage_path: uploadResult.storagePath,
          },
          updated_at: serverTimestamp(),
          ...(!log ? { date, created_at: serverTimestamp() } : {}),
        });

        setPendingReport({ report, summary });
        setFilePreview(null);
        setSelectedFile(null);
        await loadReports();
      }
    } catch (err: unknown) {
      const code = (err as {code?: string})?.code ?? '';
      const msg = String((err as {message?: string})?.message ?? '');
      if (code === 'functions/resource-exhausted' || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        setAnalyzeError(t('measurements.quotaError'));
      } else {
        setAnalyzeError(t('measurements.analyzeError'));
      }
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Delete report ─────────────────────────────────────────────────────────

  const handleDeleteReport = async (rep: BodyCompositionReportDoc) => {
    if (!currentUser || !window.confirm(t('measurements.deleteConfirm'))) return;
    setDeletingId(rep.id);
    try {
      await deleteStoredFile(rep.storage_path);
      await deleteBodyCompositionReport(currentUser.uid, rep.id);
      await loadReports();
    } finally {
      setDeletingId(null);
    }
  };

  // ── Save tape measurements ────────────────────────────────────────────────

  const handleSave = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      const measurements: Measurements = {};
      for (const [k, v] of Object.entries(values)) {
        if (v) (measurements as Record<string, number>)[k] = parseFloat(v);
      }
      await upsertDailyLog(currentUser.uid, date, {
        measurements,
        body_fat_pct: bodyFat ? parseFloat(bodyFat) : undefined,
        updated_at: serverTimestamp(),
        ...(!log ? { date, created_at: serverTimestamp() } : {}),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  if (logLoading) return (
    <Container sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
      <CircularProgress />
    </Container>
  );

  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Typography variant="body2" color="text.secondary">
          {date} — {t('measurements.hint')}
        </Typography>

        {/* ── Upload new report ── */}
        <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <MonitorWeightIcon color="primary" />
                <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
                  {t('measurements.reportTitle')}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t('measurements.reportHint')}
              </Typography>

              {filePreview && (
                filePreview.isPdf ? (
                  <Stack direction="row" alignItems="center" spacing={1}
                    sx={{ p: 1.5, bgcolor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                    <PictureAsPdfIcon color="error" />
                    <Typography variant="body2">{t('measurements.pdfReady')}</Typography>
                  </Stack>
                ) : (
                  <Box component="img" src={filePreview.dataUrl} alt="report"
                    sx={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 2, bgcolor: 'white' }} />
                )
              )}

              {/* Show just-extracted summary before user scrolls down */}
              {pendingReport?.summary && (
                <Alert severity="success" icon={<AutoFixHighIcon />}>
                  {pendingReport.summary}
                </Alert>
              )}

              <Stack direction="row" spacing={1}>
                <Button variant="outlined" startIcon={<UploadFileIcon />}
                  onClick={() => fileInputRef.current?.click()} sx={{ flex: 1 }}>
                  {filePreview ? t('measurements.changeFile') : t('measurements.uploadReport')}
                </Button>
                {filePreview && (
                  <Button variant="contained"
                    startIcon={analyzing ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />}
                    onClick={handleAnalyze} disabled={analyzing} sx={{ flex: 1 }}>
                    {analyzing ? t('measurements.analyzing') : t('measurements.extractData')}
                  </Button>
                )}
              </Stack>
              {analyzeError && <Alert severity="warning">{analyzeError}</Alert>}
            </Stack>
          </CardContent>
        </Card>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* ── Past reports list ── */}
        {reportsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : reports.length > 0 && (
          <Stack spacing={2}>
            <Typography variant="subtitle1" fontWeight={600}>
              {t('measurements.reportsHistory')}
            </Typography>
            {reports.map((rep) => (
              <Card key={rep.id} variant="outlined">
                <CardContent sx={{ pb: rep.ai_summary ? 1 : undefined }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    {rep.file_type === 'pdf'
                      ? <PictureAsPdfIcon color="error" fontSize="small" />
                      : <MonitorWeightIcon color="primary" fontSize="small" />}

                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="body2" fontWeight={600}>
                          {rep.report_date ?? rep.source_app ?? t('measurements.unknownDate')}
                        </Typography>
                        {rep.source_app && rep.report_date && (
                          <Chip label={rep.source_app} size="small" variant="outlined" />
                        )}
                      </Stack>
                    </Box>

                    <Tooltip title={t('measurements.viewReport')}>
                      <IconButton size="small" component="a" href={rep.download_url}
                        target="_blank" rel="noopener noreferrer">
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('common.delete')}>
                      <IconButton size="small" color="error"
                        onClick={() => handleDeleteReport(rep)}
                        disabled={deletingId === rep.id}>
                        {deletingId === rep.id
                          ? <CircularProgress size={16} />
                          : <DeleteIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </CardContent>

                {/* AI Summary */}
                {rep.ai_summary && (
                  <Box sx={{ px: 2, pb: 1.5, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5, mt: 1 }}>
                      AI Summary
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                      {rep.ai_summary}
                    </Typography>
                  </Box>
                )}

                {/* Extracted data accordion */}
                {rep.extracted_data && (
                  <Accordion disableGutters elevation={0}
                    sx={{ borderTop: 1, borderColor: 'divider', '&:before': { display: 'none' } }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, px: 2 }}>
                      <Typography variant="caption" fontWeight={600} color="primary.main">
                        {t('measurements.viewData')}
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 2, pt: 0, pb: 2 }}>
                      <ReportDetail data={rep.extracted_data as unknown as BodyCompositionReport} />
                    </AccordionDetails>
                  </Accordion>
                )}
              </Card>
            ))}
          </Stack>
        )}

        <Divider />

        {/* ── Tape Measurements ── */}
        <Typography variant="subtitle1" fontWeight={600}>{t('measurements.tapeTitle')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('measurements.tapeHint')}</Typography>

        <Grid container spacing={2}>
          {TAPE_FIELDS.map(({ key, label }) => (
            <Grid key={key} size={{ xs: 6 }}>
              <TextField
                label={`${t(label)} (cm)`}
                type="number"
                value={values[key] ?? ''}
                onChange={(e) => setValues((p) => ({ ...p, [key]: e.target.value }))}
                fullWidth
                inputProps={{ min: 0, step: 0.1 }}
              />
            </Grid>
          ))}
          <Grid size={{ xs: 6 }}>
            <TextField
              label={t('measurements.bodyFatManual')}
              type="number"
              value={bodyFat}
              onChange={(e) => setBodyFat(e.target.value)}
              fullWidth
              inputProps={{ min: 0, max: 80, step: 0.1 }}
            />
          </Grid>
        </Grid>

        <Button variant="contained" size="large"
          startIcon={saving ? <CircularProgress size={18} /> : <SaveIcon />}
          onClick={handleSave} disabled={saving}>
          {t('measurements.save')}
        </Button>
      </Stack>

      <Snackbar open={saved} autoHideDuration={3000} onClose={() => setSaved(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setSaved(false)}>{t('measurements.saved')}</Alert>
      </Snackbar>
    </Container>
  );
}
