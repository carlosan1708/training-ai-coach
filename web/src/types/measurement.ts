export interface MeasurementMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  raw_value?: string | number;
  raw_unit?: string;
  evidence?: string;
  confidence?: 'low' | 'medium' | 'high';
}

export interface MeasurementEntry {
  id?: string;
  measured_at: string | null;
  source_name: string;
  method: string;
  metrics: MeasurementMetric[];
  notes?: string;
  import_id?: string;
  revision?: number;
  legacy_ref?: { kind: 'manual' | 'report' | 'log_report'; id: string };
  summary?: string;
  summary_status?: string;
  source_storage_path?: string;
  source_download_url?: string;
  storage_path?: string;
  original_url?: string;
  status?: string;
  history_record_date?: string | null;
  history_record_kind?: string;
  reference_aggregation?: 'daily_median';
  reference_reading_count?: number;
  reference_source_ids?: string[];
}

export interface MeasurementJob {
  id: string;
  kind: 'summary' | 'insight';
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'stale';
  revision: number;
  error?: string;
  error_reason?: string;
}

export interface ProgressInsight {
  id?: string;
  revision: number;
  days: number;
  summary: string;
  wins: string[];
  focus: string[];
  comparisons: { key: string; label: string; start_value: number; end_value: number; delta: number; unit: string; start_date: string; end_date: string; source_name?: string; method?: string; reading_count?: number; source_ids?: string[]; aggregation?: 'daily_median' }[];
  workouts: { sessions: number; duration_min?: number; completed_sets?: number; total_volume_kg?: number; days?: number; exercise_count?: number; source_ids?: string[] };
  tracking_context?: {
    historical_sources: { source_name: string; method: string; latest_date: string | null; role: 'historical_reference'; follow_up_required: false }[];
    ongoing_sources: { source_name: string; method: string; latest_date: string | null; role: 'ongoing_tracking_option' }[];
    omitted_sources: number;
    policy: string;
  };
  status?: string;
  created_at?: unknown;
}

export interface MeasurementMemory {
  revision: number;
  status: string;
  summary: string;
  job_id?: string;
  error_reason?: string;
  entry_summaries?: { entry_id: string; summary: string; revision?: number }[];
}

export interface MeasurementWorkspaceData {
  entries: MeasurementEntry[];
  revision: number;
  memory: MeasurementMemory | null;
  factual_digest?: FactualProgressDigest;
  insights: ProgressInsight | null;
  jobs: MeasurementJob[];
  has_more?: boolean;
  warnings?: string[];
  section?: MeasurementSection;
  next_cursor?: string | null;
  order?: 'record_date_desc';
  legacy_record_order?: string;
  metric_options?: Pick<MeasurementMetric, 'key' | 'label' | 'unit'>[];
  source_options?: Pick<MeasurementEntry, 'source_name' | 'method'>[];
  reference_entries?: MeasurementEntry[];
}

export type MeasurementSection = 'summary' | 'trends' | 'history' | 'jobs' | 'references';
export interface MeasurementWorkspaceRequest {
  section: MeasurementSection;
  pageSize?: number;
  cursor?: string;
  metricKey?: string;
  metricUnit?: string;
  sourceName?: string;
  method?: string;
  days?: number;
  beforeDate?: string;
  excludeEntryId?: string;
}
export type MeasurementSectionData = Pick<MeasurementWorkspaceData, 'revision'> & Partial<Omit<MeasurementWorkspaceData, 'revision'>> & { section: MeasurementSection };

export interface FactualProgressDigest {
  kind: 'progress-facts-v1';
  narrative_version?: number;
  tracking_context?: ProgressInsight['tracking_context'];
  status: 'ready';
  summary: string;
  revision: number;
  generated_at?: unknown;
  source_fingerprint: string;
  range: { start_date: string | null; end_date: string | null; as_of: string };
  counts: { observations: number; measurement_dates: number };
  history_incomplete: boolean;
}

export interface MeasurementDraft {
  import_id: string;
  entries: MeasurementEntry[];
  warnings: string[];
  status: 'review';
}

export interface MeasurementSaveResult {
  entry_ids: string[];
  revision: number;
  job_id: string;
  status: 'pending';
}
