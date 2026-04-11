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

export default function Step4Health({ draft, onUpdate }: Props) {
  const { t } = useTranslation();

  return (
    <Stack spacing={3}>
      <TextField
        label={t('onboarding.health.notes')}
        helperText={t('onboarding.health.notesHint')}
        multiline
        rows={4}
        value={draft.health_notes ?? ''}
        onChange={(e) => onUpdate({ health_notes: e.target.value })}
        fullWidth
      />

      <FormControl fullWidth>
        <InputLabel>{t('onboarding.health.units')}</InputLabel>
        <Select
          value={draft.units ?? 'metric'}
          label={t('onboarding.health.units')}
          onChange={(e) =>
            onUpdate({ units: e.target.value as UserProfile['units'] })
          }
        >
          <MenuItem value="metric">
            {t('onboarding.health.unitsOptions.metric')}
          </MenuItem>
          <MenuItem value="imperial">
            {t('onboarding.health.unitsOptions.imperial')}
          </MenuItem>
        </Select>
      </FormControl>
    </Stack>
  );
}
