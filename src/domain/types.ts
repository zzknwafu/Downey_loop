export type LayerName = "query" | "retrieval" | "rerank" | "answer" | "overall";

export type MetricType = "binary" | "continuous" | "categorical";
export type EvaluatorFamily = "model" | "code";
export type CodeEvaluatorStrategy =
  | "exact_match"
  | "regex_match"
  | "fuzzy_match"
  | "python_script";
export type DatasetType = "ideal_output" | "workflow" | "trace_monitor";
export type TargetType = "prompt" | "agent";
export type DomainType = "food_delivery" | "grocery";
export type TaskType = "ai_search" | "recommendation" | "fulfillment_qa" | "aftersales";
export type ExperimentStatus = "CREATED" | "RUNNING" | "FINISHED" | "FAILED";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type CaseResultStatus = "success" | "invalid_judgment" | "runtime_error";
export type DatasetColumnType = "String" | "Number" | "Boolean" | "JSON";

export interface RetrievalCandidate {
  id: string;
  title: string;
  score?: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface QueryConstraints {
  budgetMax?: number;
  maxDistanceKm?: number;
  inStockOnly?: boolean;
  deliveryWithinMinutes?: number;
  dietary?: string[];
  flavor?: string[];
  category?: string[];
}

export interface BusinessOutcomeLabels {
  wouldClick?: boolean;
  wouldConvert?: boolean;
  dwellLevel?: "low" | "medium" | "high";
  trustRisk?: "low" | "medium" | "high";
}

export interface EvalCase {
  caseId: string;
  domain: DomainType;
  taskType: TaskType;
  userQuery: string;
  queryConstraints?: QueryConstraints;
  retrievalCandidates: RetrievalCandidate[];
  expectedRetrievalIds: string[];
  acceptableRetrievalIds: string[];
  expectedTopItems: string[];
  answerReference: string;
  businessOutcomeLabels?: BusinessOutcomeLabels;
}

export interface DatasetColumn {
  name: string;
  dataType: DatasetColumnType;
  required: boolean;
  description: string;
}

export interface IdealOutputDatasetCaseValue {
  caseId: string;
  input: string;
  referenceOutput: string;
  context: Record<string, unknown>;
}

export interface WorkflowDatasetCaseValue {
  caseId: string;
  input: string;
  workflowOutput: Record<string, unknown>;
  expectedSteps: string[];
  context?: Record<string, unknown>;
}

export interface TraceMonitorDatasetCaseValue {
  caseId: string;
  traceId: string;
  finalOutput: string;
  trajectory: Array<Record<string, unknown>>;
  context?: Record<string, unknown>;
}

export type EditableDatasetCase =
  | IdealOutputDatasetCaseValue
  | WorkflowDatasetCaseValue
  | TraceMonitorDatasetCaseValue;

export interface Dataset<TCase = EvalCase> {
  id: string;
  name: string;
  description: string;
  datasetType: DatasetType;
  schema: DatasetColumn[];
  cases: TCase[];
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface LayerTrace {
  layer: Exclude<LayerName, "overall">;
  latencyMs: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  model?: string;
}

export interface PromptVersion {
  id: string;
  name: string;
  version: string;
  description?: string;
  systemPrompt: string;
  userTemplate: string;
  inputSchema?: Record<string, unknown>;
}

export interface AgentVersion {
  id: string;
  name: string;
  version: string;
  description?: string;
  queryProcessor: string;
  retriever: string;
  reranker: string;
  answerer: string;
}

export type SearchPipelineVersion = AgentVersion;
export type EvalTarget = PromptVersion | AgentVersion;

export interface TargetRef {
  id: string;
  type: TargetType;
  version: string;
}

export interface ExperimentTargetSelection {
  id: string;
  type: TargetType;
  version: string;
  label: string;
}

export interface MetricDefinition {
  name: string;
  layer: LayerName;
  metricType: MetricType;
  evaluatorFamily: EvaluatorFamily;
  codeStrategy?: CodeEvaluatorStrategy;
  description: string;
}

export interface Evaluator {
  id: string;
  evaluatorKey: string;
  name: string;
  layer: LayerName;
  family: EvaluatorFamily;
  metricType: MetricType;
  version: string;
  previousVersionId?: string;
  changeSummary?: string;
  description: string;
  config: Record<string, unknown>;
  codeStrategy?: CodeEvaluatorStrategy;
}

export interface MetricResult {
  metricName: string;
  layer: LayerName;
  metricType: MetricType;
  score: number | string;
  status: CaseResultStatus;
  reason: string;
  evidence?: string[];
  evaluatorId?: string;
}

export interface TraceRun {
  traceId: string;
  caseId: string;
  retrievalTrace: LayerTrace;
  rerankTrace: LayerTrace;
  answerTrace: LayerTrace;
  layerMetrics?: Record<string, MetricResult>;
  error?: string | null;
}

export interface LayerRun {
  caseId: string;
  layer: LayerName;
  outputs: Record<string, unknown>;
}

export interface CaseResult {
  caseId: string;
  output: string;
  scores: MetricResult[];
  traceId: string;
  status: CaseResultStatus;
}

export interface ExperimentCaseRun extends CaseResult {
  targetId: string;
  trace: TraceRun;
  layerRuns: LayerRun[];
  layerMetrics: MetricResult[];
}

export interface ExperimentRunSummary {
  totalCases: number;
  completedCases: number;
  failedCases: number;
  invalidJudgmentCount: number;
  averageMetrics: Record<string, number>;
  metricSummaries: ExperimentMetricSummary[];
  layerSummaries: ExperimentLayerSummary[];
}

export interface ExperimentMetricSummary {
  metricName: string;
  layer: LayerName;
  averageScore?: number;
  successCount: number;
  invalidJudgmentCount: number;
  runtimeErrorCount: number;
}

export interface ExperimentLayerSummary {
  layer: LayerName;
  evaluatorCount: number;
  metricCount: number;
  averageScore?: number;
  successCount: number;
  invalidJudgmentCount: number;
  runtimeErrorCount: number;
}

export interface ExperimentFieldMapping {
  sourceField: string;
  targetField: string;
  sourceType?: DatasetColumnType | "runtime";
  targetType?: DatasetColumnType | "runtime";
}

export interface ExperimentEvaluatorBinding {
  evaluatorId: string;
  evaluatorVersion: string;
  evaluatorName: string;
  layer: LayerName;
  weight: number;
  fieldMappings: ExperimentFieldMapping[];
}

export interface ExperimentEvaluatorSet {
  evaluatorIds: string[];
  bindings: ExperimentEvaluatorBinding[];
}

export interface ExperimentRunConfig {
  sampleCount: number;
  timeoutMs: number;
  retryLimit: number;
  concurrency: number;
}

export interface PromptModelConfig {
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface ExperimentPromptBinding {
  promptId: string;
  promptVersion: string;
  variableMappings: ExperimentFieldMapping[];
  modelConfig: PromptModelConfig;
}

export interface ExperimentBasicInfo {
  target: {
    id: string;
    type: TargetType;
    version: string;
    label: string;
  };
  dataset: {
    id: string;
    name: string;
    version: string;
    datasetType: DatasetType;
  };
  evaluatorCount: number;
  status: ExperimentStatus;
  totalCases: number;
  completedCases: number;
  failedCases: number;
  invalidJudgmentCount: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface ExperimentConfigurationSnapshot {
  target: {
    id: string;
    type: TargetType;
    version: string;
    label: string;
  };
  dataset: {
    id: string;
    name: string;
    version: string;
    datasetType: DatasetType;
    columns: DatasetColumn[];
    fieldMappings: ExperimentFieldMapping[];
  };
  promptBinding?: ExperimentPromptBinding;
  evaluators: ExperimentEvaluatorBinding[];
  runConfig: ExperimentRunConfig;
}

export interface ExperimentRun {
  experimentId: string;
  datasetId?: string;
  evaluatorIds?: string[];
  evaluatorSet?: ExperimentEvaluatorSet;
  targetRef?: TargetRef;
  targetSelection?: ExperimentTargetSelection;
  pipelineVersionId?: string;
  target: SearchPipelineVersion;
  status: ExperimentStatus;
  startedAt?: string;
  finishedAt?: string;
  summary: ExperimentRunSummary;
  basicInfo?: ExperimentBasicInfo;
  configuration?: ExperimentConfigurationSnapshot;
  caseRuns: ExperimentCaseRun[];
}

export interface ExperimentRunJob {
  jobId: string;
  experimentId: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  caseJobs: CaseRunJob[];
}

export interface CaseRunJob {
  jobId: string;
  experimentId: string;
  caseId: string;
  status: JobStatus;
  error?: string;
}

export interface MetricDelta {
  metricName: string;
  layer: LayerName;
  baselineValue: number;
  candidateValue: number;
  delta: number;
}

export interface AttributionRecord {
  targetMetric: string;
  candidateDriver: string;
  layer: LayerName;
  delta: number;
  confidence: number;
  evidenceCaseIds: string[];
}

export type LayerHealthStatus = "healthy" | "warning" | "regressed";

export interface LayerInsight {
  layer: Exclude<LayerName, "query">;
  status: LayerHealthStatus;
  averageDelta: number;
  strongestNegativeMetric?: string;
  strongestPositiveMetric?: string;
  evidenceCaseIds: string[];
}

export interface ExperimentComparison {
  headline: string;
  baselineExperimentId: string;
  candidateExperimentId: string;
  overallDeltas: MetricDelta[];
  layerDeltas: MetricDelta[];
  layerInsights: LayerInsight[];
  driverPositive: string[];
  driverNegative: string[];
  confidence: number;
  rootCauseSummary: string[];
  evidenceCaseIds: string[];
  attributionRecords: AttributionRecord[];
}

export interface PipelineExecutionResult {
  retrievalResult: RetrievalCandidate[];
  rerankResult: RetrievalCandidate[];
  answerOutput: string;
  supportingEvidence?: string[];
  debugInfo?: Record<string, unknown>;
  latencyMs?: {
    retrieval: number;
    rerank: number;
    answer: number;
  };
}

export interface StartExperimentInput {
  dataset: Dataset;
  target: EvalTarget;
  evaluators: Evaluator[];
  executionTarget?: SearchPipelineVersion;
  targetSelection?: ExperimentTargetSelection;
  promptBinding?: Partial<Pick<ExperimentPromptBinding, "variableMappings">> & {
    modelConfig?: Partial<PromptModelConfig>;
  };
  runConfig?: Partial<ExperimentRunConfig>;
}

export interface LocalStoreSnapshot {
  datasets: Dataset[];
  evaluators: Evaluator[];
  prompts: PromptVersion[];
  agents: AgentVersion[];
  experiments: ExperimentRun[];
  comparisons: ExperimentComparison[];
  traces: TraceRun[];
}

export interface ApiContract {
  listDatasets(): Promise<Dataset[]>;
  listEvaluators(): Promise<Evaluator[]>;
  listPrompts?(): Promise<PromptVersion[]>;
  listAgents?(): Promise<AgentVersion[]>;
  listExperiments(): Promise<ExperimentRun[]>;
  getComparison(): Promise<ExperimentComparison>;
  getTrace(traceId: string): Promise<TraceRun | undefined>;
}
