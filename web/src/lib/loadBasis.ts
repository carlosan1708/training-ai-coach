import type { LoadBasis, LoadConvention, RoutineExercise } from '../types/routine';
export const loadBases: LoadBasis[] = ['per_dumbbell', 'total', 'machine_display', 'per_side'];
export const validLoadBasis = (value: unknown): value is LoadBasis => loadBases.includes(value as LoadBasis);
/** Suggestions apply to NEW configurations, never to historical numbers. */
export function suggestedLoadBasis(exercise: Pick<RoutineExercise, 'name' | 'library_id' | 'equipment'>): LoadBasis {
  const text = `${exercise.library_id ?? ''} ${exercise.name} ${exercise.equipment ?? ''}`.toLowerCase();
  if (/dumbbell|mancuerna/.test(text)) return 'per_dumbbell';
  if (/barbell|barra|\bez\b/.test(text)) return 'total';
  return 'machine_display';
}
export function loadConvention(exercise: LoadConvention): LoadConvention {
  return {
    ...(validLoadBasis(exercise.load_basis) ? { load_basis: exercise.load_basis } : {}),
    ...(exercise.load_basis_review_required ? { load_basis_review_required: true } : {}),
    ...(typeof exercise.load_basis_confirmed === 'boolean'
      ? { load_basis_confirmed: validLoadBasis(exercise.load_basis) && exercise.load_basis_confirmed } : {}),
    ...(exercise.load_basis_note ? { load_basis_note: exercise.load_basis_note } : {}),
  };
}

const recordedConfirmationNote = 'The user explicitly confirmed the recording convention for this exercise in this session. Numeric loads were not converted.';

/** Older explicit choices used this exact generated note before the confirmation flag existed. */
export function isRecordedLoadConfirmed(exercise: LoadConvention): boolean {
  return validLoadBasis(exercise.load_basis) && !exercise.load_basis_review_required
    && (exercise.load_basis_confirmed === true || (exercise.load_basis_confirmed == null
      && exercise.load_basis_note === recordedConfirmationNote));
}
export function compatibleLoadBasis(left: LoadConvention, right: LoadConvention): boolean {
  return !left.load_basis_review_required && !right.load_basis_review_required && left.load_basis === right.load_basis;
}

/** Explicit classification of recorded numbers; never a numerical conversion. */
export function classifyRecordedLoad<T extends LoadConvention>(exercise: T, basis: LoadBasis | undefined): T {
  const confirmed = validLoadBasis(basis);
  const updated = { ...exercise, load_basis: confirmed ? basis : undefined,
    load_basis_review_required: false, load_basis_confirmed: confirmed };
  updated.load_basis_note = confirmed
    ? recordedConfirmationNote
    : 'The recording convention for this session exercise is unconfirmed. Numeric loads were not converted.';
  return updated;
}
