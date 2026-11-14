import { useTranslation } from 'react-i18next';
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import type { UserProfile } from '../../types/user';

interface Props {
  draft: Partial<UserProfile>;
  onUpdate: (partial: Partial<UserProfile>) => void;
}

export default function Step1About({ draft, onUpdate }: Props) {
  const { t } = useTranslation();

  return (
    <Stack spacing={2}>
      <TextField
        label={t('onboarding.about.name')}
        required
        value={draft.name ?? ''}
        onChange={(e) => onUpdate({ name: e.target.value })}
        fullWidth
      />
      <TextField
        label={t('onboarding.about.age')}
        type="number"
        value={draft.age ?? ''}
        onChange={(e) => onUpdate({ age: e.target.value === '' ? undefined : Number(e.target.value) })}
        helperText={t('redesign.profile.optional')}
        fullWidth
        inputProps={{ min: 10, max: 120 }}
      />
      <FormControl fullWidth>
        <InputLabel>{t('onboarding.about.sex')}</InputLabel>
        <Select
          inputProps={{ 'aria-label': t('onboarding.about.sex') }}
          value={draft.biological_sex ?? ''}
          label={t('onboarding.about.sex')}
          onChange={(e) =>
            onUpdate({ biological_sex: String(e.target.value) === '' ? undefined : e.target.value as UserProfile['biological_sex'] })
          }
        >
          <MenuItem value="">{t('redesign.profile.notSpecified')}</MenuItem>
          <MenuItem value="male">{t('onboarding.about.sexOptions.male')}</MenuItem>
          <MenuItem value="female">{t('onboarding.about.sexOptions.female')}</MenuItem>
          <MenuItem value="other">{t('onboarding.about.sexOptions.other')}</MenuItem>
        </Select>
      </FormControl>
      <TextField
        label={t('onboarding.about.height')}
        type="number"
        value={draft.height_cm ?? ''}
        onChange={(e) => onUpdate({ height_cm: e.target.value === '' ? undefined : Number(e.target.value) })}
        helperText={t('redesign.profile.optional')}
        fullWidth
        inputProps={{ min: 50, max: 300 }}
      />
      <TextField
        label={t('onboarding.about.goalWeight')}
        type="number"
        value={draft.goal_weight_kg ?? ''}
        onChange={(e) => onUpdate({ goal_weight_kg: e.target.value === '' ? undefined : Number(e.target.value) })}
        helperText={t('redesign.profile.optional')}
        fullWidth
        inputProps={{ min: 20, max: 500, step: 0.1 }}
      />
    </Stack>
  );
}
