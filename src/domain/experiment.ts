import {
  EvalTarget,
  ExperimentBasicInfo,
  EvalCase,
  ExperimentConfigurationSnapshot,
  ExperimentCaseRun,
  ExperimentEvaluatorBinding,
  ExperimentEvaluatorSet,
  ExperimentFieldMapping,
  ExperimentLayerSummary,
  ExperimentMetricSummary,
  ExperimentPromptBinding,
  ExperimentRun,
  ExperimentRunConfig,
  ExperimentRunSummary,
  MetricResult,
  Dataset,
  Evaluator,
  PipelineExecutionResult,
  PromptModelConfig,
  SearchPipelineVersion,
} from "./types.js";
import { builtInEvaluators, evaluateSearchCase } from "./evaluators.js";
import { isPromptVersion, toTargetRef, toTargetSelection } from "./targets.js";

export const DEFAULT_EXPERIMENT_RUN_CONFIG: ExperimentRunConfig = {
  sampleCount: 10,
  timeoutMs: 30_000,
  retryLimit: 1,
  concurrency: 4,
};

export const DEFAULT_PROMPT_MODEL_CONFIG: PromptModelConfig = {
  model: "gemini-2.5-flash",
  temperature: 0.2,
  topP: 1,
  maxTokens: 1024,
};

const buildDatasetFieldMappings = (dataset: Dataset): ExperimentFieldMapping[] => {
  const sharedMappings = dataset.schema.map((column) => ({
    sourceField: column.name,
    targetField: column.name,
    sourceType: column.dataType,
    targetType: column.dataType,
  }));

  if (dataset.datasetType === "ideal_output") {
    return [
      {
        sourceField: "input",
        targetField: "target_input",
        sourceType: "String",
        targetType: "runtime",
      },
      ...sharedMappings,
    ];
  }

  if (dataset.datasetType === "workflow") {
    return [
      {
        sourceField: "input",
        targetField: "workflow_input",
        sourceType: "String",
        targetType: "runtime",
      },
      ...sharedMappings,
    ];
  }

  return [
    {
      sourceField: "trace_id",
      targetField: "trace_lookup",
      sourceType: "String",
      targetType: "runtime",
    },
    ...sharedMappings,
  ];
};

const buildEvaluatorFieldMappings = (dataset: Dataset): ExperimentFieldMapping[] => {
  const mappings: ExperimentFieldMapping[] = [];
  const hasInput = dataset.schema.some((column) => column.name === "input");
  const hasReferenceOutput = dataset.schema.some((column) => column.name === "reference_output");

  if (hasInput) {
    mappings.push({
      sourceField: "input",
      targetField: "evaluator_input",
      sourceType: "String",
      targetType: "runtime",
    });
  }

  mappings.push({
    sourceField: "actual_output",
    targetField: "evaluator_output",
    sourceType: "runtime",
    targetType: "runtime",
  });

  if (hasReferenceOutput) {
    mappings.push({
      sourceField: "reference_output",
      targetField: "evaluator_reference_output",
      sourceType: "String",
      targetType: "runtime",
    });
  }

  return mappings;
};

export const buildExperimentEvaluatorBindings = (
  dataset: Dataset,
  evaluators: Evaluator[],
): ExperimentEvaluatorBinding[] => {
  if (evaluators.length === 0) {
    throw new Error("Experiment requires at least one evaluator");
  }

  const fieldMappings = buildEvaluatorFieldMappings(dataset);
  return evaluators.map((evaluator) => ({
    evaluatorId: evaluator.id,
    evaluatorVersion: evaluator.version,
    evaluatorName: evaluator.name,
    layer: evaluator.layer,
    weight: 1,
    fieldMappings,
  }));
};

export const buildExperimentEvaluatorSet = (
  dataset: Dataset,
  evaluators: Evaluator[],
): ExperimentEvaluatorSet => ({
  evaluatorIds: evaluators.map((evaluator) => evaluator.id),
  bindings: buildExperimentEvaluatorBindings(dataset, evaluators),
});

export const resolveExperimentRunConfig = (
  dataset: Dataset,
  runConfig?: Partial<ExperimentRunConfig>,
): ExperimentRunConfig => ({
  ...DEFAULT_EXPERIMENT_RUN_CONFIG,
  ...runConfig,
  sampleCount: runConfig?.sampleCount ?? dataset.cases.length,
});

export const buildPromptVariableMappings = (
  dataset: Dataset,
  target: EvalTarget,
): ExperimentFieldMapping[] => {
  if (!isPromptVersion(target)) {
    return [];
  }

  const datasetColumns = new Set(dataset.schema.map((column) => column.name));
  const mappings: ExperimentFieldMapping[] = [];

  if (datasetColumns.has("input")) {
    mappings.push({
      sourceField: "input",
      targetField: "input",
      sourceType: "String",
      targetType: "runtime",
    });
  }

  const schemaKeys = Object.keys(target.inputSchema ?? {});
  for (const schemaKey of schemaKeys) {
    if (schemaKey === "input") {
      continue;
    }

    if (datasetColumns.has(schemaKey)) {
      mappings.push({
        sourceField: schemaKey,
        targetField: schemaKey,
        sourceType: dataset.schema.find((column) => column.name === schemaKey)?.dataType,
        targetType: "runtime",
      });
    }
  }

  return mappings;
};

export const resolveExperimentPromptBinding = ({
  dataset,
  target,
  promptBinding,
}: {
  dataset: Dataset;
  target: EvalTarget;
  promptBinding?: {
    variableMappings?: ExperimentFieldMapping[];
    modelConfig?: Partial<PromptModelConfig>;
  };
}): ExperimentPromptBinding | undefined => {
  if (!isPromptVersion(target)) {
    return undefined;
  }

  return {
    promptId: target.id,
    promptVersion: target.version,
    variableMappings: promptBinding?.variableMappings ?? buildPromptVariableMappings(dataset, target),
    modelConfig: {
      ...DEFAULT_PROMPT_MODEL_CONFIG,
      ...promptBinding?.modelConfig,
      model: promptBinding?.modelConfig?.model ?? DEFAULT_PROMPT_MODEL_CONFIG.model,
    },
  };
};

export const buildExperimentConfigurationSnapshot = ({
  dataset,
  target,
  evaluators,
  promptBinding,
  runConfig,
}: {
  dataset: Dataset;
  target: EvalTarget;
  evaluators: Evaluator[];
  promptBinding?: {
    variableMappings?: ExperimentFieldMapping[];
    modelConfig?: Partial<PromptModelConfig>;
  };
  runConfig?: Partial<ExperimentRunConfig>;
}): ExperimentConfigurationSnapshot => {
  const selection = toTargetSelection(target);
  const resolvedRunConfig = resolveExperimentRunConfig(dataset, runConfig);
  const resolvedPromptBinding = resolveExperimentPromptBinding({
    dataset,
    target,
    promptBinding,
  });

  return {
    target: {
      id: selection.id,
      type: selection.type,
      version: selection.version,
      label: selection.label,
    },
    dataset: {
      id: dataset.id,
      name: dataset.name,
      version: dataset.version,
      datasetType: dataset.datasetType,
      columns: dataset.schema,
      fieldMappings: buildDatasetFieldMappings(dataset),
    },
    promptBinding: resolvedPromptBinding,
    evaluators: buildExperimentEvaluatorSet(dataset, evaluators).bindings,
    runConfig: resolvedRunConfig,
  };
};

export const buildExperimentBasicInfo = ({
  dataset,
  target,
  evaluators,
  summary,
  status,
  startedAt,
  finishedAt,
}: {
  dataset: Dataset;
  target: EvalTarget;
  evaluators: Evaluator[];
  summary: ExperimentRunSummary;
  status: ExperimentRun["status"];
  startedAt?: string;
  finishedAt?: string;
}): ExperimentBasicInfo => {
  const selection = toTargetSelection(target);

  return {
    target: {
      id: selection.id,
      type: selection.type,
      version: selection.version,
      label: selection.label,
    },
    dataset: {
      id: dataset.id,
      name: dataset.name,
      version: dataset.version,
      datasetType: dataset.datasetType,
    },
    evaluatorCount: evaluators.length,
    status,
    totalCases: summary.totalCases,
    completedCases: summary.completedCases,
    failedCases: summary.failedCases,
    invalidJudgmentCount: summary.invalidJudgmentCount,
    startedAt,
    finishedAt,
  };
};

const averageMetrics = (metrics: MetricResult[]): Record<string, number> => {
  const aggregate = new Map<string, { sum: number; count: number }>();

  for (const metric of metrics) {
    if (typeof metric.score !== "number" || metric.status !== "success") {
      continue;
    }

    const key = `${metric.layer}:${metric.metricName}`;
    const current = aggregate.get(key) ?? { sum: 0, count: 0 };
    aggregate.set(key, {
      sum: current.sum + metric.score,
      count: current.count + 1,
    });
  }

  return Object.fromEntries(
    [...aggregate.entries()].map(([key, value]) => [key, Number((value.sum / value.count).toFixed(4))]),
  );
};

export const buildExperimentCaseRun = (
  evalCase: EvalCase,
  target: SearchPipelineVersion,
  execution: PipelineExecutionResult,
  evaluators: Evaluator[] = builtInEvaluators,
): ExperimentCaseRun => {
  const latencyMs = execution.latencyMs ?? { retrieval: 0, rerank: 0, answer: 0 };

  const run: ExperimentCaseRun = {
    caseId: evalCase.caseId,
    targetId: target.id,
    status: "success",
    output: execution.answerOutput,
    scores: [],
    traceId: `${target.id}_${evalCase.caseId}`,
    trace: {
      traceId: `${target.id}_${evalCase.caseId}`,
      caseId: evalCase.caseId,
      retrievalTrace: {
        layer: "retrieval",
        latencyMs: latencyMs.retrieval,
        inputs: { userQuery: evalCase.userQuery },
        outputs: { retrievalResult: execution.retrievalResult },
      },
      rerankTrace: {
        layer: "rerank",
        latencyMs: latencyMs.rerank,
        inputs: { retrievalResult: execution.retrievalResult },
        outputs: { rerankResult: execution.rerankResult },
      },
      answerTrace: {
        layer: "answer",
        latencyMs: latencyMs.answer,
        inputs: { rerankResult: execution.rerankResult },
        outputs: { answerOutput: execution.answerOutput },
      },
    },
    layerRuns: [
      {
        caseId: evalCase.caseId,
        layer: "retrieval",
        outputs: { retrievalResult: execution.retrievalResult },
      },
      {
        caseId: evalCase.caseId,
        layer: "rerank",
        outputs: { rerankResult: execution.rerankResult },
      },
      {
        caseId: evalCase.caseId,
        layer: "answer",
        outputs: { answerOutput: execution.answerOutput },
      },
      {
        caseId: evalCase.caseId,
        layer: "overall",
        outputs: {
          supportingEvidence: execution.supportingEvidence ?? [],
        },
      },
    ],
    layerMetrics: [],
  };

  run.layerMetrics = evaluateSearchCase(evalCase, run, evaluators);
  run.scores = run.layerMetrics;
  run.trace.layerMetrics = Object.fromEntries(
    run.layerMetrics.map((metric) => [metric.metricName, metric]),
  );
  if (execution.debugInfo) {
    run.trace.answerTrace.outputs = {
      ...run.trace.answerTrace.outputs,
      debugInfo: execution.debugInfo,
    };
  }

  if (run.layerMetrics.some((metric) => metric.status === "runtime_error")) {
    run.status = "runtime_error";
  } else if (run.layerMetrics.some((metric) => metric.status === "invalid_judgment")) {
    run.status = "invalid_judgment";
  }

  return run;
};

const buildMetricSummaries = (metrics: MetricResult[]): ExperimentMetricSummary[] => {
  const grouped = new Map<
    string,
    {
      metricName: string;
      layer: MetricResult["layer"];
      successScores: number[];
      invalidJudgmentCount: number;
      runtimeErrorCount: number;
    }
  >();

  for (const metric of metrics) {
    const key = `${metric.layer}:${metric.metricName}`;
    const current =
      grouped.get(key) ??
      {
        metricName: metric.metricName,
        layer: metric.layer,
        successScores: [],
        invalidJudgmentCount: 0,
        runtimeErrorCount: 0,
      };

    if (metric.status === "success" && typeof metric.score === "number") {
      current.successScores.push(metric.score);
    } else if (metric.status === "invalid_judgment") {
      current.invalidJudgmentCount += 1;
    } else if (metric.status === "runtime_error") {
      current.runtimeErrorCount += 1;
    }

    grouped.set(key, current);
  }

  return [...grouped.values()].map((entry) => ({
    metricName: entry.metricName,
    layer: entry.layer,
    averageScore:
      entry.successScores.length > 0
        ? Number(
            (
              entry.successScores.reduce((sum, value) => sum + value, 0) / entry.successScores.length
            ).toFixed(4),
          )
        : undefined,
    successCount: entry.successScores.length,
    invalidJudgmentCount: entry.invalidJudgmentCount,
    runtimeErrorCount: entry.runtimeErrorCount,
  }));
};

const buildLayerSummaries = (
  metricSummaries: ExperimentMetricSummary[],
  caseRuns: ExperimentCaseRun[],
): ExperimentLayerSummary[] =>
  (["retrieval", "rerank", "answer", "overall"] as const).map((layer) => {
    const layerMetrics = metricSummaries.filter((metric) => metric.layer === layer);
    const scoredMetrics = layerMetrics.filter((metric) => typeof metric.averageScore === "number");
    const layerCaseMetrics = caseRuns.flatMap((caseRun) =>
      caseRun.layerMetrics.filter((metric) => metric.layer === layer),
    );
    const uniqueEvaluatorIds = new Set(
      layerCaseMetrics
        .map((metric) => metric.evaluatorId)
        .filter((value): value is string => typeof value === "string"),
    );

    return {
      layer,
      evaluatorCount: uniqueEvaluatorIds.size,
      metricCount: layerMetrics.length,
      averageScore:
        scoredMetrics.length > 0
          ? Number(
              (
                scoredMetrics.reduce((sum, metric) => sum + (metric.averageScore ?? 0), 0) /
                scoredMetrics.length
              ).toFixed(4),
            )
          : undefined,
      successCount: layerMetrics.reduce((sum, metric) => sum + metric.successCount, 0),
      invalidJudgmentCount: layerMetrics.reduce(
        (sum, metric) => sum + metric.invalidJudgmentCount,
        0,
      ),
      runtimeErrorCount: layerMetrics.reduce((sum, metric) => sum + metric.runtimeErrorCount, 0),
    };
  });

export const summarizeExperimentRun = (caseRuns: ExperimentCaseRun[]): ExperimentRunSummary => {
  const allMetrics = caseRuns.flatMap((caseRun) => caseRun.layerMetrics);
  const metricSummaries = buildMetricSummaries(allMetrics);

  return {
    totalCases: caseRuns.length,
    completedCases: caseRuns.filter((caseRun) => caseRun.status !== "runtime_error").length,
    failedCases: caseRuns.filter((caseRun) => caseRun.status === "runtime_error").length,
    invalidJudgmentCount: allMetrics.filter((metric) => metric.status === "invalid_judgment").length,
    averageMetrics: averageMetrics(allMetrics),
    metricSummaries,
    layerSummaries: buildLayerSummaries(metricSummaries, caseRuns),
  };
};

export const createEmptyExperimentRun = (
  experimentId: string,
  target: EvalTarget,
  executionTarget: SearchPipelineVersion,
  overrides: Partial<ExperimentRun> = {},
): ExperimentRun => ({
  experimentId,
  targetRef: toTargetRef(target),
  targetSelection: toTargetSelection(target),
  target: executionTarget,
  status: "CREATED",
  summary: {
    totalCases: 0,
    completedCases: 0,
    failedCases: 0,
    invalidJudgmentCount: 0,
    averageMetrics: {},
    metricSummaries: [],
    layerSummaries: [],
  },
  configuration:
    overrides.configuration ??
    buildExperimentConfigurationSnapshot({
      dataset: {
        id: overrides.datasetId ?? "dataset_unknown",
        name: "Unknown dataset",
        description: "",
        datasetType: "ideal_output",
        schema: [],
        cases: [],
        version: "0.0.0",
        createdAt: "",
        updatedAt: "",
      },
      target,
      evaluators: [
        {
          id: "eval_placeholder",
          evaluatorKey: "overall_model_placeholder",
          name: "placeholder",
          layer: "overall",
          family: "model",
          metricType: "continuous",
          version: "0.0.0",
          description: "placeholder evaluator",
          config: {},
        },
      ],
    }),
  caseRuns: [],
  ...overrides,
});
