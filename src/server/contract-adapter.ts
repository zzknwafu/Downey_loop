import type {
  AbExperimentRecord,
  AgentRecord,
  AttributionRecord,
  CaseResultRecord,
  ExperimentBasicInfoRecord,
  ExperimentCaseDetailRecord,
  ExperimentConfigurationRecord,
  ExperimentDetailRecord,
  ExperimentIndicatorStatisticsRecord,
  ExperimentListItemRecord,
  ExperimentEvaluatorFieldMappingRecord,
  ExperimentExecutionState,
  PromptRecord,
  TargetSelectionRecord,
  DatasetCaseRecord,
  DatasetRecord,
  EvaluatorRecord,
  ExperimentRunRecord,
  LayerInsightRecord,
  MetricDeltaRecord,
  MetricScoreRecord,
  SearchPipelineVersionRecord,
  TraceRunRecord,
  CreateExperimentInput,
} from "../shared/contracts.js";
import type {
  EditableDatasetCase,
  Dataset,
  Evaluator,
  ExperimentConfigurationSnapshot,
  ExperimentComparison,
  ExperimentRun,
  MetricResult,
  PromptVersion,
  TraceRun,
  ExperimentEvaluatorBinding,
  ExperimentFieldMapping,
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

const mapMetric = (
  metric: MetricResult,
  evaluatorsById?: Map<string, Evaluator>,
): MetricScoreRecord => ({
  evaluator_id: metric.evaluatorId,
  evaluator_name: metric.evaluatorId ? evaluatorsById?.get(metric.evaluatorId)?.name : undefined,
  metric_name: metric.metricName,
  layer: normalizeLayer(metric.layer),
  metric_type: metric.metricType,
  score: metric.score,
  status: metric.status,
  reason: metric.reason,
  evidence: metric.evidence,
});

const findDatasetCaseRecord = (
  dataset: Dataset | undefined,
  caseId: string,
): DatasetCaseRecord | null =>
  dataset ? toDatasetRecord(dataset).cases.find((item) => item.id === caseId) ?? null : null;

const getCaseInput = (item: DatasetCaseRecord | null): string | null => {
  if (!item) {
    return null;
  }

  if ("input" in item) {
    return item.input;
  }

  return null;
};

const getCaseReferenceOutput = (item: DatasetCaseRecord | null): string | null => {
  if (!item) {
    return null;
  }

  if ("reference_output" in item) {
    return item.reference_output;
  }

  return null;
};

const buildLatencySummary = (values: number[]) => ({
  average_ms: values.length === 0 ? 0 : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
  min_ms: values.length === 0 ? 0 : Math.min(...values),
  max_ms: values.length === 0 ? 0 : Math.max(...values),
});

const buildExperimentCreator = () => "system";

const toExecutionState = (status: ExperimentRun["status"]): ExperimentExecutionState => {
  switch (status) {
    case "CREATED":
      return "queued";
    case "RUNNING":
      return "running";
    case "FINISHED":
      return "completed";
    case "FAILED":
      return "failed";
  }
};

const toCaseExecutionState = (status: MetricResult["status"]): ExperimentExecutionState =>
  status === "runtime_error" ? "failed" : "completed";

const readTraceRuntimeError = (trace: TraceRun): string | null => {
  const answerError = trace.answerTrace.outputs.error;
  if (typeof answerError === "string" && answerError.trim().length > 0) {
    return answerError;
  }

  if (typeof trace.error === "string" && trace.error.trim().length > 0) {
    return trace.error;
  }

  return null;
};

const buildCaseFailureReason = (caseRun: ExperimentRun["caseRuns"][number]): string | null => {
  const traceError = readTraceRuntimeError(caseRun.trace);
  if (traceError) {
    return traceError;
  }

  if (caseRun.status === "invalid_judgment") {
    return "Evaluator returned invalid judgment";
  }

  if (caseRun.status === "runtime_error") {
    return "Case failed during execution";
  }

  const output = String(caseRun.trace.answerTrace.outputs.answerOutput ?? "");
  if (!output.trim() && caseRun.layerMetrics.length === 0) {
    return "No model output returned";
  }

  return null;
};

const buildExperimentFailureReason = (experiment: ExperimentRun): string | null => {
  const reasons = experiment.caseRuns
    .map((caseRun) => buildCaseFailureReason(caseRun))
    .filter((reason): reason is string => Boolean(reason));

  if (reasons.length === 0) {
    return null;
  }

  return [...new Set(reasons)].slice(0, 2).join("；");
};

const buildExperimentDescription = (input: {
  experiment: ExperimentRun;
  dataset?: Dataset;
  evaluators: Evaluator[];
}) => {
  const targetLabel =
    input.experiment.configuration?.target.label ??
    input.experiment.targetSelection?.label ??
    `${input.experiment.target.name} v${input.experiment.target.version}`;
  const datasetName = input.experiment.configuration?.dataset.name ?? input.dataset?.name ?? input.experiment.datasetId ?? "dataset";
  const evaluatorCount = input.evaluators.length;
  return `Run ${targetLabel} on ${datasetName} with ${evaluatorCount} evaluator${evaluatorCount === 1 ? "" : "s"}.`;
};

const buildEvaluatorSummary = (evaluators: Evaluator[]) => {
  const grouped = new Map<ReturnType<typeof normalizeLayer>, Evaluator[]>();
  for (const evaluator of evaluators) {
    const layer = normalizeLayer(evaluator.layer);
    grouped.set(layer, [...(grouped.get(layer) ?? []), evaluator]);
  }

  return {
    total_count: evaluators.length,
    names: evaluators.map((item) => item.name),
    by_layer: [...grouped.entries()].map(([layer, layerEvaluators]) => ({
      layer,
      count: layerEvaluators.length,
      evaluator_names: layerEvaluators.map((item) => item.name),
    })),
  };
};

const buildEvaluatorSummaryFromBindings = (bindings: ExperimentEvaluatorBinding[] | undefined) => {
  const grouped = new Map<string, { count: number; names: string[] }>();
  for (const binding of bindings ?? []) {
    const current = grouped.get(binding.layer) ?? { count: 0, names: [] };
    grouped.set(binding.layer, {
      count: current.count + 1,
      names: [...current.names, binding.evaluatorName],
    });
  }

  return {
    total_count: bindings?.length ?? 0,
    names: (bindings ?? []).map((binding) => binding.evaluatorName),
    by_layer: [...grouped.entries()].map(([layer, value]) => ({
      layer: layer as ExperimentListItemRecord["evaluator_summary"]["by_layer"][number]["layer"],
      count: value.count,
      evaluator_names: value.names,
    })),
  };
};

const averageOverallScore = (experiment: ExperimentRun): number | null => {
  const overallScores = experiment.caseRuns
    .flatMap((caseRun) => caseRun.layerMetrics)
    .filter((metric) => normalizeLayer(metric.layer) === "overall" && typeof metric.score === "number")
    .map((metric) => metric.score as number);

  if (overallScores.length === 0) {
    return null;
  }

  return Number((overallScores.reduce((sum, value) => sum + value, 0) / overallScores.length).toFixed(4));
};

const mapFieldMapping = (fieldMapping: ExperimentFieldMapping) => ({
  source_field: fieldMapping.sourceField,
  target_field: fieldMapping.targetField,
  source_type: fieldMapping.sourceType,
  target_type: fieldMapping.targetType,
});

const mapContractFieldMapping = (fieldMapping: {
  source_field: string;
  target_field: string;
  source_type?: string;
  target_type?: string;
}) => ({
  source_field: fieldMapping.source_field,
  target_field: fieldMapping.target_field,
  source_type: fieldMapping.source_type,
  target_type: fieldMapping.target_type,
});

type ExperimentBindingSource =
  | CreateExperimentInput["evaluator_bindings"][number]
  | ExperimentEvaluatorBinding;

const mapExperimentBindingRecord = (
  binding: ExperimentBindingSource,
  fallbackBindings: ExperimentEvaluatorBinding[] | undefined,
  evaluators: Evaluator[],
): ExperimentEvaluatorFieldMappingRecord => {
  const evaluatorId = "evaluator_id" in binding ? binding.evaluator_id : binding.evaluatorId;
  const fallbackBinding = fallbackBindings?.find((item) => item.evaluatorId === evaluatorId);
  const evaluator = evaluators.find((item) => item.id === evaluatorId);
  const evaluatorNameValue = Reflect.get(binding as object, "evaluator_name");

  return {
    evaluator_id: evaluatorId,
    evaluator_version:
      "evaluator_version" in binding ? binding.evaluator_version : evaluator?.version ?? "",
    evaluator_name:
      typeof evaluatorNameValue === "string"
        ? evaluatorNameValue
        : fallbackBinding?.evaluatorName ?? evaluator?.name ?? "",
    layer:
      "layer" in binding
        ? normalizeLayer(binding.layer)
        : normalizeLayer(fallbackBinding?.layer ?? evaluator?.layer ?? "overall"),
    weight: binding.weight,
    field_mapping:
      "field_mapping" in binding
        ? binding.field_mapping.map(mapContractFieldMapping)
        : fallbackBinding?.fieldMappings.map(mapFieldMapping) ?? [],
  };
};

const mapConfigurationTargetSelection = (
  configuration: ExperimentConfigurationSnapshot | undefined,
  fallbackTarget: ExperimentRun["target"],
): TargetSelectionRecord =>
  configuration
    ? {
        id: configuration.target.id,
        type: configuration.target.type,
        name: fallbackTarget.name,
        version: configuration.target.version,
        label: configuration.target.label,
        scenario: configuration.target.type === "prompt" ? undefined : "ai_search",
        entry_type: configuration.target.type === "prompt" ? "prompt" : "workflow",
      }
    : toTargetSelectionRecord(fallbackTarget);

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
  version: evaluator.version,
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
  scenario?: string;
  entry_type?: string;
  artifact_ref?: string;
  composition?: AgentRecord["composition"];
  queryProcessor?: string;
  retriever?: string;
  reranker?: string;
  answerer?: string;
  query_processor?: string;
  entryType?: string;
  artifactRef?: string;
}): AgentRecord => {
  const queryProcessor = agent.queryProcessor ?? agent.query_processor ?? "";
  const retriever = agent.retriever ?? "";
  const reranker = agent.reranker ?? "";
  const answerer = agent.answerer ?? "";
  const composition =
    agent.composition ??
    (queryProcessor && retriever && reranker && answerer
      ? [
          { kind: "query_processor", ref: queryProcessor, role: "query_processor" },
          { kind: "retriever", ref: retriever, role: "retriever" },
          { kind: "reranker", ref: reranker, role: "reranker" },
          { kind: "answerer", ref: answerer, role: "answerer" },
        ]
      : undefined);

  return {
    id: agent.id,
    name: agent.name,
    version: agent.version,
    description: agent.description,
    scenario: agent.scenario ?? "ai_search",
    entry_type: (agent.entry_type ?? agent.entryType ?? "workflow") as AgentRecord["entry_type"],
    artifact_ref: agent.artifact_ref ?? agent.artifactRef ?? agent.id,
    composition,
    query_processor: queryProcessor || undefined,
    retriever: retriever || undefined,
    reranker: reranker || undefined,
    answerer: answerer || undefined,
  };
};

export const toTargetSelectionRecord = (target: {
  id: string;
  name: string;
  version: string;
}): TargetSelectionRecord => ({
  id: target.id,
  type: "agent",
  name: target.name,
  version: target.version,
  label: `${target.name} v${target.version}`,
  scenario: "ai_search",
  entry_type: "workflow",
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
  scores: caseRun.layerMetrics.map((metric) => mapMetric(metric)),
  trace_id: caseRun.trace.traceId,
  status: caseRun.status,
  execution_state: toCaseExecutionState(caseRun.status),
  message: buildCaseFailureReason(caseRun),
  runtime_error: readTraceRuntimeError(caseRun.trace),
});

const toExperimentSelectionRecord = (experiment: ExperimentRun): TargetSelectionRecord =>
  experiment.targetSelection
    ? {
        id: experiment.targetSelection.id,
        type: experiment.targetSelection.type,
        name: experiment.target.name,
        version: experiment.targetSelection.version,
        label: experiment.targetSelection.label,
        scenario: experiment.targetSelection.type === "prompt" ? undefined : "ai_search",
        entry_type: experiment.targetSelection.type === "prompt" ? "prompt" : "workflow",
      }
    : toTargetSelectionRecord(experiment.target);

const toExperimentCreator = (_experiment: ExperimentRun) => "system";

const toExperimentDescription = (experiment: ExperimentRun, dataset?: Dataset) => {
  const targetLabel = experiment.configuration?.target.label ?? toExperimentSelectionRecord(experiment).label;
  const datasetName = experiment.configuration?.dataset.name ?? dataset?.name ?? experiment.datasetId ?? "dataset";
  const evaluatorCount = experiment.configuration?.evaluators.length ?? experiment.evaluatorIds?.length ?? 0;
  return `Run ${targetLabel} on ${datasetName} with ${evaluatorCount} evaluator${evaluatorCount === 1 ? "" : "s"}.`;
};

export const toExperimentListItemRecord = (
  experiment: ExperimentRun,
  dataset?: Dataset,
  evaluators?: Evaluator[],
): ExperimentListItemRecord => ({
  id: experiment.experimentId,
  creator: toExperimentCreator(experiment),
  description: toExperimentDescription(experiment, dataset),
  dataset_id: experiment.datasetId ?? "",
  target: toExperimentSelectionRecord(experiment),
  pipeline_version: toPipelineRecord(experiment.target),
  evaluator_summary:
    experiment.configuration?.evaluators && experiment.configuration.evaluators.length > 0
      ? buildEvaluatorSummaryFromBindings(experiment.configuration.evaluators)
      : buildEvaluatorSummary(
          evaluators?.filter((item) => experiment.evaluatorIds?.includes(item.id)) ?? [],
        ),
  status: experiment.status,
  execution_state: toExecutionState(experiment.status),
  failure_reason: buildExperimentFailureReason(experiment),
  overall_score: averageOverallScore(experiment),
  case_count: experiment.summary.totalCases,
  completed_case_count: experiment.summary.completedCases,
  failed_case_count: experiment.summary.failedCases,
  invalid_judgment_count: experiment.summary.invalidJudgmentCount,
  started_at: experiment.startedAt ?? null,
  finished_at: experiment.finishedAt ?? null,
});

export const toExperimentRunRecord = (experiment: ExperimentRun): ExperimentRunRecord => ({
  id: experiment.experimentId,
  dataset_id: experiment.datasetId ?? "",
  pipeline_version: toPipelineRecord(experiment.target),
  target: toExperimentSelectionRecord(experiment),
  evaluator_ids: experiment.evaluatorIds ?? [],
  status: experiment.status,
  execution_state: toExecutionState(experiment.status),
  failure_reason: buildExperimentFailureReason(experiment),
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
  error: readTraceRuntimeError(trace),
  execution_state: readTraceRuntimeError(trace) ? "failed" : "completed",
  message: readTraceRuntimeError(trace),
  runtime_error: readTraceRuntimeError(trace),
});

const toExperimentBasicInfoRecord = (input: {
  experiment: ExperimentRun;
  dataset?: Dataset;
  evaluators: Evaluator[];
}): ExperimentBasicInfoRecord => ({
  id: input.experiment.experimentId,
  creator: buildExperimentCreator(),
  description: buildExperimentDescription(input),
  dataset_id: input.experiment.datasetId ?? "",
  target: mapConfigurationTargetSelection(input.experiment.configuration, input.experiment.target),
  pipeline_version: toPipelineRecord(input.experiment.target),
  evaluator_ids: input.experiment.evaluatorIds ?? [],
  evaluator_summary: buildEvaluatorSummary(input.evaluators),
  status: input.experiment.status,
  execution_state: toExecutionState(input.experiment.status),
  failure_reason: buildExperimentFailureReason(input.experiment),
  started_at: input.experiment.startedAt ?? null,
  finished_at: input.experiment.finishedAt ?? null,
  case_count: input.experiment.summary.totalCases,
  completed_case_count: input.experiment.summary.completedCases,
  failed_case_count: input.experiment.summary.failedCases,
  invalid_judgment_count: input.experiment.summary.invalidJudgmentCount,
  created_at: input.experiment.startedAt ?? "",
  updated_at: input.experiment.finishedAt ?? input.experiment.startedAt ?? "",
});

const toExperimentCaseDetailRecord = (input: {
  caseRun: ExperimentRun["caseRuns"][number];
  dataset?: Dataset;
  evaluatorsById: Map<string, Evaluator>;
}): ExperimentCaseDetailRecord => {
  const trace = toTraceRunRecord(input.caseRun.trace);
  const evaluationSetData = findDatasetCaseRecord(input.dataset, input.caseRun.caseId);
  const evaluatorScores = input.caseRun.layerMetrics.map((metric) =>
    mapMetric(metric, input.evaluatorsById),
  );
  const failureReason = buildCaseFailureReason(input.caseRun);
  const actualOutput = String(input.caseRun.trace.answerTrace.outputs.answerOutput ?? "");

  return {
    case_id: input.caseRun.caseId,
    input: getCaseInput(evaluationSetData),
    reference_output: getCaseReferenceOutput(evaluationSetData),
    actual_output: actualOutput.trim().length > 0 ? actualOutput : null,
    execution_state: toCaseExecutionState(input.caseRun.status),
    failure_reason: failureReason,
    trace_link: `/api/traces/${input.caseRun.trace.traceId}`,
    trace,
    trajectory: trace.trajectory,
    evaluator_scores: evaluatorScores,
    operation_metadata: {
      status: input.caseRun.status,
      execution_state: toCaseExecutionState(input.caseRun.status),
      trace_id: input.caseRun.trace.traceId,
      trace_link: `/api/traces/${input.caseRun.trace.traceId}`,
      trace_available: true,
      total_latency_ms: trace.latency.total_ms,
      message: failureReason,
      runtime_error: readTraceRuntimeError(input.caseRun.trace),
    },
    drawer: {
      evaluation_set_data: evaluationSetData,
      evaluated_object_output: {
        retrieval_result: trace.retrieval_results,
        rerank_result: trace.rerank_results,
        answer_output: trace.final_output,
      },
      trajectory: trace.trajectory,
      trace,
      evaluator_score_table: evaluatorScores,
      scoring_reasons: evaluatorScores.map((score) => ({
        metric_name: score.metric_name,
        evaluator_id: score.evaluator_id,
        evaluator_name: score.evaluator_name,
        reason: score.reason,
        evidence: score.evidence,
      })),
    },
  };
};

const toExperimentStatisticsRecord = (input: {
  experiment: ExperimentRun;
  evaluators: Evaluator[];
}): ExperimentIndicatorStatisticsRecord => {
  const evaluatorMap = new Map(input.evaluators.map((item) => [item.id, item]));
  const metrics = input.experiment.caseRuns.flatMap((caseRun) =>
    caseRun.layerMetrics.map((metric) => mapMetric(metric, evaluatorMap)),
  );

  const groupedMetrics = new Map<string, MetricScoreRecord[]>();
  for (const metric of metrics) {
    const key = [
      metric.evaluator_id ?? "unknown",
      metric.metric_name,
      metric.layer,
      metric.metric_type,
    ].join("::");
    groupedMetrics.set(key, [...(groupedMetrics.get(key) ?? []), metric]);
  }

  const evaluatorAggregatedScores = [...groupedMetrics.values()].map((entries) => {
    const numericScores = entries
      .map((entry) => entry.score)
      .filter((score): score is number => typeof score === "number");
    const buckets = new Map<string, number>();
    for (const entry of entries) {
      const bucket = String(entry.score);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }

    const first = entries[0]!;
    return {
      evaluator_id: first.evaluator_id,
      evaluator_name: first.evaluator_name,
      metric_name: first.metric_name,
      layer: first.layer,
      metric_type: first.metric_type,
      average_score:
        numericScores.length === 0
          ? null
          : Number((numericScores.reduce((sum, value) => sum + value, 0) / numericScores.length).toFixed(3)),
      score_distribution: [...buckets.entries()].map(([bucket, count]) => ({ bucket, count })),
    };
  });

  const traces = input.experiment.caseRuns.map((caseRun) => toTraceRunRecord(caseRun.trace));
  const retrievalLatencies = traces.map((trace) => trace.latency.retrieval_ms);
  const rerankLatencies = traces.map((trace) => trace.latency.rerank_ms);
  const answerLatencies = traces.map((trace) => trace.latency.answer_ms);
  const totalLatencies = traces.map((trace) => trace.latency.total_ms);

  return {
    evaluator_aggregated_scores: evaluatorAggregatedScores,
    layer_summaries: input.experiment.summary.layerSummaries.map((summary) => ({
      layer: normalizeLayer(summary.layer),
      evaluator_count: summary.evaluatorCount,
      metric_count: summary.metricCount,
      average_score: summary.averageScore ?? 0,
    })),
    latency_summary: [
      { layer: "retrieval", ...buildLatencySummary(retrievalLatencies) },
      { layer: "rerank", ...buildLatencySummary(rerankLatencies) },
      { layer: "answer", ...buildLatencySummary(answerLatencies) },
      { layer: "total", ...buildLatencySummary(totalLatencies) },
    ],
    token_cost_summary: {
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      estimated_cost_usd: null,
    },
  };
};

const toExperimentConfigurationRecord = (input: {
  experiment: ExperimentRun;
  dataset?: Dataset;
  prompt?: PromptVersion;
  evaluators: Evaluator[];
  contract?: CreateExperimentInput;
}): ExperimentConfigurationRecord => ({
  target_type: input.contract?.target_type ?? input.experiment.targetSelection?.type ?? "prompt",
  dataset_id: input.contract?.dataset_id ?? input.experiment.datasetId ?? "",
  dataset_version: input.contract?.dataset_version ?? input.dataset?.version ?? "",
  prompt_id: input.contract?.prompt_id ?? input.experiment.targetSelection?.id ?? "",
  prompt_version: input.contract?.prompt_version ?? input.prompt?.version ?? "",
  prompt_variable_mappings:
    input.contract?.prompt_variable_mappings ??
    (input.experiment.configuration?.dataset.fieldMappings ?? []).map(mapFieldMapping),
  model_params: input.contract?.model_params ?? {},
  target_info: {
    selection: mapConfigurationTargetSelection(input.experiment.configuration, input.experiment.target),
    agent_version: toAgentRecord(input.experiment.target),
    prompt_version: input.prompt ? toPromptRecord(input.prompt) : null,
  },
  dataset_info: input.dataset ? toDatasetRecord(input.dataset) : null,
  field_mappings: (input.experiment.configuration?.dataset.fieldMappings ?? []).map(mapFieldMapping),
  evaluator_list: input.evaluators.map(toEvaluatorRecord),
  evaluator_bindings: (input.contract?.evaluator_bindings ?? input.experiment.configuration?.evaluators ?? []).map(
    (binding) => mapExperimentBindingRecord(binding, input.experiment.configuration?.evaluators, input.evaluators),
  ),
  evaluator_field_mappings: (input.contract?.evaluator_bindings ?? input.experiment.configuration?.evaluators ?? []).map(
    (binding) => mapExperimentBindingRecord(binding, input.experiment.configuration?.evaluators, input.evaluators),
  ),
  weight_multipliers: Object.fromEntries(
    (input.contract?.evaluator_bindings ?? input.experiment.configuration?.evaluators ?? []).map((binding) => [
      "evaluator_id" in binding ? binding.evaluator_id : binding.evaluatorId,
      binding.weight,
    ]),
  ),
  run_config: input.contract?.run_config ?? {
    concurrency: input.experiment.configuration?.runConfig.concurrency ?? 1,
    timeout_ms: input.experiment.configuration?.runConfig.timeoutMs ?? 0,
    retry_limit: input.experiment.configuration?.runConfig.retryLimit ?? 0,
  },
});

export const toExperimentDetailRecord = (input: {
  experiment: ExperimentRun;
  dataset?: Dataset;
  prompt?: PromptVersion;
  evaluators: Evaluator[];
  comparisons?: ExperimentComparison[];
  contract?: CreateExperimentInput;
}): ExperimentDetailRecord => {
  const evaluatorsById = new Map(input.evaluators.map((item) => [item.id, item]));
  const relatedComparisons = (input.comparisons ?? []).filter(
    (comparison) =>
      comparison.baselineExperimentId === input.experiment.experimentId ||
      comparison.candidateExperimentId === input.experiment.experimentId,
  );
  const latestComparison = relatedComparisons.at(-1);

  return {
    basic_info: toExperimentBasicInfoRecord({
      experiment: input.experiment,
      dataset: input.dataset,
      evaluators: input.evaluators,
    }),
    case_results: input.experiment.caseRuns.map((caseRun) =>
      toExperimentCaseDetailRecord({
        caseRun,
        dataset: input.dataset,
        evaluatorsById,
      }),
    ),
    aggregated_metrics: toExperimentStatisticsRecord({
      experiment: input.experiment,
      evaluators: input.evaluators,
    }),
    configuration_snapshot: toExperimentConfigurationRecord({
      experiment: input.experiment,
      dataset: input.dataset,
      prompt: input.prompt,
      evaluators: input.evaluators,
      contract: input.contract,
    }),
    failure_reason_summary: buildExperimentFailureReason(input.experiment),
    root_cause: {
      latest_comparison: latestComparison ? toComparisonRecord(latestComparison) : null,
      related_comparison_ids: relatedComparisons.map(
        (comparison) => `${comparison.baselineExperimentId}:${comparison.candidateExperimentId}`,
      ),
    },
  };
};

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
