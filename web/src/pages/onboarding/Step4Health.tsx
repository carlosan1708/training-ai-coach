import { useTranslation } from 'react-i18next';
import { Alert, Stack, TextField } from '@mui/material';
import type { UserProfile } from '../../types/user';

interface Props { draft: Partial<UserProfile>; onUpdate: (partial: Partial<UserProfile>) => void }

export default function Step4Health({ draft, onUpdate }: Props) {
  const { t } = useTranslation();
  return <Stack spacing={3}>
    <TextField label={t('onboarding.health.notes')} helperText={t('onboarding.health.notesHint')} multiline rows={4}
      value={draft.health_notes ?? ''} onChange={event => onUpdate({ health_notes: event.target.value })} fullWidth />
    <Alert severity="info">{t('redesign.profile.bodyUnits')}</Alert>
  </Stack>;
}
