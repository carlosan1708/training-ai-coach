import { useEffect, useMemo, useState } from 'react';
import { Alert, Autocomplete, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ExerciseGif from './ExerciseGif';
import { loadExerciseLibrary, matchExercise, searchExercises, type LibraryExercise } from '../lib/exerciseLibrary';

export interface ExerciseAutocompleteProps {
  value: string;
  label: string;
  disabled?: boolean;
  required?: boolean;
  gifUrl?: string;
  images?: string[];
  onChange: (name: string) => void;
  onSelect: (exercise: LibraryExercise) => void;
  helperText?: string;
}

/** Search and preview without attaching library metadata until an explicit selection. */
export default function ExerciseAutocomplete({ value, label, disabled, required, gifUrl, images,
  onChange, onSelect, helperText }: ExerciseAutocompleteProps) {
  const { t } = useTranslation();
  const [library, setLibrary] = useState<LibraryExercise[] | null>(null);
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [highlighted, setHighlighted] = useState<LibraryExercise | null>(null);
  const [selected, setSelected] = useState<LibraryExercise | null>(null);
  const existingMedia = Boolean(gifUrl || images?.length);
  const shouldLoad = requested || Boolean(value.trim() && !existingMedia);

  useEffect(() => {
    if (!shouldLoad || library) return;
    let active = true;
    loadExerciseLibrary().then(items => {
      if (active) { setLibrary(items); setFailed(false); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [shouldLoad, library, attempt]);

  const options = useMemo(() => library ? searchExercises(library, value, 25) : [], [library, value]);
  const matching = useMemo(() => library && value.trim() ? matchExercise(library, value) : null, [library, value]);
  const selection = selected?.name === value ? selected : null;
  const preview = highlighted ?? (existingMedia ? null : selection);
  const previewName = preview?.name ?? (existingMedia ? value : matching?.name ?? value);
  const previewGif = preview ? undefined : gifUrl;
  const previewImages = preview?.images ?? (existingMedia ? images : matching?.images);
  const hasPreview = Boolean(previewGif || previewImages?.length);
  const previewLabel = previewName.trim()
    ? t('exerciseSearch.preview', { name: previewName }) : t('exerciseSearch.previewTitle');
  const loading = shouldLoad && !library && !failed;

  // Preview changes must not resync MUI's keyboard highlight against a new options list.
  const input = useMemo(() => <Autocomplete<LibraryExercise, false, false, true>
      freeSolo fullWidth disabled={disabled} value={selection} inputValue={value}
      options={options} filterOptions={items => items} clearOnBlur={false} openOnFocus
      loading={loading} loadingText={t('exerciseSearch.loading')} noOptionsText={t('exerciseSearch.noResults')}
      getOptionLabel={option => typeof option === 'string' ? option : option.name}
      getOptionKey={option => typeof option === 'string' ? option : option.id}
      isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
      onOpen={() => setRequested(true)} onClose={() => setHighlighted(null)}
      onHighlightChange={(_, exercise) => setHighlighted(exercise)}
      onInputChange={(_, name, reason) => {
        if (reason !== 'input' && reason !== 'clear') return;
        setHighlighted(null); setSelected(null); onChange(name);
      }}
      onChange={(_, exercise) => {
        if (typeof exercise === 'string') { setSelected(null); onChange(exercise); }
        else if (exercise) { setSelected(exercise); setHighlighted(null); onSelect(exercise); }
      }}
      renderOption={(props, exercise) => {
        const { key, ...optionProps } = props;
        return <Box component="li" key={key} {...optionProps} sx={{ gap: 1.25, minWidth: 0, minHeight: 64 }}>
          <ExerciseGif images={exercise.images} size={48} animate={false} alt="" />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{exercise.name}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {[exercise.primaryMuscles[0], exercise.equipment].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        </Box>;
      }}
      slotProps={{ listbox: { sx: { maxHeight: 240 } }, paper: { sx: { overflowWrap: 'anywhere' } } }}
      renderInput={params => <TextField {...params} label={label} required={required} size="small"
        helperText={helperText} placeholder={t('exerciseSearch.placeholder')}
        slotProps={{ input: { ...params.InputProps, endAdornment: <>
          {loading && <CircularProgress color="inherit" size={16} />}{params.InputProps.endAdornment}
        </> } }} />}
    />, [disabled, selection, value, options, loading, t, label, required, helperText, onChange, onSelect]);

  return <Stack spacing={1.25} sx={{ minWidth: 0, width: '100%' }}>
    {input}
    {failed && <Alert severity="warning" action={<Button color="inherit" disabled={disabled} sx={{ minHeight: 44 }}
      onClick={() => { setFailed(false); setRequested(true); setAttempt(previous => previous + 1); }}>
      {t('exerciseSearch.retry')}
    </Button>}>{t('exerciseSearch.loadError')}</Alert>}
    <Stack component="section" role="region" aria-label={previewLabel} data-testid="exercise-preview"
      direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
      <ExerciseGif gifUrl={previewGif} images={previewImages} size={72} alt={previewLabel} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">{t('exerciseSearch.previewTitle')}</Typography>
        {hasPreview ? <>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{previewName}</Typography>
          {!preview && !existingMedia && matching && <Typography variant="caption" color="text.secondary">
            {t('exerciseSearch.matchedPreviewHint')}
          </Typography>}
        </> : <Typography variant="caption" color="text.secondary" component="p">
          {t('exerciseSearch.previewHint')}
        </Typography>}
      </Box>
    </Stack>
  </Stack>;
}
