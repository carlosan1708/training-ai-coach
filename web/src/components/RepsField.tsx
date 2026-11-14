import { useState } from 'react';
import { TextField } from '@mui/material';

/** Keep an empty editing draft without forcing the stored zero back into the field. */
export default function RepsField({ value, onChange, label, disabled, centered = false, usageAction }: {
  value: number | undefined;
  onChange: (reps: number) => void;
  label: string;
  disabled?: boolean;
  centered?: boolean;
  usageAction?: 'reps_edited';
}) {
  const [draft, setDraft] = useState<{ value: number; text: string } | null>(null);
  const text = draft && draft.value === value ? draft.text : value ?? '';

  return <TextField type="number" size="small" fullWidth disabled={disabled} label={label} value={text}
    onFocus={() => { if (value === 0) setDraft({ value: 0, text: '' }); }}
    onBlur={() => setDraft(null)}
    onChange={event => {
      const entered = event.target.value;
      const numeric = Number(entered);
      if (!Number.isFinite(numeric)) return;
      const reps = Math.max(0, Math.trunc(numeric));
      setDraft({ value: reps, text: entered === '' ? '' : String(reps) });
      onChange(reps);
    }}
    inputProps={{ min: 0, step: 1, inputMode: 'numeric', ...(usageAction ? { 'data-usage-action': usageAction } : {}), style: { ...(centered ? { textAlign: 'center' as const } : {}), minHeight: 24 } }}
    sx={{ minWidth: 0, scrollMarginBlock: '100px', '& input': { fontSize: 16, px: 0.75 }, '& .MuiInputBase-root': { minHeight: 44 } }} />;
}
