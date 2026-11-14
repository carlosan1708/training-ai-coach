import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, MenuItem, Stack, TextField } from '@mui/material';
import { setProfile } from '../firebase/firestore';
import { getWorkoutWeightUnit, type WeightUnit } from '../lib/units';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';

/** One account preference for workout loads; it never changes recorded values. */
export default function WorkoutWeightPreference() {
  const { t } = useTranslation();
  const currentUser = useAuthStore(state => state.currentUser);
  const profile = useProfileStore(state => state.profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const choose = async (unit: WeightUnit) => {
    if (!currentUser || !profile || saving) return;
    setSaving(true);
    setError(false);
    try {
      await setProfile(currentUser.uid, { workout_weight_unit: unit });
      // Demo subscriptions do not stream updates; make all mounted views agree.
      const latest = useProfileStore.getState();
      if (latest.profileUid === currentUser.uid && latest.profile) {
        latest.setProfile({ ...latest.profile, workout_weight_unit: unit }, currentUser.uid);
      }
    } catch {
      setError(true);
    } finally { setSaving(false); }
  };

  return <Stack spacing={1}>
    <TextField select fullWidth size="small" label={t('weightInput.workoutUnit')}
      value={getWorkoutWeightUnit(profile)} disabled={saving || !currentUser || !profile}
      helperText={t('weightInput.workoutUnitHint')}
      onChange={event => { void choose(event.target.value as WeightUnit); }}>
      <MenuItem value="lb">lb</MenuItem>
      <MenuItem value="kg">kg</MenuItem>
    </TextField>
    {error && <Alert severity="error">{t('weightInput.saveUnitError')}</Alert>}
  </Stack>;
}
