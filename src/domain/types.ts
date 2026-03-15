export type LayerName = "query" | "retrieval" | "rerank" | "answer" | "overall";

export type MetricType = "binary" | "continuous" | "categorical";
export type EvaluatorFamily = "model" | "code";
export type CodeEvaluatorStrategy = "exact_match" | "regex_match" | "fuzzy_match" | "python_script";

export type CaseResultStatus = "success" | "invalid_judgment" | "runtime_error";

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
  domain: "food_delivery" | "grocery";
  taskType: "ai_search" | "recommendation" | "fulfillment_qa" | "aftersales";
  userQuery: string;
  queryConstraints?: QueryConstraints;
  retrievalCandidates: RetrievalCandidate[];
  expectedRetrievalIds: string[];
  acceptableRetrievalIds: string[];
  expectedTopItems: string[];
  answerReference: string;
  businessOutcomeLabels?: BusinessOutcomeLabels;
}

export interface LayerTrace {
  layer: Exclude<LayerName, "overall">;
  latencyMs: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  model?: string;
}

export interface TraceRun {
  traceId: string;
  caseId: string;
  retrievalTrace: LayerTrace;
  rerankTrace: LayerTrace;
  answerTrace: LayerTrace;
  layerMetrics?: Record<string, MetricResult>;
}

export interface SearchPipelineVersion {
  id: string;
  name: string;
  version: string;
  queryProcessor: string;
  retriever: string;
  reranker: string;
  answerer: string;
}

export interface SearchLayerOutput {
  rewrittenQuery?: string;
  retrievalResult: RetrievalCandidate[];
  rerankResult: RetrievalCandidate[];
  answerOutput: string;
  supportingEvidence: string[];
}

export interface LayerRun {
  caseId: string;
  layer: LayerName;
  outputs: Record<string, unknown>;
}

export interface ExperimentCaseRun {
  caseId: string;
  targetId: string;
  trace: TraceRun;
  layerRuns: LayerRun[];
  layerMetrics: MetricResult[];
}

export interface ExperimentRun {
  experimentId: string;
  target: SearchPipelineVersion;
  caseRuns: ExperimentCaseRun[];
}

export interface MetricDefinition {
  name: string;
  layer: LayerName;
  metricType: MetricType;
  evaluatorFamily: EvaluatorFamily;
  codeStrategy?: CodeEvaluatorStrategy;
  description: string;
}

export interface MetricResult {
  metricName: string;
  layer: LayerName;
  metricType: MetricType;
  score: number | string;
  status: CaseResultStatus;
  reason: string;
  evidence?: string[];
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

export interface ExperimentComparison {
  baselineExperimentId: string;
  candidateExperimentId: string;
  overallDeltas: MetricDelta[];
  layerDeltas: MetricDelta[];
  rootCauseSummary: string[];
  evidenceCaseIds: string[];
  attributionRecords: AttributionRecord[];
}
