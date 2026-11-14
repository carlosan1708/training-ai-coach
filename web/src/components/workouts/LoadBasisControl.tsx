import { Button, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { LoadBasis, LoadConvention } from '../../types/routine';
import { validLoadBasis } from '../../lib/loadBasis';

/** Unconfirmed legacy records deliberately have no selected option. */
export default function LoadBasisControl({ exercise, disabled = false, hint, onChange }: {
  exercise: LoadConvention; disabled?: boolean; hint?: string; onChange: (basis: LoadBasis | undefined) => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const helpId = useId();
  const basis = validLoadBasis(exercise.load_basis) ? exercise.load_basis : '';
  return <FormControl component="fieldset" disabled={disabled} fullWidth>
    <FormLabel component="legend" id={labelId}>{t('loadBasis.label')}</FormLabel>
    <RadioGroup row value={basis} aria-labelledby={labelId} aria-describedby={helpId}
      onChange={event => onChange(event.target.value as LoadBasis)}>
      {(['total', 'per_dumbbell', 'machine_display', 'per_side'] as LoadBasis[]).map(value => <FormControlLabel
        key={value} value={value} control={<Radio />} label={t(`loadBasis.${value}`)}
        sx={{ minHeight: 44, mr: 2, '& .MuiFormControlLabel-label': { fontSize: '0.875rem' } }} />)}
    </RadioGroup>
    <Stack spacing={0.5}>
      <Typography id={helpId} variant="caption" color="text.secondary">{hint ?? t('loadBasis.recordedChoiceHint')}</Typography>
      {!basis && <Typography variant="body2">{t('loadBasis.unknown')}</Typography>}
      {basis && <Button size="small" variant="text" disabled={disabled} onClick={() => onChange(undefined)}
        sx={{ alignSelf: 'flex-start', minHeight: 44 }}>{t('loadBasis.clearChoice')}</Button>}
    </Stack>
  </FormControl>;
}
