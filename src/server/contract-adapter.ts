import type {
  AgentRecord,
  AttributionRecord,
  CaseResultRecord,
  PromptRecord,
  DatasetCaseRecord,
  DatasetRecord,
  EvaluatorRecord,
  ExperimentRunRecord,
  LayerInsightRecord,
  MetricDeltaRecord,
  MetricScoreRecord,
  SearchPipelineVersionRecord,
  TraceRunRecord,
} from "../shared/contracts.js";
import type {
  EditableDatasetCase,
  Dataset,
  Evaluator,
  ExperimentComparison,
  ExperimentRun,
  MetricResult,
  TraceRun,
} from "../domain/types.js";

const normalizeLayer = (layer: string) =>
  (layer === "query" ? "retrieval" : layer) as "retrieval" | "rerank" | "answer" | "overall";

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (value: object, key: string): string | undefined => {
  const field = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
};

const readStringArray = (value: object, key: string): string[] | undefined => {
  const field = Reflect.get(value, key);
  return Array.isArray(field) && field.every((item) => typeof item === "string") ? field : undefined;
};

const readObject = (value: object, key: string): Record<string, unknown> | undefined => {
  const field = Reflect.get(value, key);
  return isObject(field) ? field : undefined;
};

const readArray = (value: object, key: string): unknown[] | undefined => {
  const field = Reflect.get(value, key);
  return Array.isArray(field) ? field : undefined;
};

const ensureField = (value: string | undefined, fieldName: string): string => {
  if (!value) {
    throw new Error(`Missing dataset case field: ${fieldName}`);
  }

  return value;
};

const toIdealOutputContext = (item: object): Record<string, unknown> => {
  const explicitContext = readObject(item, "context");
  if (explicitContext) {
    return explicitContext;
  }

  return {
    domain: readString(item, "domain") ?? null,
    task_type: readString(item, "taskType") ?? null,
    query_constraints: readObject(item, "queryConstraints") ?? null,
    retrieval_candidates: readArray(item, "retrievalCandidates") ?? [],
    expected_retrieval_ids: readStringArray(item, "expectedRetrievalIds") ?? [],
    acceptable_retrieval_ids: readStringArray(item, "acceptableRetrievalIds") ?? [],
    expected_top_items: readStringArray(item, "expectedTopItems") ?? [],
    business_labels: readObject(item, "businessOutcomeLabels") ?? null,
  };
};

const isIdealOutputDatasetCaseRecord = (
  value: DatasetCaseRecord,
): value is Extract<DatasetCaseRecord, { reference_output: string }> => "reference_output" in value;

const isWorkflowDatasetCaseRecord = (
  value: DatasetCaseRecord,
): value is Extract<DatasetCaseRecord, { workflow_output: Record<string, unknown> }> =>
  "workflow_output" in value;

const isTraceMonitorDatasetCaseRecord = (
  value: DatasetCaseRecord,
): value is Extract<DatasetCaseRecord, { trace_id: string }> => "trace_id" in value;

const mapMetric = (metric: MetricResult): MetricScoreRecord => ({
  metric_name: metric.metricName,
  layer: normalizeLayer(metric.layer),
  metric_type: metric.metricType,
  score: metric.score,
  status: metric.status,
  reason: metric.reason,
  evidence: metric.evidence,
});

export const toDatasetRecord = (dataset: Dataset): DatasetRecord => ({
  id: dataset.id,
  name: dataset.name,
  description: dataset.description,
  dataset_type: dataset.datasetType,
  schema: dataset.schema.map((column) => ({
    name: column.name,
    data_type: column.dataType,
    required: column.required,
    description: column.description,
  })),
  cases: dataset.cases.map((item) => toDatasetCaseRecord(item, dataset.datasetType)),
  version: dataset.version,
  created_at: dataset.createdAt,
  updated_at: dataset.updatedAt,
});

export const toDatasetCaseRecord = (
  item: Dataset["cases"][number] | EditableDatasetCase,
  datasetType: Dataset["datasetType"],
): DatasetCaseRecord => {
  const source = item as object;
  const id = ensureField(readString(source, "caseId") ?? readString(source, "id"), "id");

  switch (datasetType) {
    case "ideal_output":
      return {
        id,
        input: ensureField(readString(source, "userQuery") ?? readString(source, "input"), "input"),
        reference_output: ensureField(
          readString(source, "answerReference") ?? readString(source, "referenceOutput"),
          "reference_output",
        ),
        context: toIdealOutputContext(source),
      };
    case "workflow":
      return {
        id,
        input: ensureField(readString(source, "input"), "input"),
        workflow_output: readObject(source, "workflowOutput") ?? readObject(source, "workflow_output") ?? {},
        expected_steps:
          readStringArray(source, "expectedSteps") ?? readStringArray(source, "expected_steps") ?? [],
        context: readObject(source, "context"),
      };
    case "trace_monitor":
      return {
        id,
        trace_id: ensureField(readString(source, "traceId") ?? readString(source, "trace_id"), "trace_id"),
        final_output: ensureField(
          readString(source, "finalOutput") ?? readString(source, "final_output"),
          "final_output",
        ),
        trajectory: (readArray(source, "trajectory") ?? []) as Extract<
          DatasetCaseRecord,
          { trace_id: string }
        >["trajectory"],
        context: readObject(source, "context"),
      };
  }
};

export const toEditableDatasetCase = (
  next: DatasetCaseRecord,
  datasetType: Dataset["datasetType"],
): EditableDatasetCase => {
  switch (datasetType) {
    case "ideal_output":
      if (!isIdealOutputDatasetCaseRecord(next)) {
        throw new Error("Invalid ideal output dataset case payload");
      }

      return {
        caseId: next.id,
        input: next.input,
        referenceOutput: next.reference_output,
        context: next.context,
      };
    case "workflow":
      if (!isWorkflowDatasetCaseRecord(next)) {
        throw new Error("Invalid workflow dataset case payload");
      }

      return {
        caseId: next.id,
        input: next.input,
        workflowOutput: next.workflow_output,
        expectedSteps: next.expected_steps,
        context: next.context,
      };
    case "trace_monitor":
      if (!isTraceMonitorDatasetCaseRecord(next)) {
        throw new Error("Invalid trace monitor dataset case payload");
      }

      return {
        caseId: next.id,
        traceId: next.trace_id,
        finalOutput: next.final_output,
        trajectory: next.trajectory as unknown as Array<Record<string, unknown>>,
        context: next.context,
      };
  }
};

export const toEvaluatorRecord = (evaluator: Evaluator): EvaluatorRecord => ({
  id: evaluator.id,
  name: evaluator.name,
  family: evaluator.family,
  layer: normalizeLayer(evaluator.layer),
  metric_type: evaluator.metricType,
  code_strategy: evaluator.codeStrategy,
  description: evaluator.description,
  config: evaluator.config,
  created_at: evaluator.version,
  updated_at: evaluator.version,
});

export const toPromptRecord = (prompt: {
  id: string;
  name: string;
  version: string;
  description?: string;
  systemPrompt: string;
  userTemplate: string;
}): PromptRecord => ({
  id: prompt.id,
  name: prompt.name,
  version: prompt.version,
  description: prompt.description,
  system_prompt: prompt.systemPrompt,
  user_template: prompt.userTemplate,
});

export const toAgentRecord = (agent: {
  id: string;
  name: string;
  version: string;
  description?: string;
  queryProcessor: string;
  retriever: string;
  reranker: string;
  answerer: string;
}): AgentRecord => ({
  id: agent.id,
  name: agent.name,
  version: agent.version,
  description: agent.description,
  query_processor: agent.queryProcessor,
  retriever: agent.retriever,
  reranker: agent.reranker,
  answerer: agent.answerer,
});

const toPipelineRecord = (target: ExperimentRun["target"]): SearchPipelineVersionRecord => ({
  id: target.id,
  name: target.name,
  version: target.version,
  query_processor: target.queryProcessor,
  retriever: target.retriever,
  reranker: target.reranker,
  answerer: target.answerer,
});

const toCaseResultRecord = (caseRun: ExperimentRun["caseRuns"][number]): CaseResultRecord => ({
  case_id: caseRun.caseId,
  output: {
    retrieval_result: caseRun.trace.retrievalTrace.outputs.retrievalResult as CaseResultRecord["output"]["retrieval_result"],
    rerank_result: caseRun.trace.rerankTrace.outputs.rerankResult as CaseResultRecord["output"]["rerank_result"],
    answer_output: String(caseRun.trace.answerTrace.outputs.answerOutput ?? ""),
  },
  scores: caseRun.layerMetrics.map(mapMetric),
  trace_id: caseRun.trace.traceId,
});

export const toExperimentRunRecord = (experiment: ExperimentRun): ExperimentRunRecord => ({
  id: experiment.experimentId,
  dataset_id: experiment.datasetId ?? "",
  pipeline_version: toPipelineRecord(experiment.target),
  evaluator_ids: experiment.evaluatorIds ?? [],
  status: experiment.status,
  summary: {
    case_count: experiment.summary.totalCases,
    metrics: Object.entries(experiment.summary.averageMetrics).map(([key, average]) => {
      const [layer, metricName] = key.split(":");
      return {
        metric_name: metricName ?? key,
        layer: normalizeLayer(layer),
        average_score: average,
      };
    }),
  },
  case_results: experiment.caseRuns.map(toCaseResultRecord),
  created_at: experiment.startedAt ?? "",
  updated_at: experiment.finishedAt ?? experiment.startedAt ?? "",
});

export const toTraceRunRecord = (trace: TraceRun): TraceRunRecord => ({
  id: trace.traceId,
  case_id: trace.caseId,
  retrieval_results: trace.retrievalTrace.outputs.retrievalResult as TraceRunRecord["retrieval_results"],
  rerank_results: trace.rerankTrace.outputs.rerankResult as TraceRunRecord["rerank_results"],
  final_output: String(trace.answerTrace.outputs.answerOutput ?? ""),
  latency: {
    retrieval_ms: trace.retrievalTrace.latencyMs,
    rerank_ms: trace.rerankTrace.latencyMs,
    answer_ms: trace.answerTrace.latencyMs,
    total_ms:
      trace.retrievalTrace.latencyMs + trace.rerankTrace.latencyMs + trace.answerTrace.latencyMs,
  },
  tool_calls: [],
  trajectory: [
    {
      layer: "retrieval",
      latency_ms: trace.retrievalTrace.latencyMs,
      inputs: trace.retrievalTrace.inputs,
      outputs: trace.retrievalTrace.outputs,
    },
    {
      layer: "rerank",
      latency_ms: trace.rerankTrace.latencyMs,
      inputs: trace.rerankTrace.inputs,
      outputs: trace.rerankTrace.outputs,
    },
    {
      layer: "answer",
      latency_ms: trace.answerTrace.latencyMs,
      inputs: trace.answerTrace.inputs,
      outputs: trace.answerTrace.outputs,
    },
  ],
  error: null,
});

const toMetricDeltaRecord = (delta: ExperimentComparison["overallDeltas"][number]): MetricDeltaRecord => ({
  metric_name: delta.metricName,
  layer: normalizeLayer(delta.layer),
  baseline_value: delta.baselineValue,
  candidate_value: delta.candidateValue,
  delta: delta.delta,
});

const toAttributionRecord = (
  attribution: ExperimentComparison["attributionRecords"][number],
): AttributionRecord => ({
  target_metric: attribution.targetMetric,
  candidate_driver: attribution.candidateDriver,
  layer: normalizeLayer(attribution.layer),
  delta: attribution.delta,
  confidence: attribution.confidence,
  evidence_case_ids: attribution.evidenceCaseIds,
});

const toLayerInsightRecord = (
  insight: ExperimentComparison["layerInsights"][number],
): LayerInsightRecord => ({
  layer: normalizeLayer(insight.layer),
  status: insight.status,
  average_delta: insight.averageDelta,
  strongest_negative_metric: insight.strongestNegativeMetric,
  strongest_positive_metric: insight.strongestPositiveMetric,
  evidence_case_ids: insight.evidenceCaseIds,
});

export const toComparisonRecord = (comparison: ExperimentComparison) => ({
  headline: comparison.headline,
  baseline_run_id: comparison.baselineExperimentId,
  candidate_run_id: comparison.candidateExperimentId,
  overall_metrics: comparison.overallDeltas.map(toMetricDeltaRecord),
  layer_deltas: comparison.layerDeltas.map(toMetricDeltaRecord),
  layer_insights: comparison.layerInsights.map(toLayerInsightRecord),
  driver_positive: comparison.driverPositive,
  driver_negative: comparison.driverNegative,
  confidence: comparison.confidence,
  root_cause_summary: comparison.rootCauseSummary,
  evidence_case_ids: comparison.evidenceCaseIds,
  attribution_records: comparison.attributionRecords.map(toAttributionRecord),
});
