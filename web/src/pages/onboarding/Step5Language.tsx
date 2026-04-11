import { useTranslation } from 'react-i18next';
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
} from '@mui/material';
import type { UserProfile } from '../../types/user';
import i18n from '../../i18n';

interface Props {
  draft: Partial<UserProfile>;
  onUpdate: (partial: Partial<UserProfile>) => void;
}

export default function Step5Language({ draft, onUpdate }: Props) {
  const { t } = useTranslation();

  const handleUiLanguage = (lang: 'en' | 'es') => {
    onUpdate({ ui_language: lang });
    i18n.changeLanguage(lang);
    localStorage.setItem('ui_language', lang);
  };

  return (
    <Stack spacing={3}>
      <FormControl fullWidth>
        <InputLabel>{t('onboarding.language.uiLanguage')}</InputLabel>
        <Select
          value={draft.ui_language ?? 'en'}
          label={t('onboarding.language.uiLanguage')}
          onChange={(e) => handleUiLanguage(e.target.value as 'en' | 'es')}
        >
          <MenuItem value="en">English</MenuItem>
          <MenuItem value="es">Español</MenuItem>
        </Select>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel>{t('onboarding.language.responseLanguage')}</InputLabel>
        <Select
          value={draft.response_language ?? 'en'}
          label={t('onboarding.language.responseLanguage')}
          onChange={(e) =>
            onUpdate({ response_language: e.target.value as UserProfile['response_language'] })
          }
        >
          {(['en', 'es', 'both'] as const).map((v) => (
            <MenuItem key={v} value={v}>
              {t(`onboarding.language.responseOptions.${v}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel>{t('onboarding.language.tone')}</InputLabel>
        <Select
          value={draft.coaching_tone ?? 'friendly'}
          label={t('onboarding.language.tone')}
          onChange={(e) =>
            onUpdate({ coaching_tone: e.target.value as UserProfile['coaching_tone'] })
          }
        >
          {(['motivational', 'clinical', 'friendly'] as const).map((v) => (
            <MenuItem key={v} value={v}>
              {t(`onboarding.language.toneOptions.${v}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );
}
