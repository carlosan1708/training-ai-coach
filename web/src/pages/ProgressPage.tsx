import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Button, Container, Stack } from '@mui/material';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import PageHeader from '../components/layout/PageHeader';
import MeasurementWorkspace from '../components/measurements/MeasurementWorkspace';

export default function ProgressPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [section, setSection] = useState<'summary' | 'trends' | 'history' | null>(null);
  return <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, sm: 3, md: 4 } }}>
    <Stack spacing={3}>
      <PageHeader title={t('redesign.nav.progress')} />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap aria-label={t('redesign.progress.title')}>
        <Button variant="outlined" startIcon={<FitnessCenterRoundedIcon />} onClick={() => navigate('/workout-history')}>{t('redesign.progress.workoutAction')}</Button>
        <Button variant="text" onClick={() => navigate('/routines')}>{t('redesign.progress.exerciseAction')}</Button>
        <Button component="a" href="#progress-measurements" variant="outlined" startIcon={<InsightsRoundedIcon />}>{t('redesign.progress.measurementsAction')}</Button>
      </Stack>
      <Box id="progress-measurements" sx={{ scrollMarginTop: 16 }}>
        <MeasurementWorkspace selectedSection={section} onSectionChange={setSection} />
      </Box>
    </Stack>
  </Container>;
}
