export type DatasetType = "ideal_output" | "workflow" | "trace_monitor";
export type LayerName = "retrieval" | "rerank" | "answer" | "overall";
export type MetricType = "binary" | "continuous" | "categorical";
export type EvaluatorFamily = "model" | "code";
export type CodeEvaluatorStrategy =
  | "exact_match"
  | "regex_match"
  | "fuzzy_match"
  | "python_script";

export type ExperimentStatus = "CREATED" | "RUNNING" | "FINISHED" | "FAILED";
export type CaseResultStatus = "success" | "invalid_judgment" | "runtime_error";
export type StorageDriver = "local_json";
export type DatasetColumnType = "String" | "Number" | "Boolean" | "JSON";

export interface RetrievalCandidateRecord {
  id: string;
  title: string;
  score?: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface DatasetSchemaField {
  name: string;
  data_type: DatasetColumnType;
  required: boolean;
  description: string;
}

export interface IdealOutputDatasetCase {
  id: string;
  input: string;
  reference_output: string;
  context: Record<string, unknown>;
}

export interface WorkflowDatasetCase {
  id: string;
  input: string;
  workflow_output: Record<string, unknown>;
  expected_steps: string[];
  context?: Record<string, unknown>;
}

export interface TraceMonitorDatasetCase {
  id: string;
  trace_id: string;
  final_output: string;
  trajectory: TraceStepRecord[];
  context?: Record<string, unknown>;
}

export type DatasetCaseRecord =
  | IdealOutputDatasetCase
  | WorkflowDatasetCase
  | TraceMonitorDatasetCase;

export interface DatasetRecord {
  id: string;
  name: string;
  description: string;
  dataset_type: DatasetType;
  schema: DatasetSchemaField[];
  cases: DatasetCaseRecord[];
  version: string;
  created_at: string;
  updated_at: string;
}

export interface EvaluatorRecord {
  id: string;
  name: string;
  family: EvaluatorFamily;
  layer: LayerName;
  metric_type: MetricType;
  code_strategy?: CodeEvaluatorStrategy;
  description: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SearchPipelineVersionRecord {
  id: string;
  name: string;
  version: string;
  query_processor: string;
  retriever: string;
  reranker: string;
  answerer: string;
}

export interface MetricScoreRecord {
  metric_name: string;
  layer: LayerName;
  metric_type: MetricType;
  score: number | string;
  status: CaseResultStatus;
  reason: string;
  evidence?: string[];
}

export interface CaseOutputRecord {
  retrieval_result: RetrievalCandidateRecord[];
  rerank_result: RetrievalCandidateRecord[];
  answer_output: string;
}

export interface CaseResultRecord {
  case_id: string;
  output: CaseOutputRecord;
  scores: MetricScoreRecord[];
  trace_id: string;
}

export interface ExperimentSummaryMetric {
  metric_name: string;
  layer: LayerName;
  average_score: number;
}

export interface ExperimentSummaryRecord {
  case_count: number;
  metrics: ExperimentSummaryMetric[];
}

export interface ExperimentRunRecord {
  id: string;
  dataset_id: string;
  pipeline_version: SearchPipelineVersionRecord;
  evaluator_ids: string[];
  status: ExperimentStatus;
  summary: ExperimentSummaryRecord;
  case_results: CaseResultRecord[];
  created_at: string;
  updated_at: string;
}

export interface TraceStepRecord {
  layer: "retrieval" | "rerank" | "answer";
  latency_ms: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

export interface TraceLatencyRecord {
  retrieval_ms: number;
  rerank_ms: number;
  answer_ms: number;
  total_ms: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface TraceRunRecord {
  id: string;
  case_id: string;
  retrieval_results: RetrievalCandidateRecord[];
  rerank_results: RetrievalCandidateRecord[];
  final_output: string;
  latency: TraceLatencyRecord;
  tool_calls: ToolCallRecord[];
  trajectory: TraceStepRecord[];
  error?: string | null;
}

export interface MetricDeltaRecord {
  metric_name: string;
  layer: LayerName;
  baseline_value: number;
  candidate_value: number;
  delta: number;
}

export interface AttributionRecord {
  target_metric: string;
  candidate_driver: string;
  layer: LayerName;
  delta: number;
  confidence: number;
  evidence_case_ids: string[];
}

export type LayerHealthStatus = "healthy" | "warning" | "regressed";

export interface LayerInsightRecord {
  layer: LayerName;
  status: LayerHealthStatus;
  average_delta: number;
  strongest_negative_metric?: string;
  strongest_positive_metric?: string;
  evidence_case_ids: string[];
}

export interface AbExperimentRecord {
  headline: string;
  baseline_run_id: string;
  candidate_run_id: string;
  overall_metrics: MetricDeltaRecord[];
  layer_deltas: MetricDeltaRecord[];
  layer_insights: LayerInsightRecord[];
  driver_positive: string[];
  driver_negative: string[];
  confidence: number;
  root_cause_summary: string[];
  evidence_case_ids: string[];
  attribution_records: AttributionRecord[];
}

export interface AppDataSnapshot {
  datasets: DatasetRecord[];
  evaluators: EvaluatorRecord[];
  experiments: ExperimentRunRecord[];
  traces: TraceRunRecord[];
  ab_experiment: AbExperimentRecord;
}

export interface ApiMeta {
  app_name: string;
  generated_at: string;
  storage: {
    driver: StorageDriver;
    data_dir: string;
    sqlite_path: string;
  };
}

export interface BootstrapResponse {
  meta: ApiMeta;
  data: AppDataSnapshot;
}

export interface ListResponse<T> {
  items: T[];
}

export interface ItemResponse<T> {
  item: T;
}

export interface CreateDatasetInput {
  name: string;
  description: string;
  dataset_type: DatasetType;
  schema: DatasetSchemaField[];
}

export interface CreateEvaluatorInput {
  name: string;
  family: EvaluatorFamily;
  layer: LayerName;
  metric_type: MetricType;
  code_strategy?: CodeEvaluatorStrategy;
  description: string;
  config: Record<string, unknown>;
}

export interface CreateExperimentInput {
  dataset_id: string;
  evaluator_ids?: string[];
  pipeline_version: SearchPipelineVersionRecord;
}

export interface CreateComparisonInput {
  baseline_run_id: string;
  candidate_run_id: string;
}
