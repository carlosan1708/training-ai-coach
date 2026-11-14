import type { LoadConvention } from './routine';

export interface Measurements {
  waist_cm?: number;
  chest_cm?: number;
  hips_cm?: number;
  arms_cm?: number;
  thighs_cm?: number;
}

export interface MealItem {
  name: string;
  portion?: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}

export interface FoodLogEntry {
  meal: string;
  description: string;
  adherent: boolean;
  timestamp: string;
  // Nutrition (from photo analysis or manual entry)
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  items?: MealItem[];
  photo_url?: string;
}

/** Shape returned by the analyze_meal_photo cloud function. */
export interface MealAnalysis {
  name: string;
  items: MealItem[];
  total_calories?: number;
  total_protein_g?: number;
  total_carbs_g?: number;
  total_fat_g?: number;
  confidence?: 'low' | 'medium' | 'high';
}

export interface ExerciseLogEntry extends LoadConvention {
  /** Links mirrored workout entries so edits/deletions preserve manual entries. */
  workout_session_id?: string;
  exercise: string;
  /** Optional exercise-library identity and demonstration selected by the user. */
  library_id?: string;
  gif_url?: string;
  images?: string[];
  sets?: number;
  reps?: number;
  weight_kg?: number;
  weight_unit?: 'kg' | 'lb';
  weight_unit_override?: boolean;
  duration_min?: number;
  notes?: string;
}

export interface BodyCompositionReport {
  // Common fields (both BIA and anthropometric)
  source_app?: string;
  report_date?: string;
  weight_kg?: number;
  height_cm?: number;
  bmi?: number;
  body_fat_pct?: number;
  body_fat_kg?: number;
  lean_mass_kg?: number;

  // BIA-specific (Fitdays, InBody, Tanita, Withings, etc.)
  skeletal_muscle_kg?: number;
  skeletal_muscle_pct?: number;
  bone_mass_kg?: number;
  body_water_pct?: number;
  protein_kg?: number;
  visceral_fat_level?: number;
  body_score?: number;
  metabolic_age?: number;
  segmental_fat?: { left_arm_kg?: number; right_arm_kg?: number; left_leg_kg?: number; right_leg_kg?: number; trunk_kg?: number };
  segmental_muscle?: { left_arm_kg?: number; right_arm_kg?: number; left_leg_kg?: number; right_leg_kg?: number; trunk_kg?: number };
  bia?: { resistance_50khz?: number; reactance_50khz?: number; resistance_250khz?: number; reactance_250khz?: number };
  weight_control?: { recommended_weight_kg?: number; fat_to_lose_kg?: number; muscle_to_gain_kg?: number };

  // ISAK / Anthropometric (Holway, ISAK, skinfold-based)
  fat_method?: string;           // "Jackson/Pollock", "Yuhasz", "Holway", etc.
  bone_mass_pct?: number;
  residual_mass_kg?: number;
  residual_mass_pct?: number;
  muscle_mass_kg?: number;
  muscle_mass_pct?: number;
  sum_6_skinfolds_mm?: number;
  sum_8_skinfolds_mm?: number;
  skinfolds?: {
    triceps_mm?: number;
    subscapular_mm?: number;
    pectoral_mm?: number;
    iliac_crest_mm?: number;
    supraspinale_mm?: number;
    abdominal_mm?: number;
    medial_thigh_mm?: number;
    medial_calf_mm?: number;
    axillary_mm?: number;
  };
  girths?: {
    relaxed_arm_cm?: number;
    tensed_arm_cm?: number;
    waist_cm?: number;
    hip_cm?: number;
    calf_cm?: number;
  };
  bone_breadths?: {
    humerus_cm?: number;
    femur_cm?: number;
  };
  somatotype?: {
    endomorph?: number;
    mesomorph?: number;
    ectomorph?: number;
    dominant?: string;
  };
  arm_muscle_area_mm2?: number;

  // Storage reference for previewing the original file
  report_url?: string;
  report_storage_path?: string;

  error?: string;
}

export interface DailyLog {
  date: string;
  weight_kg?: number | null;
  body_fat_pct?: number;
  measurements: Measurements;
  body_composition_report?: BodyCompositionReport;
  energy: number; // 1–5
  notes: string;
  food_log: FoodLogEntry[];
  exercise_log: ExerciseLogEntry[];
  created_at?: unknown;
  updated_at?: unknown;
}
