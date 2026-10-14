export interface RoutineExercise {
  name: string;
  muscle_group?: string;
  equipment?: string;
  sets: number;
  reps: number;
  weight_kg?: number | null;
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
  exercises: RoutineExercise[];
}

export interface Routine {
  id: string;
  name: string;
  description?: string;
  exercises: RoutineExercise[];
  days?: RoutineDay[];
  session_count?: number;
  last_session_at?: string; // YYYY-MM-DD
  created_at?: unknown;
  updated_at?: unknown;
}

export interface SessionSet {
  reps: number;
  weight_kg: number;
  done: boolean;
}

export type SessionChange = 'increase' | 'hold' | 'decrease';

export interface SessionExercise {
  name: string;
  gif_url?: string;
  images?: string[];
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
  total_volume_kg?: number;
  duration_min?: number;
  notes?: string;
  started_at?: unknown;
  completed_at?: unknown;
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
  exercises: {
    name: string;
    muscle_group?: string;
    sets: number;
    reps: number;
    weight_kg?: number | null;
    rest_sec?: number;
    notes?: string;
  }[];
}
