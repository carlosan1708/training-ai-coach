import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExerciseGif from '../ExerciseGif';
import ExerciseAutocomplete from '../ExerciseAutocomplete';
import ExerciseConfigDialog from './ExerciseConfigDialog';
import {
  loadExerciseLibrary,
  searchExercises,
  type LibraryExercise,
} from '../../lib/exerciseLibrary';
import type { RoutineExercise } from '../../types/routine';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (exercise: RoutineExercise) => void;
}

/** Search the exercise library (with demo images) or add a custom exercise. */
export default function ExercisePickerDialog({ open, onClose, onAdd }: Props) {
  const { t } = useTranslation();
  const [library, setLibrary] = useState<LibraryExercise[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [configuring, setConfiguring] = useState<RoutineExercise | null>(null);
  const [isCustom, setIsCustom] = useState(false);

  useEffect(() => {
    if (!open || library) return;
    loadExerciseLibrary()
      .then(setLibrary)
      .catch(() => setLoadError(true));
  }, [open, library]);

  const results = useMemo(
    () => (library ? searchExercises(library, search, 30) : []),
    [library, search]
  );

  const pickLibrary = (ex: LibraryExercise) => {
    setIsCustom(false);
    setConfiguring({
      name: ex.name,
      muscle_group: ex.primaryMuscles[0],
      equipment: ex.equipment ?? undefined,
      images: ex.images,
      library_id: ex.id,
      instructions: ex.instructions.slice(0, 4),
      sets: 3,
      reps: 10,
    });
  };

  const pickCustom = () => {
    setIsCustom(true);
    setConfiguring({ name: search.trim(), sets: 3, reps: 10 });
  };

  const handleSave = (ex: RoutineExercise) => {
    setConfiguring(null);
    onAdd(ex);
  };

  return (
    <>
      <Dialog open={open && !configuring} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{t('routines.addExercise')}</DialogTitle>
        <DialogContent sx={{ minHeight: 420 }}>
          <ExerciseAutocomplete
            label={t('routines.searchExercises')}
            value={search}
            onChange={setSearch}
            onSelect={pickLibrary}
          />

          <Button startIcon={<AddIcon />} onClick={pickCustom} size="small" sx={{ mb: 1 }}>
            {t('routines.addCustom')}
          </Button>

          {!library && !loadError && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          )}

          <List dense disablePadding>
            {results.map((ex) => (
              <ListItemButton key={ex.id} onClick={() => pickLibrary(ex)} sx={{ borderRadius: 2 }}>
                <ExerciseGif images={ex.images} size={56} animate={false} />
                <ListItemText
                  sx={{ ml: 2 }}
                  primary={ex.name}
                  secondary={
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                      {[ex.primaryMuscles[0], ex.equipment, ex.level].filter(Boolean).join(' · ')}
                    </Typography>
                  }
                />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
      </Dialog>

      <ExerciseConfigDialog
        open={!!configuring}
        initial={configuring}
        editableName={isCustom}
        onClose={() => setConfiguring(null)}
        onSave={handleSave}
      />
    </>
  );
}
