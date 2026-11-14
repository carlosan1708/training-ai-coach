import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Chip, Container, Grid, Stack, Typography } from '@mui/material';
import { useAuthStore } from '../../store/authStore';
import { getBodyCompositionReports, type BodyCompositionReportDoc } from '../../firebase/firestore';
import { deleteMeasurementEntry, measurementRequestId } from '../../firebase/measurements';
import MeasurementHistory from '../../components/measurements/MeasurementHistory';
import MeasurementWorkspace from '../../components/measurements/MeasurementWorkspace';
import type { BodyCompositionReport } from '../../types/log';

interface Props { date: string }

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
  const uid = useAuthStore(state => state.currentUser?.uid);
  const [legacy, setLegacy] = useState(false);
  const [reports, setReports] = useState<BodyCompositionReportDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const loadReports = useCallback(async () => {
    if (!uid) return;
    setLoading(true); setError(false);
    try { setReports(await getBodyCompositionReports(uid)); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [uid]);
  useEffect(() => { if (legacy) void loadReports(); }, [legacy, loadReports]);
  const remove = async (report: BodyCompositionReportDoc) => {
    if (!window.confirm(t('measurements.deleteConfirm'))) return;
    setDeleting(report.id);
    try { await deleteMeasurementEntry(`legacy_report_${report.id}`, measurementRequestId()); await loadReports(); setRefresh(value => value + 1); }
    catch { setError(true); }
    finally { setDeleting(null); }
  };
  return <Container maxWidth="md" sx={{ py: 3 }}><Stack spacing={3}>
    <Button variant="text" onClick={() => setLegacy(value => !value)} sx={{ alignSelf: 'flex-start' }}>{t(legacy ? 'measurementWorkspace.backToWorkspace' : 'measurementWorkspace.browseLegacy')}</Button>
    {legacy ? <MeasurementHistory uid={uid} reports={reports} reportsLoading={loading} reportsError={error} refreshKey={refresh}
      renderReport={report => <ReportDetail data={report} />} onAdd={() => setLegacy(false)} onRetryReports={loadReports}
      onDelete={remove} deletingId={deleting} /> : <MeasurementWorkspace initialDate={date} />}
  </Stack></Container>;
}
