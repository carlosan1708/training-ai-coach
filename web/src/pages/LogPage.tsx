import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Button, Container, IconButton, Stack, Tab, Tabs, TextField } from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import StraightenIcon from '@mui/icons-material/Straighten';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import { localDateKey, shiftDateKey } from '../lib/dates';
import DailyTab from './tabs/DailyTab';
import MeasurementsTab from './tabs/MeasurementsTab';
import ExerciseTab from './tabs/ExerciseTab';
import MealsTab from './tabs/MealsTab';

function isCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return localDateKey(new Date(`${value}T12:00:00`)) === value;
}

export default function LogPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = localDateKey();
  const requestedTab = Number(searchParams.get('tab') ?? 0);
  const tab = Number.isInteger(requestedTab) && requestedTab >= 0 && requestedTab < 4 ? requestedTab : 0;
  const requestedDate = searchParams.get('date');
  const date = isCalendarDate(requestedDate) && requestedDate <= today ? requestedDate : today;

  const selectDate = (next: string) => {
    if (!isCalendarDate(next) || next > today) return;
    const params = new URLSearchParams(searchParams);
    if (next === today) params.delete('date');
    else params.set('date', next);
    setSearchParams(params);
  };

  const handleTab = (_: React.SyntheticEvent, val: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', String(val));
    setSearchParams(params);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Container maxWidth="md" disableGutters>
          <Tabs value={tab} onChange={handleTab} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
            aria-label={t('logNavigation.sections')} sx={{ '& .MuiTab-root': { minHeight: 56, minWidth: 125 } }}>
            <Tab icon={<EditNoteIcon />} label={t('dailyLog.tabDaily')} iconPosition="start" />
            <Tab icon={<StraightenIcon />} label={t('dailyLog.tabMeasurements')} iconPosition="start" />
            <Tab icon={<FitnessCenterIcon />} label={t('dailyLog.tabExercises')} iconPosition="start" />
            <Tab icon={<RestaurantIcon />} label={t('dailyLog.tabMeals')} iconPosition="start" />
          </Tabs>
        </Container>
      </Box>

      <Container maxWidth="md" sx={{ py: 1.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="center" flexWrap="wrap" gap={1}>
          <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5}>
            <IconButton onClick={() => selectDate(shiftDateKey(date, -1))} aria-label={t('logNavigation.previousDay')} sx={{ width: 44, height: 44 }}>
              <ChevronLeftIcon />
            </IconButton>
            <TextField label={t('logNavigation.date')} type="date" value={date}
              onChange={(event) => selectDate(event.target.value)} size="small"
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
              sx={{ width: 170 }} />
            <IconButton onClick={() => selectDate(shiftDateKey(date, 1))} disabled={date === today} aria-label={t('logNavigation.nextDay')} sx={{ width: 44, height: 44 }}>
              <ChevronRightIcon />
            </IconButton>
          </Stack>
          <Button onClick={() => selectDate(today)} startIcon={<TodayIcon />} size="small"
            variant={date === today ? 'text' : 'outlined'} sx={{ flexShrink: 0, minHeight: 44 }}>
            {t('logNavigation.today')}
          </Button>
        </Stack>
      </Container>

      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        {tab === 0 && <DailyTab key={date} date={date} />}
        {tab === 1 && <MeasurementsTab key={date} date={date} />}
        {tab === 2 && <ExerciseTab key={date} date={date} />}
        {tab === 3 && <MealsTab key={date} date={date} />}
      </Box>
    </Box>
  );
}
