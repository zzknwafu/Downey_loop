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
export type ExperimentExecutionState = "queued" | "running" | "completed" | "failed";
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

export type CreateDatasetCaseInput = DatasetCaseRecord;
export type UpdateDatasetCaseInput = DatasetCaseRecord;
export interface ReplaceDatasetCasesInput {
  cases: DatasetCaseRecord[];
}
export type DatasetSynthesisSource = "dataset" | "online";
export type DatasetSynthesisDirection =
  | "generalize"
  | "augment_failures"
  | "augment_guardrails"
  | "align_online_distribution";
export type TargetType = "prompt" | "agent";
export type AgentEntryType = "prompt" | "api" | "workflow";

export interface DatasetSynthesisSuggestion {
  id: string;
  title: string;
  detail: string;
}

export interface DatasetSynthesisColumnInput {
  name: string;
  description: string;
  generation_requirement: string;
}

export interface SynthesizeDatasetInput {
  dataset_id: string;
  source: DatasetSynthesisSource;
  direction: DatasetSynthesisDirection;
  scenario_description: string;
  use_case_description: string;
  seed_source_ref: string;
  columns: DatasetSynthesisColumnInput[];
  sample_count: number;
}

export interface DatasetSynthesisResult {
  dataset_id: string;
  source: DatasetSynthesisSource;
  direction: DatasetSynthesisDirection;
  items: DatasetCaseRecord[];
  status: "draft";
  created_at: string;
}

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

export interface PromptRecord {
  id: string;
  name: string;
  version: string;
  description?: string;
  system_prompt: string;
  user_template: string;
}

export interface AgentCompositionRecord {
  kind: string;
  ref: string;
  role?: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  version: string;
  description?: string;
  scenario: string;
  entry_type: AgentEntryType;
  artifact_ref: string;
  composition?: AgentCompositionRecord[];
  query_processor?: string;
  retriever?: string;
  reranker?: string;
  answerer?: string;
}

export interface TargetRefInput {
  id: string;
  type: TargetType;
  version: string;
}

export interface TargetSelectionRecord {
  id: string;
  type: TargetType;
  name: string;
  version: string;
  label: string;
  scenario?: string;
  entry_type?: AgentEntryType;
}

export interface CreatePromptInput {
  name: string;
  description?: string;
  system_prompt: string;
  user_template: string;
}

export interface CreateAgentInput {
  name: string;
  version: string;
  description?: string;
  scenario: string;
  entry_type: AgentEntryType;
  artifact_ref: string;
  composition?: AgentCompositionRecord[];
  query_processor?: string;
  retriever?: string;
  reranker?: string;
  answerer?: string;
}

export interface PromptPreviewInput {
  input: string;
  variables?: Record<string, string>;
}

export interface PromptPreviewResult {
  prompt_id: string;
  input: string;
  rendered_system_prompt: string;
  rendered_user_prompt: string;
  output_preview: string;
  actual_model_output: string;
  debug_info?: Record<string, unknown>;
  created_at: string;
}

export interface EvaluatorRecord {
  id: string;
  name: string;
  version: string;
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
  evaluator_id?: string;
  evaluator_name?: string;
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
  status: CaseResultStatus;
  execution_state: ExperimentExecutionState;
  message?: string | null;
  runtime_error?: string | null;
}

export interface ExperimentSummaryMetric {
  metric_name: string;
  layer: LayerName;
  average_score: number;
}

export interface ExperimentSummaryLayer {
  layer: LayerName;
  evaluator_count: number;
  metric_count: number;
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
  target?: TargetSelectionRecord;
  evaluator_ids: string[];
  status: ExperimentStatus;
  execution_state?: ExperimentExecutionState;
  failure_reason?: string | null;
  summary: ExperimentSummaryRecord;
  case_results: CaseResultRecord[];
  created_at: string;
  updated_at: string;
}

export interface ExperimentListItemRecord {
  id: string;
  creator: string;
  description: string;
  dataset_id: string;
  target?: TargetSelectionRecord;
  pipeline_version?: SearchPipelineVersionRecord;
  evaluator_summary: ExperimentEvaluatorSummaryRecord;
  status: ExperimentStatus;
  execution_state?: ExperimentExecutionState;
  failure_reason?: string | null;
  overall_score: number | null;
  case_count: number;
  completed_case_count: number;
  failed_case_count: number;
  invalid_judgment_count: number;
  started_at: string | null;
  finished_at: string | null;
}

export interface ExperimentBasicInfoRecord {
  id: string;
  creator: string;
  description: string;
  dataset_id: string;
  target?: TargetSelectionRecord;
  pipeline_version?: SearchPipelineVersionRecord;
  evaluator_ids: string[];
  evaluator_summary: ExperimentEvaluatorSummaryRecord;
  status: ExperimentStatus;
  execution_state?: ExperimentExecutionState;
  failure_reason?: string | null;
  started_at: string | null;
  finished_at: string | null;
  case_count: number;
  completed_case_count: number;
  failed_case_count: number;
  invalid_judgment_count: number;
  created_at: string;
  updated_at: string;
}

export interface ExperimentEvaluatorLayerSummaryRecord {
  layer: LayerName;
  count: number;
  evaluator_names: string[];
}

export interface ExperimentEvaluatorSummaryRecord {
  total_count: number;
  names: string[];
  by_layer: ExperimentEvaluatorLayerSummaryRecord[];
}

export interface ExperimentOperationMetadataRecord {
  status: CaseResultStatus;
  execution_state: ExperimentExecutionState;
  trace_id: string;
  trace_link: string;
  trace_available: boolean;
  total_latency_ms: number | null;
  message?: string | null;
  runtime_error?: string | null;
}

export interface ExperimentScoreReasonRecord {
  metric_name: string;
  evaluator_id?: string;
  evaluator_name?: string;
  reason: string;
  evidence?: string[];
}

export interface ExperimentCaseDrawerRecord {
  evaluation_set_data: DatasetCaseRecord | null;
  evaluated_object_output: CaseOutputRecord;
  trajectory: TraceStepRecord[];
  trace: TraceRunRecord | null;
  evaluator_score_table: MetricScoreRecord[];
  scoring_reasons: ExperimentScoreReasonRecord[];
}

export interface ExperimentCaseDetailRecord {
  case_id: string;
  input: string | null;
  reference_output: string | null;
  actual_output: string | null;
  execution_state: ExperimentExecutionState;
  failure_reason: string | null;
  trace_link: string;
  trace: TraceRunRecord | null;
  trajectory: TraceStepRecord[];
  evaluator_scores: MetricScoreRecord[];
  operation_metadata: ExperimentOperationMetadataRecord;
  drawer: ExperimentCaseDrawerRecord;
}

export interface ExperimentMetricDistributionBucketRecord {
  bucket: string;
  count: number;
}

export interface ExperimentMetricStatisticsRecord {
  evaluator_id?: string;
  evaluator_name?: string;
  metric_name: string;
  layer: LayerName;
  metric_type: MetricType;
  average_score: number | null;
  score_distribution: ExperimentMetricDistributionBucketRecord[];
}

export interface ExperimentLatencyStatisticsRecord {
  layer: "retrieval" | "rerank" | "answer" | "total";
  average_ms: number;
  min_ms: number;
  max_ms: number;
}

export interface ExperimentTokenCostSummaryRecord {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
}

export interface ExperimentIndicatorStatisticsRecord {
  evaluator_aggregated_scores: ExperimentMetricStatisticsRecord[];
  layer_summaries: ExperimentSummaryLayer[];
  latency_summary: ExperimentLatencyStatisticsRecord[];
  token_cost_summary: ExperimentTokenCostSummaryRecord;
}

export interface ExperimentFieldMappingRecord {
  source_field: string;
  target_field: string;
  source_type?: string;
  target_type?: string;
}

export interface ExperimentPromptVariableMappingRecord extends ExperimentFieldMappingRecord {}

export interface ExperimentModelParamsRecord extends Record<string, unknown> {}

export interface ExperimentEvaluatorBindingInputRecord {
  evaluator_id: string;
  evaluator_version: string;
  field_mapping: ExperimentFieldMappingRecord[];
  weight: number;
}

export interface ExperimentEvaluatorBindingRecord extends ExperimentEvaluatorBindingInputRecord {
  evaluator_name: string;
  layer: LayerName;
}

export interface ExperimentRunConfigRecord {
  concurrency: number;
  timeout_ms: number;
  retry_limit: number;
}

export interface ExperimentEvaluatorFieldMappingRecord {
  evaluator_id: string;
  evaluator_version: string;
  evaluator_name: string;
  layer: LayerName;
  weight: number;
  field_mapping: ExperimentFieldMappingRecord[];
}

export interface ExperimentConfigurationRecord {
  target_type: TargetType;
  dataset_id: string;
  dataset_version: string;
  prompt_id: string;
  prompt_version: string;
  prompt_variable_mappings: ExperimentPromptVariableMappingRecord[];
  model_params: ExperimentModelParamsRecord;
  target_info: {
    selection: TargetSelectionRecord | null;
    agent_version: AgentRecord | null;
    prompt_version: PromptRecord | null;
  };
  dataset_info: DatasetRecord | null;
  field_mappings: ExperimentFieldMappingRecord[];
  evaluator_list: EvaluatorRecord[];
  evaluator_bindings: ExperimentEvaluatorFieldMappingRecord[];
  evaluator_field_mappings: ExperimentEvaluatorFieldMappingRecord[];
  weight_multipliers: Record<string, number>;
  run_config: ExperimentRunConfigRecord;
}

export interface ExperimentRootCauseRecord {
  latest_comparison: AbExperimentRecord | null;
  related_comparison_ids: string[];
}

export interface ExperimentDetailRecord {
  basic_info: ExperimentBasicInfoRecord;
  case_results: ExperimentCaseDetailRecord[];
  aggregated_metrics: ExperimentIndicatorStatisticsRecord;
  configuration_snapshot: ExperimentConfigurationRecord;
  failure_reason_summary?: string | null;
  root_cause: ExperimentRootCauseRecord;
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
  execution_state?: ExperimentExecutionState;
  message?: string | null;
  runtime_error?: string | null;
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
  sample_count: number;
  schema: DatasetSchemaField[];
}

export interface UpdateDatasetInput {
  name: string;
  description: string;
  dataset_type: DatasetType;
  sample_count: number;
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
  dataset_version: string;
  target_type: "prompt";
  prompt_id: string;
  prompt_version: string;
  prompt_variable_mappings: ExperimentPromptVariableMappingRecord[];
  model_params: ExperimentModelParamsRecord;
  evaluator_bindings: ExperimentEvaluatorBindingInputRecord[];
  run_config: ExperimentRunConfigRecord;
}

export interface CreateComparisonInput {
  baseline_run_id: string;
  candidate_run_id: string;
}
