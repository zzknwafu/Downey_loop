import { compareExperiments } from "../domain/comparison.js";
import { metricDefinitions } from "../domain/evaluators.js";
import { buildSampleExperiments, sampleCases } from "../domain/sample-data.js";
import type {
  AbExperimentRecord,
  ApiMeta,
  AppDataSnapshot,
  AttributionRecord,
  BootstrapResponse,
  DatasetRecord,
  EvaluatorRecord,
  ExperimentRunRecord,
  MetricDeltaRecord,
  MetricScoreRecord,
  RetrievalCandidateRecord,
  SearchPipelineVersionRecord,
  TraceRunRecord,
  TraceStepRecord,
} from "./contracts.js";

const SEEDED_AT = "2026-03-16T00:00:00.000Z";

const toContractLayer = (layer: string) =>
  (layer === "query" ? "retrieval" : layer) as "retrieval" | "rerank" | "answer" | "overall";

const mapCandidate = (candidate: {
  id: string;
  title: string;
  score?: number;
  attributes?: Record<string, string | number | boolean>;
}): RetrievalCandidateRecord => ({
  id: candidate.id,
  title: candidate.title,
  score: candidate.score,
  attributes: candidate.attributes,
});

const mapMetric = (metric: {
  metricName: string;
  layer: string;
  metricType: "binary" | "continuous" | "categorical";
  score: number | string;
  status: "success" | "invalid_judgment" | "runtime_error";
  reason: string;
  evidence?: string[];
}): MetricScoreRecord => ({
  metric_name: metric.metricName,
  layer: toContractLayer(metric.layer),
  metric_type: metric.metricType,
  score: metric.score,
  status: metric.status,
  reason: metric.reason,
  evidence: metric.evidence,
});

const aggregateMetrics = (scores: MetricScoreRecord[]) => {
  const grouped = new Map<string, { layer: MetricScoreRecord["layer"]; sum: number; count: number }>();

  for (const score of scores) {
    if (typeof score.score !== "number" || score.status !== "success") {
      continue;
    }

    const key = `${score.layer}:${score.metric_name}`;
    const current = grouped.get(key) ?? { layer: score.layer, sum: 0, count: 0 };
    grouped.set(key, {
      layer: score.layer,
      sum: current.sum + score.score,
      count: current.count + 1,
    });
  }

  return Array.from(grouped.entries()).map(([key, value]) => {
    const [, metricName] = key.split(":");
    return {
      metric_name: metricName ?? key,
      layer: value.layer,
      average_score: Number((value.sum / Math.max(1, value.count)).toFixed(4)),
    };
  });
};

const mapPipeline = (pipeline: {
  id: string;
  name: string;
  version: string;
  queryProcessor: string;
  retriever: string;
  reranker: string;
  answerer: string;
}): SearchPipelineVersionRecord => ({
  id: pipeline.id,
  name: pipeline.name,
  version: pipeline.version,
  query_processor: pipeline.queryProcessor,
  retriever: pipeline.retriever,
  reranker: pipeline.reranker,
  answerer: pipeline.answerer,
});

const buildTrajectory = (trace: {
  retrievalTrace: {
    latencyMs: number;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
  };
  rerankTrace: {
    latencyMs: number;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
  };
  answerTrace: {
    latencyMs: number;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
  };
}): TraceStepRecord[] => [
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
];

const buildDatasets = (): DatasetRecord[] => {
  const { baseline } = buildSampleExperiments();

  const idealOutput = {
    id: "dataset_ideal_001",
    name: "外卖 AI 搜理想输出集",
    description: "外卖和商超 AI 搜索的最小理想输出评测集。",
    dataset_type: "ideal_output",
    schema: [
      {
        name: "input",
        data_type: "String",
        required: true,
        description: "评测输入。",
      },
      {
        name: "reference_output",
        data_type: "String",
        required: true,
        description: "参考输出。",
      },
      {
        name: "context",
        data_type: "JSON",
        required: false,
        description: "补充上下文、约束和候选。",
      },
    ],
    cases: sampleCases.map((sample) => ({
      id: sample.caseId,
      input: sample.userQuery,
      reference_output: sample.answerReference,
      context: {
        domain: sample.domain,
        task_type: sample.taskType,
        query_constraints: sample.queryConstraints ?? null,
        retrieval_candidates: sample.retrievalCandidates.map(mapCandidate),
        expected_retrieval_ids: sample.expectedRetrievalIds,
        acceptable_retrieval_ids: sample.acceptableRetrievalIds,
        expected_top_items: sample.expectedTopItems,
        business_labels: sample.businessOutcomeLabels ?? null,
      },
    })),
    version: "0.1.0",
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  } satisfies DatasetRecord;

  const workflow = {
    id: "dataset_workflow_001",
    name: "AI 搜 Workflow 执行集",
    description: "同一批样本按 workflow 视角表达，用于节点与步骤联调。",
    dataset_type: "workflow",
    schema: [
      {
        name: "input",
        data_type: "String",
        required: true,
        description: "工作流输入。",
      },
      {
        name: "workflow_output",
        data_type: "JSON",
        required: true,
        description: "工作流最终输出。",
      },
      {
        name: "expected_steps",
        data_type: "JSON",
        required: false,
        description: "期望步骤。",
      },
    ],
    cases: sampleCases.map((sample) => ({
      id: `workflow_${sample.caseId}`,
      input: sample.userQuery,
      workflow_output: {
        retrieval_candidates: sample.retrievalCandidates.map(mapCandidate),
        expected_top_items: sample.expectedTopItems,
        answer_reference: sample.answerReference,
      },
      expected_steps: ["retrieval", "rerank", "answer"],
      context: {
        domain: sample.domain,
        task_type: sample.taskType,
      },
    })),
    version: "0.1.0",
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  } satisfies DatasetRecord;

  const traceMonitor = {
    id: "dataset_trace_001",
    name: "AI 搜 Trace 监控集",
    description: "从 baseline 实验直接派生的 trace 回放样本。",
    dataset_type: "trace_monitor",
    schema: [
      {
        name: "trace_id",
        data_type: "String",
        required: true,
        description: "轨迹唯一标识。",
      },
      {
        name: "final_output",
        data_type: "String",
        required: true,
        description: "最终回答。",
      },
      {
        name: "trajectory",
        data_type: "JSON",
        required: false,
        description: "轨迹步骤。",
      },
    ],
    cases: baseline.caseRuns.map((run) => ({
      id: `trace_case_${run.trace.traceId}`,
      trace_id: run.trace.traceId,
      final_output: String(run.trace.answerTrace.outputs.answerOutput ?? ""),
      trajectory: buildTrajectory(run.trace),
      context: {
        case_id: run.caseId,
      },
    })),
    version: "0.1.0",
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  } satisfies DatasetRecord;

  return [idealOutput, workflow, traceMonitor];
};

const buildEvaluators = (): EvaluatorRecord[] =>
  metricDefinitions.map((metric) => ({
    id: `evaluator_${metric.name}`,
    name: metric.name,
    family: metric.evaluatorFamily,
    layer: toContractLayer(metric.layer),
    metric_type: metric.metricType,
    code_strategy: metric.codeStrategy,
    description: metric.description,
    config: metric.codeStrategy ? { strategy: metric.codeStrategy } : {},
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  }));

const buildExperiments = (): { experiments: ExperimentRunRecord[]; traces: TraceRunRecord[] } => {
  const { baseline, candidate } = buildSampleExperiments();
  const experiments = [baseline, candidate].map((experiment) => {
    const caseResults = experiment.caseRuns.map((run) => ({
      case_id: run.caseId,
      output: {
        retrieval_result: (
          run.trace.retrievalTrace.outputs.retrievalResult as RetrievalCandidateRecord[]
        ).map(mapCandidate),
        rerank_result: (run.trace.rerankTrace.outputs.rerankResult as RetrievalCandidateRecord[]).map(
          mapCandidate,
        ),
        answer_output: String(run.trace.answerTrace.outputs.answerOutput ?? ""),
      },
      scores: run.layerMetrics.map(mapMetric),
      trace_id: run.trace.traceId,
    }));

    return {
      id: runIdForExperiment(experiment.experimentId),
      dataset_id: "dataset_ideal_001",
      pipeline_version: mapPipeline(experiment.target),
      evaluator_ids: buildEvaluators().map((evaluator) => evaluator.id),
      status: "FINISHED",
      summary: {
        case_count: caseResults.length,
        metrics: aggregateMetrics(caseResults.flatMap((result) => result.scores)),
      },
      case_results: caseResults,
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT,
    } satisfies ExperimentRunRecord;
  });

  const traces = [baseline, candidate].flatMap((experiment) =>
    experiment.caseRuns.map((run) => {
      const retrievalLatency = run.trace.retrievalTrace.latencyMs;
      const rerankLatency = run.trace.rerankTrace.latencyMs;
      const answerLatency = run.trace.answerTrace.latencyMs;
      return {
        id: run.trace.traceId,
        case_id: run.caseId,
        retrieval_results: (
          run.trace.retrievalTrace.outputs.retrievalResult as RetrievalCandidateRecord[]
        ).map(mapCandidate),
        rerank_results: (run.trace.rerankTrace.outputs.rerankResult as RetrievalCandidateRecord[]).map(
          mapCandidate,
        ),
        final_output: String(run.trace.answerTrace.outputs.answerOutput ?? ""),
        latency: {
          retrieval_ms: retrievalLatency,
          rerank_ms: rerankLatency,
          answer_ms: answerLatency,
          total_ms: retrievalLatency + rerankLatency + answerLatency,
        },
        tool_calls: [],
        trajectory: buildTrajectory(run.trace),
        error: null,
      } satisfies TraceRunRecord;
    }),
  );

  return { experiments, traces };
};

const runIdForExperiment = (experimentId: string) => {
  if (experimentId === "exp_baseline") {
    return "experiment_run_baseline";
  }

  if (experimentId === "exp_candidate") {
    return "experiment_run_candidate";
  }

  return experimentId;
};

const mapDelta = (delta: {
  metricName: string;
  layer: string;
  baselineValue: number;
  candidateValue: number;
  delta: number;
}): MetricDeltaRecord => ({
  metric_name: delta.metricName,
  layer: toContractLayer(delta.layer),
  baseline_value: delta.baselineValue,
  candidate_value: delta.candidateValue,
  delta: delta.delta,
});

const mapAttribution = (record: {
  targetMetric: string;
  candidateDriver: string;
  layer: string;
  delta: number;
  confidence: number;
  evidenceCaseIds: string[];
}): AttributionRecord => ({
  target_metric: record.targetMetric,
  candidate_driver: record.candidateDriver,
  layer: toContractLayer(record.layer),
  delta: record.delta,
  confidence: record.confidence,
  evidence_case_ids: record.evidenceCaseIds,
});

const buildAbExperiment = (): AbExperimentRecord => {
  const { baseline, candidate } = buildSampleExperiments();
  const comparison = compareExperiments(baseline, candidate);

  return {
    baseline_run_id: runIdForExperiment(comparison.baselineExperimentId),
    candidate_run_id: runIdForExperiment(comparison.candidateExperimentId),
    overall_metrics: comparison.overallDeltas.map(mapDelta),
    layer_deltas: comparison.layerDeltas.map(mapDelta),
    root_cause_summary: comparison.rootCauseSummary,
    evidence_case_ids: comparison.evidenceCaseIds,
    attribution_records: comparison.attributionRecords.map(mapAttribution),
  };
};

export const createSeedSnapshot = (): AppDataSnapshot => {
  const datasets = buildDatasets();
  const evaluators = buildEvaluators();
  const { experiments, traces } = buildExperiments();

  return {
    datasets,
    evaluators,
    experiments,
    traces,
    ab_experiment: buildAbExperiment(),
  };
};

export const createBootstrapResponse = (meta: ApiMeta): BootstrapResponse => ({
  meta,
  data: createSeedSnapshot(),
});

export const defaultApiMeta = (): ApiMeta => ({
  app_name: "Downey Evals Loop",
  generated_at: SEEDED_AT,
  storage: {
    driver: "local_json",
    data_dir: "./data",
    sqlite_path: "./data/downey-evals-loop.sqlite",
  },
});
