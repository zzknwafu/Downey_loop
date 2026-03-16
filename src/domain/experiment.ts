import {
  EvalCase,
  ExperimentCaseRun,
  ExperimentRun,
  ExperimentRunSummary,
  MetricResult,
  PipelineExecutionResult,
  SearchPipelineVersion,
} from "./types.js";
import { evaluateSearchCase } from "./evaluators.js";

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

  run.layerMetrics = evaluateSearchCase(evalCase, run);
  run.scores = run.layerMetrics;
  run.trace.layerMetrics = Object.fromEntries(
    run.layerMetrics.map((metric) => [metric.metricName, metric]),
  );

  if (run.layerMetrics.some((metric) => metric.status === "runtime_error")) {
    run.status = "runtime_error";
  } else if (run.layerMetrics.some((metric) => metric.status === "invalid_judgment")) {
    run.status = "invalid_judgment";
  }

  return run;
};

export const summarizeExperimentRun = (caseRuns: ExperimentCaseRun[]): ExperimentRunSummary => {
  const allMetrics = caseRuns.flatMap((caseRun) => caseRun.layerMetrics);

  return {
    totalCases: caseRuns.length,
    completedCases: caseRuns.filter((caseRun) => caseRun.status !== "runtime_error").length,
    failedCases: caseRuns.filter((caseRun) => caseRun.status === "runtime_error").length,
    invalidJudgmentCount: allMetrics.filter((metric) => metric.status === "invalid_judgment").length,
    averageMetrics: averageMetrics(allMetrics),
  };
};

export const createEmptyExperimentRun = (
  experimentId: string,
  target: SearchPipelineVersion,
  overrides: Partial<ExperimentRun> = {},
): ExperimentRun => ({
  experimentId,
  target,
  status: "CREATED",
  summary: {
    totalCases: 0,
    completedCases: 0,
    failedCases: 0,
    invalidJudgmentCount: 0,
    averageMetrics: {},
  },
  caseRuns: [],
  ...overrides,
});
