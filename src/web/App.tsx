import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { sampleAgents, sampleEvaluators, samplePrompts } from "../domain/sample-data.js";
import type {
  DatasetType,
  ExperimentCaseRun,
  ExperimentRun,
  LayerName,
  MetricResult,
  PromptVersion,
} from "../domain/types.js";
import type {
  AgentCompositionRecord,
  AgentEntryType,
  AgentRecord,
  DatasetCaseRecord,
  DatasetRecord,
  DatasetSynthesisResult,
  ExperimentListItemRecord,
  ExperimentRunRecord,
  ExperimentPromptVariableMappingRecord,
  MetricScoreRecord,
  TraceRunRecord,
  UpdateDatasetInput,
} from "../shared/contracts.js";
import { DEFAULT_EXPERIMENT_RUN_CONFIG } from "../domain/experiment.js";
import {
  createAgent as createAgentRequest,
  createDataset as createDatasetRequest,
  createExperiment as createExperimentRequest,
  createDatasetCase as createDatasetCaseRequest,
  deleteDatasetCase as deleteDatasetCaseRequest,
  fetchAgents as fetchAgentsRequest,
  fetchDataset,
  fetchDatasetCase,
  fetchDatasetCases,
  fetchExperiment as fetchExperimentRequest,
  fetchExperimentItems as fetchExperimentItemsRequest,
  synthesizeDatasetCases as synthesizeDatasetCasesRequest,
  updateDataset as updateDatasetRequest,
  updateDatasetCase as updateDatasetCaseRequest,
} from "./api.js";
import type { DemoDataset, DemoEvaluator, DemoViewModel } from "./view-model.js";
import { demoViewModel, loadRemoteDemoViewModel } from "./view-model.js";

type ActiveView =
  | "prompt_dev"
  | "playground"
  | "datasets"
  | "evaluators"
  | "experiment_runs"
  | "ab_experiments"
  | "trace"
  | "stats"
  | "automation";

type DisplayLayer = Exclude<LayerName, "query">;
type EvaluatorFamilyChoice = "model" | "code";
type DatasetTypeFilter = "all" | DatasetType;
type DatasetDetailTab = "evaluation_set" | "synthesis";
type SynthesisDirection =
  | "generalize"
  | "augment_failures"
  | "augment_guardrails"
  | "align_online_distribution";
type ExperimentCreateStep = 1 | 2 | 3 | 4 | 5;
type AgentCreateStep = 1 | 2;
type AgentCreateMode = "simple" | "advanced";

interface SynthesisColumnDraft {
  name: string;
  enabled: boolean;
  description: string;
  requirement: string;
}

interface AgentFormState {
  name: string;
  version: string;
  description: string;
  scenario: string;
  entryType: AgentEntryType;
  artifactRef: string;
  compositionModules: string[];
}

interface ExperimentListRow {
  id: string;
  label: string;
  status: ExperimentRun["status"];
  source?: "remote" | "local_mock";
  evaluatorSummary?: ExperimentListItemRecord["evaluator_summary"];
  datasetName: string;
  targetName: string;
  targetVersion: string;
  promptKey: string;
  promptDescription?: string;
  promptVariableMappings: ExperimentPromptVariableMappingRecord[];
  promptParams: {
    model: string;
    temperature: string;
    maxTokens: string;
    topP: string;
  };
  totalCases: number;
  invalidJudgmentCount: number;
  overallScore: number;
  startedAt?: string;
  finishedAt?: string;
  experiment: ExperimentRun;
}

interface TraceListRow {
  key: string;
  traceId: string;
  experimentId: string;
  experimentLabel: string;
  caseId: string;
  title: string;
  trace: ExperimentCaseRun["trace"];
  caseRun: ExperimentCaseRun;
}

interface DatasetFormState {
  name: string;
  description: string;
  datasetType: DatasetType;
  sampleCount: number;
  schema: DatasetRecord["schema"];
}

interface EvaluatorFormState {
  name: string;
  layer: DisplayLayer;
  metricType: DemoEvaluator["metricType"];
  description: string;
  codeStrategy: string;
}

interface ExperimentFormState {
  name: string;
  description: string;
  datasetId: string;
  promptKey: string;
  promptVersion: string;
  promptParams: {
    model: string;
    temperature: string;
    maxTokens: string;
    topP: string;
  };
  evaluatorIds: string[];
  evaluatorVersions: Record<string, string>;
}

type ExperimentTab = "data_detail" | "indicator_statistics" | "experiment_configuration";

interface ExperimentCaseTableRow {
  caseRun: ExperimentCaseRun;
  title: string;
  datasetCase?: DatasetCaseRecord;
  layerScore: number;
  overallScore: number;
  evaluatorScores: Record<string, number>;
  status: CaseExecutionStatus;
  failureReason: string | null;
}

interface PromptPreviewState {
  payload: string;
  rendered: string;
  error: string | null;
}

type CaseExecutionStatus = "success" | "failed" | "pending";

const layerOrder: DisplayLayer[] = ["retrieval", "rerank", "answer", "overall"];

const layerLabels: Record<DisplayLayer, string> = {
  retrieval: "Retrieval",
  rerank: "Rerank",
  answer: "Answer",
  overall: "Overall",
};

const experimentLayerLabels: Record<DisplayLayer, string> = {
  retrieval: "Retrieval",
  rerank: "Rerank",
  answer: "Answer",
  overall: "Overall",
};

const datasetTypeLabels: Record<DatasetType, string> = {
  ideal_output: "普通数据集",
  workflow: "Workflow 数据集",
  trace_monitor: "Trace 监控集",
};

const metricTypeLabels: Record<DemoEvaluator["metricType"], string> = {
  binary: "Binary",
  continuous: "Continuous",
  categorical: "Categorical",
};

const evaluatorFamilyLabels: Record<EvaluatorFamilyChoice, string> = {
  model: "LLM Evaluator",
  code: "Code Evaluator",
};

const datasetTemplateColumns: Record<DatasetType, Array<{ name: string; description: string }>> = {
  ideal_output: [
    { name: "input", description: "评测输入" },
    { name: "reference_output", description: "理想输出" },
    { name: "context", description: "补充上下文" },
  ],
  workflow: [
    { name: "input", description: "工作流原始输入" },
    { name: "workflow_output", description: "工作流输出" },
    { name: "expected_steps", description: "期望步骤" },
  ],
  trace_monitor: [
    { name: "trace_id", description: "trace 唯一标识" },
    { name: "final_output", description: "最终输出" },
    { name: "trajectory", description: "执行轨迹" },
  ],
};

const datasetFieldGuides: Record<
  DatasetType,
  {
    summary: string;
    recommended: string[];
    extensible: string[];
  }
> = {
  ideal_output: {
    summary: "适合理想输出评测，围绕 input / reference_output / context 组织样本。",
    recommended: ["input", "reference_output", "context"],
    extensible: ["query_constraints", "reference_items", "business_labels", "expected_top_items"],
  },
  workflow: {
    summary: "适合 agent 或 workflow 执行结果评测，强调步骤与动作回放。",
    recommended: ["input", "workflow_output", "expected_steps"],
    extensible: ["expected_actions", "tool_inputs", "tool_outputs", "step_constraints"],
  },
  trace_monitor: {
    summary: "适合轨迹回放、线上问题复现与 trace 监控。",
    recommended: ["trace_id", "final_output", "trajectory"],
    extensible: ["step_records", "tool_calls", "latency_profile", "failure_reason"],
  },
};

const buildDatasetSchema = (datasetType: DatasetType): DatasetRecord["schema"] =>
  datasetTemplateColumns[datasetType].map((column) => ({
    name: column.name,
    data_type:
      column.name === "context" || column.name === "workflow_output" || column.name === "trajectory"
        ? "JSON"
        : "String",
    required: true,
    description: column.description,
  }));

const createEmptyDatasetForm = (): DatasetFormState => ({
  name: "",
  description: "",
  datasetType: "ideal_output",
  sampleCount: 10,
  schema: buildDatasetSchema("ideal_output"),
});

const createEmptyAgentForm = (): AgentFormState => ({
  name: "",
  version: "0.1.0",
  description: "",
  scenario: "",
  entryType: "workflow",
  artifactRef: "",
  compositionModules: [],
});

const createEmptyExperimentForm = (): ExperimentFormState => ({
  name: "",
  description: "",
  datasetId: "",
  promptKey: promptExperimentCatalog[0]?.name ?? "",
  promptVersion: promptExperimentCatalog[0]?.version ?? "",
  promptParams: { ...defaultPromptParams },
  evaluatorIds: [],
  evaluatorVersions: {},
});

const evaluatorVersionOptions = (evaluator: DemoEvaluator) => [evaluator.version];

const defaultEvaluatorVersion = (evaluator: DemoEvaluator) => evaluator.version || "0.1.0";

const buildExperimentEvaluatorBindingsInput = (
  dataset: DemoDataset,
  evaluators: DemoEvaluator[],
  evaluatorVersions: Record<string, string>,
) =>
  evaluators.map((evaluator) => ({
    evaluator_id: evaluator.id,
    evaluator_version: evaluatorVersions[evaluator.id] ?? defaultEvaluatorVersion(evaluator),
    field_mapping: [
      {
        source_field: "input",
        target_field: "evaluator_input",
        source_type: "String",
        target_type: "runtime",
      },
      {
        source_field: "actual_output",
        target_field: "evaluator_output",
        source_type: "runtime",
        target_type: "runtime",
      },
      ...(dataset.datasetType === "ideal_output"
        ? [
            {
              source_field: "reference_output",
              target_field: "evaluator_reference_output",
              source_type: "String",
              target_type: "runtime",
            },
          ]
        : []),
    ],
    weight: 1,
  }));

const mapDatasetRecordToDemoDataset = (dataset: DatasetRecord): DemoDataset => ({
  id: dataset.id,
  name: dataset.name,
  description: dataset.description,
  datasetType: dataset.dataset_type,
  columns: dataset.schema,
  cases: dataset.cases,
  itemCount: dataset.cases.length,
  version: dataset.version,
  source: "remote",
});

const mapLegacyAgentToRecord = (agent: (typeof sampleAgents)[number]): AgentRecord => ({
  id: agent.id,
  name: agent.name,
  version: agent.version,
  description: agent.description,
  scenario: "ai_search",
  entry_type: "workflow",
  artifact_ref: agent.id,
  composition: [
    { kind: "query_understanding", ref: agent.queryProcessor },
    { kind: "retrieval", ref: agent.retriever },
    { kind: "ranking", ref: agent.reranker },
    { kind: "answer_generation", ref: agent.answerer },
  ],
  query_processor: agent.queryProcessor,
  retriever: agent.retriever,
  reranker: agent.reranker,
  answerer: agent.answerer,
});

const codeStrategies = [
  { value: "exact_match", label: "Exact Match", description: "输出与参考答案完全一致才通过" },
  { value: "regex_match", label: "Regex Match", description: "命中规则表达式即通过" },
  { value: "fuzzy_match", label: "Fuzzy Match", description: "按字符串相似度返回分数" },
  { value: "python_script", label: "Python Script", description: "预留后端 runner 执行自定义逻辑" },
];

const agentEntryTypeOptions: Array<{ value: AgentEntryType; label: string; description: string }> = [
  { value: "prompt", label: "prompt", description: "被测对象是某个 prompt 入口。" },
  { value: "api", label: "api", description: "被测对象通过 API 或 service endpoint 暴露。" },
  { value: "workflow", label: "workflow", description: "被测对象是 workflow 或 agent runtime 入口。" },
];

const compositionStarterSet = [
  "query_understanding",
  "retrieval",
  "ranking",
  "answer_generation",
  "planning",
  "tool_use",
  "memory",
  "verification",
];

const promptExperimentCatalog = samplePrompts.filter((prompt) => !prompt.version.includes("-coze"));

const defaultPromptParams = {
  model: "gemini-2.5-flash",
  temperature: "0.2",
  maxTokens: "1024",
  topP: "1",
};

const EXPERIMENT_LABEL_OVERRIDES_STORAGE_KEY = "downey_experiment_label_overrides";

const promptVersionOptions = (promptName: string) =>
  promptExperimentCatalog.filter((prompt) => prompt.name === promptName);

const resolvePromptVersion = (promptName: string, promptVersion: string) =>
  promptVersionOptions(promptName).find((prompt) => prompt.version === promptVersion) ??
  promptVersionOptions(promptName)[0] ??
  promptExperimentCatalog[0];

const buildPromptVariableMappings = (
  prompt: PromptVersion,
  dataset: DemoDataset | undefined,
): ExperimentPromptVariableMappingRecord[] => {
  const datasetColumns = dataset?.columns ?? [];
  const columnByName = new Map(datasetColumns.map((column) => [column.name, column]));
  const runtimeSourceByVariable: Record<string, string> = {
    input: "input",
    reference_output: "answerReference",
    retrieval_candidates: "retrievalCandidates",
    expected_retrieval_ids: "expectedRetrievalIds",
    acceptable_retrieval_ids: "acceptableRetrievalIds",
    expected_top_items: "expectedTopItems",
    query_constraints: "queryConstraints",
    business_labels: "businessOutcomeLabels",
    business_outcome_labels: "businessOutcomeLabels",
    domain: "domain",
    task_type: "taskType",
  };

  return Object.entries(prompt.inputSchema ?? {}).map(([variable, sourceType]) => {
    const sourceField = runtimeSourceByVariable[variable] ?? variable;
    const sourceColumn =
      columnByName.get(variable) ??
      (variable === "retrieval_candidates" ? columnByName.get("context") : undefined);

    return {
      source_field: sourceField,
      target_field: variable,
      source_type: sourceColumn?.data_type ?? String(sourceType),
      target_type: "runtime",
    };
  });
};

const mapMetricScoreRecordToMetricResult = (metric: MetricScoreRecord): MetricResult => ({
  metricName: metric.metric_name,
  layer: metric.layer,
  metricType: metric.metric_type,
  score: metric.score,
  status: metric.status,
  reason: metric.reason,
  evidence: metric.evidence,
  evaluatorId: metric.evaluator_id,
});

const traceRunRecordToTraceRun = (
  traceRecord: TraceRunRecord,
  layerMetrics: MetricResult[],
): ExperimentCaseRun["trace"] => ({
  traceId: traceRecord.id,
  caseId: traceRecord.case_id,
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
  error: traceRecord.error ?? null,
});

const buildFallbackTraceRecord = (
  experimentId: string,
  result: ExperimentRunRecord["case_results"][number],
): TraceRunRecord => ({
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
  error: result.scores.some((metric) => metric.status === "runtime_error")
    ? `Experiment ${experimentId} case ${result.case_id} failed`
    : null,
});

const buildExperimentMetricSummaries = (caseRuns: ExperimentCaseRun[]): ExperimentRun["summary"]["metricSummaries"] => {
  const grouped = new Map<
    string,
    {
      metricName: string;
      layer: LayerName;
      numericScores: number[];
      successCount: number;
      invalidJudgmentCount: number;
      runtimeErrorCount: number;
    }
  >();

  for (const caseRun of caseRuns) {
    for (const metric of caseRun.layerMetrics) {
      const key = `${metric.layer}:${metric.metricName}`;
      const current = grouped.get(key) ?? {
        metricName: metric.metricName,
        layer: metric.layer,
        numericScores: [],
        successCount: 0,
        invalidJudgmentCount: 0,
        runtimeErrorCount: 0,
      };

      if (metric.status === "success") {
        current.successCount += 1;
        if (typeof metric.score === "number") {
          current.numericScores.push(metric.score);
        }
      } else if (metric.status === "invalid_judgment") {
        current.invalidJudgmentCount += 1;
      } else if (metric.status === "runtime_error") {
        current.runtimeErrorCount += 1;
      }

      grouped.set(key, current);
    }
  }

  return [...grouped.values()].map((item) => ({
    metricName: item.metricName,
    layer: item.layer,
    averageScore:
      item.numericScores.length > 0
        ? Number((item.numericScores.reduce((sum, value) => sum + value, 0) / item.numericScores.length).toFixed(4))
        : undefined,
    successCount: item.successCount,
    invalidJudgmentCount: item.invalidJudgmentCount,
    runtimeErrorCount: item.runtimeErrorCount,
  }));
};

const buildExperimentLayerSummaries = (
  caseRuns: ExperimentCaseRun[],
  metricSummaries: ExperimentRun["summary"]["metricSummaries"],
): ExperimentRun["summary"]["layerSummaries"] => {
  const evaluatorsByLayer = new Map<LayerName, Set<string>>();
  for (const caseRun of caseRuns) {
    for (const metric of caseRun.layerMetrics) {
      const layerSet = evaluatorsByLayer.get(metric.layer) ?? new Set<string>();
      if (metric.evaluatorId) {
        layerSet.add(metric.evaluatorId);
      }
      evaluatorsByLayer.set(metric.layer, layerSet);
    }
  }

  return layerOrder.map((layer) => {
    const layerMetrics = metricSummaries.filter((metric) => metric.layer === layer);
    const scored = layerMetrics
      .map((metric) => metric.averageScore)
      .filter((value): value is number => typeof value === "number");

    return {
      layer,
      evaluatorCount: evaluatorsByLayer.get(layer)?.size ?? 0,
      metricCount: layerMetrics.length,
      averageScore:
        scored.length > 0
          ? Number((scored.reduce((sum, value) => sum + value, 0) / scored.length).toFixed(4))
          : undefined,
      successCount: layerMetrics.reduce((sum, metric) => sum + metric.successCount, 0),
      invalidJudgmentCount: layerMetrics.reduce((sum, metric) => sum + metric.invalidJudgmentCount, 0),
      runtimeErrorCount: layerMetrics.reduce((sum, metric) => sum + metric.runtimeErrorCount, 0),
    };
  }).filter((item) => item.metricCount > 0 || item.evaluatorCount > 0);
};

const mapExperimentRunRecordToExperiment = (record: ExperimentRunRecord): ExperimentRun => {
  const caseRuns = record.case_results.map((result) => {
    const layerMetrics = result.scores.map(mapMetricScoreRecordToMetricResult);
    const trace = traceRunRecordToTraceRun(
      buildFallbackTraceRecord(record.id, result),
      layerMetrics,
    );
    const status = layerMetrics.some((metric) => metric.status === "runtime_error")
      ? "runtime_error"
      : layerMetrics.some((metric) => metric.status === "invalid_judgment")
        ? "invalid_judgment"
        : "success";

    return {
      caseId: result.case_id,
      targetId: record.pipeline_version.id,
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
    } satisfies ExperimentCaseRun;
  });

  const metricSummaries = buildExperimentMetricSummaries(caseRuns);
  const layerSummaries = buildExperimentLayerSummaries(caseRuns, metricSummaries);

  return {
    experimentId: record.id,
    datasetId: record.dataset_id,
    evaluatorIds: record.evaluator_ids,
    pipelineVersionId: record.pipeline_version.id,
    targetRef: record.target
      ? {
          id: record.target.id,
          type: record.target.type,
          version: record.target.version,
        }
      : undefined,
    targetSelection: record.target
      ? {
          id: record.target.id,
          type: record.target.type,
          version: record.target.version,
          label: record.target.label,
        }
      : undefined,
    target: {
      id: record.pipeline_version.id,
      name: record.pipeline_version.name,
      version: record.pipeline_version.version,
      queryProcessor: record.pipeline_version.query_processor,
      retriever: record.pipeline_version.retriever,
      reranker: record.pipeline_version.reranker,
      answerer: record.pipeline_version.answerer,
    },
    status: record.status,
    startedAt: record.created_at,
    finishedAt: record.updated_at,
    summary: {
      totalCases: record.summary.case_count,
      completedCases: caseRuns.filter((caseRun) => caseRun.status === "success").length,
      failedCases: caseRuns.filter((caseRun) => caseRun.status === "runtime_error").length,
      invalidJudgmentCount: caseRuns.filter((caseRun) => caseRun.status === "invalid_judgment").length,
      averageMetrics: Object.fromEntries(
        record.summary.metrics.map((metric) => [`${metric.layer}:${metric.metric_name}`, metric.average_score]),
      ),
      metricSummaries,
      layerSummaries,
    },
    caseRuns,
  };
};

const buildExperimentRowFromRun = (input: {
  experiment: ExperimentRun;
  label: string;
  evaluatorSummary?: ExperimentListItemRecord["evaluator_summary"];
  overallScore?: number;
  datasetName: string;
  targetName: string;
  targetVersion: string;
  promptKey: string;
  promptDescription?: string;
  promptVariableMappings: ExperimentPromptVariableMappingRecord[];
  promptParams: ExperimentListRow["promptParams"];
}): ExperimentListRow => ({
  id: input.experiment.experimentId,
  label: input.label,
  status: input.experiment.status,
  source: "remote",
  evaluatorSummary: input.evaluatorSummary,
  datasetName: input.datasetName,
  targetName: input.targetName,
  targetVersion: input.targetVersion,
  promptKey: input.promptKey,
  promptDescription: input.promptDescription,
  promptVariableMappings: input.promptVariableMappings,
  promptParams: input.promptParams,
  totalCases: input.experiment.summary.totalCases,
  invalidJudgmentCount: input.experiment.summary.invalidJudgmentCount,
  overallScore:
    input.overallScore ??
    averageLayerScore(input.experiment.caseRuns.flatMap((caseRun) => caseRun.layerMetrics), "overall"),
  startedAt: input.experiment.startedAt,
  finishedAt: input.experiment.finishedAt,
  experiment: input.experiment,
});

const createPlaceholderExperimentFromListItem = (item: ExperimentListItemRecord): ExperimentRun => ({
  experimentId: item.id,
  datasetId: item.dataset_id,
  evaluatorIds: [],
  pipelineVersionId: item.pipeline_version?.id ?? item.target?.id ?? item.id,
  targetRef: item.target
    ? {
        id: item.target.id,
        type: item.target.type,
        version: item.target.version,
      }
    : undefined,
  targetSelection: item.target
    ? {
        id: item.target.id,
        type: item.target.type,
        version: item.target.version,
        label: item.target.label,
      }
    : undefined,
  target: {
    id: item.pipeline_version?.id ?? item.target?.id ?? item.id,
    name: item.pipeline_version?.name ?? item.target?.name ?? item.id,
    version: item.pipeline_version?.version ?? item.target?.version ?? "unknown",
    queryProcessor: item.pipeline_version?.query_processor ?? "n/a",
    retriever: item.pipeline_version?.retriever ?? "n/a",
    reranker: item.pipeline_version?.reranker ?? "n/a",
    answerer: item.pipeline_version?.answerer ?? "n/a",
  },
  status: item.status,
  startedAt: item.started_at ?? undefined,
  finishedAt: item.finished_at ?? undefined,
  summary: {
    totalCases: item.case_count,
    completedCases: item.completed_case_count,
    failedCases: item.failed_case_count,
    invalidJudgmentCount: item.invalid_judgment_count,
    averageMetrics: {},
    metricSummaries: [],
    layerSummaries: [],
  },
  caseRuns: [],
});

const mapExperimentItemToRow = (
  item: ExperimentListItemRecord,
  datasets: DemoDataset[],
  labelOverride?: string,
): ExperimentListRow => {
  const dataset = datasets.find((entry) => entry.id === item.dataset_id);
  const targetName = item.target?.name ?? item.pipeline_version?.name ?? "Target";
  const targetVersion = item.target?.version ?? item.pipeline_version?.version ?? "--";

  return buildExperimentRowFromRun({
    experiment: createPlaceholderExperimentFromListItem(item),
    label: labelOverride ?? item.target?.label ?? targetName,
    evaluatorSummary: item.evaluator_summary,
    overallScore: item.overall_score ?? 0,
    datasetName: dataset?.name ?? item.dataset_id ?? "未绑定数据集",
    targetName,
    targetVersion,
    promptKey: targetName,
    promptDescription: item.description,
    promptVariableMappings: [],
    promptParams: { ...defaultPromptParams },
  });
};

const buildExperimentListItemFromRun = (input: {
  row: ExperimentListRow;
  experiment: ExperimentRun;
  datasetId: string;
  datasetName: string;
  targetName: string;
  targetVersion: string;
  selectedEvaluators: DemoEvaluator[];
}): ExperimentListItemRecord => ({
  id: input.row.id,
  creator: "system",
  description: `Run ${input.targetName} on ${input.datasetName} with ${input.selectedEvaluators.length} evaluator${
    input.selectedEvaluators.length === 1 ? "" : "s"
  }.`,
  dataset_id: input.datasetId,
  target: input.experiment.targetSelection
    ? {
        id: input.experiment.targetSelection.id,
        type: input.experiment.targetSelection.type,
        name: input.targetName,
        version: input.experiment.targetSelection.version,
        label: input.experiment.targetSelection.label,
      }
    : undefined,
  pipeline_version: undefined,
  evaluator_summary: input.row.evaluatorSummary ?? {
    total_count: 0,
    names: [],
    by_layer: [],
  },
  status: input.experiment.status,
  case_count: input.experiment.summary.totalCases,
  completed_case_count: input.experiment.summary.completedCases,
  failed_case_count: input.experiment.summary.failedCases,
  invalid_judgment_count: input.experiment.summary.invalidJudgmentCount,
  started_at: input.experiment.startedAt ?? null,
  finished_at: input.experiment.finishedAt ?? null,
});

const navGroups: Array<{
  title: string;
  items: Array<{ key: ActiveView; label: string }>;
}> = [
  {
    title: "Targets",
    items: [
      { key: "prompt_dev", label: "Prompts" },
      { key: "playground", label: "Agents" },
    ],
  },
  {
    title: "评测",
    items: [
      { key: "datasets", label: "评测集" },
      { key: "evaluators", label: "评估器" },
      { key: "experiment_runs", label: "实验运行" },
      { key: "ab_experiments", label: "AB 实验" },
    ],
  },
  {
    title: "观测",
    items: [
      { key: "trace", label: "Trace" },
      { key: "stats", label: "统计" },
      { key: "automation", label: "自动化任务" },
    ],
  },
];

const formatMetric = (value: number) => {
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }

  return value.toFixed(3);
};

const formatDelta = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;

const formatDate = (value?: string) => {
  if (!value) {
    return "未开始";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(date)
    .replace(/\//g, "-");
};

const metricScore = (value: MetricResult["score"]) => (typeof value === "number" ? value : 0);

const average = (values: number[]) =>
  values.length > 0 ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : 0;

const averageLayerScore = (metrics: MetricResult[], layer: DisplayLayer) =>
  average(metrics.filter((metric) => metric.layer === layer).map((metric) => metricScore(metric.score)));

const statusTone = (value: number) => {
  if (value > 0.03) {
    return "is-success";
  }
  if (value < -0.03) {
    return "is-danger";
  }
  return "is-warning";
};

const experimentStatusCategory = (status: ExperimentStatus) => {
  if (status === "FAILED") {
    return "failed";
  }

  if (status === "FINISHED") {
    return "finished";
  }

  return "running";
};

const experimentStatusLabel = (status: ExperimentStatus) => {
  const category = experimentStatusCategory(status);
  if (category === "failed") {
    return "失败";
  }
  if (category === "finished") {
    return "完成";
  }
  return "进行中";
};

const caseExecutionStatusLabel = (status: CaseExecutionStatus) => {
  if (status === "failed") {
    return "失败";
  }

  if (status === "pending") {
    return "进行中";
  }

  return "成功";
};

const caseExecutionStatusClass = (status: CaseExecutionStatus) => {
  if (status === "failed") {
    return "failed";
  }

  if (status === "pending") {
    return "pending";
  }

  return "finished";
};

const isExperimentInFlight = (status: ExperimentStatus) => status === "CREATED" || status === "RUNNING";

const deriveCaseExecutionStatus = (
  caseRun: ExperimentCaseRun,
  experimentStatus: ExperimentStatus,
  traceError?: string | null,
): CaseExecutionStatus => {
  const hasOutput = Boolean(caseRun.output.trim());
  const hasScores = caseRun.scores.length > 0;
  const hasExplicitError = Boolean(traceError?.trim());

  if (caseRun.status === "runtime_error" || caseRun.status === "invalid_judgment" || hasExplicitError) {
    return "failed";
  }

  if (!hasOutput || !hasScores) {
    return isExperimentInFlight(experimentStatus) ? "pending" : "failed";
  }

  return "success";
};

const deriveCaseFailureReason = (
  caseRun: ExperimentCaseRun,
  caseStatus: CaseExecutionStatus,
  traceError?: string | null,
): string | null => {
  if (caseStatus === "success") {
    return null;
  }

  if (caseStatus === "pending") {
    return "当前 case 仍在执行中，等待模型输出或评分结果。";
  }

  const metricFailure = caseRun.scores.find((metric) => metric.status !== "success" && metric.reason.trim());
  if (traceError?.trim()) {
    return traceError.trim();
  }

  if (metricFailure?.reason.trim()) {
    return metricFailure.reason.trim();
  }

  if (!caseRun.output.trim()) {
    return "模型未返回输出，未生成可评估结果。";
  }

  if (!caseRun.scores.length) {
    return "未生成评分结果，实验执行未完成。";
  }

  return "实验执行失败。";
};

const experimentStatusTooltip = (row: ExperimentListRow) => {
  const failedCases = row.experiment.summary.failedCases;
  const invalidJudgmentCount = row.experiment.summary.invalidJudgmentCount;
  const totalCases = row.experiment.summary.totalCases;

  if (row.status === "FAILED") {
    if (failedCases > 0 || invalidJudgmentCount > 0) {
      return `本次实验未成功完成：共 ${totalCases} 条样本，其中 ${failedCases} 条运行失败，${invalidJudgmentCount} 条判定无效。进入实验可查看具体 case、trace 和评分原因。`;
    }

    return "本次实验执行失败。进入实验可查看具体 case、trace 和评分原因。";
  }

  if (row.status === "FINISHED") {
    if (invalidJudgmentCount > 0) {
      return `本次实验已完成，但包含 ${invalidJudgmentCount} 条无效判定。进入实验可查看具体 case 和评分原因。`;
    }

    return "本次实验已完成。进入实验可查看数据明细、指标统计和实验配置。";
  }

  return "本次实验仍在运行中。进入实验可查看当前进度和样本执行情况。";
};

const formatCaseValue = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
};

const datasetCaseInput = (value: DatasetCaseRecord | undefined) => {
  if (!value) {
    return "--";
  }

  if ("input" in value) {
    return value.input;
  }

  return value.trace_id;
};

const datasetCaseReferenceOutput = (value: DatasetCaseRecord | undefined) => {
  if (!value) {
    return "--";
  }

  if ("reference_output" in value) {
    return value.reference_output || "--";
  }

  if ("workflow_output" in value) {
    return JSON.stringify(value.workflow_output);
  }

  return value.final_output;
};

const cloneDatasetCaseRecord = (value: DatasetCaseRecord): DatasetCaseRecord =>
  JSON.parse(JSON.stringify(value)) as DatasetCaseRecord;

const interpolatePromptTemplate = (template: string, payload: Record<string, unknown>) =>
  template.replace(/\{\{(.*?)\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim();
    const value = payload[key];
    if (value === undefined) {
      return `{{${key}}}`;
    }

    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  });

const buildPromptPreviewState = (prompt: PromptVersion | undefined, payloadRaw: string): PromptPreviewState => {
  if (!prompt) {
    return {
      payload: payloadRaw,
      rendered: "",
      error: "未选择 prompt。",
    };
  }

  try {
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    const rendered = `${prompt.systemPrompt}\n\n${interpolatePromptTemplate(prompt.userTemplate, payload)}`;
    return {
      payload: payloadRaw,
      rendered,
      error: null,
    };
  } catch (error) {
    return {
      payload: payloadRaw,
      rendered: "",
      error: error instanceof Error ? error.message : "JSON 解析失败",
    };
  }
};

const buildPromptDebugPayload = (prompt: PromptVersion | undefined) =>
  JSON.stringify(
    Object.fromEntries(Object.keys((prompt?.inputSchema as Record<string, unknown> | undefined) ?? {}).map((key) => [key, ""])),
    null,
    2,
  );

const buildSynthesisColumns = (dataset: DemoDataset | undefined): SynthesisColumnDraft[] =>
  (dataset?.columns ?? []).map((column) => ({
    name: column.name,
    enabled: true,
    description: column.description,
    requirement: "",
  }));

const buildEmptyDatasetCase = (datasetType: DatasetType): DatasetCaseRecord => {
  const id = `case_${Date.now().toString(36)}`;

  if (datasetType === "workflow") {
    return {
      id,
      input: "",
      workflow_output: {},
      expected_steps: [],
      context: {},
    };
  }

  if (datasetType === "trace_monitor") {
    return {
      id,
      trace_id: `trace_${Date.now().toString(36)}`,
      final_output: "",
      trajectory: [],
      context: {},
    };
  }

  return {
    id,
    input: "",
    reference_output: "",
    context: {},
  };
};

const agentCompositionSummary = (agent: AgentRecord) =>
  agent.composition && agent.composition.length > 0 ? `${agent.composition.length} modules` : "No composition";

const agentModeLabel = (agent: AgentRecord) =>
  agent.composition && agent.composition.length > 0 ? "Advanced" : "Simple";

const caseTitleMap = (viewModel: DemoViewModel) =>
  new Map(viewModel.sampleCases.map((sample) => [sample.caseId, sample.userQuery]));

const buildTraceRows = (
  rows: ExperimentListRow[],
  titles: Map<string, string>,
): TraceListRow[] =>
  rows.flatMap((row) =>
    row.experiment.caseRuns.map((caseRun) => ({
      key: `${row.id}:${caseRun.trace.traceId}`,
      traceId: caseRun.trace.traceId,
      experimentId: row.id,
      experimentLabel: row.label,
      caseId: caseRun.caseId,
      title: titles.get(caseRun.caseId) ?? caseRun.caseId,
      trace: caseRun.trace,
      caseRun,
    })),
  );

const Drawer = ({
  open,
  title,
  subtitle,
  onClose,
  wide = false,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) =>
  open ? (
    <div className="overlay overlay--drawer" role="presentation" onClick={onClose}>
      <aside
        className={`drawer ${wide ? "drawer--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer__header">
          <div>
            <h3>{title}</h3>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close drawer">
            ×
          </button>
        </div>
        <div className="drawer__body">{children}</div>
      </aside>
    </div>
  ) : null;

const Modal = ({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) =>
  open ? (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div className="overlay-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="overlay-card__header">
          <div>
            <h3>{title}</h3>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </div>
        <div className="overlay-card__body">{children}</div>
      </div>
    </div>
  ) : null;

export const App = () => {
  const [viewModel, setViewModel] = useState<DemoViewModel>(demoViewModel);
  const [syncState, setSyncState] = useState<"syncing" | "ready" | "fallback">("syncing");
  const [activeView, setActiveView] = useState<ActiveView>("datasets");

  const [createdDatasets, setCreatedDatasets] = useState<DemoDataset[]>([]);
  const [createdPrompts, setCreatedPrompts] = useState<PromptVersion[]>([]);
  const [createdAgents, setCreatedAgents] = useState<AgentRecord[]>([]);
  const [remoteAgents, setRemoteAgents] = useState<AgentRecord[]>(() => sampleAgents.map(mapLegacyAgentToRecord));
  const [editedDatasets, setEditedDatasets] = useState<Record<string, DemoDataset>>({});
  const [editedPrompts, setEditedPrompts] = useState<Record<string, PromptVersion>>({});
  const [createdEvaluators, setCreatedEvaluators] = useState<DemoEvaluator[]>([]);
  const [experimentItems, setExperimentItems] = useState<ExperimentListItemRecord[]>([]);
  const [experimentListSyncState, setExperimentListSyncState] = useState<"syncing" | "ready" | "error">("syncing");
  const [experimentRunOverrides, setExperimentRunOverrides] = useState<Record<string, ExperimentRun>>({});
  const [experimentLabelOverrides, setExperimentLabelOverrides] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") {
      return {};
    }

    try {
      const raw = window.localStorage.getItem(EXPERIMENT_LABEL_OVERRIDES_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });

  const [datasetQuery, setDatasetQuery] = useState("");
  const [agentQuery, setAgentQuery] = useState("");
  const [datasetTypeFilter, setDatasetTypeFilter] = useState<DatasetTypeFilter>("all");
  const [evaluatorQuery, setEvaluatorQuery] = useState("");
  const [evaluatorTemplateQuery, setEvaluatorTemplateQuery] = useState("");
  const [traceQuery, setTraceQuery] = useState("");
  const [experimentQuery, setExperimentQuery] = useState("");
  const [experimentStatusFilter, setExperimentStatusFilter] = useState<"all" | "running" | "finished" | "failed">("all");

  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [selectedDatasetCaseId, setSelectedDatasetCaseId] = useState<string>("");
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [selectedEvaluatorId, setSelectedEvaluatorId] = useState<string>("");
  const [selectedExperimentId, setSelectedExperimentId] = useState<string>("");
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [selectedTraceKey, setSelectedTraceKey] = useState<string>("");

  const [runLayer, setRunLayer] = useState<DisplayLayer>("overall");
  const [evaluatorLayer, setEvaluatorLayer] = useState<DisplayLayer>("retrieval");
  const [abLayer, setAbLayer] = useState<DisplayLayer>("overall");

  const [showDatasetCreate, setShowDatasetCreate] = useState(false);
  const [showDatasetEdit, setShowDatasetEdit] = useState(false);
  const [showPromptCreateModal, setShowPromptCreateModal] = useState(false);
  const [showAgentCreate, setShowAgentCreate] = useState(false);
  const [showEvaluatorTypeModal, setShowEvaluatorTypeModal] = useState(false);
  const [showEvaluatorCreate, setShowEvaluatorCreate] = useState(false);
  const [showExperimentCreate, setShowExperimentCreate] = useState(false);
  const [showDatasetDrawer, setShowDatasetDrawer] = useState(false);
  const [showDatasetCaseDrawer, setShowDatasetCaseDrawer] = useState(false);
  const [showDatasetCaseEditor, setShowDatasetCaseEditor] = useState(false);
  const [showPromptDrawer, setShowPromptDrawer] = useState(false);
  const [showEvaluatorDrawer, setShowEvaluatorDrawer] = useState(false);
  const [showExperimentCaseDrawer, setShowExperimentCaseDrawer] = useState(false);
  const [showExperimentDetail, setShowExperimentDetail] = useState(false);
  const [showComparisonDrawer, setShowComparisonDrawer] = useState(false);
  const [showTraceDrawer, setShowTraceDrawer] = useState(false);
  const [experimentCreateStep, setExperimentCreateStep] = useState<ExperimentCreateStep>(1);

  const [selectedEvaluatorFamily, setSelectedEvaluatorFamily] = useState<EvaluatorFamilyChoice | null>(null);
  const [evaluatorCatalogTab, setEvaluatorCatalogTab] = useState<"self_built" | "preset">("preset");
  const [evaluatorFamilyFilter, setEvaluatorFamilyFilter] = useState<"all" | "model" | "code">("all");
  const [evaluatorTemplateLayerFilter, setEvaluatorTemplateLayerFilter] = useState<DisplayLayer | "all">("all");
  const [agentSyncState, setAgentSyncState] = useState<"syncing" | "ready" | "fallback">("syncing");
  const [agentFeedback, setAgentFeedback] = useState<{ tone: "success" | "warning"; message: string } | null>(null);
  const [experimentFeedback, setExperimentFeedback] = useState<{ tone: "success" | "warning"; message: string } | null>(null);
  const [datasetDetailTab, setDatasetDetailTab] = useState<DatasetDetailTab>("evaluation_set");
  const [agentCreateStep, setAgentCreateStep] = useState<AgentCreateStep>(1);
  const [agentCreateMode, setAgentCreateMode] = useState<AgentCreateMode>("simple");
  const [experimentTab, setExperimentTab] = useState<ExperimentTab>("data_detail");
  const [selectedIndicatorMetric, setSelectedIndicatorMetric] = useState<string>("");
  const [experimentSubmitting, setExperimentSubmitting] = useState(false);
  const [editingDatasetId, setEditingDatasetId] = useState<string>("");
  const [datasetSubmitting, setDatasetSubmitting] = useState(false);
  const [datasetFeedback, setDatasetFeedback] = useState<{ tone: "success" | "warning"; message: string } | null>(
    null,
  );
  const [synthesisSource, setSynthesisSource] = useState<"dataset" | "online">("dataset");
  const [synthesisStep, setSynthesisStep] = useState<1 | 2>(1);
  const [synthesisScenario, setSynthesisScenario] = useState("");
  const [synthesisPurpose, setSynthesisPurpose] = useState("");
  const [synthesisDirection, setSynthesisDirection] = useState<SynthesisDirection>("generalize");
  const [synthesisSampleCount, setSynthesisSampleCount] = useState(10);
  const [synthesisColumns, setSynthesisColumns] = useState<SynthesisColumnDraft[]>([]);
  const [datasetCasesLoading, setDatasetCasesLoading] = useState(false);
  const [datasetCaseSubmitting, setDatasetCaseSubmitting] = useState(false);
  const [datasetCaseDraft, setDatasetCaseDraft] = useState<DatasetCaseRecord | null>(null);
  const [datasetCaseEditorMode, setDatasetCaseEditorMode] = useState<"create" | "edit">("edit");
  const [datasetCaseJsonDrafts, setDatasetCaseJsonDrafts] = useState<Record<string, string>>({});
  const [datasetCaseFormError, setDatasetCaseFormError] = useState<string | null>(null);
  const [synthesisLoading, setSynthesisLoading] = useState(false);
  const [datasetSynthesisResult, setDatasetSynthesisResult] = useState<DatasetSynthesisResult | null>(null);
  const [promptDraft, setPromptDraft] = useState<PromptVersion | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentFormState | null>(null);
  const [promptDebugPayload, setPromptDebugPayload] = useState("{}");
  const [promptParameterDraft, setPromptParameterDraft] = useState({
    model: "Gemini",
    temperature: "0.2",
    maxTokens: "1024",
    topP: "1",
  });

  const [datasetForm, setDatasetForm] = useState<DatasetFormState>(createEmptyDatasetForm);
  const [evaluatorForm, setEvaluatorForm] = useState<EvaluatorFormState>({
    name: "",
    layer: "retrieval",
    metricType: "continuous",
    description: "",
    codeStrategy: "exact_match",
  });
  const [experimentForm, setExperimentForm] = useState<ExperimentFormState>({
    name: "",
    description: "",
    datasetId: "",
    promptKey: promptExperimentCatalog[0]?.name ?? "",
    promptVersion: promptExperimentCatalog[0]?.version ?? "",
    promptParams: { ...defaultPromptParams },
    evaluatorIds: [],
    evaluatorVersions: {},
  });

  useEffect(() => {
    let active = true;

    const sync = async () => {
      try {
        const remoteViewModel = await loadRemoteDemoViewModel();
        if (!active) {
          return;
        }

        setViewModel(remoteViewModel);
        setSyncState("ready");
      } catch {
        if (!active) {
          return;
        }

        setSyncState("fallback");
      }
    };

    void sync();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const syncAgents = async () => {
      try {
        const response = await fetchAgentsRequest();
        if (!active) {
          return;
        }

        setRemoteAgents(response.items);
        setAgentSyncState("ready");
      } catch {
        if (!active) {
          return;
        }

        setAgentSyncState("fallback");
      }
    };

    void syncAgents();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const syncExperimentItems = async () => {
      try {
        const response = await fetchExperimentItemsRequest();
        if (!active) {
          return;
        }

        setExperimentItems(response.items);
        setExperimentListSyncState("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setExperimentItems([]);
        setExperimentListSyncState("error");
        setExperimentFeedback({
          tone: "warning",
          message: error instanceof Error ? error.message : "实验列表加载失败。",
        });
      }
    };

    void syncExperimentItems();

    return () => {
      active = false;
    };
  }, []);

  const caseTitles = useMemo(() => caseTitleMap(viewModel), [viewModel]);

  const allDatasets = useMemo(
    () => [...createdDatasets, ...viewModel.datasets].map((dataset) => editedDatasets[dataset.id] ?? dataset),
    [createdDatasets, editedDatasets, viewModel.datasets],
  );
  const experimentSelectableDatasets = useMemo(
    () => allDatasets.filter((dataset) => dataset.source === "remote" && dataset.datasetType === "ideal_output"),
    [allDatasets],
  );
  const allPrompts = useMemo(
    () => [...createdPrompts, ...samplePrompts].map((prompt) => editedPrompts[prompt.id] ?? prompt),
    [createdPrompts, editedPrompts],
  );
  const allAgents = useMemo(() => [...createdAgents, ...remoteAgents], [createdAgents, remoteAgents]);
  const allEvaluators = useMemo(
    () => [...createdEvaluators, ...viewModel.evaluators],
    [createdEvaluators, viewModel.evaluators],
  );
  const remoteExperimentRows = useMemo(
    () =>
      experimentItems
        .map((item) => mapExperimentItemToRow(item, allDatasets, experimentLabelOverrides[item.id]))
        .sort((left, right) =>
          (right.finishedAt ?? right.startedAt ?? "").localeCompare(left.finishedAt ?? left.startedAt ?? ""),
        ),
    [allDatasets, experimentItems, experimentLabelOverrides],
  );
  const allExperimentRows = useMemo(
    () =>
      remoteExperimentRows.map((row) => {
        const override = experimentRunOverrides[row.id];
        const source = row.source ?? "remote";

        if (!override) {
          return {
            ...row,
            source,
          };
        }

        return {
          ...row,
          source,
          status: override.status,
          evaluatorSummary: row.evaluatorSummary,
          totalCases: override.summary.totalCases,
          invalidJudgmentCount: override.summary.invalidJudgmentCount,
          overallScore: averageLayerScore(override.caseRuns.flatMap((caseRun) => caseRun.layerMetrics), "overall"),
          startedAt: override.startedAt,
          finishedAt: override.finishedAt,
          experiment: override,
        };
      }),
    [experimentRunOverrides, remoteExperimentRows],
  );
  const filteredExperimentRows = useMemo(
    () =>
      allExperimentRows.filter((row) => {
        const matchesQuery = [row.label, row.datasetName, row.targetName, row.targetVersion]
          .join(" ")
          .toLowerCase()
          .includes(experimentQuery.trim().toLowerCase());
        const rowStatusCategory = experimentStatusCategory(row.status);
        const matchesStatus = experimentStatusFilter === "all" || rowStatusCategory === experimentStatusFilter;
        return matchesQuery && matchesStatus;
      }),
    [allExperimentRows, experimentQuery, experimentStatusFilter],
  );
  const allTraceRows = useMemo(() => buildTraceRows(allExperimentRows, caseTitles), [allExperimentRows, caseTitles]);

  useEffect(() => {
    if (!selectedDatasetId && allDatasets.length > 0) {
      setSelectedDatasetId(allDatasets[0]!.id);
      setExperimentForm((current) => ({
        ...current,
        datasetId: experimentSelectableDatasets[0]?.id ?? allDatasets[0]!.id,
      }));
    }
  }, [allDatasets, experimentSelectableDatasets, selectedDatasetId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        EXPERIMENT_LABEL_OVERRIDES_STORAGE_KEY,
        JSON.stringify(experimentLabelOverrides),
      );
    } catch {
      // Ignore storage errors and keep the current in-memory mapping.
    }
  }, [experimentLabelOverrides]);

  useEffect(() => {
    if (experimentSelectableDatasets.length === 0) {
      return;
    }

    const hasSelectedDataset = experimentSelectableDatasets.some((dataset) => dataset.id === experimentForm.datasetId);
    if (!experimentForm.datasetId || experimentForm.datasetId.startsWith("dataset_local_") || !hasSelectedDataset) {
      setExperimentForm((current) => ({
        ...current,
        datasetId: experimentSelectableDatasets[0]!.id,
      }));
    }
  }, [experimentForm.datasetId, experimentSelectableDatasets]);

  useEffect(() => {
    if (!selectedEvaluatorId && allEvaluators.length > 0) {
      setSelectedEvaluatorId(allEvaluators[0]!.id);
    }
  }, [allEvaluators, selectedEvaluatorId]);

  useEffect(() => {
    if (!selectedPromptId && allPrompts.length > 0) {
      setSelectedPromptId(allPrompts[0]!.id);
    }
  }, [allPrompts, selectedPromptId]);

  useEffect(() => {
    if (!selectedAgentId && allAgents.length > 0) {
      setSelectedAgentId(allAgents[0]!.id);
    }
  }, [allAgents, selectedAgentId]);

  useEffect(() => {
    if (!selectedExperimentId && allExperimentRows.length > 0) {
      setSelectedExperimentId(allExperimentRows[0]!.id);
    }
  }, [allExperimentRows, selectedExperimentId]);

  useEffect(() => {
    if (!selectedTraceKey && allTraceRows.length > 0) {
      setSelectedTraceKey(allTraceRows[0]!.key);
    }
  }, [allTraceRows, selectedTraceKey]);

  const filteredDatasets = useMemo(
    () =>
      allDatasets.filter((dataset) => {
        const matchesType = datasetTypeFilter === "all" || dataset.datasetType === datasetTypeFilter;
        const matchesQuery = [dataset.name, dataset.description, datasetTypeLabels[dataset.datasetType]]
          .join(" ")
          .toLowerCase()
          .includes(datasetQuery.trim().toLowerCase());
        return matchesType && matchesQuery;
      }),
    [allDatasets, datasetQuery, datasetTypeFilter],
  );

  const filteredAgents = useMemo(
    () =>
      allAgents.filter((agent) =>
        [agent.name, agent.version, agent.scenario, agent.description ?? "", agent.entry_type, agent.artifact_ref]
          .join(" ")
          .toLowerCase()
          .includes(agentQuery.trim().toLowerCase()),
      ),
    [allAgents, agentQuery],
  );

  const datasetTypeCounts = useMemo(
    () => ({
      all: allDatasets.length,
      ideal_output: allDatasets.filter((dataset) => dataset.datasetType === "ideal_output").length,
      workflow: allDatasets.filter((dataset) => dataset.datasetType === "workflow").length,
      trace_monitor: allDatasets.filter((dataset) => dataset.datasetType === "trace_monitor").length,
    }),
    [allDatasets],
  );

  const filteredEvaluators = useMemo(
    () =>
      (evaluatorCatalogTab === "self_built"
        ? createdEvaluators
        : viewModel.evaluators
      ).filter((evaluator) => {
        const matchesFamily = evaluatorFamilyFilter === "all" || evaluator.evaluatorFamily === evaluatorFamilyFilter;
        const matchesLayer = evaluator.layer === evaluatorLayer;
        const matchesQuery = [evaluator.name, evaluator.description]
          .join(" ")
          .toLowerCase()
          .includes(evaluatorQuery.trim().toLowerCase());
        return matchesFamily && matchesLayer && matchesQuery;
      }),
    [createdEvaluators, evaluatorCatalogTab, evaluatorFamilyFilter, evaluatorLayer, evaluatorQuery, viewModel.evaluators],
  );

  const evaluatorTemplateCandidates = useMemo(
    () =>
      allEvaluators.filter((evaluator) => {
        const matchesFamily = selectedEvaluatorFamily ? evaluator.evaluatorFamily === selectedEvaluatorFamily : true;
        const matchesLayer =
          evaluatorTemplateLayerFilter === "all" ? true : evaluator.layer === evaluatorTemplateLayerFilter;
        const matchesQuery = [evaluator.name, evaluator.description, evaluator.layer, evaluator.metricType]
          .join(" ")
          .toLowerCase()
          .includes(evaluatorTemplateQuery.trim().toLowerCase());
        return matchesFamily && matchesLayer && matchesQuery;
      }),
    [allEvaluators, evaluatorTemplateLayerFilter, evaluatorTemplateQuery, selectedEvaluatorFamily],
  );

  const filteredTraceRows = useMemo(
    () =>
      allTraceRows.filter((row) =>
        [row.traceId, row.caseId, row.title, row.experimentLabel]
          .join(" ")
          .toLowerCase()
          .includes(traceQuery.trim().toLowerCase()),
      ),
    [allTraceRows, traceQuery],
  );

  const selectedDataset = allDatasets.find((dataset) => dataset.id === selectedDatasetId) ?? filteredDatasets[0];
  const preferredExperimentDatasetId =
    experimentSelectableDatasets.find((dataset) => dataset.id === selectedDatasetId)?.id ??
    experimentSelectableDatasets[0]?.id ??
    "";
  const synthesisDatasets = allDatasets.filter((dataset) => dataset.datasetType === "ideal_output");
  const selectedSynthesisDataset =
    synthesisDatasets.find((dataset) => dataset.id === selectedDatasetId) ?? synthesisDatasets[0];
  const selectedPrompt = allPrompts.find((prompt) => prompt.id === selectedPromptId) ?? allPrompts[0];
  const selectedAgent = allAgents.find((agent) => agent.id === selectedAgentId) ?? allAgents[0];
  const selectedEvaluator =
    allEvaluators.find((evaluator) => evaluator.id === selectedEvaluatorId) ?? filteredEvaluators[0] ?? allEvaluators[0];
  const selectedExperimentRow =
    allExperimentRows.find((experiment) => experiment.id === selectedExperimentId) ?? allExperimentRows[0];
  const selectedTraceRow = allTraceRows.find((trace) => trace.key === selectedTraceKey) ?? allTraceRows[0];
  const selectedDatasetCase =
    selectedDataset?.cases.find((item) => item.id === selectedDatasetCaseId) ?? selectedDataset?.cases[0];

  const startEvaluatorCreationFromTemplate = (template: DemoEvaluator) => {
    setSelectedEvaluatorFamily(template.evaluatorFamily);
    setEvaluatorForm({
      name: `${template.name} Copy`,
      layer: template.layer,
      metricType: template.metricType,
      description: template.description,
      codeStrategy: template.codeStrategy ?? "exact_match",
    });
    setEvaluatorTemplateQuery("");
    setEvaluatorTemplateLayerFilter("all");
    setShowEvaluatorTypeModal(false);
    setShowEvaluatorCreate(true);
  };

  useEffect(() => {
    if (!selectedDataset) {
      return;
    }

    if (selectedDataset.cases.length === 0) {
      setSelectedDatasetCaseId("");
      return;
    }

    const exists = selectedDataset.cases.some((item) => item.id === selectedDatasetCaseId);
    if (!selectedDatasetCaseId || !exists) {
      setSelectedDatasetCaseId(selectedDataset.cases[0]!.id);
    }
  }, [selectedDataset, selectedDatasetCaseId]);

  useEffect(() => {
    setSynthesisColumns(buildSynthesisColumns(selectedSynthesisDataset));
  }, [selectedSynthesisDataset]);

  const migratedCozePrompts = useMemo(
    () => allPrompts.filter((prompt) => prompt.version.includes("-coze") || prompt.id.includes("_coze_")),
    [allPrompts],
  );

  useEffect(() => {
    if (!selectedPrompt) {
      setPromptDraft(null);
      return;
    }

    setPromptDraft({ ...selectedPrompt });
  }, [selectedPrompt]);

  useEffect(() => {
    if (!selectedPrompt) {
      setPromptDebugPayload("{}");
      return;
    }

    setPromptDebugPayload(buildPromptDebugPayload(selectedPrompt));
  }, [selectedPrompt?.id]);

  useEffect(() => {
    setPromptParameterDraft({
      model: "Gemini",
      temperature: "0.2",
      maxTokens: "1024",
      topP: "1",
    });
  }, [selectedPrompt?.id]);

  const promptPreview = useMemo(
    () => buildPromptPreviewState(promptDraft ?? selectedPrompt, promptDebugPayload),
    [promptDebugPayload, promptDraft, selectedPrompt],
  );

  const latestAgentScores = useMemo(() => {
    const rows = [...allExperimentRows].sort((left, right) =>
      (right.finishedAt ?? right.startedAt ?? "").localeCompare(left.finishedAt ?? left.startedAt ?? ""),
    );
    const scores = new Map<string, number>();

    rows.forEach((row) => {
      const key = `${row.targetName}::${row.targetVersion}`;
      if (!scores.has(key)) {
        scores.set(key, row.overallScore);
      }
    });

    return scores;
  }, [allExperimentRows]);
  const selectedAgentLastScore = selectedAgent
    ? latestAgentScores.get(`${selectedAgent.name}::${selectedAgent.version}`)
    : undefined;

  const selectedExperimentDataset = selectedExperimentRow
    ? allDatasets.find((dataset) => dataset.id === selectedExperimentRow.experiment.datasetId)
    : undefined;
  const selectedExperimentEvaluators = selectedExperimentRow
    ? selectedExperimentRow.experiment.evaluatorIds
        .map((id) => allEvaluators.find((evaluator) => evaluator.id === id))
        .filter((value): value is DemoEvaluator => Boolean(value))
    : [];
  const selectedExperimentSummary = selectedExperimentRow?.experiment.summary;
  const selectedExperimentMetricSummaries = selectedExperimentSummary?.metricSummaries ?? [];
  const selectedExperimentLayerSummaries = selectedExperimentSummary?.layerSummaries ?? [];
  const selectedExperimentEvaluatorIdSet = useMemo(
    () => new Set(selectedExperimentRow?.experiment.evaluatorIds ?? []),
    [selectedExperimentRow],
  );

  const currentExperimentTraceMap = useMemo(() => {
    if (!selectedExperimentRow) {
      return new Map<string, TraceListRow>();
    }

    return new Map(
      allTraceRows
        .filter((row) => row.experimentId === selectedExperimentRow.id)
        .map((row) => [row.traceId, row]),
    );
  }, [allTraceRows, selectedExperimentRow]);

  const currentLayerMetricColumns = useMemo(() => {
    if (!selectedExperimentRow) {
      return [];
    }

    const layerEvaluators = selectedExperimentEvaluators.filter((evaluator) => evaluator.layer === runLayer);
    if (layerEvaluators.length > 0) {
      return layerEvaluators.map((evaluator) => ({
        key: evaluator.id,
        label: evaluator.name,
        evaluatorId: evaluator.id,
        metricName: evaluator.name,
      }));
    }

    const metricNames =
      selectedExperimentMetricSummaries.length > 0
        ? Array.from(
            new Set(
              selectedExperimentMetricSummaries
                .filter((metric) => metric.layer === runLayer)
                .map((metric) => metric.metricName),
            ),
          )
        : Array.from(
            new Set(
              selectedExperimentRow.experiment.caseRuns.flatMap((caseRun) =>
                caseRun.layerMetrics
                  .filter(
                    (metric) =>
                      metric.layer === runLayer &&
                      (!metric.evaluatorId || selectedExperimentEvaluatorIdSet.has(metric.evaluatorId)),
                  )
                  .map((metric) => metric.metricName),
              ),
            ),
          );

    return metricNames.map((metricName) => ({
      key: metricName,
      label: metricName,
      evaluatorId: undefined,
      metricName,
    }));
  }, [
    runLayer,
    selectedExperimentEvaluators,
    selectedExperimentEvaluatorIdSet,
    selectedExperimentMetricSummaries,
    selectedExperimentRow,
  ]);

  const currentRunCases = useMemo(() => {
    if (!selectedExperimentRow) {
      return [];
    }

    const datasetCaseMap = new Map((selectedExperimentDataset?.cases ?? []).map((item) => [item.id, item]));

    return selectedExperimentRow.experiment.caseRuns.map((caseRun): ExperimentCaseTableRow => ({
      caseRun,
      title: caseTitles.get(caseRun.caseId) ?? caseRun.caseId,
      datasetCase: datasetCaseMap.get(caseRun.caseId),
      layerScore: averageLayerScore(caseRun.layerMetrics, runLayer),
      overallScore: averageLayerScore(caseRun.layerMetrics, "overall"),
      status: deriveCaseExecutionStatus(
        caseRun,
        selectedExperimentRow.experiment.status,
        currentExperimentTraceMap.get(caseRun.traceId)?.trace.error ?? caseRun.trace.error ?? null,
      ),
      failureReason: deriveCaseFailureReason(
        caseRun,
        deriveCaseExecutionStatus(
          caseRun,
          selectedExperimentRow.experiment.status,
          currentExperimentTraceMap.get(caseRun.traceId)?.trace.error ?? caseRun.trace.error ?? null,
        ),
        currentExperimentTraceMap.get(caseRun.traceId)?.trace.error ?? caseRun.trace.error ?? null,
      ),
      evaluatorScores: Object.fromEntries(
        currentLayerMetricColumns.map((column) => {
          const metric = caseRun.layerMetrics.find((item) =>
            item.layer === runLayer &&
            (column.evaluatorId ? item.evaluatorId === column.evaluatorId : item.metricName === column.metricName) &&
            (!item.evaluatorId || selectedExperimentEvaluatorIdSet.has(item.evaluatorId))
          );

          return [column.key, metric ? metricScore(metric.score) : undefined];
        }),
      ),
    }));
  }, [
    caseTitles,
    currentLayerMetricColumns,
    currentExperimentTraceMap,
    runLayer,
    selectedExperimentDataset,
    selectedExperimentEvaluatorIdSet,
    selectedExperimentRow,
  ]);

  useEffect(() => {
    if (!currentRunCases.length) {
      setSelectedCaseId("");
      return;
    }

    if (!selectedCaseId || !currentRunCases.some((item) => item.caseRun.caseId === selectedCaseId)) {
      setSelectedCaseId(currentRunCases[0]!.caseRun.caseId);
    }
  }, [currentRunCases, selectedCaseId]);

  const selectedRunCase =
    currentRunCases.find((item) => item.caseRun.caseId === selectedCaseId)?.caseRun ?? currentRunCases[0]?.caseRun;
  const selectedRunCaseRow =
    currentRunCases.find((item) => item.caseRun.caseId === selectedCaseId) ?? currentRunCases[0];
  const selectedRunCaseStatus = selectedRunCaseRow?.status ?? "pending";
  const selectedRunCaseFailureReason = selectedRunCaseRow?.failureReason ?? null;

  const selectedRunTraceRow =
    selectedRunCase && selectedExperimentRow
      ? allTraceRows.find(
          (row) => row.traceId === selectedRunCase.traceId && row.experimentId === selectedExperimentRow.id,
        ) ?? allTraceRows.find((row) => row.traceId === selectedRunCase.traceId)
      : undefined;

  const experimentStatisticsByLayer = useMemo(
    () => {
      if (selectedExperimentMetricSummaries.length > 0) {
        return layerOrder.map((layer) => ({
          layer,
          metrics: selectedExperimentMetricSummaries
            .filter((metric) => metric.layer === layer)
            .map((metric) => ({
              metricName: metric.metricName,
              average: metric.averageScore ?? 0,
            }))
            .sort((left, right) => right.average - left.average),
        }));
      }

      return layerOrder.map((layer) => {
        const metricMap = new Map<string, number[]>();

        selectedExperimentRow?.experiment.caseRuns.forEach((caseRun) => {
          caseRun.layerMetrics
            .filter((metric) => metric.layer === layer)
            .forEach((metric) => {
              const current = metricMap.get(metric.metricName) ?? [];
              current.push(metricScore(metric.score));
              metricMap.set(metric.metricName, current);
            });
        });

        return {
          layer,
          metrics: Array.from(metricMap.entries())
            .map(([metricName, scores]) => ({
              metricName,
              average: average(scores),
            }))
            .sort((left, right) => right.average - left.average),
        };
      });
    },
    [selectedExperimentMetricSummaries, selectedExperimentRow],
  );

  const allStatisticMetricNames = useMemo(
    () =>
      Array.from(
        new Set(experimentStatisticsByLayer.flatMap((section) => section.metrics.map((metric) => metric.metricName))),
      ),
    [experimentStatisticsByLayer],
  );

  const selectedStatisticMetricNames = useMemo(
    () => experimentStatisticsByLayer.find((section) => section.layer === runLayer)?.metrics.map((metric) => metric.metricName) ?? [],
    [experimentStatisticsByLayer, runLayer],
  );

  useEffect(() => {
    const nextMetrics = selectedStatisticMetricNames.length > 0 ? selectedStatisticMetricNames : allStatisticMetricNames;

    if (!nextMetrics.length) {
      setSelectedIndicatorMetric("");
      return;
    }

    if (!selectedIndicatorMetric || !nextMetrics.includes(selectedIndicatorMetric)) {
      setSelectedIndicatorMetric(nextMetrics[0]!);
    }
  }, [allStatisticMetricNames, selectedIndicatorMetric, selectedStatisticMetricNames]);

  const selectedMetricDistribution = useMemo(
    () =>
      (selectedExperimentRow?.experiment.caseRuns ?? [])
        .map((item) => ({
          caseId: item.caseId,
          title: caseTitles.get(item.caseId) ?? item.caseId,
          score:
            metricScore(
              item.layerMetrics.find(
                (metric) =>
                  metric.layer === runLayer &&
                  metric.metricName === selectedIndicatorMetric &&
                  (!metric.evaluatorId || selectedExperimentEvaluatorIdSet.has(metric.evaluatorId)),
              )?.score ?? 0,
            ),
        }))
        .sort((left, right) => right.score - left.score),
    [caseTitles, runLayer, selectedExperimentEvaluatorIdSet, selectedExperimentRow, selectedIndicatorMetric],
  );

  const selectedExperimentLatency = useMemo(() => {
    if (!selectedExperimentRow) {
      return null;
    }

    const traces = selectedExperimentRow.experiment.caseRuns
      .map((caseRun) =>
        allTraceRows.find(
          (trace) => trace.traceId === caseRun.traceId && trace.experimentId === selectedExperimentRow.id,
        ),
      )
      .filter((value): value is TraceListRow => Boolean(value));

    if (!traces.length) {
      return null;
    }

    return {
      retrieval: average(traces.map((trace) => trace.trace.retrievalTrace.latencyMs)),
      rerank: average(traces.map((trace) => trace.trace.rerankTrace.latencyMs)),
      answer: average(traces.map((trace) => trace.trace.answerTrace.latencyMs)),
      total: average(
        traces.map(
          (trace) =>
            trace.trace.retrievalTrace.latencyMs +
            trace.trace.rerankTrace.latencyMs +
            trace.trace.answerTrace.latencyMs,
        ),
      ),
    };
  }, [allTraceRows, selectedExperimentRow]);

  const experimentProgress = useMemo(() => {
    if (!selectedExperimentRow) {
      return { total: 0, success: 0, failure: 0, pending: 0 };
    }

    const total = currentRunCases.length;
    const success = currentRunCases.filter((item) => item.status === "success").length;
    const failure = currentRunCases.filter((item) => item.status === "failed").length;
    const pending = currentRunCases.filter((item) => item.status === "pending").length;

    return {
      total,
      success,
      failure,
      pending,
    };
  }, [currentRunCases, selectedExperimentRow]);

  const experimentMetaItems = useMemo(
    () =>
      [
        {
          label: "创建时间",
          value: formatDate(selectedExperimentRow?.startedAt),
        },
        {
          label: "结束时间",
          value: formatDate(selectedExperimentRow?.finishedAt),
        },
      ].filter((item) => item.value && item.value !== "--"),
    [selectedExperimentRow],
  );

  const experimentSummaryLayerItems = useMemo(
    () =>
      selectedExperimentLayerSummaries.length > 0
        ? selectedExperimentLayerSummaries.map((item) => ({
            layer: item.layer,
            label: `${experimentLayerLabels[item.layer]} (${item.evaluatorCount})`,
          }))
        : selectedExperimentEvaluators.length > 0
          ? layerOrder
              .map((layer) => ({
                layer,
                label: `${experimentLayerLabels[layer]} (${
                  selectedExperimentEvaluators.filter((evaluator) => evaluator.layer === layer).length
                })`,
              }))
              .filter((item) => !item.label.endsWith("(0)"))
          : [],
    [selectedExperimentEvaluators, selectedExperimentLayerSummaries],
  );

  const evidenceCases = useMemo(() => {
    const caseMap = new Map(viewModel.caseDetails.map((detail) => [detail.caseId, detail]));
    return viewModel.comparison.evidenceCaseIds
      .map((caseId) => caseMap.get(caseId))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .map((detail) => ({
        ...detail,
        selectedLayerDelta:
          abLayer === "overall"
            ? average(detail.deltas.map((item) => item.delta))
            : detail.deltas.find((item) => item.layer === abLayer)?.delta ?? 0,
      }));
  }, [abLayer, viewModel.caseDetails, viewModel.comparison.evidenceCaseIds]);

  const openTrace = (traceId: string, experimentId?: string) => {
    const targetTrace =
      allTraceRows.find(
        (row) => row.traceId === traceId && (experimentId ? row.experimentId === experimentId : true),
      ) ?? allTraceRows.find((row) => row.traceId === traceId);

    if (!targetTrace) {
      return;
    }

    setSelectedTraceKey(targetTrace.key);
    setActiveView("trace");
    setShowTraceDrawer(true);
  };

  const openExperimentCaseDrawer = (caseId: string) => {
    setSelectedCaseId(caseId);
    setShowExperimentCaseDrawer(true);
  };

  const openExperimentDetail = (experimentId: string) => {
    setSelectedExperimentId(experimentId);
    setExperimentTab("data_detail");
    setShowExperimentDetail(true);

    void (async () => {
      try {
        const response = await fetchExperimentRequest(experimentId);
        const experiment = mapExperimentRunRecordToExperiment(response.item);
        setExperimentRunOverrides((current) => ({
          ...current,
          [experimentId]: experiment,
        }));
      } catch (error) {
        setExperimentFeedback({
          tone: "warning",
          message: error instanceof Error ? error.message : "实验详情加载失败。",
        });
      }
    })();
  };

  const handleRetryCase = (caseId: string) => {
    setExperimentFeedback({
      tone: "warning",
      message: `Retry ${caseId} 入口已预留，等待真实 rerun API。`,
    });
  };

  const handleBatchRetry = () => {
    setExperimentFeedback({
      tone: "warning",
      message: "Batch retry 已预留入口，等待真实 rerun API。",
    });
  };

  const selectedRunCaseMetrics =
    selectedRunCase?.layerMetrics.filter(
      (metric) =>
        metric.layer === runLayer &&
        (!metric.evaluatorId || selectedExperimentEvaluatorIdSet.has(metric.evaluatorId)),
    ) ?? [];

  const resetDatasetComposer = () => {
    setShowDatasetCreate(false);
    setShowDatasetEdit(false);
    setEditingDatasetId("");
    setDatasetSubmitting(false);
    setDatasetFeedback(null);
    setDatasetSynthesisResult(null);
    setSynthesisStep(1);
    setSynthesisScenario("");
    setSynthesisPurpose("");
    setSynthesisDirection("generalize");
    setSynthesisSource("dataset");
    setSynthesisSampleCount(10);
    setShowDatasetCaseEditor(false);
    setShowDatasetCaseDrawer(false);
    setDatasetCaseDraft(null);
    setDatasetCaseEditorMode("edit");
    setDatasetCaseJsonDrafts({});
    setDatasetCaseFormError(null);
    setDatasetForm(createEmptyDatasetForm());
  };

  const startCreateDataset = () => {
    setShowDatasetEdit(false);
    setEditingDatasetId("");
    setDatasetFeedback(null);
    setDatasetDetailTab("evaluation_set");
    setDatasetForm(createEmptyDatasetForm());
    setShowDatasetCreate(true);
  };

  const openDatasetEditor = async (datasetId: string) => {
    const currentDataset = allDatasets.find((dataset) => dataset.id === datasetId);
    if (!currentDataset) {
      return;
    }

    setSelectedDatasetId(datasetId);
    setShowDatasetCreate(false);
    setShowDatasetEdit(true);
    setDatasetDetailTab("evaluation_set");
    setEditingDatasetId(datasetId);
    setDatasetFeedback(null);
    setShowDatasetCaseDrawer(false);
    setDatasetForm({
      name: currentDataset.name,
      description: currentDataset.description,
      datasetType: currentDataset.datasetType,
      sampleCount: currentDataset.itemCount,
      schema: currentDataset.columns.map((column) => ({ ...column })),
    });

    if (datasetId.startsWith("dataset_local_")) {
      return;
    }

    try {
      const response = await fetchDataset(datasetId);
      const latestDataset = mapDatasetRecordToDemoDataset(response.item);
      setEditedDatasets((current) => ({ ...current, [datasetId]: latestDataset }));
      setDatasetForm({
        name: latestDataset.name,
        description: latestDataset.description,
        datasetType: latestDataset.datasetType,
        sampleCount: latestDataset.itemCount,
        schema: latestDataset.columns.map((column) => ({ ...column })),
      });
    } catch {
      // Keep current UI snapshot when remote detail is unavailable.
    }

    try {
      setDatasetCasesLoading(true);
      const response = await fetchDatasetCases(datasetId);
      setEditedDatasets((current) => {
        const existing = current[datasetId] ?? currentDataset;
        return {
          ...current,
          [datasetId]: {
            ...existing,
            cases: response.items,
            itemCount: response.items.length,
          },
        };
      });
    } catch {
      // Keep current case list when list API is unavailable.
    } finally {
      setDatasetCasesLoading(false);
    }
  };

  const handleCreateDataset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (syncState !== "ready") {
      setDatasetFeedback({
        tone: "warning",
        message: "当前页面仍在 fallback mock 状态，不能创建真实评测集。先确认 /api/bootstrap 已连通。",
      });
      return;
    }

    const payload = {
      name: datasetForm.name.trim(),
      description: datasetForm.description.trim(),
      dataset_type: datasetForm.datasetType,
      sample_count: datasetForm.sampleCount,
      schema: datasetForm.schema.map((column) => ({ ...column })),
    } as const;

    if (payload.sample_count < 10) {
      setDatasetFeedback({
        tone: "warning",
        message: "评测集样本量至少为 10，才能通过后端校验。",
      });
      return;
    }

    void (async () => {
      try {
        setDatasetSubmitting(true);
        const response = await createDatasetRequest(payload);
        const createdDataset = mapDatasetRecordToDemoDataset(response.item);

        try {
          const remoteViewModel = await loadRemoteDemoViewModel();
          setViewModel(remoteViewModel);
          setSyncState("ready");
        } catch {
          setCreatedDatasets((current) => [
            createdDataset,
            ...current.filter((dataset) => dataset.id !== createdDataset.id),
          ]);
        }

        setEditedDatasets((current) => ({
          ...current,
          [createdDataset.id]: createdDataset,
        }));
        setSelectedDatasetId(createdDataset.id);
        setExperimentForm((current) => ({
          ...current,
          datasetId: createdDataset.id,
        }));
        setShowDatasetCreate(false);
        setShowDatasetEdit(false);
        setEditingDatasetId("");
        setDatasetFeedback({
          tone: "success",
          message: `评测集 ${createdDataset.name} 已创建，并已同步到真实数据源。`,
        });
        setDatasetForm(createEmptyDatasetForm());
      } catch (error) {
        setDatasetFeedback({
          tone: "warning",
          message:
            error instanceof Error
              ? `${error.message}；未生成本地数据集。`
              : "评测集创建失败，未生成本地数据集。",
        });
      } finally {
        setDatasetSubmitting(false);
      }
    })();
  };

  const handleUpdateDataset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editingDatasetId) {
      return;
    }

    const currentDataset = allDatasets.find((dataset) => dataset.id === editingDatasetId);
    if (!currentDataset) {
      return;
    }

    const payload: UpdateDatasetInput = {
      name: datasetForm.name.trim(),
      description: datasetForm.description.trim(),
      dataset_type: datasetForm.datasetType,
      sample_count: currentDataset.itemCount,
      schema: datasetForm.schema.map((column) => ({ ...column })),
    };

    setDatasetSubmitting(true);

    try {
      const response = await updateDatasetRequest(editingDatasetId, payload);
      const updatedDataset = mapDatasetRecordToDemoDataset(response.item);

      setEditedDatasets((current) => ({
        ...current,
        [editingDatasetId]: updatedDataset,
      }));
      setSelectedDatasetId(updatedDataset.id);
      setShowDatasetEdit(false);
      setEditingDatasetId("");
      setDatasetFeedback({
        tone: "success",
        message: "评测集已通过 update 接口更新。",
      });
      setDatasetForm(createEmptyDatasetForm());
    } catch {
      const fallbackDataset: DemoDataset = {
        ...currentDataset,
        name: payload.name,
        description: payload.description,
        datasetType: payload.dataset_type,
        columns: payload.schema,
        cases: currentDataset.cases,
      };

      setEditedDatasets((current) => ({
        ...current,
        [editingDatasetId]: fallbackDataset,
      }));
      setSelectedDatasetId(editingDatasetId);
      setShowDatasetEdit(false);
      setEditingDatasetId("");
      setDatasetFeedback({
        tone: "warning",
        message: "update 接口当前未返回成功，前端已先用 mock 状态更新展示。",
      });
      setDatasetForm(createEmptyDatasetForm());
    } finally {
      setDatasetSubmitting(false);
    }
  };

  const openDatasetCaseDetail = async (caseId: string) => {
    if (!selectedDataset) {
      return;
    }

    setSelectedDatasetCaseId(caseId);

    try {
      const response = await fetchDatasetCase(selectedDataset.id, caseId);
      const nextCase = response.item;
      setEditedDatasets((current) => ({
        ...current,
        [selectedDataset.id]: {
          ...(current[selectedDataset.id] ?? selectedDataset),
          cases: selectedDataset.cases.map((item) => (item.id === nextCase.id ? nextCase : item)),
          itemCount: selectedDataset.cases.length,
        },
      }));
    } catch {
      // Keep local case snapshot when detail API is unavailable.
    }

    setShowDatasetCaseDrawer(true);
  };

  const openDatasetCaseEditor = async (caseId: string) => {
    if (!selectedDataset) {
      return;
    }

    setSelectedDatasetCaseId(caseId);
    setDatasetCaseEditorMode("edit");
    setDatasetCaseFormError(null);

    const currentCase = selectedDataset.cases.find((item) => item.id === caseId);
    if (!currentCase) {
      return;
    }

    let nextCase = currentCase;
    try {
      const response = await fetchDatasetCase(selectedDataset.id, caseId);
      nextCase = response.item;
    } catch {
      // Keep local case snapshot when detail API is unavailable.
    }

    setDatasetCaseDraft(cloneDatasetCaseRecord(nextCase));
    setDatasetCaseJsonDrafts(
      Object.fromEntries(
        Object.entries(nextCase)
          .filter(([, value]) => typeof value !== "string")
          .map(([key, value]) => [key, JSON.stringify(value, null, 2)]),
      ),
    );
    setShowDatasetCaseEditor(true);
  };

  const openNewDatasetCaseEditor = () => {
    if (!selectedDataset) {
      return;
    }

    const nextCase = buildEmptyDatasetCase(selectedDataset.datasetType);
    setDatasetCaseEditorMode("create");
    setDatasetCaseFormError(null);
    setDatasetCaseDraft(nextCase);
    setDatasetCaseJsonDrafts(
      Object.fromEntries(
        Object.entries(nextCase)
          .filter(([, value]) => typeof value !== "string")
          .map(([key, value]) => [key, JSON.stringify(value, null, 2)]),
      ),
    );
    setShowDatasetCaseEditor(true);
  };

  const handleDatasetCaseFieldChange = (key: string, rawValue: string) => {
    if (!datasetCaseDraft) {
      return;
    }

    const currentValue = (datasetCaseDraft as Record<string, unknown>)[key];
    if (typeof currentValue === "string") {
      setDatasetCaseDraft({
        ...(datasetCaseDraft as Record<string, unknown>),
        [key]: rawValue,
      } as DatasetCaseRecord);
      return;
    }

    setDatasetCaseJsonDrafts((current) => ({
      ...current,
      [key]: rawValue,
    }));
  };

  const handleDatasetCaseSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedDataset || !datasetCaseDraft) {
      return;
    }

    try {
      const payload = Object.fromEntries(
        Object.entries(datasetCaseDraft as Record<string, unknown>).map(([key, value]) => {
          if (typeof value === "string") {
            return [key, value];
          }

          return [key, JSON.parse(datasetCaseJsonDrafts[key] ?? JSON.stringify(value))];
        }),
      ) as DatasetCaseRecord;

      setDatasetCaseSubmitting(true);
      setDatasetCaseFormError(null);

      const response =
        datasetCaseEditorMode === "create"
          ? await createDatasetCaseRequest(selectedDataset.id, payload)
          : await updateDatasetCaseRequest(selectedDataset.id, payload.id, payload);
      const updatedCase = response.item;
      const nextCases =
        datasetCaseEditorMode === "create"
          ? [updatedCase, ...selectedDataset.cases]
          : selectedDataset.cases.map((item) => (item.id === updatedCase.id ? updatedCase : item));

      setEditedDatasets((current) => ({
        ...current,
        [selectedDataset.id]: {
          ...(current[selectedDataset.id] ?? selectedDataset),
          cases: nextCases,
          itemCount: nextCases.length,
        },
      }));
      setDatasetCaseDraft(updatedCase);
      setSelectedDatasetCaseId(updatedCase.id);
      setShowDatasetCaseEditor(false);
      setDatasetFeedback({
        tone: "success",
        message: datasetCaseEditorMode === "create" ? `样本 ${updatedCase.id} 已创建。` : `样本 ${updatedCase.id} 已更新。`,
      });
    } catch (error) {
      setDatasetCaseFormError(error instanceof Error ? error.message : "样本更新失败");
    } finally {
      setDatasetCaseSubmitting(false);
    }
  };

  const handleDatasetCaseDeleteRequest = async (caseId: string) => {
    if (!selectedDataset) {
      return;
    }

    if (!globalThis.confirm(`删除样本 ${caseId}？`)) {
      return;
    }

    try {
      await deleteDatasetCaseRequest(selectedDataset.id, caseId);
      const nextCases = selectedDataset.cases.filter((item) => item.id !== caseId);
      setEditedDatasets((current) => ({
        ...current,
        [selectedDataset.id]: {
          ...(current[selectedDataset.id] ?? selectedDataset),
          cases: nextCases,
          itemCount: nextCases.length,
        },
      }));
      if (selectedDatasetCaseId === caseId) {
        setSelectedDatasetCaseId(nextCases[0]?.id ?? "");
      }
      setShowDatasetCaseDrawer(false);
      setShowDatasetCaseEditor(false);
      setDatasetFeedback({
        tone: "success",
        message: `样本 ${caseId} 已删除。`,
      });
    } catch (error) {
      setDatasetFeedback({
        tone: "warning",
        message: error instanceof Error ? error.message : `样本 ${caseId} 删除失败。`,
      });
    }
  };

  const runDatasetSynthesis = async () => {
    if (!selectedSynthesisDataset) {
      return;
    }

    try {
      setSynthesisLoading(true);
      const response = await synthesizeDatasetCasesRequest(selectedSynthesisDataset.id, {
        source: synthesisSource,
        direction: synthesisDirection,
        scenario_description: synthesisScenario.trim(),
        use_case_description: synthesisPurpose.trim(),
        seed_source_ref:
          synthesisSource === "dataset" ? `dataset:${selectedSynthesisDataset.id}` : "online:latest-window",
        columns: synthesisColumns
          .filter((column) => column.enabled)
          .map((column) => ({
            name: column.name,
            description: column.description.trim(),
            generation_requirement: column.requirement.trim(),
          })),
        sample_count: Math.max(10, synthesisSampleCount),
      });
      setDatasetSynthesisResult(response.item);
    } catch {
      setDatasetFeedback({
        tone: "warning",
        message: "智能合成接口暂时不可用，当前仍可以继续使用已有评测样本。",
      });
    } finally {
      setSynthesisLoading(false);
    }
  };

  const handleSavePromptTemplate = () => {
    if (!promptDraft) {
      return;
    }

    setEditedPrompts((current) => ({
      ...current,
      [promptDraft.id]: {
        ...promptDraft,
        name: promptDraft.name.trim(),
        version: promptDraft.version.trim(),
        description: promptDraft.description?.trim(),
        systemPrompt: promptDraft.systemPrompt.trim(),
        userTemplate: promptDraft.userTemplate.trim(),
      },
    }));
  };

  const handleCreatePrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!promptDraft) {
      return;
    }

    const nextPrompt: PromptVersion = {
      ...promptDraft,
      id: `prompt_local_${Date.now().toString(36)}`,
      name: promptDraft.name.trim(),
      version: promptDraft.version.trim(),
      description: promptDraft.description?.trim(),
      systemPrompt: promptDraft.systemPrompt.trim(),
      userTemplate: promptDraft.userTemplate.trim(),
      inputSchema: promptDraft.inputSchema ?? {},
    };

    setCreatedPrompts((current) => [nextPrompt, ...current]);
    setSelectedPromptId(nextPrompt.id);
    setShowPromptCreateModal(false);
    setPromptDraft(nextPrompt);
  };

  const handleCreateAgent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!agentDraft) {
      return;
    }

    const composition: AgentCompositionRecord[] | undefined =
      agentCreateMode === "advanced" && agentDraft.compositionModules.length > 0
        ? agentDraft.compositionModules.map((module) => ({
            kind: module,
            ref: module,
          }))
        : undefined;

    const payload = {
      name: agentDraft.name.trim(),
      version: agentDraft.version.trim(),
      description: agentDraft.description.trim() || undefined,
      scenario: agentDraft.scenario.trim(),
      entry_type: agentDraft.entryType,
      artifact_ref: agentDraft.artifactRef.trim(),
      composition,
    };

    const fallbackAgent: AgentRecord = {
      id: `agent_local_${Date.now().toString(36)}`,
      ...payload,
    };

    const finishCreateAgent = (nextAgent: AgentRecord, tone: "success" | "warning", message: string) => {
      setCreatedAgents((current) => [nextAgent, ...current]);
      setSelectedAgentId(nextAgent.id);
      setShowAgentCreate(false);
      setAgentCreateStep(1);
      setAgentCreateMode("simple");
      setAgentDraft(createEmptyAgentForm());
      setAgentFeedback({ tone, message });
    };

    void (async () => {
      try {
        const response = await createAgentRequest(payload);
        finishCreateAgent(response.item, "success", `Agent ${response.item.name} 已创建。`);
      } catch {
        finishCreateAgent(fallbackAgent, "warning", "Agent API 暂未就绪，已先在前端本地创建。");
      }
    })();
  };

  const openPromptCreateModal = () => {
    setPromptDraft({
      id: "prompt_draft",
      name: "",
      version: "0.1.0",
      description: "",
      systemPrompt: "",
      userTemplate: "",
      inputSchema: {},
    });
    setPromptDebugPayload("{}");
    setShowPromptCreateModal(true);
  };

  const startAgentCreateFlow = () => {
    setAgentFeedback(null);
    setAgentCreateStep(1);
    setAgentCreateMode("simple");
    setAgentDraft(createEmptyAgentForm());
    setShowAgentCreate(true);
  };

  const startExperimentCreateFlow = () => {
    setExperimentFeedback(null);
    setExperimentCreateStep(1);
    setExperimentForm({
      ...createEmptyExperimentForm(),
      datasetId: preferredExperimentDatasetId,
    });
    setShowExperimentCreate(true);
  };

  const closeExperimentCreateFlow = () => {
    setShowExperimentCreate(false);
    setExperimentCreateStep(1);
    setExperimentForm({
      ...createEmptyExperimentForm(),
      datasetId: preferredExperimentDatasetId,
    });
  };

  const goToExperimentCreateStep = (step: ExperimentCreateStep) => {
    setExperimentCreateStep(step);
  };

  const closeAgentCreateFlow = () => {
    setShowAgentCreate(false);
    setAgentCreateStep(1);
    setAgentCreateMode("simple");
    setAgentDraft(createEmptyAgentForm());
  };

  const goToAgentCreateStepTwo = () => {
    if (!agentDraft) {
      return;
    }

    if (
      !agentDraft.name.trim() ||
      !agentDraft.version.trim() ||
      !agentDraft.scenario.trim() ||
      !agentDraft.artifactRef.trim()
    ) {
      setAgentFeedback({
        tone: "warning",
        message: "请先补齐基础信息，再进入模式选择。",
      });
      return;
    }

    setAgentFeedback(null);
    setAgentCreateStep(2);
  };

  const toggleAgentCompositionModule = (module: string) => {
    setAgentDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        compositionModules: current.compositionModules.includes(module)
          ? current.compositionModules.filter((item) => item !== module)
          : [...current.compositionModules, module],
      };
    });
  };

  const handleCreateEvaluator = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEvaluatorFamily) {
      return;
    }

    const config =
      selectedEvaluatorFamily === "code"
        ? JSON.stringify({ strategy: evaluatorForm.codeStrategy }, null, 2)
        : JSON.stringify(
            { rubric: evaluatorForm.description, strictBinary: evaluatorForm.metricType === "binary" },
            null,
            2,
          );

    const nextEvaluator: DemoEvaluator = {
      id: `evaluator_local_${Date.now().toString(36)}`,
      name: evaluatorForm.name.trim(),
      layer: evaluatorForm.layer,
      metricType: evaluatorForm.metricType,
      evaluatorFamily: selectedEvaluatorFamily,
      codeStrategy: selectedEvaluatorFamily === "code" ? evaluatorForm.codeStrategy : undefined,
      description: evaluatorForm.description.trim(),
      config,
    };

    setCreatedEvaluators((current) => [nextEvaluator, ...current]);
    setSelectedEvaluatorId(nextEvaluator.id);
    setEvaluatorLayer(nextEvaluator.layer);
    setShowEvaluatorCreate(false);
    setSelectedEvaluatorFamily(null);
    setEvaluatorForm({
      name: "",
      layer: "retrieval",
      metricType: "continuous",
      description: "",
      codeStrategy: "exact_match",
    });
  };

  const handleCreateExperiment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (experimentSubmitting) {
      return;
    }

    const selectedDataset =
      experimentSelectableDatasets.find((dataset) => dataset.id === experimentForm.datasetId) ??
      experimentSelectableDatasets[0];
    const selectedPrompt = resolvePromptVersion(experimentForm.promptKey, experimentForm.promptVersion);
    const selectedEvaluators = allEvaluators.filter((evaluator) => experimentForm.evaluatorIds.includes(evaluator.id));

    if (syncState !== "ready") {
      setExperimentFeedback({
        tone: "warning",
        message: "当前页面仍在 fallback mock 状态，不能创建真实实验。先确认 /api/bootstrap 已连通。",
      });
      return;
    }

    if (!selectedDataset) {
      setExperimentFeedback({
        tone: "warning",
        message: "请先选择一个真实存在的评测集。",
      });
      return;
    }

    if (selectedDataset.id.startsWith("dataset_local_")) {
      setExperimentFeedback({
        tone: "warning",
        message: `当前选中的评测集 ${selectedDataset.name} 仍是前端本地 mock，尚未写入后端，不能用于真实实验。请改选已同步的评测集。`,
      });
      return;
    }

    if (selectedEvaluators.some((evaluator) => evaluator.id.startsWith("evaluator_local_"))) {
      setExperimentFeedback({
        tone: "warning",
        message: "当前勾选里包含前端本地 evaluator，后端无法识别。请改选已同步到后端的 evaluator。",
      });
      return;
    }

    const datasetName = selectedDataset?.name ?? "未绑定数据集";
    const promptName = selectedPrompt?.name ?? promptExperimentCatalog[0]?.name ?? "Prompt";
    const promptVersion = selectedPrompt?.version ?? promptExperimentCatalog[0]?.version ?? "--";
    const promptMappings = buildPromptVariableMappings(selectedPrompt ?? promptExperimentCatalog[0]!, selectedDataset);
    const evaluatorBindings = selectedDataset
      ? buildExperimentEvaluatorBindingsInput(selectedDataset, selectedEvaluators, experimentForm.evaluatorVersions)
      : [];
    const createPayload =
      selectedDataset && selectedPrompt
        ? {
            dataset_id: selectedDataset.id,
            dataset_version: selectedDataset.version,
            target_type: "prompt" as const,
            prompt_id: selectedPrompt.id,
            prompt_version: selectedPrompt.version,
            prompt_variable_mappings: promptMappings,
            model_params: {
              model: experimentForm.promptParams.model,
              temperature: Number(experimentForm.promptParams.temperature),
              maxTokens: Number(experimentForm.promptParams.maxTokens),
              topP: Number(experimentForm.promptParams.topP),
            },
            evaluator_bindings: evaluatorBindings,
            run_config: {
              concurrency: DEFAULT_EXPERIMENT_RUN_CONFIG.concurrency,
              timeout_ms: DEFAULT_EXPERIMENT_RUN_CONFIG.timeoutMs,
              retry_limit: DEFAULT_EXPERIMENT_RUN_CONFIG.retryLimit,
            },
          }
        : null;

    setExperimentSubmitting(true);
    void (async () => {
      try {
        if (!createPayload) {
          throw new Error("实验创建配置不完整。");
        }

        const response = await createExperimentRequest(createPayload);
        const nextExperiment = mapExperimentRunRecordToExperiment(response.item);
        const row = buildExperimentRowFromRun({
          experiment: nextExperiment,
          label: experimentForm.name.trim(),
          evaluatorSummary: {
            total_count: selectedEvaluators.length,
            names: selectedEvaluators.map((item) => item.name),
            by_layer: layerOrder
              .map((layer) => {
                const layerEvaluators = selectedEvaluators.filter((item) => item.layer === layer);
                return {
                  layer,
                  count: layerEvaluators.length,
                  evaluator_names: layerEvaluators.map((item) => item.name),
                };
              })
              .filter((item) => item.count > 0),
          },
          datasetName,
          targetName: promptName,
          targetVersion: promptVersion,
          promptKey: promptName,
          promptDescription: selectedPrompt?.description,
          promptVariableMappings: promptMappings,
          promptParams: { ...experimentForm.promptParams },
        });

        try {
          const experimentItemsResponse = await fetchExperimentItemsRequest();
          const createdItem = buildExperimentListItemFromRun({
            row,
            experiment: nextExperiment,
            datasetId: selectedDataset.id,
            datasetName,
            targetName: promptName,
            targetVersion: promptVersion,
            selectedEvaluators,
          });
          const nextItems = experimentItemsResponse.items.some((item) => item.id === row.id)
            ? experimentItemsResponse.items
            : [createdItem, ...experimentItemsResponse.items.filter((item) => item.id !== row.id)];
          setExperimentItems(nextItems);
          setExperimentListSyncState("ready");
        } catch {
          const createdItem = buildExperimentListItemFromRun({
            row,
            experiment: nextExperiment,
            datasetId: selectedDataset.id,
            datasetName,
            targetName: promptName,
            targetVersion: promptVersion,
            selectedEvaluators,
          });
          setExperimentItems((current) => [createdItem, ...current.filter((item) => item.id !== row.id)]);
        }
        setExperimentRunOverrides((current) => ({
          ...current,
          [row.id]: nextExperiment,
        }));
        setExperimentLabelOverrides((current) => ({
          ...current,
          [row.id]: row.label,
        }));
        setSelectedExperimentId(row.id);
        setShowExperimentCreate(false);
        setExperimentCreateStep(1);
        setExperimentForm({
          ...createEmptyExperimentForm(),
          datasetId: experimentSelectableDatasets[0]?.id ?? "",
        });
        setExperimentFeedback({
          tone: "success",
          message: `Experiment ${row.id} 已创建。`,
        });
      } catch (error) {
        setExperimentFeedback({
          tone: "warning",
          message:
            error instanceof Error
              ? `${error.message}；未生成本地实验结果。`
              : "Experiment 创建失败，未生成本地实验结果。",
        });
      } finally {
        setExperimentSubmitting(false);
      }
    })();
  };

  const renderExperimentCreatePage = () => {
    const selectedCreateDataset =
      experimentSelectableDatasets.find((dataset) => dataset.id === experimentForm.datasetId) ??
      experimentSelectableDatasets[0];
    const selectedCreatePrompt =
      resolvePromptVersion(experimentForm.promptKey, experimentForm.promptVersion) ?? promptExperimentCatalog[0];
    const selectedCreateEvaluators = allEvaluators.filter((evaluator) => experimentForm.evaluatorIds.includes(evaluator.id));
    const selectedCreateLayerSummary = layerOrder
      .map((layer) => ({
        layer,
        count: selectedCreateEvaluators.filter((evaluator) => evaluator.layer === layer).length,
      }))
      .filter((item) => item.count > 0);
    const promptVersionList = promptVersionOptions(experimentForm.promptKey);
    const selectedPromptVariableMappings = buildPromptVariableMappings(
      selectedCreatePrompt ?? promptExperimentCatalog[0]!,
      selectedCreateDataset,
    );
    const selectedEvaluatorVersions = new Map(
      selectedCreateEvaluators.map((evaluator) => [
        evaluator.id,
        experimentForm.evaluatorVersions[evaluator.id] ?? defaultEvaluatorVersion(evaluator),
      ]),
    );
    const stepLabels = ["基础信息", "评测集", "评测对象", "评估器", "确认并发起"] as const;
    const promptParams = experimentForm.promptParams;
    const promptTargetColumns = selectedCreateDataset?.columns ?? [];

    return (
      <section className="experiment-create-shell">
        <div className="experiment-create-head">
          <button
            className="table-link"
            type="button"
            onClick={closeExperimentCreateFlow}
          >
            ← 返回实验列表
          </button>
        </div>

        <div className="experiment-create-stepper">
          {stepLabels.map((label, index) => {
            const step = (index + 1) as ExperimentCreateStep;
            const isDone = experimentCreateStep > step;
            const isActive = experimentCreateStep === step;
            return (
              <button
                key={label}
                className={`experiment-create-step ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""}`}
                type="button"
                onClick={() => setExperimentCreateStep(step)}
              >
                <span className="experiment-create-step__index">{index + 1}</span>
                <span className="experiment-create-step__label">
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        <form className="experiment-create" onSubmit={handleCreateExperiment}>
          {experimentCreateStep === 1 ? (
            <section className="detail-card experiment-create-stage">
              <div className="experiment-create-stage__header">
                <div>
                  <h3>基础信息</h3>
                  <span>先给实验起一个可识别的名称，再继续选择评测集与 Prompt。</span>
                </div>
              </div>

              <div className="experiment-create-stage__grid experiment-create-stage__grid--single">
                <label className="field">
                  <span>Name *</span>
                  <input
                    value={experimentForm.name}
                    onChange={(event) =>
                      setExperimentForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="请输入实验名称"
                    required
                  />
                </label>
              </div>

              <div className="experiment-create-stage__summary">
                <div className="stack-item stack-item--block">
                  <strong>Description</strong>
                  <textarea
                    value={experimentForm.description}
                    onChange={(event) =>
                      setExperimentForm((current) => ({ ...current, description: event.target.value }))
                    }
                    placeholder="补充实验目的、范围或验证假设。"
                  />
                </div>
              </div>

              <div className="experiment-create-stage__footer">
                <button className="secondary-button" type="button" onClick={closeExperimentCreateFlow}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setExperimentCreateStep(2)}
                  disabled={!experimentForm.name.trim()}
                >
                  下一步：评测集
                </button>
              </div>
            </section>
          ) : null}

          {experimentCreateStep === 2 ? (
            <section className="detail-card experiment-create-stage">
              <div className="experiment-create-stage__header">
                <div>
                  <h3>评测集</h3>
                  <span>评测集必须选择具体版本；当前 Prompt MVP 只承载已同步到后端的正式普通数据集。</span>
                </div>
                <div className="stack-list">
                  <div className="stack-item">
                    <strong>可用于当前实验</strong>
                    <span>{experimentSelectableDatasets.length}</span>
                  </div>
                  <div className="stack-item">
                    <strong>全部数据集</strong>
                    <span>{allDatasets.length}</span>
                  </div>
                </div>
              </div>

              <div className="experiment-create-stage__dataset-layout">
                <div className="detail-card detail-card--soft experiment-create-stage__dataset-picker">
                  <div className="field">
                    <span>Evaluation set *</span>
                  </div>
                  <div className="meta-text">
                    当前仅展示正式普通数据集。Workflow / Trace 数据集不进入 Prompt 实验；其余{" "}
                    {Math.max(allDatasets.length - experimentSelectableDatasets.length, 0)} 个 seeded/local mock 仅用于本地演示。
                  </div>
                  <div className="experiment-create-stage__dataset-list">
                    {experimentSelectableDatasets.map((dataset) => {
                      const isSelected = dataset.id === experimentForm.datasetId;
                      return (
                        <button
                          key={dataset.id}
                          type="button"
                          className={`experiment-create-stage__dataset-option${isSelected ? " is-selected" : ""}`}
                          onClick={() =>
                            setExperimentForm((current) => ({ ...current, datasetId: dataset.id }))
                          }
                        >
                          <div className="experiment-create-stage__dataset-option-header">
                            <strong>{dataset.name}</strong>
                            <span>{dataset.version}</span>
                          </div>
                          <span className="meta-text">{datasetTypeLabels[dataset.datasetType]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="detail-card detail-card--soft experiment-create-stage__summary-card">
                  <h2>Dataset snapshot</h2>
                  <div className="stack-list">
                    <div className="stack-item stack-item--block">
                      <strong>Name and version</strong>
                      <span>
                        {selectedCreateDataset?.name ?? "--"} · {selectedCreateDataset?.version ?? "--"}
                      </span>
                    </div>
                    <div className="stack-item stack-item--block">
                      <strong>Column name</strong>
                      <div className="pill-list">
                        {selectedCreateDataset?.columns.map((column) => (
                          <span key={column.name} className="pill">
                            {column.name}
                          </span>
                        )) ?? <span className="meta-text">--</span>}
                      </div>
                    </div>
                    <div className="stack-item stack-item--block">
                      <strong>样本数</strong>
                      <span>{selectedCreateDataset?.itemCount ?? 0}</span>
                    </div>
                    <div className="stack-item stack-item--block">
                      <strong>Description</strong>
                      <span>{selectedCreateDataset?.description ?? "--"}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="experiment-create-stage__footer">
                <button className="secondary-button" type="button" onClick={() => setExperimentCreateStep(1)}>
                  上一步
                </button>
                <button className="primary-button" type="button" onClick={() => setExperimentCreateStep(3)} disabled={!experimentForm.datasetId}>
                  下一步：评测对象
                </button>
              </div>
            </section>
          ) : null}

          {experimentCreateStep === 3 ? (
            <section className="detail-card experiment-create-stage">
              <div className="experiment-create-stage__header">
                <div>
                  <h3>评测对象</h3>
                  <span>本轮 MVP 只支持 Prompt。请选择 Prompt Key / 名称、版本、变量映射和参数注入。</span>
                </div>
              </div>

              <div className="experiment-create-stage__grid experiment-create-stage__grid--single">
                <label className="field">
                  <span>Prompt Key / 名称 *</span>
                  <select
                    value={experimentForm.promptKey}
                    onChange={(event) => {
                      const nextPromptKey = event.target.value;
                      const nextVersion = promptVersionOptions(nextPromptKey)[0]?.version ?? "";
                      setExperimentForm((current) => ({
                        ...current,
                        promptKey: nextPromptKey,
                        promptVersion: nextVersion,
                      }));
                    }}
                  >
                    {promptExperimentCatalog.map((prompt) => (
                      <option key={prompt.name} value={prompt.name}>
                        {prompt.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Prompt 版本 *</span>
                  <select
                    value={experimentForm.promptVersion}
                    onChange={(event) =>
                      setExperimentForm((current) => ({
                        ...current,
                        promptVersion: event.target.value,
                      }))
                    }
                  >
                    {promptVersionList.map((prompt) => (
                      <option key={prompt.version} value={prompt.version}>
                        {prompt.version}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="detail-grid detail-grid--wide experiment-create-prompt-grid">
                <article className="detail-card detail-card--soft experiment-create-prompt-grid__preview">
                  <h2>Prompt 详情预览</h2>
                  <div className="stack-list">
                    <div className="stack-item stack-item--block">
                      <strong>Description</strong>
                      <span>{selectedCreatePrompt?.description ?? "--"}</span>
                    </div>
                    <div className="stack-item stack-item--block">
                      <strong>System Prompt</strong>
                      <pre className="code-block code-block--compact">{selectedCreatePrompt?.systemPrompt ?? "--"}</pre>
                    </div>
                    <div className="stack-item stack-item--block">
                      <strong>User Template</strong>
                      <pre className="code-block code-block--compact">{selectedCreatePrompt?.userTemplate ?? "--"}</pre>
                    </div>
                  </div>
                </article>

                <article className="detail-card detail-card--soft experiment-create-prompt-grid__mapping">
                  <h2>Prompt 变量映射</h2>
                  <div className="table-shell">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>变量</th>
                          <th>映射到评测集字段</th>
                          <th>类型</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPromptVariableMappings.length > 0 ? (
                          selectedPromptVariableMappings.map((mapping) => (
                            <tr key={`${mapping.source_field}:${mapping.target_field}`}>
                              <td>{mapping.source_field}</td>
                              <td>{mapping.target_field}</td>
                              <td>{mapping.target_type ?? mapping.source_type ?? "--"}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3}>当前 Prompt 没有可映射变量</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              </div>

              <section className="detail-card detail-card--soft experiment-create-params">
                <h2>参数注入</h2>
                <div className="form-grid">
                  <label className="field">
                    <span>model</span>
                    <input
                      value={promptParams.model}
                      onChange={(event) =>
                        setExperimentForm((current) => ({
                          ...current,
                          promptParams: { ...current.promptParams, model: event.target.value },
                        }))
                      }
                      placeholder="gemini-2.5-flash"
                    />
                  </label>
                  <label className="field">
                    <span>temperature</span>
                    <input
                      value={promptParams.temperature}
                      onChange={(event) =>
                        setExperimentForm((current) => ({
                          ...current,
                          promptParams: { ...current.promptParams, temperature: event.target.value },
                        }))
                      }
                      placeholder="0.2"
                    />
                  </label>
                  <label className="field">
                    <span>max_tokens</span>
                    <input
                      value={promptParams.maxTokens}
                      onChange={(event) =>
                        setExperimentForm((current) => ({
                          ...current,
                          promptParams: { ...current.promptParams, maxTokens: event.target.value },
                        }))
                      }
                      placeholder="1024"
                    />
                  </label>
                  <label className="field">
                    <span>top_p</span>
                    <input
                      value={promptParams.topP}
                      onChange={(event) =>
                        setExperimentForm((current) => ({
                          ...current,
                          promptParams: { ...current.promptParams, topP: event.target.value },
                        }))
                      }
                      placeholder="1"
                    />
                  </label>
                </div>
              </section>

              <div className="experiment-create-stage__footer">
                <button className="secondary-button" type="button" onClick={() => setExperimentCreateStep(2)}>
                  上一步
                </button>
                <button className="primary-button" type="button" onClick={() => setExperimentCreateStep(4)} disabled={!selectedCreatePrompt}>
                  下一步：评估器
                </button>
              </div>
            </section>
          ) : null}

          {experimentCreateStep === 4 ? (
            <section className="detail-card experiment-create-confirm experiment-create-confirm--evaluator">
              <div className="panel__header experiment-create-confirm__header">
                <div>
                  <h2>评估器</h2>
                  <span>左侧先按 layer 选择 evaluator，右侧统一管理已选项的版本。</span>
                </div>
                <div className="pill-list">
                  {selectedCreateLayerSummary.length > 0 ? (
                    selectedCreateLayerSummary.map((item) => (
                      <span key={item.layer} className="pill">
                        {layerLabels[item.layer]} ({item.count})
                      </span>
                    ))
                  ) : (
                    <span className="meta-text">尚未选择 evaluator</span>
                  )}
                </div>
              </div>

              <div className="experiment-create-confirm__layout">
                <div className="experiment-create-confirm__selection">
                  {layerOrder.map((layer) => {
                    const layerEvaluators = allEvaluators.filter((evaluator) => evaluator.layer === layer);
                    if (layerEvaluators.length === 0) {
                      return null;
                    }

                    const layerIds = layerEvaluators.map((evaluator) => evaluator.id);
                    const selectedCount = layerIds.filter((id) => experimentForm.evaluatorIds.includes(id)).length;

                    return (
                      <section key={layer} className="detail-card detail-card--soft experiment-create-evaluator-group">
                        <div className="panel__header">
                          <div>
                            <h3>{layerLabels[layer]}</h3>
                            <span>先批量选择这一层的 evaluator，版本配置在右侧已选列表中统一管理。</span>
                          </div>
                          <div className="inline-actions">
                            <span className="meta-text">
                              {selectedCount}/{layerEvaluators.length} 已选
                            </span>
                            <button
                              className="pill-button"
                              type="button"
                              onClick={() =>
                                setExperimentForm((current) => ({
                                  ...current,
                                  evaluatorIds: Array.from(new Set([...current.evaluatorIds, ...layerIds])),
                                  evaluatorVersions: {
                                    ...current.evaluatorVersions,
                                    ...Object.fromEntries(
                                      layerEvaluators.map((evaluator) => [
                                        evaluator.id,
                                        current.evaluatorVersions[evaluator.id] ?? defaultEvaluatorVersion(evaluator),
                                      ]),
                                    ),
                                  },
                                }))
                              }
                            >
                              全选本层
                            </button>
                            <button
                              className="pill-button"
                              type="button"
                              onClick={() =>
                                setExperimentForm((current) => ({
                                  ...current,
                                  evaluatorIds: current.evaluatorIds.filter((id) => !layerIds.includes(id)),
                                  evaluatorVersions: Object.fromEntries(
                                    Object.entries(current.evaluatorVersions).filter(([id]) => !layerIds.includes(id)),
                                  ),
                                }))
                              }
                            >
                              清空本层
                            </button>
                          </div>
                        </div>

                        <div className="experiment-create-evaluator-grid">
                          {layerEvaluators.map((evaluator) => {
                            const checked = experimentForm.evaluatorIds.includes(evaluator.id);

                            return (
                              <label
                                key={evaluator.id}
                                className={`experiment-create-evaluator-card ${checked ? "is-selected" : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) =>
                                    setExperimentForm((current) => ({
                                      ...current,
                                      evaluatorIds: event.target.checked
                                        ? [...current.evaluatorIds, evaluator.id]
                                        : current.evaluatorIds.filter((id) => id !== evaluator.id),
                                      evaluatorVersions: event.target.checked
                                        ? {
                                            ...current.evaluatorVersions,
                                            [evaluator.id]:
                                              current.evaluatorVersions[evaluator.id] ?? defaultEvaluatorVersion(evaluator),
                                          }
                                        : Object.fromEntries(
                                            Object.entries(current.evaluatorVersions).filter(([id]) => id !== evaluator.id),
                                          ),
                                    }))
                                  }
                                />
                                <div className="experiment-create-evaluator-card__body">
                                  <div className="experiment-create-evaluator-card__top">
                                    <strong>{evaluator.name}</strong>
                                    <span className="meta-text">{metricTypeLabels[evaluator.metricType]}</span>
                                  </div>
                                  <div className="pill-list">
                                    <span className="pill">{layerLabels[evaluator.layer]}</span>
                                    <span className="pill">{evaluator.evaluatorFamily === "model" ? "LLM" : "Code"}</span>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>

                <aside className="experiment-create-confirm__sidebar">
                  <section className="detail-card experiment-create-confirm__selected">
                    <div className="panel__header">
                      <div>
                        <h2>已选评估器</h2>
                        <span>统一查看已选 evaluator，并在这里调整具体版本。</span>
                      </div>
                      <span className="pill">{selectedCreateEvaluators.length} selected</span>
                    </div>

                    {selectedCreateEvaluators.length > 0 ? (
                      <div className="experiment-create-confirm__selected-list">
                        {selectedCreateEvaluators.map((evaluator) => {
                          const selectedVersion =
                            experimentForm.evaluatorVersions[evaluator.id] ?? defaultEvaluatorVersion(evaluator);
                          const versionOptions = evaluatorVersionOptions(evaluator);

                          return (
                            <label key={evaluator.id} className="experiment-create-confirm__selected-item">
                              <div className="experiment-create-confirm__selected-item-main">
                                <div className="experiment-create-confirm__selected-item-title">
                                  <strong>{evaluator.name}</strong>
                                  <span className="meta-text">{layerLabels[evaluator.layer]}</span>
                                </div>
                                <div className="pill-list">
                                  <span className="pill">{evaluator.evaluatorFamily === "model" ? "LLM" : "Code"}</span>
                                  <span className="pill">{metricTypeLabels[evaluator.metricType]}</span>
                                </div>
                              </div>

                              <select
                                value={selectedVersion}
                                onChange={(event) =>
                                  setExperimentForm((current) => ({
                                    ...current,
                                    evaluatorVersions: {
                                      ...current.evaluatorVersions,
                                      [evaluator.id]: event.target.value,
                                    },
                                  }))
                                }
                              >
                                {versionOptions.map((version) => (
                                  <option key={version} value={version}>
                                    {version}
                                  </option>
                                ))}
                              </select>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="draft-note">
                        <strong>未选择 evaluator</strong>
                        <span>先在左侧按层选择 evaluator 集合，再到这里统一确认版本。</span>
                      </div>
                    )}
                  </section>
                </aside>
              </div>

              <div className="experiment-create-stage__footer experiment-create-stage__footer--evaluator">
                <button className="secondary-button" type="button" onClick={() => setExperimentCreateStep(3)}>
                  上一步
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setExperimentCreateStep(5)}
                  disabled={!experimentForm.name.trim() || !experimentForm.datasetId || !selectedCreatePrompt || experimentForm.evaluatorIds.length === 0}
                >
                  下一步：确认并发起
                </button>
              </div>
            </section>
          ) : null}

          {experimentCreateStep === 5 ? (
            <section className={`detail-card experiment-create-stage ${experimentSubmitting ? "is-submitting" : ""}`}>
              <div className="experiment-create-stage__header">
                <div>
                  <h2>确认并发起</h2>
                  <span>最后确认实验名称、评测集、Prompt 和 evaluator 集合，再发起运行。</span>
                </div>
              </div>

              {experimentSubmitting ? (
                <div className="experiment-create-submit-state" aria-live="polite">
                  <div className="experiment-create-submit-state__spinner" aria-hidden="true" />
                  <div>
                    <strong>正在发起实验</strong>
                    <span>正在提交配置并生成实验记录，请稍候。</span>
                  </div>
                </div>
              ) : null}

              {experimentFeedback ? (
                <div className="notice-bar experiment-create-stage__notice">
                  <strong className={experimentFeedback.tone === "success" ? "is-success" : "is-warning"}>
                    {experimentFeedback.message}
                  </strong>
                </div>
              ) : null}

              <div className="summary-grid">
                <article className="summary-card">
                  <span>实验名称</span>
                  <strong>{experimentForm.name || "--"}</strong>
                </article>
                <article className="summary-card">
                  <span>评测集</span>
                  <strong>
                    {selectedCreateDataset?.name ?? "--"}
                    <div className="meta-text">{selectedCreateDataset?.version ?? "--"}</div>
                  </strong>
                </article>
                <article className="summary-card">
                  <span>Prompt</span>
                  <strong>
                    {selectedCreatePrompt?.name ?? "--"}
                    <div className="meta-text">{selectedCreatePrompt?.version ?? "--"}</div>
                  </strong>
                </article>
                <article className="summary-card">
                  <span>评估器数量</span>
                  <strong>{selectedCreateEvaluators.length}</strong>
                </article>
              </div>

              <div className="detail-grid">
                <article className="detail-card detail-card--soft">
                  <h3>Prompt 参数</h3>
                  <div className="stack-list">
                    <div className="stack-item stack-item--block">
                      <strong>model</strong>
                      <span>{promptParams.model}</span>
                    </div>
                    <div className="stack-item stack-item--block">
                      <strong>temperature / max_tokens / top_p</strong>
                      <span>
                        {promptParams.temperature} / {promptParams.maxTokens} / {promptParams.topP}
                      </span>
                    </div>
                  </div>
                </article>

                <article className="detail-card detail-card--soft">
                  <h3>Evaluator summary</h3>
                  <div className="pill-list">
                    {selectedCreateLayerSummary.length > 0 ? (
                      selectedCreateLayerSummary.map((item) => (
                        <span key={item.layer} className="pill">
                          {layerLabels[item.layer]} ({item.count})
                        </span>
                      ))
                    ) : (
                      <span className="meta-text">尚未选择 evaluator</span>
                    )}
                  </div>
                  <div className="stack-list experiment-create-confirm__list">
                    {selectedCreateEvaluators.map((evaluator) => (
                      <div key={evaluator.id} className="stack-item stack-item--block">
                        <strong>{evaluator.name}</strong>
                        <span>
                          {layerLabels[evaluator.layer]} · {selectedEvaluatorVersions.get(evaluator.id) ?? defaultEvaluatorVersion(evaluator)}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              </div>

              <div className="experiment-create-stage__footer">
                <button className="secondary-button" type="button" onClick={() => setExperimentCreateStep(4)}>
                  上一步
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    experimentSubmitting ||
                    !experimentForm.name.trim() ||
                    !experimentForm.datasetId ||
                    !selectedCreatePrompt ||
                    experimentForm.evaluatorIds.length === 0
                  }
                >
                  {experimentSubmitting ? "发起中..." : "确认并发起"}
                </button>
              </div>
            </section>
          ) : null}
        </form>
      </section>
    );
  };

  const renderPromptPage = () =>
    !showPromptDrawer ? (
      <div className="content-stack">
        <section className="hero">
          <div>
            <span className="eyebrow">Targets</span>
            <h1>Prompt development</h1>
            <p>先看 Prompt 列表，再进入详情工作台。详情页再承载模板编辑、参数配置和 Preview and debug。</p>
          </div>
          <div className="hero__meta">
            <span className="hero__pill">{allPrompts.length} prompts</span>
            <span className="hero__pill">{migratedCozePrompts.length} migrated from Coze Loop</span>
            <button className="primary-button" type="button" onClick={openPromptCreateModal}>
              + 新建 Prompt
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <div>
              <h3>Prompt List</h3>
              <span>第一层只承载 Prompt 列表与版本概览；点进详情后再编辑模板。</span>
            </div>
          </div>

          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Description</th>
                  <th>Source</th>
                  <th>Operation</th>
                </tr>
              </thead>
              <tbody>
                {allPrompts.map((prompt) => (
                  <tr key={prompt.id} className={selectedPromptId === prompt.id ? "is-selected" : ""}>
                    <td>{prompt.name}</td>
                    <td>{prompt.version}</td>
                    <td>{prompt.description ?? "--"}</td>
                    <td>
                      <span className={`pill ${prompt.version.includes("-coze") ? "" : "pill--success"}`}>
                        {prompt.version.includes("-coze") ? "Coze Loop migrated" : "Business sample"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        onClick={() => {
                          setSelectedPromptId(prompt.id);
                          setShowPromptDrawer(true);
                        }}
                      >
                        进入详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    ) : (
      <section className="panel prompt-detail-page">
        <div className="prompt-detail-topbar">
          <div className="prompt-detail-heading">
            <button className="table-link" type="button" onClick={() => setShowPromptDrawer(false)}>
              ← 返回 Prompt 列表
            </button>
            <div>
              <h2>{selectedPrompt?.name ?? "Prompt 详情"}</h2>
              <span>{selectedPrompt?.description ?? "在详情页编辑 Prompt template、参数配置和单次调试。"}</span>
            </div>
          </div>

          <div className="inline-actions">
            <span className="pill">{selectedPrompt?.version ?? "--"}</span>
            <span className={`pill ${selectedPrompt?.version?.includes("-coze") ? "" : "pill--success"}`}>
              {selectedPrompt?.version?.includes("-coze") ? "Coze Loop migrated" : "Business sample"}
            </span>
            <button className="secondary-button" type="button" onClick={handleSavePromptTemplate}>
              保存模板
            </button>
          </div>
        </div>

        <div className="prompt-detail-workbench">
          <section className="detail-card prompt-detail-workbench__template">
            <div className="panel__header">
              <div>
                <h3>Prompt template</h3>
                <span>主工作区只负责模板编辑。</span>
              </div>
            </div>

            {promptDraft ? (
              <div className="form-layout">
                <div className="form-grid">
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={promptDraft.name}
                      onChange={(event) => setPromptDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                    />
                  </label>
                  <label className="field">
                    <span>Version</span>
                    <input
                      value={promptDraft.version}
                      onChange={(event) => setPromptDraft((current) => (current ? { ...current, version: event.target.value } : current))}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Description</span>
                  <textarea
                    value={promptDraft.description ?? ""}
                    onChange={(event) =>
                      setPromptDraft((current) => (current ? { ...current, description: event.target.value } : current))
                    }
                  />
                </label>
                <label className="field">
                  <span>System prompt</span>
                  <textarea
                    value={promptDraft.systemPrompt}
                    onChange={(event) =>
                      setPromptDraft((current) => (current ? { ...current, systemPrompt: event.target.value } : current))
                    }
                  />
                </label>
                <label className="field">
                  <span>User template</span>
                  <textarea
                    value={promptDraft.userTemplate}
                    onChange={(event) =>
                      setPromptDraft((current) => (current ? { ...current, userTemplate: event.target.value } : current))
                    }
                  />
                </label>
              </div>
            ) : null}
          </section>

          <section className="detail-card detail-card--soft prompt-detail-workbench__config">
            <div className="panel__header">
              <div>
                <h3>Common Configuration</h3>
                <span>参数配置降为辅助列，模型固定为 Gemini。</span>
              </div>
              <span className="pill pill--success">Gemini</span>
            </div>

            <div className="prompt-parameter-card">
              <div className="stack-list">
                <div className="stack-item stack-item--block">
                  <strong>Model</strong>
                  <span>Gemini</span>
                </div>
              </div>

              <div className="prompt-parameter-grid prompt-parameter-grid--single">
                <label className="field">
                  <span>Temperature</span>
                  <input
                    value={promptParameterDraft.temperature}
                    onChange={(event) =>
                      setPromptParameterDraft((current) => ({ ...current, temperature: event.target.value }))
                    }
                    inputMode="decimal"
                  />
                </label>
                <label className="field">
                  <span>Max tokens</span>
                  <input
                    value={promptParameterDraft.maxTokens}
                    onChange={(event) =>
                      setPromptParameterDraft((current) => ({ ...current, maxTokens: event.target.value }))
                    }
                    inputMode="numeric"
                  />
                </label>
                <label className="field">
                  <span>Top p</span>
                  <input
                    value={promptParameterDraft.topP}
                    onChange={(event) =>
                      setPromptParameterDraft((current) => ({ ...current, topP: event.target.value }))
                    }
                    inputMode="decimal"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="detail-card prompt-detail-workbench__preview">
            <div className="panel__header">
              <div>
                <h3>Preview and debug</h3>
                <span>右侧只做单次调试，不替代实验。</span>
              </div>
            </div>

            <div className="form-layout">
              <label className="field">
                <span>Debug payload</span>
                <textarea value={promptDebugPayload} onChange={(event) => setPromptDebugPayload(event.target.value)} />
              </label>
              {promptPreview.error ? <div className="notice-bar">{promptPreview.error}</div> : null}
              <div className="trace-section">
                <strong>Rendered prompt</strong>
                <pre>{promptPreview.rendered || "等待输入调试内容。"}</pre>
              </div>
            </div>
          </section>
        </div>
      </section>
    );

  const renderPlaygroundPage = () => (
    <div className="content-stack">
      {agentFeedback ? (
        <div className="notice-bar">
          <strong className={agentFeedback.tone === "success" ? "is-success" : "is-warning"}>
            {agentFeedback.message}
          </strong>
        </div>
      ) : null}

      <section className="hero">
        <div>
          <span className="eyebrow">Targets</span>
          <h1>Agents</h1>
          <p>AgentVersion 在这里是通用 target。AI Search 只是某个 scenario，而不是默认结构。</p>
        </div>
        <div className="hero__meta">
          <span className="hero__pill">{allAgents.length} agents</span>
          <span className="hero__pill">{agentSyncState === "ready" ? "contract synced" : "contract fallback"}</span>
          {!showAgentCreate ? (
            <button className="primary-button" type="button" onClick={startAgentCreateFlow}>
              + Create Agent
            </button>
          ) : null}
        </div>
      </section>

      {showAgentCreate && agentDraft ? (
        <section className="agent-create-shell">
          <div className="dataset-editor-topbar">
            <button className="secondary-button" type="button" onClick={closeAgentCreateFlow}>
              ← Back to agents
            </button>
          </div>

          <article className="agent-create">
            <header className="agent-create__header">
              <div>
                <span className="eyebrow">Create Agent</span>
                <h1>Create Agent</h1>
                <p>Step 1 录入基础信息，Step 2 选择 Simple 或 Advanced。Advanced 只声明模块组成，不绑定执行语义。</p>
              </div>
            </header>

            <div className="agent-stepper">
              <button
                className={`agent-step ${agentCreateStep === 1 ? "is-active" : "is-done"}`}
                type="button"
                onClick={() => setAgentCreateStep(1)}
              >
                <span className="agent-step__index">1</span>
                <span>基础信息</span>
              </button>
              <button
                className={`agent-step ${agentCreateStep === 2 ? "is-active" : ""}`}
                type="button"
                onClick={() => setAgentCreateStep(2)}
                disabled={!agentDraft.name.trim() || !agentDraft.version.trim() || !agentDraft.scenario.trim() || !agentDraft.artifactRef.trim()}
              >
                <span className="agent-step__index">2</span>
                <span>模式选择</span>
              </button>
            </div>

            <form className="agent-create__form" onSubmit={handleCreateAgent}>
              {agentCreateStep === 1 ? (
                <section className="detail-card">
                  <div className="panel__header">
                    <div>
                      <h3>Step 1. 基础信息</h3>
                      <span>这里只保留 v1 最小字段：name / version / description / scenario / entry_type / artifact_ref。</span>
                    </div>
                  </div>

                  <div className="form-grid">
                    <label className="field">
                      <span>Name</span>
                      <input
                        value={agentDraft.name}
                        onChange={(event) => setAgentDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Version</span>
                      <input
                        value={agentDraft.version}
                        onChange={(event) => setAgentDraft((current) => (current ? { ...current, version: event.target.value } : current))}
                        required
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>Description</span>
                    <textarea
                      value={agentDraft.description}
                      onChange={(event) => setAgentDraft((current) => (current ? { ...current, description: event.target.value } : current))}
                    />
                  </label>

                  <div className="form-grid">
                    <label className="field">
                      <span>Scenario</span>
                      <input
                        value={agentDraft.scenario}
                        onChange={(event) => setAgentDraft((current) => (current ? { ...current, scenario: event.target.value } : current))}
                        placeholder="例如：ai_search / customer_support / workflow_qa"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Entry type</span>
                      <select
                        value={agentDraft.entryType}
                        onChange={(event) =>
                          setAgentDraft((current) =>
                            current ? { ...current, entryType: event.target.value as AgentEntryType } : current,
                          )
                        }
                      >
                        {agentEntryTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="field">
                    <span>Artifact reference</span>
                    <input
                      value={agentDraft.artifactRef}
                      onChange={(event) => setAgentDraft((current) => (current ? { ...current, artifactRef: event.target.value } : current))}
                      placeholder="例如：pipeline.ai_search.candidate / workflow://ops/rewrite-v2"
                      required
                    />
                  </label>

                  <div className="form-actions">
                    <button className="secondary-button" type="button" onClick={closeAgentCreateFlow}>
                      Cancel
                    </button>
                    <button className="primary-button" type="button" onClick={goToAgentCreateStepTwo}>
                      Next
                    </button>
                  </div>
                </section>
              ) : (
                <section className="detail-card">
                  <div className="panel__header">
                    <div>
                      <h3>Step 2. 模式选择</h3>
                      <span>Simple 适合快速注册 target。Advanced 只表达 composition 声明。</span>
                    </div>
                  </div>

                  <div className="template-grid">
                    <button
                      className={`template-card ${agentCreateMode === "simple" ? "is-selected" : ""}`}
                      type="button"
                      onClick={() => setAgentCreateMode("simple")}
                    >
                      <strong>Simple</strong>
                      <span>低门槛录入被测对象，不声明 composition。</span>
                    </button>
                    <button
                      className={`template-card ${agentCreateMode === "advanced" ? "is-selected" : ""}`}
                      type="button"
                      onClick={() => setAgentCreateMode("advanced")}
                    >
                      <strong>Advanced</strong>
                      <span>可选声明模块组成，但不绑定执行语义。</span>
                    </button>
                  </div>

                  {agentCreateMode === "advanced" ? (
                    <div className="agent-composition-builder">
                      <div className="dataset-section-title">
                        <div>
                          <h3>Composition</h3>
                          <span>v1 只做模块声明，供实验和详情展示使用。</span>
                        </div>
                      </div>
                      <div className="agent-module-grid">
                        {compositionStarterSet.map((module) => (
                          <button
                            key={module}
                            className={`template-card ${agentDraft.compositionModules.includes(module) ? "is-selected" : ""}`}
                            type="button"
                            onClick={() => toggleAgentCompositionModule(module)}
                          >
                            <strong>{module}</strong>
                            <span>{agentDraft.compositionModules.includes(module) ? "已声明到 composition" : "点击加入 composition"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="draft-note">
                      <strong>Simple Mode</strong>
                      <span>本次创建只保留基础信息，不额外声明模块组成。</span>
                    </div>
                  )}

                  <div className="form-actions">
                    <button className="secondary-button" type="button" onClick={() => setAgentCreateStep(1)}>
                      Back
                    </button>
                    <button className="primary-button" type="submit">
                      Create Agent
                    </button>
                  </div>
                </section>
              )}
            </form>
          </article>
        </section>
      ) : (
        <section className="detail-grid detail-grid--wide">
          <article className="panel">
            <div className="panel__header">
              <div>
                <h3>Agent List</h3>
                <span>这里只展示通用 target 信息，不再把 Agent 默认解释为 AI Search pipeline。</span>
              </div>
            </div>
            <div className="toolbar">
              <input
                className="toolbar__search"
                placeholder="Search name / scenario / entry type"
                value={agentQuery}
                onChange={(event) => setAgentQuery(event.target.value)}
              />
            </div>
            <div className="table-shell">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Version</th>
                    <th>Scenario</th>
                    <th>Description</th>
                    <th>Composition summary</th>
                    <th>Last Eval Score</th>
                    <th>Operation</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map((agent) => {
                    const score = latestAgentScores.get(`${agent.name}::${agent.version}`);
                    return (
                      <tr
                        key={agent.id}
                        className={selectedAgentId === agent.id ? "is-selected" : ""}
                        onClick={() => setSelectedAgentId(agent.id)}
                      >
                        <td>{agent.name}</td>
                        <td>{agent.version}</td>
                        <td>{agent.scenario}</td>
                        <td>{agent.description ?? "--"}</td>
                        <td>{agentCompositionSummary(agent)}</td>
                        <td>{score === undefined ? "--" : formatMetric(score)}</td>
                        <td>
                          <button className="table-link" type="button" onClick={() => setSelectedAgentId(agent.id)}>
                            Detail
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <article className="detail-card">
            <div className="panel__header">
              <div>
                <h2>Agent Detail</h2>
                <span>基础信息和 composition 声明在这里查看。</span>
              </div>
            </div>
            {selectedAgent ? (
              <div className="content-stack">
                <section className="stack-list">
                  <div className="stack-item"><strong>Name</strong><span>{selectedAgent.name}</span></div>
                  <div className="stack-item"><strong>Version</strong><span>{selectedAgent.version}</span></div>
                  <div className="stack-item"><strong>Scenario</strong><span>{selectedAgent.scenario}</span></div>
                  <div className="stack-item"><strong>Description</strong><span>{selectedAgent.description ?? "--"}</span></div>
                  <div className="stack-item"><strong>Entry type</strong><span>{selectedAgent.entry_type}</span></div>
                  <div className="stack-item"><strong>Artifact ref</strong><span>{selectedAgent.artifact_ref}</span></div>
                </section>

                <section className="detail-card detail-card--soft">
                  <div className="panel__header">
                    <div>
                      <h3>Mode</h3>
                      <span>{agentModeLabel(selectedAgent)}</span>
                    </div>
                    <span className="pill">{selectedAgentLastScore === undefined ? "No eval yet" : `Last score ${formatMetric(selectedAgentLastScore)}`}</span>
                  </div>
                  {selectedAgent.composition && selectedAgent.composition.length > 0 ? (
                    <div className="pill-list">
                      {selectedAgent.composition.map((item) => (
                        <span key={`${item.kind}:${item.ref}`} className="pill">
                          {item.kind}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p>Simple Mode 下不声明 composition。</p>
                  )}
                </section>
              </div>
            ) : null}
          </article>
        </section>
      )}
    </div>
  );

  const renderDatasetsPage = () => (
    <div className="content-stack dataset-page">
      {datasetFeedback ? (
        <div className="notice-bar">
          <strong className={datasetFeedback.tone === "success" ? "is-success" : "is-warning"}>
            {datasetFeedback.message}
          </strong>
        </div>
      ) : null}

      <section className="dataset-page-head">
        <div>
          <span className="eyebrow">评测</span>
          <h1>Dataset</h1>
          <p>按 Coze Loop 的动线拆成两个主工作区。Evaluation set 管正式数据集，智能合成只做定向补样草稿。</p>
        </div>
        <div className="dataset-page-tabs">
          <button
            className={`pill-button ${datasetDetailTab === "evaluation_set" ? "is-active" : ""}`}
            type="button"
            onClick={() => setDatasetDetailTab("evaluation_set")}
          >
            Evaluation set
          </button>
          <button
            className={`pill-button ${datasetDetailTab === "synthesis" ? "is-active" : ""}`}
            type="button"
            onClick={() => setDatasetDetailTab("synthesis")}
          >
            智能合成
          </button>
        </div>
      </section>

      {datasetDetailTab === "evaluation_set" ? (
        showDatasetCreate ? (
          <section className="dataset-editor-shell">
            <div className="dataset-editor-topbar">
              <button className="table-link" type="button" onClick={resetDatasetComposer}>
                ← 返回评测集列表
              </button>
              <span className="meta-text">How to create an evaluation set?</span>
            </div>

            <div className="dataset-editor">
              <div className="dataset-editor__header">
                <div>
                  <span className="eyebrow">评测 / 评测集</span>
                  <h1>{showDatasetEdit ? "Edit evaluation set" : "Create evaluation set"}</h1>
                  <p>
                    {showDatasetEdit
                      ? "回填现有 dataset 信息，修改后提交 update 接口。"
                      : "保持 mock-first，先完成基本信息和 schema 配置，再补样本导入。"}
                  </p>
                </div>
                <div className="dataset-editor__meta">
                  <div className="summary-card">
                    <span>{showDatasetEdit ? "样本数" : "Mock 样本数"}</span>
                    <strong>{datasetForm.sampleCount}</strong>
                  </div>
                  <div className="summary-card">
                    <span>字段数</span>
                    <strong>{datasetForm.schema.length}</strong>
                  </div>
                </div>
              </div>

              <form
                className="dataset-editor__form"
                onSubmit={showDatasetEdit ? handleUpdateDataset : handleCreateDataset}
              >
                <section className="dataset-editor__section">
                  <div className="dataset-section-title">
                    <h3>Basic information</h3>
                  </div>
                  <div className="form-layout">
                    <label className="field">
                      <span>Name</span>
                      <input
                        value={datasetForm.name}
                        onChange={(event) => setDatasetForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Please enter the name of the evaluation set"
                        required
                      />
                    </label>

                    <label className="field">
                      <span>Description</span>
                      <textarea
                        value={datasetForm.description}
                        onChange={(event) =>
                          setDatasetForm((current) => ({ ...current, description: event.target.value }))
                        }
                        placeholder="Please enter the description of the evaluation set"
                        required
                      />
                    </label>

                    {!showDatasetEdit ? (
                      <label className="field field--compact">
                        <span>Sample count</span>
                        <input
                          type="number"
                          min={10}
                          value={datasetForm.sampleCount}
                          onChange={(event) =>
                            setDatasetForm((current) => ({
                              ...current,
                              sampleCount: Number(event.target.value || 10),
                            }))
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                </section>

                <section className="dataset-editor__section">
                  <div className="dataset-section-title">
                    <div>
                      <h3>Config columns</h3>
                      <span>按数据集类型展示 schema 预览，不做字段级 column management。</span>
                    </div>
                  </div>

                  <div className="dataset-template-row">
                    {(["ideal_output", "workflow", "trace_monitor"] as DatasetType[]).map((type) => (
                      <button
                        key={type}
                        className={`dataset-template-option ${datasetForm.datasetType === type ? "is-selected" : ""}`}
                        type="button"
                        onClick={() =>
                          setDatasetForm((current) => ({
                            ...current,
                            datasetType: type,
                            schema: buildDatasetSchema(type),
                          }))
                        }
                      >
                        <strong>{type === "ideal_output" ? "Ideal output evaluation set" : datasetTypeLabels[type]}</strong>
                        <span>{datasetFieldGuides[type].summary}</span>
                      </button>
                    ))}
                  </div>

                  <div className="dataset-guide-row">
                    <div className="pill-list">
                      {datasetFieldGuides[datasetForm.datasetType].recommended.map((field) => (
                        <span key={field} className="pill">
                          {field}
                        </span>
                      ))}
                    </div>
                    <span className="meta-text">{datasetTypeLabels[datasetForm.datasetType]}</span>
                  </div>

                  <div className="dataset-schema-list">
                    {datasetForm.schema.map((column, index) => (
                      <article key={`${column.name}-${index}`} className="dataset-schema-card">
                        <div className="dataset-schema-card__header">
                          <div>
                            <strong>{column.name}</strong>
                          </div>
                          <span className="meta-text">
                            {column.data_type} · {column.required ? "Required" : "Optional"}
                          </span>
                        </div>
                        <p>{column.description}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <div className="dataset-editor__footer">
                  <button className="secondary-button" type="button" onClick={resetDatasetComposer}>
                    Cancel
                  </button>
                  <button className="primary-button" type="submit" disabled={datasetSubmitting}>
                    {showDatasetEdit ? (datasetSubmitting ? "Saving..." : "Save") : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : showDatasetEdit && selectedDataset ? (
          <section className="dataset-editor-shell">
            <div className="dataset-editor-topbar">
              <button className="table-link" type="button" onClick={resetDatasetComposer}>
                ← 返回评测集列表
              </button>
              <span className="meta-text">{selectedDataset.version}</span>
            </div>

            <div className="dataset-editor">
              <div className="dataset-editor__header">
                <div>
                  <span className="eyebrow">评测 / 评测集</span>
                  <h1>{datasetForm.name || selectedDataset.name}</h1>
                  <p>{datasetForm.description || selectedDataset.description}</p>
                </div>
                <div className="dataset-editor__meta">
                  <div className="summary-card">
                    <span>样本数</span>
                    <strong>{selectedDataset.cases.length}</strong>
                  </div>
                  <div className="summary-card">
                    <span>字段数</span>
                    <strong>{selectedDataset.columns.length}</strong>
                  </div>
                </div>
              </div>

              <form className="dataset-editor__form" onSubmit={handleUpdateDataset}>
                <section className="dataset-editor__section">
                  <div className="dataset-section-title">
                    <h3>Basic information</h3>
                  </div>
                  <div className="form-layout">
                    <label className="field">
                      <span>Name</span>
                      <input
                        value={datasetForm.name}
                        onChange={(event) => setDatasetForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Please enter the name of the evaluation set"
                        required
                      />
                    </label>

                    <label className="field">
                      <span>Description</span>
                      <textarea
                        value={datasetForm.description}
                        onChange={(event) =>
                          setDatasetForm((current) => ({ ...current, description: event.target.value }))
                        }
                        placeholder="Please enter the description of the evaluation set"
                        required
                      />
                    </label>
                  </div>
                </section>

                <section className="dataset-editor__section">
                  <div className="dataset-section-title">
                    <div>
                      <h3>Schema</h3>
                      <span>当前版本只展示 schema，不做字段级管理。</span>
                    </div>
                  </div>

                  <div className="dataset-template-row">
                    {(["ideal_output", "workflow", "trace_monitor"] as DatasetType[]).map((type) => (
                      <button
                        key={type}
                        className={`dataset-template-option ${datasetForm.datasetType === type ? "is-selected" : ""}`}
                        type="button"
                        onClick={() =>
                          setDatasetForm((current) => ({
                            ...current,
                            datasetType: type,
                            schema: buildDatasetSchema(type),
                          }))
                        }
                      >
                        <strong>{type === "ideal_output" ? "Ideal output evaluation set" : datasetTypeLabels[type]}</strong>
                        <span>{datasetFieldGuides[type].summary}</span>
                      </button>
                    ))}
                  </div>

                  <div className="dataset-schema-list">
                    {datasetForm.schema.map((column) => (
                      <article key={column.name} className="dataset-schema-card">
                        <div className="dataset-schema-card__header">
                          <strong>{column.name}</strong>
                          <span className="meta-text">
                            {column.data_type} · {column.required ? "Required" : "Optional"}
                          </span>
                        </div>
                        <p>{column.description}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="dataset-editor__section">
                  <div className="dataset-section-title">
                    <div>
                      <h3>Data item</h3>
                      <span>正式数据集样本管理。支持 case list / view / create / edit / delete。</span>
                    </div>
                    <div className="inline-actions">
                      <button className="secondary-button" type="button" onClick={openNewDatasetCaseEditor}>
                        + New case
                      </button>
                    </div>
                  </div>

                  <div className="table-shell dataset-table-shell">
                    <table className="table dataset-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>{selectedDataset.datasetType === "trace_monitor" ? "trace_id" : "input"}</th>
                          <th>
                            {selectedDataset.datasetType === "ideal_output"
                              ? "reference_output"
                              : selectedDataset.datasetType === "workflow"
                                ? "expected_steps"
                                : "final_output"}
                          </th>
                          <th>Operation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDataset.cases.map((item) => (
                          <tr
                            key={item.id}
                            className={selectedDatasetCaseId === item.id ? "is-selected" : ""}
                            onClick={() => setSelectedDatasetCaseId(item.id)}
                          >
                            <td>{item.id}</td>
                            <td>{"input" in item ? item.input : "trace_id" in item ? item.trace_id : item.id}</td>
                            <td>
                              {"reference_output" in item
                                ? item.reference_output
                                : "expected_steps" in item
                                  ? item.expected_steps.join(", ")
                                  : "final_output" in item
                                    ? item.final_output
                                    : "--"}
                            </td>
                            <td>
                              <div className="table-actions">
                                <button
                                  className="table-link"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void openDatasetCaseDetail(item.id);
                                  }}
                                >
                                  View
                                </button>
                                <button
                                  className="table-link"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void openDatasetCaseEditor(item.id);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="table-link"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDatasetCaseDeleteRequest(item.id);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {datasetCasesLoading ? <div className="meta-text">Loading dataset cases...</div> : null}
                </section>

                <div className="dataset-editor__footer">
                  <button className="secondary-button" type="button" onClick={resetDatasetComposer}>
                    Cancel
                  </button>
                  <button className="primary-button" type="submit" disabled={datasetSubmitting}>
                    {datasetSubmitting ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : (
          <section className="dataset-list-shell">
            <div className="dataset-list-header">
              <div>
                <h1>Evaluation set</h1>
                <p className="meta-text">列表优先，进入详情后再做 schema、样本查看与样本编辑。</p>
              </div>
              <button className="primary-button" type="button" onClick={startCreateDataset}>
                + Create evaluation set
              </button>
            </div>

            <div className="dataset-list-toolbar">
              <input
                className="toolbar__search"
                value={datasetQuery}
                onChange={(event) => setDatasetQuery(event.target.value)}
                placeholder="Search name"
              />
              <div className="pill-list">
                {([
                  { key: "all", label: `全部 ${datasetTypeCounts.all}` },
                  { key: "ideal_output", label: `普通数据集 ${datasetTypeCounts.ideal_output}` },
                  { key: "workflow", label: `Workflow ${datasetTypeCounts.workflow}` },
                  { key: "trace_monitor", label: `Trace 监控 ${datasetTypeCounts.trace_monitor}` },
                ] as Array<{ key: DatasetTypeFilter; label: string }>).map((item) => (
                  <button
                    key={item.key}
                    className={`pill-button ${datasetTypeFilter === item.key ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setDatasetTypeFilter(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="table-shell dataset-table-shell">
              <table className="table dataset-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Data item</th>
                    <th>Latest version</th>
                    <th>Description</th>
                    <th>Operation</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDatasets.map((dataset) => (
                    <tr
                      key={dataset.id}
                      className={selectedDatasetId === dataset.id ? "is-selected" : ""}
                      onClick={() => setSelectedDatasetId(dataset.id)}
                    >
                      <td>
                        {dataset.name}
                        {dataset.source !== "remote" ? (
                          <div className="meta-text">{dataset.source === "seeded" ? "seeded mock" : "local mock"}</div>
                        ) : null}
                      </td>
                      <td>{datasetTypeLabels[dataset.datasetType]}</td>
                      <td>{dataset.itemCount}</td>
                      <td>
                        {dataset.version}
                        {dataset.source !== "remote" ? <div className="meta-text">仅用于本地演示</div> : null}
                      </td>
                      <td>{dataset.description}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="table-link"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDatasetId(dataset.id);
                              setShowDatasetDrawer(true);
                            }}
                          >
                            Detail
                          </button>
                          <button
                            className="table-link"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openDatasetEditor(dataset.id);
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="dataset-list-footer">
              <span>Total datasets: {filteredDatasets.length}</span>
              <span>{selectedDataset ? `当前选中: ${selectedDataset.name}` : "未选中数据集"}</span>
            </div>
          </section>
        )
      ) : (
        <section className="dataset-synthesis-shell">
          <div className="dataset-synthesis__header">
            <div>
              <span className="eyebrow">智能合成</span>
              <h2>智能合成侧线</h2>
              <p>保留独立 tab 占位，但不作为本轮核心验收项。主线先完成 Evaluation set 的正式管理闭环。</p>
            </div>
            <div className="dataset-editor__meta">
              <div className="summary-card is-highlight">
                <span>目标数据集</span>
                <strong>{selectedSynthesisDataset?.name ?? "暂无文本评测集"}</strong>
              </div>
              <div className="summary-card">
                <span>最小合成数</span>
                <strong>10</strong>
              </div>
            </div>
          </div>

          {selectedSynthesisDataset ? (
            <>
              <section className="detail-card synthesis-target-panel">
                <div className="synthesis-target-panel__main">
                  <label className="field">
                    <span>目标 Evaluation set</span>
                    <select value={selectedSynthesisDataset.id} onChange={(event) => setSelectedDatasetId(event.target.value)}>
                      {synthesisDatasets.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="dataset-inline-meta">
                  <span className="pill">{selectedSynthesisDataset.version}</span>
                  <span className="pill">{selectedSynthesisDataset.itemCount} samples</span>
                  <span className="pill">{selectedSynthesisDataset.columns.length} columns</span>
                </div>
              </section>

              <section className="detail-grid">
                <article className="detail-card">
                  <h2>当前状态</h2>
                  <p>智能合成已降为侧线占位。本轮主线只保证 Evaluation set 的正式管理闭环可用。</p>
                </article>
                <article className="detail-card">
                  <h2>后续范围</h2>
                  <p>后续会在这里继续承接两步向导、草稿样本预览，以及人工确认后并入 Evaluation set 的流程。</p>
                </article>
              </section>

              <section className="detail-card">
                <div className="panel__header">
                  <div>
                    <h3>Placeholder</h3>
                    <span>保留入口，不阻塞 Dataset / Evaluator / Experiment 主线验收。</span>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => setDatasetDetailTab("evaluation_set")}>
                    返回 Evaluation set
                  </button>
                </div>
                <div className="stack-list">
                  <div className="stack-item stack-item--block">
                    <strong>draft only</strong>
                    <span>生成结果必须先进入 draft，不直接写入正式数据集。</span>
                  </div>
                  <div className="stack-item stack-item--block">
                    <strong>source</strong>
                    <span>{synthesisSource}</span>
                  </div>
                  <div className="stack-item stack-item--block">
                    <strong>next</strong>
                    <span>等待侧线继续实现向导、草稿筛选和 merge 流程。</span>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <article className="detail-card">
              <h2>暂无文本评测集</h2>
              <p>智能合成只支持文本评测集。请先在 Evaluation set 中创建 `普通数据集`，再进入这里做定向补样。</p>
            </article>
          )}
        </section>
      )}
    </div>
  );

  const renderEvaluatorsPage = () => (
    <div className="content-stack">
      <section className="compact-page-head">
        <div>
          <h1>Evaluator</h1>
          <p>主视图围绕 Retrieval / Rerank / Answer / Overall 展开。新建流程先选 LLM Evaluator / Code Evaluator，再进入配置。</p>
        </div>
        <div className="compact-page-head__meta">
          <span className="hero__pill">{allEvaluators.length} evaluators</span>
          <span className="hero__pill">UI-first mock flow</span>
        </div>
      </section>

      <section className="panel">
        <div className="dataset-page-tabs evaluator-list-tabs">
          <button
            className={`pill-button ${evaluatorCatalogTab === "self_built" ? "is-active" : ""}`}
            type="button"
            onClick={() => setEvaluatorCatalogTab("self_built")}
          >
            Self built evaluator
          </button>
          <button
            className={`pill-button ${evaluatorCatalogTab === "preset" ? "is-active" : ""}`}
            type="button"
            onClick={() => setEvaluatorCatalogTab("preset")}
          >
            Preset evaluator
          </button>
        </div>

        <div className="panel__header evaluator-list-header">
          <div>
            <h3>{evaluatorCatalogTab === "self_built" ? "Self built evaluator" : "Preset evaluator"}</h3>
            <span>先按层看这一层的 evaluator，再按类型与名称筛选。</span>
          </div>
          <div className="inline-actions evaluator-list-toolbar">
            <input
              className="toolbar__search"
              value={evaluatorQuery}
              onChange={(event) => setEvaluatorQuery(event.target.value)}
              placeholder="搜索评估器"
            />
            <select
              className="toolbar__select"
              value={evaluatorFamilyFilter}
              onChange={(event) => setEvaluatorFamilyFilter(event.target.value as "all" | "model" | "code")}
            >
              <option value="all">Please select type</option>
              <option value="model">LLM</option>
              <option value="code">Code</option>
            </select>
            <button className="primary-button" type="button" onClick={() => setShowEvaluatorTypeModal(true)}>
              新建
            </button>
          </div>
        </div>

        <div className="flow-row">
          {layerOrder.map((layer) => (
            <button
              key={layer}
              className={`flow-node ${evaluatorLayer === layer ? "is-active" : ""}`}
              type="button"
              onClick={() => setEvaluatorLayer(layer)}
            >
              <strong>{layerLabels[layer]}</strong>
            </button>
          ))}
        </div>
      </section>

      {showEvaluatorCreate && selectedEvaluatorFamily ? (
        <section className="panel evaluator-editor-shell">
          <div className="panel__header">
            <div>
              <h3>创建 {evaluatorFamilyLabels[selectedEvaluatorFamily]}</h3>
              <span>不在 UI 里发明新指标，只消费现有层级和类型。</span>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowEvaluatorCreate(false)}>
              返回列表
            </button>
          </div>

          <form className="form-layout" onSubmit={handleCreateEvaluator}>
            <div className="form-grid">
              <label className="field">
                <span>名称</span>
                <input
                  value={evaluatorForm.name}
                  onChange={(event) => setEvaluatorForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：Answer groundedness custom"
                  required
                />
              </label>
              <label className="field">
                <span>Layer</span>
                <select
                  value={evaluatorForm.layer}
                  onChange={(event) =>
                    setEvaluatorForm((current) => ({ ...current, layer: event.target.value as DisplayLayer }))
                  }
                >
                  {layerOrder.map((layer) => (
                    <option key={layer} value={layer}>
                      {layerLabels[layer]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Metric Type</span>
                <select
                  value={evaluatorForm.metricType}
                  onChange={(event) =>
                    setEvaluatorForm((current) => ({
                      ...current,
                      metricType: event.target.value as DemoEvaluator["metricType"],
                    }))
                  }
                >
                  {Object.entries(metricTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              {selectedEvaluatorFamily === "code" ? (
                <label className="field">
                  <span>Code Strategy</span>
                  <select
                    value={evaluatorForm.codeStrategy}
                    onChange={(event) =>
                      setEvaluatorForm((current) => ({ ...current, codeStrategy: event.target.value }))
                    }
                  >
                    {codeStrategies.map((strategy) => (
                      <option key={strategy.value} value={strategy.value}>
                        {strategy.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="detail-card">
                  <h2>Judge Family</h2>
                  <p>当前创建的是 {evaluatorFamilyLabels[selectedEvaluatorFamily]}，配置会在 mock 层先序列化展示。</p>
                </div>
              )}
            </div>

            <label className="field">
              <span>描述</span>
              <textarea
                value={evaluatorForm.description}
                onChange={(event) =>
                  setEvaluatorForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="描述这个 evaluator 关注的判断标准。"
                required
              />
            </label>

            {selectedEvaluatorFamily === "code" ? (
              <div className="template-grid">
                {codeStrategies.map((strategy) => (
                  <button
                    key={strategy.value}
                    className={`template-card ${evaluatorForm.codeStrategy === strategy.value ? "is-selected" : ""}`}
                    type="button"
                    onClick={() =>
                      setEvaluatorForm((current) => ({ ...current, codeStrategy: strategy.value }))
                    }
                  >
                    <strong>{strategy.label}</strong>
                    <p>{strategy.description}</p>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setShowEvaluatorCreate(false)}>
                取消
              </button>
              <button className="primary-button" type="submit">
                创建评估器
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>{layerLabels[evaluatorLayer]} Layer Evaluators</h3>
            <span>列表页保持稳定，不在 hover 时改变边框宽度和布局。</span>
          </div>
        </div>

        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>Family</th>
                <th>Metric Type</th>
                <th>描述</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvaluators.map((evaluator) => (
                <tr
                  key={evaluator.id}
                  className={selectedEvaluatorId === evaluator.id ? "is-selected" : ""}
                  onClick={() => setSelectedEvaluatorId(evaluator.id)}
                >
                  <td>{evaluator.name}</td>
                  <td>{evaluator.evaluatorFamily === "model" ? "LLM" : "Code"}</td>
                  <td>{metricTypeLabels[evaluator.metricType]}</td>
                  <td>{evaluator.description}</td>
                  <td>
                    <button
                      className="table-link"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedEvaluatorId(evaluator.id);
                        setShowEvaluatorDrawer(true);
                      }}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderExperimentsPage = () => (
    <div className="content-stack">
      {showExperimentCreate ? (
        renderExperimentCreatePage()
      ) : !showExperimentDetail ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <h3>实验列表</h3>
              <span>首页只承载实验列表；进入具体实验后再查看数据明细、指标统计和实验配置。</span>
            </div>
            <button className="primary-button" type="button" onClick={startExperimentCreateFlow}>
              新建实验
            </button>
          </div>

          <div className="toolbar experiment-list-toolbar">
            <input
              className="toolbar__search"
              value={experimentQuery}
              onChange={(event) => setExperimentQuery(event.target.value)}
              placeholder="搜索实验名"
            />
            <select
              className="toolbar__select"
              value={experimentStatusFilter}
              onChange={(event) => setExperimentStatusFilter(event.target.value as typeof experimentStatusFilter)}
            >
              <option value="all">全部状态</option>
              <option value="running">进行中</option>
              <option value="finished">完成</option>
              <option value="failed">失败</option>
            </select>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setExperimentQuery("");
                setExperimentStatusFilter("all");
              }}
            >
              清空筛选
            </button>
          </div>

          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>实验名称</th>
                  <th>评测集</th>
                  <th>Prompt</th>
                  <th>状态</th>
                  <th>Overall</th>
                  <th>样本数</th>
                  <th>结束时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredExperimentRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="meta-text">
                      {experimentListSyncState === "syncing" ? "实验列表加载中..." : "暂无符合筛选条件的实验。"}
                    </td>
                  </tr>
                ) : null}
                {filteredExperimentRows.map((row) => {
                  const statusCategory = experimentStatusCategory(row.status);
                  const statusLabel = experimentStatusLabel(row.status);
                  const statusTooltip = experimentStatusTooltip(row);

                  return (
                  <tr key={row.id} className={selectedExperimentId === row.id ? "is-selected" : ""}>
                    <td>
                      {row.label}
                      <div className="meta-text">{row.id}</div>
                      {row.source === "local_mock" ? <div className="meta-text">local mock</div> : null}
                    </td>
                    <td>{row.datasetName}</td>
                    <td>
                      {row.targetName}
                      <div className="meta-text">{row.targetVersion}</div>
                    </td>
                    <td>
                      <span
                        className={`experiment-status experiment-status--${statusCategory}`}
                        title={statusTooltip}
                        aria-label={statusTooltip}
                      >
                        <span className="experiment-status__icon" aria-hidden="true" />
                        {statusLabel}
                      </span>
                      {row.source === "local_mock" ? <div className="meta-text">仅用于本地演示</div> : null}
                    </td>
                    <td>{formatMetric(row.overallScore)}</td>
                    <td>{row.totalCases}</td>
                    <td>{formatDate(row.finishedAt)}</td>
                    <td>
                      <button className="table-link" type="button" onClick={() => openExperimentDetail(row.id)}>
                        进入实验
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
          ) : (
        <section className="panel experiment-page">
          <div className="experiment-detail-topbar">
            <div className="experiment-detail-heading">
              <button
                className="table-link"
                type="button"
                onClick={() => {
                  setShowExperimentDetail(false);
                  setShowExperimentCaseDrawer(false);
                }}
              >
                ← 返回实验列表
              </button>
              <div>
                <h2>{selectedExperimentRow?.label ?? "实验详情"}</h2>
                <span>
                  {selectedExperimentDataset?.name ?? selectedExperimentRow?.datasetName ?? "--"} ·{" "}
                  {selectedExperimentRow?.targetName ?? "--"}
                </span>
              </div>
            </div>
            <div className="inline-actions">
              <button className="secondary-button" type="button" onClick={handleBatchRetry}>
                批量重试
              </button>
              <button className="secondary-button" type="button" onClick={() => setShowComparisonDrawer(true)}>
                实验对比
              </button>
            </div>
          </div>

          <section className="detail-card detail-card--soft experiment-summary">
            <div className="experiment-summary__header">
              <div>
                <h3>Basic Information</h3>
                <span>这里只展示实验摘要，不在首页展开 case 明细。</span>
              </div>
              <div className="summary-pill-list">
                <span className="pill">总样本数 {experimentProgress.total}</span>
                <span className="pill">成功 {experimentProgress.success}</span>
                <span className="pill">失败 {experimentProgress.failure}</span>
                <span className="pill">进行中 {experimentProgress.pending}</span>
              </div>
            </div>

            <div className="experiment-summary__grid">
              <article className="experiment-summary__item is-primary">
                <span>评测集</span>
                <strong>{selectedExperimentDataset?.name ?? selectedExperimentRow?.datasetName ?? "--"}</strong>
                <em>{selectedExperimentDataset?.version ?? "--"}</em>
              </article>
              <article className="experiment-summary__item">
                <span>评测对象</span>
                <strong>{selectedExperimentRow?.targetName ?? "--"}</strong>
                <em>{selectedExperimentRow?.targetVersion ?? "--"}</em>
              </article>
              <article className="experiment-summary__item">
                <span>状态</span>
                <strong>{selectedExperimentRow?.status ?? "--"}</strong>
              </article>
              <article className="experiment-summary__item experiment-summary__item--evaluator">
                <span>评测器集合</span>
                <strong>
                  {selectedExperimentRow?.evaluatorSummary?.total_count ??
                    selectedExperimentRow?.experiment.evaluatorIds.length ??
                    selectedExperimentEvaluators.length ??
                    0}
                </strong>
                <div className="summary-pill-list">
                  {experimentSummaryLayerItems.length > 0 ? (
                    experimentSummaryLayerItems.map((item) => (
                      <span key={item.layer} className="pill">
                        {item.label}
                      </span>
                    ))
                  ) : (
                    <span className="meta-text">当前 experiment snapshot 仅暴露 evaluator ids。</span>
                  )}
                </div>
              </article>
            </div>

            {experimentMetaItems.length > 0 ? (
              <div className="experiment-summary__meta">
                {experimentMetaItems.map((item) => (
                  <div key={item.label} className="stack-item stack-item--inline">
                    <strong>{item.label}</strong>
                    <span>{item.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <div className="experiment-toolbar">
            <div className="dataset-page-tabs experiment-tabs">
              <button
                className={`pill-button ${experimentTab === "data_detail" ? "is-active" : ""}`}
                type="button"
                onClick={() => setExperimentTab("data_detail")}
              >
                数据明细
              </button>
              <button
                className={`pill-button ${experimentTab === "indicator_statistics" ? "is-active" : ""}`}
                type="button"
                onClick={() => setExperimentTab("indicator_statistics")}
              >
                指标统计
              </button>
              <button
                className={`pill-button ${experimentTab === "experiment_configuration" ? "is-active" : ""}`}
                type="button"
                onClick={() => setExperimentTab("experiment_configuration")}
              >
                实验配置
              </button>
            </div>
          </div>

          <section className="detail-card detail-card--soft experiment-layer-filter">
            <div className="experiment-layer-filter__header">
              <div>
                <h3>层级筛选</h3>
                <span>选择当前查看的 evaluator 层级，Data detail 和指标分布都会同步切换。</span>
              </div>
              <div className="flow-row">
                {layerOrder.map((layer) => (
                  <button
                    key={layer}
                    className={`flow-node ${runLayer === layer ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setRunLayer(layer)}
                  >
                    <strong>{layerLabels[layer]}</strong>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {experimentTab === "data_detail" ? (
            <div className="content-stack">
              <div className="panel__header">
                <div>
                  <h3>Data detail</h3>
                  <span>当前层只展示对应 evaluator 列，避免和统计页重复。</span>
                </div>
              </div>

              <div className="table-shell">
                <table className="table experiment-data-table">
                  <thead>
                    <tr>
                      <th>case_id</th>
                      <th>input</th>
                      <th>reference_output</th>
                      <th>actual_output</th>
                      <th>status</th>
                      <th>trajectory / trace</th>
                      {currentLayerMetricColumns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                      <th>operation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRunCases.map((item) => (
                      <tr
                        key={item.caseRun.caseId}
                        className={selectedCaseId === item.caseRun.caseId ? "is-selected" : ""}
                        onClick={() => setSelectedCaseId(item.caseRun.caseId)}
                      >
                        <td>{item.caseRun.caseId}</td>
                        <td>{datasetCaseInput(item.datasetCase)}</td>
                        <td>{datasetCaseReferenceOutput(item.datasetCase)}</td>
                        <td>{item.caseRun.output || "--"}</td>
                        <td>
                          <span className={`experiment-status experiment-status--${caseExecutionStatusClass(item.status)}`}>
                            <span className="experiment-status__icon" aria-hidden="true" />
                            {caseExecutionStatusLabel(item.status)}
                          </span>
                        </td>
                        <td>
                          <button
                            className="table-link"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openExperimentCaseDrawer(item.caseRun.caseId);
                            }}
                          >
                            View trace
                          </button>
                        </td>
                        {currentLayerMetricColumns.map((column) => (
                          <td key={column.key}>{formatMetric(item.evaluatorScores[column.key] ?? 0)}</td>
                        ))}
                        <td>
                          <div className="table-actions">
                            <button
                              className="table-link"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openExperimentCaseDrawer(item.caseRun.caseId);
                              }}
                            >
                              Detail
                            </button>
                            <button
                              className="table-link"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRetryCase(item.caseRun.caseId);
                              }}
                            >
                              Retry
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {experimentTab === "indicator_statistics" ? (
            <div className="content-stack">
              <section className="detail-card">
                <div className="panel__header">
                  <div>
                    <h2>分层指标总览</h2>
                    <span>按层作为行、按指标作为列平铺；列多时横向滚动。</span>
                  </div>
                </div>

                <div className="table-shell statistics-matrix-shell">
                  <table className="table statistics-matrix">
                    <thead>
                      <tr>
                        <th>层级</th>
                        {selectedExperimentLatency ? <th>latency_ms</th> : null}
                        {allStatisticMetricNames.map((metricName) => (
                          <th key={metricName}>{metricName}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {experimentStatisticsByLayer.map((section) => {
                        const metricMap = new Map(section.metrics.map((metric) => [metric.metricName, metric.average]));
                        const latencyValue =
                          section.layer === "overall"
                            ? selectedExperimentLatency?.total
                            : section.layer === "retrieval"
                              ? selectedExperimentLatency?.retrieval
                              : section.layer === "rerank"
                                ? selectedExperimentLatency?.rerank
                                : section.layer === "answer"
                                  ? selectedExperimentLatency?.answer
                                  : undefined;

                        return (
                          <tr key={section.layer}>
                            <td>
                              <strong>{layerLabels[section.layer]}</strong>
                            </td>
                            {selectedExperimentLatency ? <td>{latencyValue ? `${latencyValue}ms` : "--"}</td> : null}
                            {allStatisticMetricNames.map((metricName) => (
                              <td key={`${section.layer}:${metricName}`}>
                                {metricMap.has(metricName) ? formatMetric(metricMap.get(metricName) ?? 0) : "--"}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="detail-card">
                <div className="panel__header">
                  <div>
                    <h2>指标分布图</h2>
                    <span>当前层：{layerLabels[runLayer]}。分布只看当前 layer 下的指标，不和 Data detail 重复。</span>
                  </div>
                </div>

                <div className="pill-list">
                  {(selectedStatisticMetricNames.length > 0 ? selectedStatisticMetricNames : allStatisticMetricNames).map((metricName) => (
                    <button
                      key={metricName}
                      className={`pill-button ${selectedIndicatorMetric === metricName ? "is-active" : ""}`}
                      type="button"
                      onClick={() => setSelectedIndicatorMetric(metricName)}
                    >
                      {metricName}
                    </button>
                  ))}
                </div>

                <div className="distribution-list">
                  {selectedMetricDistribution.map((item) => (
                    <div key={item.caseId} className="distribution-row">
                      <div className="distribution-row__label">
                        <strong>{item.caseId}</strong>
                        <span>{item.title}</span>
                      </div>
                      <div className="distribution-row__bar">
                        <div
                          className="distribution-row__fill"
                          style={{ width: `${Math.max(6, Math.min(100, item.score * 100))}%` }}
                        />
                      </div>
                      <span>{formatMetric(item.score)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="detail-card">
                <h2>Token / cost</h2>
                <p>当前 experiment contract 未暴露 token 与 cost 聚合字段，先保留区域占位。</p>
              </section>
            </div>
          ) : null}

          {experimentTab === "experiment_configuration" ? (
            <div className="content-stack">
              <section className="detail-grid">
                <article className="detail-card">
                  <h2>Prompt</h2>
                  <div className="stack-list">
                    <div className="stack-item"><strong>Name</strong><span>{selectedExperimentRow?.targetName ?? "--"}</span></div>
                    <div className="stack-item"><strong>Version</strong><span>{selectedExperimentRow?.targetVersion ?? "--"}</span></div>
                  </div>
                </article>

                <article className="detail-card">
                  <h2>Evaluation set</h2>
                  <div className="stack-list">
                    <div className="stack-item"><strong>Name</strong><span>{selectedExperimentDataset?.name ?? selectedExperimentRow?.datasetName ?? "--"}</span></div>
                    <div className="stack-item"><strong>Version</strong><span>{selectedExperimentDataset?.version ?? "--"}</span></div>
                  </div>
                </article>
              </section>

              <section className="detail-grid">
                <article className="detail-card">
                  <h2>Prompt variable mappings</h2>
                  <p>当前 experiment contract 未暴露 mapping snapshot，前端只保留只读区域。</p>
                  <pre className="code-block">{JSON.stringify({ status: "not_exposed_by_contract" }, null, 2)}</pre>
                </article>

                <article className="detail-card">
                  <h2>Evaluator list</h2>
                  <div className="pill-list">
                    {selectedExperimentEvaluators.length > 0 ? (
                      selectedExperimentEvaluators.map((evaluator) => (
                        <span key={evaluator.id} className="pill">
                          {evaluator.name} <span className="meta-text">{evaluator.version}</span>
                        </span>
                      ))
                    ) : (
                      <span className="meta-text">当前只拿到 evaluator ids。</span>
                    )}
                  </div>
                </article>
              </section>

              <section className="detail-grid">
                <article className="detail-card">
                  <h2>Evaluator field mapping</h2>
                  <p>当前 contract 未暴露 evaluator field mapping snapshot。</p>
                  <pre className="code-block">{JSON.stringify({ status: "not_exposed_by_contract" }, null, 2)}</pre>
                </article>

                <article className="detail-card">
                  <h2>Weight multiplier</h2>
                  <p>当前 contract 未暴露 weight multiplier。</p>
                  <pre className="code-block">{JSON.stringify({ status: "not_exposed_by_contract" }, null, 2)}</pre>
                </article>
              </section>

              <section className="detail-card">
                <h2>Run config</h2>
                <p>configuration 页只展示实验快照，不在这里做复杂调参。</p>
                <pre className="code-block">{JSON.stringify({ status: "not_exposed_by_contract" }, null, 2)}</pre>
              </section>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );

  const renderAbPage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">实验</span>
          <h1>AB 实验</h1>
          <p>先看 overall 指标卡片和 headline，再看 layer deltas、drivers 和 evidence cases，最后下钻 trace。</p>
        </div>
        <div className="hero__meta">
          <span className="hero__pill">{viewModel.comparison.headline}</span>
          <span className="hero__pill">confidence {viewModel.comparison.confidence.toFixed(2)}</span>
        </div>
      </section>

      <section className="summary-grid">
        {viewModel.comparison.overallDeltas.slice(0, 6).map((metric) => (
          <article key={metric.metricName} className="summary-card">
            <span>{metric.metricName}</span>
            <strong>{formatMetric(metric.candidateValue)}</strong>
            <em className={statusTone(metric.delta)}>{formatDelta(metric.delta)}</em>
          </article>
        ))}
      </section>

      <section className="detail-grid">
        <article className="detail-card">
          <h2>Root Cause Summary</h2>
          <p>{viewModel.comparison.headline}</p>
          <div className="stack-list">
            {viewModel.comparison.rootCauseSummary.map((line) => (
              <div key={line} className="stack-item">
                <span>{line}</span>
              </div>
            ))}
          </div>
        </article>
        <article className="detail-card">
          <h2>Attribution Drivers</h2>
          <div className="stack-list">
            <div className="stack-item">
              <strong>Positive</strong>
              <div className="pill-list">
                {viewModel.comparison.driverPositive.length > 0 ? (
                  viewModel.comparison.driverPositive.map((driver) => (
                    <span key={driver} className="pill pill--success">
                      {driver}
                    </span>
                  ))
                ) : (
                  <span className="meta-text">暂无正向 driver</span>
                )}
              </div>
            </div>
            <div className="stack-item">
              <strong>Negative</strong>
              <div className="pill-list">
                {viewModel.comparison.driverNegative.length > 0 ? (
                  viewModel.comparison.driverNegative.map((driver) => (
                    <span key={driver} className="pill pill--danger">
                      {driver}
                    </span>
                  ))
                ) : (
                  <span className="meta-text">暂无负向 driver</span>
                )}
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Layer Drill-down</h3>
            <span>从 overall 进入 layer，再落到 evidence cases。</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => setShowComparisonDrawer(true)}>
            查看完整归因
          </button>
        </div>

        <div className="flow-row">
          {layerOrder.map((layer) => (
            <button
              key={layer}
              className={`flow-node ${abLayer === layer ? "is-active" : ""}`}
              type="button"
              onClick={() => setAbLayer(layer)}
            >
              <strong>{layerLabels[layer]}</strong>
            </button>
          ))}
        </div>

        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Layer</th>
                <th>Status</th>
                <th>平均变化</th>
                <th>Strongest Negative</th>
                <th>Strongest Positive</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.comparison.layerInsights.map((insight) => (
                <tr key={insight.layer}>
                  <td>{layerLabels[insight.layer as DisplayLayer]}</td>
                  <td>
                    <span className="status-badge">{insight.status}</span>
                  </td>
                  <td className={statusTone(insight.averageDelta)}>{formatDelta(insight.averageDelta)}</td>
                  <td>{insight.strongestNegativeMetric ?? "--"}</td>
                  <td>{insight.strongestPositiveMetric ?? "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Evidence Cases</h3>
            <span>按当前 layer 聚焦 case，再跳 trace。</span>
          </div>
        </div>

        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Domain</th>
                <th>Layer Delta</th>
                <th>Candidate</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {evidenceCases.map((item) => (
                <tr key={item.caseId}>
                  <td>{item.title}</td>
                  <td>{item.domain}</td>
                  <td className={statusTone(item.selectedLayerDelta)}>{formatDelta(item.selectedLayerDelta)}</td>
                  <td>{item.candidateRun.output}</td>
                  <td>
                    <button
                      className="table-link"
                      type="button"
                      onClick={() => openTrace(item.candidateRun.traceId, viewModel.candidate.experimentId)}
                    >
                      查看 trace
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderTracePage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">观测</span>
          <h1>Trace Viewer</h1>
          <p>统一查看 retrieval / rerank / answer 轨迹、延迟与 metric evidence，作为实验下钻的终点。</p>
        </div>
        <div className="hero__meta">
          <span className="hero__pill">{allTraceRows.length} traces</span>
          <span className="hero__pill">{selectedTraceRow?.traceId ?? "--"}</span>
        </div>
      </section>

      <section className="detail-grid detail-grid--wide">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h3>Trace List</h3>
              <span>支持从实验页、AB 页直接跳转进来。</span>
            </div>
            <input
              className="toolbar__search"
              value={traceQuery}
              onChange={(event) => setTraceQuery(event.target.value)}
              placeholder="搜索 trace / case"
            />
          </div>
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>Trace ID</th>
                  <th>Run</th>
                  <th>Case</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {filteredTraceRows.map((row) => (
                  <tr
                    key={row.key}
                    className={selectedTraceKey === row.key ? "is-selected" : ""}
                    onClick={() => setSelectedTraceKey(row.key)}
                  >
                    <td>{row.traceId}</td>
                    <td>{row.experimentLabel}</td>
                    <td>{row.title}</td>
                    <td>
                      {row.trace.retrievalTrace.latencyMs + row.trace.rerankTrace.latencyMs + row.trace.answerTrace.latencyMs}
                      ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <h3>Trace Detail</h3>
              <span>{selectedTraceRow?.title ?? "请选择 trace"}</span>
            </div>
          </div>

          {selectedTraceRow ? (
            <div className="content-stack">
              <div className="summary-grid">
                <article className="summary-card">
                  <span>Retrieval</span>
                  <strong>{selectedTraceRow.trace.retrievalTrace.latencyMs}ms</strong>
                </article>
                <article className="summary-card">
                  <span>Rerank</span>
                  <strong>{selectedTraceRow.trace.rerankTrace.latencyMs}ms</strong>
                </article>
                <article className="summary-card">
                  <span>Answer</span>
                  <strong>{selectedTraceRow.trace.answerTrace.latencyMs}ms</strong>
                </article>
                <article className="summary-card">
                  <span>Total</span>
                  <strong>
                    {selectedTraceRow.trace.retrievalTrace.latencyMs +
                      selectedTraceRow.trace.rerankTrace.latencyMs +
                      selectedTraceRow.trace.answerTrace.latencyMs}
                    ms
                  </strong>
                </article>
              </div>

              <section className="trace-section">
                <strong>Retrieval Output</strong>
                <pre>{JSON.stringify(selectedTraceRow.trace.retrievalTrace.outputs, null, 2)}</pre>
              </section>
              <section className="trace-section">
                <strong>Rerank Output</strong>
                <pre>{JSON.stringify(selectedTraceRow.trace.rerankTrace.outputs, null, 2)}</pre>
              </section>
              <section className="trace-section">
                <strong>Answer Output</strong>
                <pre>{JSON.stringify(selectedTraceRow.trace.answerTrace.outputs, null, 2)}</pre>
              </section>

              <section className="metric-list">
                {Object.values(selectedTraceRow.trace.layerMetrics ?? {}).map((metric) => (
                  <article key={`${metric.layer}:${metric.metricName}`} className="metric-item">
                    <div className="metric-item__top">
                      <strong>{metric.metricName}</strong>
                      <span>{formatMetric(metricScore(metric.score))}</span>
                    </div>
                    <p>
                      {layerLabels[metric.layer as DisplayLayer]} · {metric.reason}
                    </p>
                  </article>
                ))}
              </section>
            </div>
          ) : (
            <div className="detail-card">
              <h2>暂无 trace</h2>
              <p>当前没有可展示的 trace 记录。</p>
            </div>
          )}
        </article>
      </section>
    </div>
  );

  const renderStatsPage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">观测</span>
          <h1>统计</h1>
          <p>当前先保留轻量统计面板，聚焦实验数、trace 数和 AB headline，不扩展超出 PRD 的高级分析能力。</p>
        </div>
      </section>
      <section className="summary-grid">
        <article className="summary-card is-highlight">
          <span>Experiments</span>
          <strong>{allExperimentRows.length}</strong>
        </article>
        <article className="summary-card">
          <span>Traces</span>
          <strong>{allTraceRows.length}</strong>
        </article>
        <article className="summary-card">
          <span>AB Headline</span>
          <strong>{viewModel.comparison.headline}</strong>
        </article>
      </section>
    </div>
  );

  const renderAutomationPage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">观测</span>
          <h1>自动化任务</h1>
          <p>MVP 先保留任务入口和说明区，不发明新的自动化领域对象。</p>
        </div>
      </section>
      <section className="detail-grid">
        <article className="detail-card">
          <h2>当前状态</h2>
          <p>建议后续接入定时回归跑数、失败 trace 巡检和 AB 指标播报，但这版只提供前端入口位。</p>
        </article>
        <article className="detail-card">
          <h2>输入来源</h2>
          <p>会复用实验、AB 和 trace 的已有数据，不在 UI 层定义新的结果结构。</p>
        </article>
      </section>
    </div>
  );

  const renderContent = () => {
    switch (activeView) {
      case "prompt_dev":
        return renderPromptPage();
      case "playground":
        return renderPlaygroundPage();
      case "datasets":
        return renderDatasetsPage();
      case "evaluators":
        return renderEvaluatorsPage();
      case "experiment_runs":
        return renderExperimentsPage();
      case "ab_experiments":
        return renderAbPage();
      case "trace":
        return renderTracePage();
      case "stats":
        return renderStatsPage();
      case "automation":
        return renderAutomationPage();
      default:
        return null;
    }
  };

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar__brand">
            <div className="sidebar__mark">D</div>
            <div>
              <strong>Downey Evals Loop</strong>
              <span>Mock-first frontend shell</span>
            </div>
          </div>

          <div className="workspace-pill">
            Demo 空间
            <div className="meta-text">{syncState === "ready" ? "API bootstrap" : "Fallback mock"}</div>
          </div>

          {navGroups.map((group) => (
            <div key={group.title} className="sidebar__group">
              <div className="sidebar__title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  className={`sidebar__item ${activeView === item.key ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setActiveView(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <main className="content">
          <div className="notice-bar">
            当前页面以 mock data 跑通主流程；保持与 PRD / BRD 对齐，不在 UI 层改领域命名或新增公共字段。
          </div>
          {renderContent()}
        </main>
      </div>

      <Modal
        open={showPromptCreateModal && Boolean(promptDraft)}
        title="新建 Prompt"
        subtitle="轻量录入最小字段，不做重型 IDE"
        onClose={() => setShowPromptCreateModal(false)}
      >
        {promptDraft ? (
          <form className="form-layout" onSubmit={handleCreatePrompt}>
            <div className="form-grid">
              <label className="field">
                <span>Name</span>
                <input
                  value={promptDraft.name}
                  onChange={(event) => setPromptDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                  required
                />
              </label>
              <label className="field">
                <span>Version</span>
                <input
                  value={promptDraft.version}
                  onChange={(event) => setPromptDraft((current) => (current ? { ...current, version: event.target.value } : current))}
                  required
                />
              </label>
            </div>
            <label className="field">
              <span>Description</span>
              <textarea
                value={promptDraft.description ?? ""}
                onChange={(event) => setPromptDraft((current) => (current ? { ...current, description: event.target.value } : current))}
              />
            </label>
            <label className="field">
              <span>System prompt</span>
              <textarea
                value={promptDraft.systemPrompt}
                onChange={(event) => setPromptDraft((current) => (current ? { ...current, systemPrompt: event.target.value } : current))}
                required
              />
            </label>
            <label className="field">
              <span>User template</span>
              <textarea
                value={promptDraft.userTemplate}
                onChange={(event) => setPromptDraft((current) => (current ? { ...current, userTemplate: event.target.value } : current))}
                required
              />
            </label>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setShowPromptCreateModal(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Create Prompt
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Drawer
        open={showEvaluatorTypeModal}
        title="Evaluator template"
        subtitle="先选模板，再进入配置；模板只作起点，不改 domain。"
        onClose={() => setShowEvaluatorTypeModal(false)}
        wide
      >
        <div className="evaluator-template-layout">
          <aside className="evaluator-template-rail">
            <div className="evaluator-template-group">
              <span className="evaluator-template-label">Type</span>
              <div className="evaluator-template-switch">
                {(["model", "code"] as EvaluatorFamilyChoice[]).map((family) => (
                  <button
                    key={family}
                    className={`pill-button ${selectedEvaluatorFamily === family ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setSelectedEvaluatorFamily(family)}
                  >
                    {evaluatorFamilyLabels[family]}
                  </button>
                ))}
              </div>
            </div>

            <div className="evaluator-template-group">
              <span className="evaluator-template-label">Layer</span>
              <div className="pill-list">
                <button
                  className={`pill-button ${evaluatorTemplateLayerFilter === "all" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setEvaluatorTemplateLayerFilter("all")}
                >
                  All
                </button>
                {layerOrder.map((layer) => (
                  <button
                    key={layer}
                    className={`pill-button ${evaluatorTemplateLayerFilter === layer ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setEvaluatorTemplateLayerFilter(layer)}
                  >
                    {layerLabels[layer]}
                  </button>
                ))}
              </div>
            </div>

            <div className="evaluator-template-group">
              <span className="evaluator-template-label">Metric type</span>
              <div className="pill-list">
                {Object.entries(metricTypeLabels).map(([key, label]) => (
                  <span key={key} className="pill">
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div className="detail-card detail-card--soft">
              <h3>创建方式</h3>
              <p>点击右侧模板卡片即可进入创建页。模板仅预填当前结构，不附带额外执行语义。</p>
            </div>
          </aside>

          <section className="evaluator-template-panel">
            <div className="evaluator-template-toolbar">
              <input
                className="toolbar__search"
                value={evaluatorTemplateQuery}
                onChange={(event) => setEvaluatorTemplateQuery(event.target.value)}
                placeholder="Search for indicator names"
              />
              <button className="primary-button" type="button" onClick={() => setShowEvaluatorTypeModal(false)}>
                创建评估器
              </button>
            </div>

            <div className="template-grid evaluator-template-grid">
              {evaluatorTemplateCandidates.length > 0 ? (
                evaluatorTemplateCandidates.map((template) => (
                  <button
                    key={template.id}
                    className="template-card evaluator-template-card"
                    type="button"
                    onClick={() => startEvaluatorCreationFromTemplate(template)}
                  >
                    <div className="evaluator-template-card__top">
                      <strong>{template.name}</strong>
                      <span className="meta-text">{template.evaluatorFamily === "model" ? "LLM" : "Code"}</span>
                    </div>
                    <p>{template.description}</p>
                    <div className="pill-list">
                      <span className="pill">{layerLabels[template.layer]}</span>
                      <span className="pill">{metricTypeLabels[template.metricType]}</span>
                      {template.codeStrategy ? <span className="pill">{template.codeStrategy}</span> : null}
                    </div>
                  </button>
                ))
              ) : (
                <div className="detail-card detail-card--soft">
                  <h3>没有匹配的模板</h3>
                  <p>调整左侧类型或搜索条件后再试。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </Drawer>

      <Drawer
        open={showDatasetDrawer && Boolean(selectedDataset)}
        title={selectedDataset?.name ?? "Dataset"}
        subtitle={selectedDataset ? datasetTypeLabels[selectedDataset.datasetType] : undefined}
        onClose={() => setShowDatasetDrawer(false)}
        wide
      >
        {selectedDataset ? (
          <div className="content-stack">
            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setShowDatasetDrawer(false);
                  void openDatasetEditor(selectedDataset.id);
                }}
              >
                编辑数据集
              </button>
            </div>

            <div className="summary-grid">
              <article className="summary-card">
                <span>样本数</span>
                <strong>{selectedDataset.itemCount}</strong>
              </article>
              <article className="summary-card">
                <span>版本</span>
                <strong>{selectedDataset.version}</strong>
              </article>
            </div>

            <article className="detail-card">
              <h2>Schema</h2>
              <div className="stack-list">
                {selectedDataset.columns.map((column) => (
                  <div key={column.name} className="stack-item">
                    <strong>{column.name}</strong>
                    <span>
                      {column.data_type} · {column.description}
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className="detail-card">
              <h2>样本浏览</h2>
              {selectedDataset.cases.length > 0 ? (
                <div className="table-shell">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th>{selectedDataset.datasetType === "trace_monitor" ? "trace_id" : "input"}</th>
                        <th>
                          {selectedDataset.datasetType === "ideal_output"
                            ? "reference_output"
                            : selectedDataset.datasetType === "workflow"
                              ? "expected_steps"
                              : "final_output"}
                        </th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDataset.cases.slice(0, 5).map((item) => (
                        <tr key={item.id}>
                          <td>{item.id}</td>
                          <td>{"input" in item ? item.input : "trace_id" in item ? item.trace_id : item.id}</td>
                          <td>
                            {"reference_output" in item
                              ? item.reference_output
                              : "expected_steps" in item
                                ? item.expected_steps.join(", ")
                                : "final_output" in item
                                  ? item.final_output
                                  : "--"}
                          </td>
                          <td>
                            <button
                              className="table-link"
                              type="button"
                              onClick={() => void openDatasetCaseDetail(item.id)}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="stack-list">
                  <div className="stack-item">
                    <strong>当前能力</strong>
                    <span>当前前端没有可展示的样本记录，可继续补充样本数据或接入后端查询。</span>
                  </div>
                </div>
              )}
            </article>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={showDatasetCaseDrawer && Boolean(selectedDatasetCase)}
        title={selectedDatasetCase?.id ?? "Dataset Case"}
        subtitle={selectedDataset?.name}
        onClose={() => setShowDatasetCaseDrawer(false)}
      >
        {selectedDatasetCase ? (
          <div className="content-stack">
            <article className="detail-card">
              <h2>Case Record</h2>
              <div className="stack-list">
                {Object.entries(selectedDatasetCase as Record<string, unknown>).map(([key, value]) => (
                  <div key={key} className="stack-item stack-item--block">
                    <strong>{key}</strong>
                    {typeof value === "string" ? (
                      <span>{value}</span>
                    ) : (
                      <pre className="code-block">{formatCaseValue(value)}</pre>
                    )}
                  </div>
                ))}
              </div>
            </article>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={showDatasetCaseEditor && Boolean(datasetCaseDraft)}
        title={datasetCaseEditorMode === "create" ? "New Case" : datasetCaseDraft?.id ?? "Edit Case"}
        subtitle={selectedDataset?.name}
        onClose={() => setShowDatasetCaseEditor(false)}
      >
        {datasetCaseDraft ? (
          <form className="form-layout" onSubmit={handleDatasetCaseSave}>
            {Object.entries(datasetCaseDraft as Record<string, unknown>).map(([key, value]) => (
              <label key={key} className="field">
                <span>{key}</span>
                {typeof value === "string" ? (
                  <input
                    value={String(value)}
                    readOnly={key === "id"}
                    onChange={(event) => handleDatasetCaseFieldChange(key, event.target.value)}
                  />
                ) : (
                  <textarea
                    value={datasetCaseJsonDrafts[key] ?? formatCaseValue(value)}
                    onChange={(event) => handleDatasetCaseFieldChange(key, event.target.value)}
                  />
                )}
              </label>
            ))}

            {datasetCaseFormError ? <div className="notice-bar">{datasetCaseFormError}</div> : null}

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setShowDatasetCaseEditor(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={datasetCaseSubmitting}>
                {datasetCaseSubmitting ? "Saving..." : datasetCaseEditorMode === "create" ? "Create case" : "Save case"}
              </button>
            </div>
          </form>
        ) : null}
      </Drawer>

      <Drawer
        open={showEvaluatorDrawer && Boolean(selectedEvaluator)}
        title={selectedEvaluator?.name ?? "Evaluator"}
        subtitle={
          selectedEvaluator
            ? `${layerLabels[selectedEvaluator.layer as DisplayLayer]} / ${
                selectedEvaluator.evaluatorFamily === "model" ? "LLM" : "Code"
              }`
            : undefined
        }
        onClose={() => setShowEvaluatorDrawer(false)}
      >
        {selectedEvaluator ? (
          <div className="content-stack">
            <div className="summary-grid">
              <article className="summary-card">
                <span>Metric Type</span>
                <strong>{metricTypeLabels[selectedEvaluator.metricType]}</strong>
              </article>
              <article className="summary-card">
                <span>Family</span>
                <strong>
                  {selectedEvaluator.evaluatorFamily === "model" ? "LLM Evaluator" : "Code Evaluator"}
                </strong>
              </article>
            </div>
            <article className="detail-card">
              <h2>描述</h2>
              <p>{selectedEvaluator.description}</p>
            </article>
            <article className="detail-card">
              <h2>配置</h2>
              <pre className="code-block">{selectedEvaluator.config || "{}"}</pre>
            </article>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={showExperimentCaseDrawer && Boolean(selectedRunCase)}
        title={selectedRunCase?.caseId ?? "Case detail"}
        subtitle={selectedExperimentRow?.label}
        onClose={() => setShowExperimentCaseDrawer(false)}
        wide
      >
        {selectedRunCase ? (
          <div className="content-stack">
            <section className="detail-grid">
              <article className="detail-card">
                <h2>Evaluation set data</h2>
                <div className="stack-list">
                  <div className="stack-item stack-item--block">
                    <strong>input</strong>
                    <span>
                      {datasetCaseInput(currentRunCases.find((item) => item.caseRun.caseId === selectedRunCase.caseId)?.datasetCase)}
                    </span>
                  </div>
                  <div className="stack-item stack-item--block">
                    <strong>reference_output</strong>
                    <span>
                      {datasetCaseReferenceOutput(
                        currentRunCases.find((item) => item.caseRun.caseId === selectedRunCase.caseId)?.datasetCase,
                      )}
                    </span>
                  </div>
                </div>
              </article>

              <article className="detail-card">
                <h2>Output data of evaluated object</h2>
                <div className="stack-list">
                  <div className="stack-item stack-item--block">
                    <strong>status</strong>
                    <span>
                      <span className={`experiment-status experiment-status--${caseExecutionStatusClass(selectedRunCaseStatus)}`}>
                        <span className="experiment-status__icon" aria-hidden="true" />
                        {caseExecutionStatusLabel(selectedRunCaseStatus)}
                      </span>
                    </span>
                  </div>
                  <div className="stack-item stack-item--block">
                    <strong>actual_output</strong>
                    <span>{selectedRunCase.output || "--"}</span>
                  </div>
                  {selectedRunCaseStatus === "failed" ? (
                    <div className="stack-item stack-item--block">
                      <strong>失败原因</strong>
                      <span>{selectedRunCaseFailureReason ?? selectedRunTraceRow?.trace.error ?? "实验执行失败。"}</span>
                    </div>
                  ) : null}
                  {selectedRunCaseStatus === "pending" ? (
                    <div className="stack-item stack-item--block">
                      <strong>等待原因</strong>
                      <span>{selectedRunCaseFailureReason ?? "当前 case 仍在执行中，暂无可用输出。"}</span>
                    </div>
                  ) : null}
                </div>
              </article>
            </section>

            <section className="detail-card">
              <h2>trajectory / trace</h2>
              {selectedRunTraceRow ? (
                <div className="content-stack">
                  <div className="summary-grid">
                    <article className="summary-card">
                      <span>Retrieval</span>
                      <strong>{selectedRunTraceRow.trace.retrievalTrace.latencyMs}ms</strong>
                    </article>
                    <article className="summary-card">
                      <span>Rerank</span>
                      <strong>{selectedRunTraceRow.trace.rerankTrace.latencyMs}ms</strong>
                    </article>
                    <article className="summary-card">
                      <span>Answer</span>
                      <strong>{selectedRunTraceRow.trace.answerTrace.latencyMs}ms</strong>
                    </article>
                  </div>

                  <div className="detail-grid">
                    <article className="trace-section">
                      <strong>Retrieval trace</strong>
                      <pre>{JSON.stringify(selectedRunTraceRow.trace.retrievalTrace.outputs, null, 2)}</pre>
                    </article>
                    <article className="trace-section">
                      <strong>Rerank trace</strong>
                      <pre>{JSON.stringify(selectedRunTraceRow.trace.rerankTrace.outputs, null, 2)}</pre>
                    </article>
                  </div>

                  <article className="trace-section">
                    <strong>Answer trace</strong>
                    <pre>{JSON.stringify(selectedRunTraceRow.trace.answerTrace.outputs, null, 2)}</pre>
                  </article>
                </div>
              ) : (
                <p>当前 case 没有可用 trace。</p>
              )}
            </section>

            <section className="detail-grid">
              <article className="detail-card">
                <h2>Evaluator score table</h2>
                <div className="table-shell">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Evaluator</th>
                        <th>Layer</th>
                        <th>Score</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRunCaseMetrics.map((metric) => (
                        <tr key={`${metric.layer}:${metric.metricName}`}>
                          <td>{metric.metricName}</td>
                          <td>{metric.layer === "query" ? "Query" : layerLabels[metric.layer as DisplayLayer]}</td>
                          <td>{formatMetric(metricScore(metric.score))}</td>
                          <td>{metric.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="detail-card">
                <h2>Reasons for scoring</h2>
                <div className="metric-list">
                  {selectedRunCaseMetrics.map((metric) => (
                    <article key={`reason:${metric.layer}:${metric.metricName}`} className="metric-item">
                      <div className="metric-item__top">
                        <strong>{metric.metricName}</strong>
                        <span>{metric.reason}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            </section>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={showComparisonDrawer}
        title="AB Compare Detail"
        subtitle={`${viewModel.baseline.target.version} vs ${viewModel.candidate.target.version}`}
        onClose={() => setShowComparisonDrawer(false)}
        wide
      >
        <div className="content-stack">
          <article className="detail-card">
            <h2>Attribution Records</h2>
            <div className="table-shell">
              <table className="table">
                <thead>
                  <tr>
                    <th>Target Metric</th>
                    <th>Driver</th>
                    <th>Layer</th>
                    <th>Delta</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {viewModel.comparison.attributionRecords.map((record) => (
                    <tr key={`${record.layer}:${record.candidateDriver}`}>
                      <td>{record.targetMetric}</td>
                      <td>{record.candidateDriver}</td>
                      <td>{layerLabels[record.layer as DisplayLayer]}</td>
                      <td className={statusTone(record.delta)}>{formatDelta(record.delta)}</td>
                      <td>{record.confidence.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="detail-card">
            <h2>Layer Deltas</h2>
            <div className="table-shell">
              <table className="table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Layer</th>
                    <th>Baseline</th>
                    <th>Candidate</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {viewModel.comparison.layerDeltas.map((delta) => (
                    <tr key={`${delta.layer}:${delta.metricName}`}>
                      <td>{delta.metricName}</td>
                      <td>{layerLabels[delta.layer as DisplayLayer]}</td>
                      <td>{formatMetric(delta.baselineValue)}</td>
                      <td>{formatMetric(delta.candidateValue)}</td>
                      <td className={statusTone(delta.delta)}>{formatDelta(delta.delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </Drawer>

      <Drawer
        open={showTraceDrawer && Boolean(selectedTraceRow)}
        title={selectedTraceRow?.traceId ?? "Trace"}
        subtitle={selectedTraceRow?.title}
        onClose={() => setShowTraceDrawer(false)}
        wide
      >
        {selectedTraceRow ? (
          <div className="content-stack">
            <article className="detail-card">
              <h2>Answer Output</h2>
              <pre className="code-block">{JSON.stringify(selectedTraceRow.trace.answerTrace.outputs, null, 2)}</pre>
            </article>
            <div className="detail-grid">
              <article className="detail-card">
                <h2>Retrieval</h2>
                <pre className="code-block">{JSON.stringify(selectedTraceRow.trace.retrievalTrace.outputs, null, 2)}</pre>
              </article>
              <article className="detail-card">
                <h2>Rerank</h2>
                <pre className="code-block">{JSON.stringify(selectedTraceRow.trace.rerankTrace.outputs, null, 2)}</pre>
              </article>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
};
