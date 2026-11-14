import { useEffect, useState } from 'react';
import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export type ImportPhase = 'uploading' | 'extracting' | 'saving';

/** Upload percentages are real; extraction deliberately has no invented percent. */
export default function MeasurementImportStatus({ phase, progress }: { phase: ImportPhase; progress: number }) {
  const { t } = useTranslation();
  const [started] = useState(Date.now);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [started]);
  const uploading = phase === 'uploading';
  const saving = phase === 'saving';
  const label = t(`measurementWorkspace.${uploading ? 'uploadingReport' : saving ? 'savingReport' : 'analyzing'}`);
  return <Box data-testid="measurement-import-status" sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2,
    position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper' }}>
    <Stack spacing={1}>
      <Stack direction="row" justifyContent="space-between" gap={1}>
        <Typography role="status" variant="body2" fontWeight={700}>{label}</Typography>
        <Typography aria-hidden="true" variant="body2" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {uploading ? `${progress}%` : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}
        </Typography>
      </Stack>
      <LinearProgress aria-label={label} variant={uploading ? 'determinate' : 'indeterminate'} value={uploading ? progress : undefined} />
      <Typography variant="body2" color="text.secondary">{t(`measurementWorkspace.${uploading ? 'uploadingHint' : saving ? 'savingReportHint' : 'readingHint'}`)}</Typography>
      {!saving && elapsed >= 30 && <Typography role="status" variant="body2">{t(`measurementWorkspace.${uploading ? 'uploadSlow' : 'readingSlow'}`)}</Typography>}
    </Stack>
  </Box>;
}
