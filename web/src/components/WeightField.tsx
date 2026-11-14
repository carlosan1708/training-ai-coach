import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useProfileStore } from '../store/profileStore';
import { useAuthStore } from '../store/authStore';
import { formatWeight, formatWeightValue, getWorkoutWeightUnit, toKilograms, type WeightUnit } from '../lib/units';

interface Props {
  valueKg?: number | null;
  onChange: (kilograms: number | undefined) => void;
  unit?: WeightUnit;
  onUnitChange?: (unit: WeightUnit) => void;
  label?: string;
  disabled?: boolean;
  preferenceKey?: string;
  showUnitToggle?: boolean;
}

/** Unit selection changes display only; typing converts once at the boundary. */
export default function WeightField({ valueKg, onChange, unit: controlledUnit, onUnitChange, label, disabled, preferenceKey = 'weight', showUnitToggle = true }: Props) {
  const { t } = useTranslation();
  const profile = useProfileStore(state => state.profile);
  const uid = useAuthStore(state => state.currentUser?.uid);
  const storageKey = `tac_weight_unit:${uid ?? 'local'}:${preferenceKey}`;
  const [localUnit, setLocalUnit] = useState<WeightUnit>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === 'kg' || saved === 'lb') return saved;
    } catch { /* Unit selection still works when browser storage is unavailable. */ }
    return preferenceKey === 'body-weight' ? 'kg' : getWorkoutWeightUnit(profile);
  });
  const unit = controlledUnit ?? localUnit;
  const [draft, setDraft] = useState<{ valueKg: number | undefined; unit: WeightUnit; text: string } | null>(null);
  const value = draft?.valueKg === (valueKg ?? undefined) && draft?.unit === unit
    ? draft.text : valueKg == null ? '' : formatWeightValue(valueKg, unit);
  const opposite = unit === 'kg' ? 'lb' : 'kg';
  return <Stack spacing={1} sx={{ minWidth: 0 }}>
    <TextField
      label={`${label ?? t('weightInput.weight')} (${unit})`}
      type="number" size="small" fullWidth disabled={disabled}
      value={value}
      onChange={event => {
        const text = event.target.value;
        const kilograms = text === '' ? undefined : toKilograms(Number(text), unit);
        if (kilograms != null && (!Number.isFinite(kilograms) || kilograms < 0)) return;
        setDraft({ valueKg: kilograms, unit, text });
        onChange(kilograms);
      }}
      inputProps={{ min: 0, step: 'any', inputMode: 'decimal' }}
      helperText={showUnitToggle ? valueKg == null ? t('weightInput.chooseUnit')
        : t('weightInput.equivalent', { value: formatWeight(valueKg, opposite) }) : undefined}
    />
    {showUnitToggle && <ToggleButtonGroup size="small" exclusive value={unit} disabled={disabled}
      aria-label={t('weightInput.unit')}
      onChange={(_, next: WeightUnit | null) => {
        if (!next) return;
        setLocalUnit(next);
        if (!controlledUnit) {
          try { localStorage.setItem(storageKey, next); } catch { /* Optional preference. */ }
        }
        onUnitChange?.(next);
      }}>
      <ToggleButton value="kg" sx={{ minWidth: 52, minHeight: 44 }}>kg</ToggleButton>
      <ToggleButton value="lb" sx={{ minWidth: 52, minHeight: 44 }}>lb</ToggleButton>
    </ToggleButtonGroup>}
  </Stack>;
}
