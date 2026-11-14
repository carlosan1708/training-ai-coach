import type { WeightUnit } from '../lib/units';

/** JavaScript calendar convention: Sunday is 0 and Saturday is 6. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type LoadBasis = 'per_dumbbell' | 'total' | 'machine_display' | 'per_side';
export interface LoadConvention {
  /** Meaning of the entered weight; absent in unconfirmed legacy records. */
  load_basis?: LoadBasis;
  load_basis_review_required?: boolean;
  /** True only after an explicit confirmation of what these recorded numbers mean. */
  load_basis_confirmed?: boolean;
  /** Confirmed provenance, including exceptions in older sessions. */
  load_basis_note?: string;
}

export interface RoutineExercise extends LoadConvention {
  /** Stable identity for newly added/edited exercises, independent of order. */
  id?: string;
  name: string;
  /** Earlier labels keep legacy sessions without exercise IDs discoverable. */
  previous_names?: string[];
  /** Earlier physical exercises retain separate progress when a stable slot is replaced. */
  progress_previous_exercises?: { name: string; previous_names?: string[]; library_id?: string }[];
  muscle_group?: string;
  equipment?: string;
  sets: number;
  reps: number;
  weight_kg?: number | null;
  /** Preferred entry/display unit; weight_kg remains the canonical value. */
  weight_unit?: WeightUnit;
  /** Set only by a manual unit toggle; older generated units follow the profile. */
  weight_unit_override?: boolean;
  /** Last saved working values. Completion flags are never carried forward. */
  set_defaults?: Pick<SessionSet, 'reps' | 'weight_kg'>[];
  /** Changes when the user explicitly changes the routine prescription. */
  targets_revision?: string;
  /** Session that last supplied these working defaults (used when discarding a draft). */
  defaults_session_id?: string;
  rest_sec?: number;
  notes?: string;
  /** Custom animated GIF URL (takes priority over library images). */
  gif_url?: string;
  /** free-exercise-db relative image paths — two frames animated as a GIF. */
  images?: string[];
  /** free-exercise-db id when picked from the library. */
  library_id?: string;
  instructions?: string[];
}

export interface RoutineDay {
  id: string;
  name: string;
  /** Earlier labels for legacy sessions recorded before day IDs were saved. */
  previous_names?: string[];
  /** Owns unscoped sessions from this routine's original single-workout format. */
  includes_legacy_sessions?: boolean;
  /** An explicit empty list disables scheduling inferred from the name. */
  scheduled_weekdays?: Weekday[];
  exercises: RoutineExercise[];
}

export interface Routine {
  id: string;
  name: string;
  /** Used by single-workout routines; multi-day routines schedule each day. */
  scheduled_weekdays?: Weekday[];
  /** Date-specific assignments for multi-day routines; an empty list is a rest day. */
  schedule_overrides?: Record<string, string[]>;
  description?: string;
  exercises: RoutineExercise[];
  days?: RoutineDay[];
  session_count?: number;
  last_session_at?: string | null; // YYYY-MM-DD
  created_at?: unknown;
  updated_at?: unknown;
}

export interface SessionSet {
  reps: number;
  weight_kg: number;
  done: boolean;
}

export type SessionChange = 'increase' | 'hold' | 'decrease';

/** Template ownership retained across a temporary alternative and partial completion. */
export interface WorkoutExerciseSubstitutionSource extends LoadConvention {
  name: string;
  target_sets: number;
  day_id?: string;
  routine_exercise_id?: string;
  routine_exercise_index?: number;
  targets_revision?: string;
  library_id?: string;
  routine_addition?: true;
  routine_defaults_excluded?: boolean;
}

export interface WorkoutExerciseSubstitutionMarker {
  request_id: string;
  role: 'retained' | 'replacement';
  permanent: boolean;
  source: WorkoutExerciseSubstitutionSource;
}

/** A stable request id makes lost-response retries safe after structural edits. */
export interface WorkoutExerciseSubstitutionRecord {
  permanent: boolean;
  source_index: number;
  source_signature: string;
  alternative_signature: string;
}

export interface SessionExercise extends LoadConvention {
  name: string;
  /** A manually added workout exercise; eligible for an explicit save to its routine. */
  routine_addition?: true;
  /** One-session alternatives and their completed originals never rewrite routine defaults. */
  routine_defaults_excluded?: boolean;
  exercise_substitution?: WorkoutExerciseSubstitutionMarker;
  routine_exercise_id?: string;
  /** Legacy routines can lack an id; index also disambiguates repeated names. */
  routine_exercise_index?: number;
  targets_revision?: string;
  weight_unit?: WeightUnit;
  weight_unit_override?: boolean;
  notes?: string;
  gif_url?: string;
  images?: string[];
  /** Library identity is separate from this workout's routine exercise identity. */
  library_id?: string;
  target_sets: number;
  target_reps: number;
  target_weight_kg?: number | null;
  rest_sec?: number;
  /** AI adjustment vs previous session. */
  change?: SessionChange;
  /** Short AI reason for the adjustment. */
  ai_note?: string;
  /** Human summary of what the user did last session, e.g. "3×10 @ 40kg". */
  last_summary?: string;
  sets: SessionSet[];
}

export interface WorkoutSession {
  id: string;
  routine_id: string;
  routine_name: string;
  day_id?: string;
  day_name?: string;
  date: string; // YYYY-MM-DD
  status: 'active' | 'completed';
  ai_insight?: string;
  exercises: SessionExercise[];
  /** Applied manual addition IDs; true records a permanent save even after removal. */
  exercise_additions?: Record<string, boolean>;
  exercise_substitutions?: Record<string, WorkoutExerciseSubstitutionRecord>;
  total_volume_kg?: number;
  duration_min?: number;
  /** Exact wall-clock duration from recorded start to completion. */
  duration_sec?: number;
  notes?: string;
  started_at?: unknown;
  completed_at?: unknown;
  updated_at?: unknown;
  /** Original routine before this active draft first supplied working defaults. */
  routine_defaults_before?: Routine;
  routine_defaults_written_at?: unknown;
}

/** Explicit edits may correct historical workouts without changing their status. */
export interface WorkoutSessionEdit {
  routine_name: string;
  day_name?: string;
  date: string;
  notes?: string;
  exercises: SessionExercise[];
  started_at: number | null;
  completed_at: number | null;
}

/** Response shape of the plan_workout_session cloud function. */
export interface SessionPlan {
  insight: string;
  exercises: {
    name: string;
    sets: number;
    reps: number;
    weight_kg?: number | null;
    change?: SessionChange;
    note?: string;
  }[];
}

/** Response shape of the generate_routine cloud function. */
export interface GeneratedRoutine {
  name: string;
  description?: string;
  exercises: (LoadConvention & {
    name: string;
    muscle_group?: string;
    sets: number;
    reps: number;
    weight_kg?: number | null;
    rest_sec?: number;
    notes?: string;
  })[];
}
