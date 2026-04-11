import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Container, Tab, Tabs } from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import StraightenIcon from '@mui/icons-material/Straighten';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import DailyTab from './tabs/DailyTab';
import MeasurementsTab from './tabs/MeasurementsTab';
import ExerciseTab from './tabs/ExerciseTab';

const today = new Date().toISOString().split('T')[0];

export default function LogPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = Number(searchParams.get('tab') ?? 0);
  const [tab, setTab] = useState(initialTab);

  const handleTab = (_: React.SyntheticEvent, val: number) => {
    setTab(val);
    setSearchParams({ tab: String(val) });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Container maxWidth="md" disableGutters>
          <Tabs value={tab} onChange={handleTab} variant="fullWidth">
            <Tab icon={<EditNoteIcon />} label={t('dailyLog.tabDaily')} iconPosition="start" />
            <Tab icon={<StraightenIcon />} label={t('dailyLog.tabMeasurements')} iconPosition="start" />
            <Tab icon={<FitnessCenterIcon />} label={t('dailyLog.tabExercises')} iconPosition="start" />
          </Tabs>
        </Container>
      </Box>

      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        {tab === 0 && <DailyTab date={today} />}
        {tab === 1 && <MeasurementsTab date={today} />}
        {tab === 2 && <ExerciseTab date={today} />}
      </Box>
    </Box>
  );
}
