export interface UserProfile {
  // Identity
  name: string;
  age?: number;
  biological_sex?: 'male' | 'female' | 'other';
  height_cm?: number;
  goal_weight_kg?: number;

  // Diet
  dietary_style: 'omnivore' | 'vegetarian' | 'vegan' | 'other';
  intolerances: string[];
  disliked_foods: string[];
  preferred_cuisines: string[];
  meals_per_day: number;
  caloric_target: number | 'auto';

  // Exercise
  training_goal: 'fat_loss' | 'muscle_gain' | 'endurance' | 'general';
  equipment: 'none' | 'home' | 'gym';
  training_days_per_week: number;
  session_length_min: number;
  movement_restrictions: string;
  /** Routine selected for Today. Null clears the explicit preference. */
  preferred_routine_id?: string | null;
  /** Unit for exercise loads, independent of body-weight measurements. */
  workout_weight_unit?: 'kg' | 'lb';

  // Health
  health_notes: string;
  units: 'metric' | 'imperial';

  // UX
  ui_language: 'en' | 'es';
  response_language: 'en' | 'es' | 'both';
  coaching_tone: 'motivational' | 'clinical' | 'friendly';

  // Meta
  onboarding_complete: boolean;
  created_at: unknown;
  updated_at: unknown;
}
