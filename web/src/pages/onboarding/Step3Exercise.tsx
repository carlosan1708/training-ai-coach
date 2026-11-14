import { useTranslation } from 'react-i18next';
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { UserProfile } from '../../types/user';

interface Props {
  draft: Partial<UserProfile>;
  onUpdate: (partial: Partial<UserProfile>) => void;
  showGoal?: boolean;
}

export default function Step3Exercise({ draft, onUpdate, showGoal = true }: Props) {
  const { t } = useTranslation();

  return (
    <Stack spacing={3}>
      {showGoal && <FormControl fullWidth>
        <InputLabel>{t('onboarding.exercise.goal')}</InputLabel>
        <Select
          value={draft.training_goal ?? 'general'}
          inputProps={{ 'aria-label': t('onboarding.exercise.goal') }}
          label={t('onboarding.exercise.goal')}
          onChange={(e) =>
            onUpdate({ training_goal: e.target.value as UserProfile['training_goal'] })
          }
        >
          {(['fat_loss', 'muscle_gain', 'endurance', 'general'] as const).map((v) => (
            <MenuItem key={v} value={v}>
              {t(`onboarding.exercise.goalOptions.${v}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>}

      <FormControl fullWidth>
        <InputLabel>{t('onboarding.exercise.equipment')}</InputLabel>
        <Select
          value={draft.equipment ?? 'gym'}
          inputProps={{ 'aria-label': t('onboarding.exercise.equipment') }}
          label={t('onboarding.exercise.equipment')}
          onChange={(e) =>
            onUpdate({ equipment: e.target.value as UserProfile['equipment'] })
          }
        >
          {(['none', 'home', 'gym'] as const).map((v) => (
            <MenuItem key={v} value={v}>
              {t(`onboarding.exercise.equipmentOptions.${v}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Stack>
        <Typography gutterBottom>
          {t('onboarding.exercise.daysPerWeek')}: {draft.training_days_per_week ?? 3}
        </Typography>
        <Slider
          min={1}
          aria-label={t('onboarding.exercise.daysPerWeek')}
          max={7}
          step={1}
          marks
          value={draft.training_days_per_week ?? 3}
          onChange={(_, v) => onUpdate({ training_days_per_week: v as number })}
        />
      </Stack>

      <Stack>
        <Typography gutterBottom>
          {t('onboarding.exercise.sessionLength')}: {draft.session_length_min ?? 45} min
        </Typography>
        <Slider
          min={15}
          aria-label={t('onboarding.exercise.sessionLength')}
          max={120}
          step={5}
          marks={[15, 30, 45, 60, 90, 120].map((v) => ({ value: v, label: `${v}` }))}
          value={draft.session_length_min ?? 45}
          onChange={(_, v) => onUpdate({ session_length_min: v as number })}
        />
      </Stack>

      <TextField
        label={t('onboarding.exercise.restrictions')}
        multiline
        rows={2}
        value={draft.movement_restrictions ?? ''}
        onChange={(e) => onUpdate({ movement_restrictions: e.target.value })}
        fullWidth
      />
    </Stack>
  );
}
