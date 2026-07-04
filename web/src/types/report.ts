export interface WeeklyReportStats {
  week_start: string;
  week_end: string;
  sessions: number;
  routines_done: string[];
  total_volume_kg: number;
  prev_volume_kg: number;
  volume_change_pct?: number | null;
  weight_start_kg?: number | null;
  weight_end_kg?: number | null;
  weight_delta_kg?: number | null;
  avg_energy?: number | null;
}

export interface WeeklyReport {
  id?: string;
  week_start: string;
  week_end: string;
  headline: string;
  summary: string;
  wins: string[];
  focus_next_week: string[];
  stats: WeeklyReportStats;
  created_at?: unknown;
}
