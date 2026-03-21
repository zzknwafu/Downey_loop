import type {
  EvalCase,
  ExperimentComparison,
  ExperimentRun,
  MetricDefinition,
  MetricResult,
  TraceRun,
} from "../domain/types.js";
import type {
  ApiMeta,
  BootstrapResponse,
  DatasetCaseRecord,
  DatasetRecord,
  EvaluatorRecord,
  LayerName,
  MetricScoreRecord,
  TraceRunRecord,
} from "../shared/contracts.js";
import { createBootstrapResponse, defaultApiMeta } from "../shared/mock-data.js";
import { fetchBootstrap } from "./api.js";

export interface DemoDataset {
  id: string;
  name: string;
  description: string;
  datasetType: DatasetRecord["dataset_type"];
  columns: DatasetRecord["schema"];
  cases: DatasetCaseRecord[];
  itemCount: number;
  version: string;
  source: "remote" | "seeded" | "local_mock";
}

export interface DemoEvaluator {
  id: string;
  name: string;
  version: string;
  layer: EvaluatorRecord["layer"];
  metricType: EvaluatorRecord["metric_type"];
  evaluatorFamily: EvaluatorRecord["family"];
  codeStrategy?: EvaluatorRecord["code_strategy"];
  description: string;
  config: string;
}

export interface DemoCaseDetail {
  caseId: string;
  title: string;
  domain: EvalCase["domain"];
  baselineRun: ExperimentRun["caseRuns"][number];
  candidateRun: ExperimentRun["caseRuns"][number];
  deltas: Array<{
    layer: LayerName;
    baselineAverage: number;
    candidateAverage: number;
    delta: number;
  }>;
}

export interface DemoViewModel {
  baseline: ExperimentRun;
  candidate: ExperimentRun;
  comparison: ExperimentComparison;
  metricDefinitions: MetricDefinition[];
  sampleCases: EvalCase[];
  groupedBaselineMetrics: Map<string, MetricResult[]>;
  groupedCandidateMetrics: Map<string, MetricResult[]>;
  caseDetails: DemoCaseDetail[];
  datasets: DemoDataset[];
  evaluators: DemoEvaluator[];
  experimentCount: number;
  traceCount: number;
  meta: ApiMeta;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const mapMetric = (metric: MetricScoreRecord): MetricResult => ({
  metricName: metric.metric_name,
  layer: metric.layer,
  metricType: metric.metric_type,
  score: metric.score,
  status: metric.status,
  reason: metric.reason,
  evidence: metric.evidence,
});

const traceRecordToTraceRun = (
  traceRecord: TraceRunRecord,
  caseId: string,
  layerMetrics: MetricResult[],
): TraceRun => ({
  traceId: traceRecord.id,
  caseId,
  retrievalTrace: {
    layer: "retrieval",
    latencyMs: traceRecord.latency.retrieval_ms,
    inputs: traceRecord.trajectory.find((step) => step.layer === "retrieval")?.inputs ?? {},
    outputs: traceRecord.trajectory.find((step) => step.layer === "retrieval")?.outputs ?? {},
  },
  rerankTrace: {
    layer: "rerank",
    latencyMs: traceRecord.latency.rerank_ms,
    inputs: traceRecord.trajectory.find((step) => step.layer === "rerank")?.inputs ?? {},
    outputs: traceRecord.trajectory.find((step) => step.layer === "rerank")?.outputs ?? {},
  },
  answerTrace: {
    layer: "answer",
    latencyMs: traceRecord.latency.answer_ms,
    inputs: traceRecord.trajectory.find((step) => step.layer === "answer")?.inputs ?? {},
    outputs: traceRecord.trajectory.find((step) => step.layer === "answer")?.outputs ?? {},
  },
  layerMetrics: Object.fromEntries(layerMetrics.map((metric) => [metric.metricName, metric])),
});

const buildExperiment = (
  experiment: BootstrapResponse["data"]["experiments"][number],
  traceMap: Map<string, TraceRunRecord>,
): ExperimentRun => {
  const caseRuns = experiment.case_results.map((result) => {
    const layerMetrics = result.scores.map(mapMetric);
    const traceRecord = traceMap.get(result.trace_id);
    const trace = traceRecord
      ? traceRecordToTraceRun(traceRecord, result.case_id, layerMetrics)
      : traceRecordToTraceRun(
          {
            id: result.trace_id,
            case_id: result.case_id,
            retrieval_results: result.output.retrieval_result,
            rerank_results: result.output.rerank_result,
            final_output: result.output.answer_output,
            latency: {
              retrieval_ms: 0,
              rerank_ms: 0,
              answer_ms: 0,
              total_ms: 0,
            },
            tool_calls: [],
            trajectory: [],
            error: null,
          },
          result.case_id,
          layerMetrics,
        );

    const status = layerMetrics.some((metric) => metric.status === "runtime_error")
      ? "runtime_error"
      : layerMetrics.some((metric) => metric.status === "invalid_judgment")
        ? "invalid_judgment"
        : "success";

    return {
      caseId: result.case_id,
      targetId: experiment.pipeline_version.id,
      output: result.output.answer_output,
      scores: layerMetrics,
      traceId: result.trace_id,
      status,
      trace,
      layerRuns: [
        {
          caseId: result.case_id,
          layer: "retrieval",
          outputs: { retrievalResult: result.output.retrieval_result },
        },
        {
          caseId: result.case_id,
          layer: "rerank",
          outputs: { rerankResult: result.output.rerank_result },
        },
        {
          caseId: result.case_id,
          layer: "answer",
          outputs: { answerOutput: result.output.answer_output },
        },
        {
          caseId: result.case_id,
          layer: "overall",
          outputs: {},
        },
      ],
      layerMetrics,
    };
  });

  return {
    experimentId: experiment.id,
    datasetId: experiment.dataset_id,
    evaluatorIds: experiment.evaluator_ids,
    pipelineVersionId: experiment.pipeline_version.id,
    target: {
      id: experiment.pipeline_version.id,
      name: experiment.pipeline_version.name,
      version: experiment.pipeline_version.version,
      queryProcessor: experiment.pipeline_version.query_processor,
      retriever: experiment.pipeline_version.retriever,
      reranker: experiment.pipeline_version.reranker,
      answerer: experiment.pipeline_version.answerer,
    },
    status: experiment.status,
    startedAt: experiment.created_at,
    finishedAt: experiment.updated_at,
    summary: {
      totalCases: experiment.summary.case_count,
      completedCases: caseRuns.filter((caseRun) => caseRun.status === "success").length,
      failedCases: caseRuns.filter((caseRun) => caseRun.status === "runtime_error").length,
      invalidJudgmentCount: caseRuns.filter((caseRun) => caseRun.status === "invalid_judgment").length,
      averageMetrics: Object.fromEntries(
        experiment.summary.metrics.map((metric) => [metric.metric_name, metric.average_score]),
      ),
    },
    caseRuns,
  };
};

const contextField = <T>(context: Record<string, unknown>, key: string, fallback: T) => {
  const value = context[key];
  return value === undefined ? fallback : (value as T);
};

const mapIdealDatasetCases = (datasets: DatasetRecord[]): EvalCase[] => {
  const dataset = datasets.find((item) => item.dataset_type === "ideal_output");
  if (!dataset) {
    return [];
  }

  return dataset.cases.flatMap((item) => {
    if (!("reference_output" in item) || !isObject(item.context)) {
      return [];
    }

    const context = item.context;
    return [
      {
        caseId: item.id,
        domain: contextField(context, "domain", "food_delivery"),
        taskType: contextField(context, "task_type", "ai_search"),
        userQuery: item.input,
        queryConstraints: contextField(context, "query_constraints", undefined),
        retrievalCandidates: contextField(context, "retrieval_candidates", []),
        expectedRetrievalIds: contextField(context, "expected_retrieval_ids", []),
        acceptableRetrievalIds: contextField(context, "acceptable_retrieval_ids", []),
        expectedTopItems: contextField(context, "expected_top_items", []),
        answerReference: item.reference_output,
        businessOutcomeLabels: contextField(context, "business_labels", undefined),
      },
    ];
  });
};

const mapComparison = (
  abExperiment: BootstrapResponse["data"]["ab_experiment"],
): ExperimentComparison => ({
  headline: abExperiment.headline,
  baselineExperimentId: abExperiment.baseline_run_id,
  candidateExperimentId: abExperiment.candidate_run_id,
  overallDeltas: abExperiment.overall_metrics.map((metric) => ({
    metricName: metric.metric_name,
    layer: metric.layer,
    baselineValue: metric.baseline_value,
    candidateValue: metric.candidate_value,
    delta: metric.delta,
  })),
  layerDeltas: abExperiment.layer_deltas.map((metric) => ({
    metricName: metric.metric_name,
    layer: metric.layer,
    baselineValue: metric.baseline_value,
    candidateValue: metric.candidate_value,
    delta: metric.delta,
  })),
  layerInsights: abExperiment.layer_insights.map((insight) => ({
    layer: insight.layer,
    status: insight.status,
    averageDelta: insight.average_delta,
    strongestNegativeMetric: insight.strongest_negative_metric,
    strongestPositiveMetric: insight.strongest_positive_metric,
    evidenceCaseIds: insight.evidence_case_ids,
  })),
  driverPositive: abExperiment.driver_positive,
  driverNegative: abExperiment.driver_negative,
  confidence: abExperiment.confidence,
  rootCauseSummary: abExperiment.root_cause_summary,
  evidenceCaseIds: abExperiment.evidence_case_ids,
  attributionRecords: abExperiment.attribution_records.map((record) => ({
    targetMetric: record.target_metric,
    candidateDriver: record.candidate_driver,
    layer: record.layer,
    delta: record.delta,
    confidence: record.confidence,
    evidenceCaseIds: record.evidence_case_ids,
  })),
});

const groupMetrics = (experiment: ExperimentRun) => {
  const groups = new Map<string, MetricResult[]>();
  for (const caseRun of experiment.caseRuns) {
    for (const metric of caseRun.layerMetrics) {
      const key = metric.layer;
      const list = groups.get(key) ?? [];
      list.push(metric);
      groups.set(key, list);
    }
  }
  return groups;
};

const metricMap = (metrics: MetricResult[]) =>
  new Map(metrics.map((metric) => [`${metric.layer}:${metric.metricName}`, metric]));

const buildCaseDetails = (
  sampleCases: EvalCase[],
  baseline: ExperimentRun,
  candidate: ExperimentRun,
): DemoCaseDetail[] =>
  sampleCases.flatMap((evalCase) => {
    const baselineRun = baseline.caseRuns.find((run) => run.caseId === evalCase.caseId);
    const candidateRun = candidate.caseRuns.find((run) => run.caseId === evalCase.caseId);

    if (!baselineRun || !candidateRun) {
      return [];
    }

    const baselineMetrics = metricMap(baselineRun.layerMetrics);
    const candidateMetrics = metricMap(candidateRun.layerMetrics);

    return [{
      caseId: evalCase.caseId,
      title: evalCase.userQuery,
      domain: evalCase.domain,
      baselineRun,
      candidateRun,
      deltas: (["retrieval", "rerank", "answer"] as LayerName[]).map((layer) => {
        const keys = baselineRun.layerMetrics
          .filter((metric) => metric.layer === layer)
          .map((metric) => `${metric.layer}:${metric.metricName}`);
        const baselineAverage =
          keys.reduce((sum, key) => sum + Number(baselineMetrics.get(key)?.score ?? 0), 0) /
          Math.max(1, keys.length);
        const candidateAverage =
          keys.reduce((sum, key) => sum + Number(candidateMetrics.get(key)?.score ?? 0), 0) /
          Math.max(1, keys.length);

        return {
          layer,
          baselineAverage: Number(baselineAverage.toFixed(4)),
          candidateAverage: Number(candidateAverage.toFixed(4)),
          delta: Number((candidateAverage - baselineAverage).toFixed(4)),
        };
      }),
    }];
  });

const mapDatasets = (datasets: DatasetRecord[], remoteDatasetIds?: Set<string>): DemoDataset[] =>
  datasets.map((dataset) => ({
    id: dataset.id,
    name: dataset.name,
    description: dataset.description,
    datasetType: dataset.dataset_type,
    columns: dataset.schema,
    cases: dataset.cases,
    itemCount: dataset.cases.length,
    version: dataset.version,
    source: remoteDatasetIds
      ? remoteDatasetIds.has(dataset.id)
        ? "remote"
        : "seeded"
      : "seeded",
  }));

const mapEvaluators = (evaluators: EvaluatorRecord[]): DemoEvaluator[] =>
  evaluators.map((evaluator) => ({
    id: evaluator.id,
    name: evaluator.name,
    version: evaluator.version,
    layer: evaluator.layer,
    metricType: evaluator.metric_type,
    evaluatorFamily: evaluator.family,
    codeStrategy: evaluator.code_strategy,
    description: evaluator.description,
    config: Object.keys(evaluator.config).length > 0 ? JSON.stringify(evaluator.config, null, 2) : "",
  }));

const mapMetricDefinitions = (evaluators: EvaluatorRecord[]): MetricDefinition[] =>
  evaluators.map((evaluator) => ({
    name: evaluator.name,
    layer: evaluator.layer,
    metricType: evaluator.metric_type,
    evaluatorFamily: evaluator.family,
    codeStrategy: evaluator.code_strategy,
    description: evaluator.description,
  }));

export const buildDemoViewModel = (bootstrap: BootstrapResponse, remoteDatasetIds?: Set<string>): DemoViewModel => {
  const traceMap = new Map(bootstrap.data.traces.map((trace) => [trace.id, trace]));
  const experiments = bootstrap.data.experiments.map((experiment) => buildExperiment(experiment, traceMap));
  const comparison = mapComparison(bootstrap.data.ab_experiment);
  const baseline =
    experiments.find((experiment) => experiment.experimentId === comparison.baselineExperimentId) ??
    experiments[0]!;
  const candidate =
    experiments.find((experiment) => experiment.experimentId === comparison.candidateExperimentId) ??
    experiments[1] ??
    experiments[0]!;
  const sampleCases = mapIdealDatasetCases(bootstrap.data.datasets);

  return {
    baseline,
    candidate,
    comparison,
    metricDefinitions: mapMetricDefinitions(bootstrap.data.evaluators),
    sampleCases,
    groupedBaselineMetrics: groupMetrics(baseline),
    groupedCandidateMetrics: groupMetrics(candidate),
    caseDetails: buildCaseDetails(sampleCases, baseline, candidate),
    datasets: mapDatasets(bootstrap.data.datasets, remoteDatasetIds),
    evaluators: mapEvaluators(bootstrap.data.evaluators),
    experimentCount: bootstrap.data.experiments.length,
    traceCount: bootstrap.data.traces.length,
    meta: bootstrap.meta,
  };
};

const defaultBootstrap = createBootstrapResponse(defaultApiMeta());

export const demoViewModel: DemoViewModel = buildDemoViewModel(defaultBootstrap);

export const replaceDemoViewModel = (nextViewModel: DemoViewModel) => {
  Object.assign(demoViewModel, nextViewModel);
};

export const loadRemoteDemoViewModel = async () => {
  const bootstrap = await fetchBootstrap();
  const remoteDatasetIds = new Set(bootstrap.data.datasets.map((dataset) => dataset.id));
  return buildDemoViewModel(bootstrap, remoteDatasetIds);
};
