import { useTranslation } from 'react-i18next';
import {
  Checkbox,
  FormControl,
  FormControlLabel,
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
}

export default function Step2Diet({ draft, onUpdate }: Props) {
  const { t } = useTranslation();

  return (
    <Stack spacing={3}>
      <FormControl fullWidth>
        <InputLabel>{t('onboarding.diet.style')}</InputLabel>
        <Select
          value={draft.dietary_style ?? 'omnivore'}
          label={t('onboarding.diet.style')}
          onChange={(e) =>
            onUpdate({ dietary_style: e.target.value as UserProfile['dietary_style'] })
          }
        >
          {(['omnivore', 'vegetarian', 'vegan', 'other'] as const).map((v) => (
            <MenuItem key={v} value={v}>
              {t(`onboarding.diet.styleOptions.${v}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        label={t('onboarding.diet.intolerances')}
        helperText={t('onboarding.diet.intolerancesHint')}
        value={(draft.intolerances ?? []).join(', ')}
        onChange={(e) =>
          onUpdate({
            intolerances: e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
        fullWidth
      />

      <TextField
        label={t('onboarding.diet.dislikedFoods')}
        helperText={t('onboarding.diet.dislikedFoodsHint')}
        value={(draft.disliked_foods ?? []).join(', ')}
        onChange={(e) =>
          onUpdate({
            disliked_foods: e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
        fullWidth
      />

      <TextField
        label={t('onboarding.diet.cuisines')}
        helperText={t('onboarding.diet.cuisinesHint')}
        value={(draft.preferred_cuisines ?? []).join(', ')}
        onChange={(e) =>
          onUpdate({
            preferred_cuisines: e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
        fullWidth
      />

      <Stack>
        <Typography gutterBottom>
          {t('onboarding.diet.mealsPerDay')}: {draft.meals_per_day ?? 3}
        </Typography>
        <Slider
          min={2}
          max={6}
          step={1}
          marks
          value={draft.meals_per_day ?? 3}
          onChange={(_, v) => onUpdate({ meals_per_day: v as number })}
        />
      </Stack>

      <Stack direction="row" alignItems="center" spacing={2}>
        <TextField
          label={t('onboarding.diet.caloricTarget')}
          type="number"
          value={draft.caloric_target === 'auto' ? '' : (draft.caloric_target ?? '')}
          onChange={(e) =>
            onUpdate({ caloric_target: e.target.value ? Number(e.target.value) : 'auto' })
          }
          disabled={draft.caloric_target === 'auto'}
          fullWidth
          inputProps={{ min: 800, max: 6000 }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={draft.caloric_target === 'auto'}
              onChange={(e) =>
                onUpdate({ caloric_target: e.target.checked ? 'auto' : 2000 })
              }
            />
          }
          label={t('onboarding.diet.caloricAuto')}
          sx={{ whiteSpace: 'nowrap' }}
        />
      </Stack>
    </Stack>
  );
}
