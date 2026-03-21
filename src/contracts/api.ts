import {
  ApiContract,
  Dataset,
  Evaluator,
  ExperimentComparison,
  ExperimentRun,
  TraceRun,
} from "../domain/types.js";
import type {
  AgentRecord,
  CreateAgentInput,
  CreatePromptInput,
  CreateDatasetCaseInput,
  DatasetCaseRecord,
  DatasetSynthesisResult,
  ExperimentDetailRecord,
  ExperimentListItemRecord,
  PromptPreviewInput,
  PromptPreviewResult,
  PromptRecord,
  ReplaceDatasetCasesInput,
  SynthesizeDatasetInput,
  UpdateDatasetCaseInput,
} from "../shared/contracts.js";

export interface DatasetListItem {
  id: string;
  name: string;
  datasetType: Dataset["datasetType"];
  description: string;
  itemCount: number;
  version: string;
}

export interface EvaluatorListItem {
  id: string;
  name: string;
  layer: Evaluator["layer"];
  family: Evaluator["family"];
  metricType: Evaluator["metricType"];
  version: string;
  description: string;
}

export interface BootstrapPayload {
  datasets: DatasetListItem[];
  evaluators: EvaluatorListItem[];
  experiments: ExperimentListItemRecord[];
  comparison: ExperimentComparison;
}

export interface EvalLoopApi extends Omit<ApiContract, "listPrompts" | "listAgents"> {
  bootstrap(): Promise<BootstrapPayload>;
  listPrompts(): Promise<PromptRecord[]>;
  listAgents(): Promise<AgentRecord[]>;
  listExperimentItems(): Promise<ExperimentListItemRecord[]>;
  getPrompt(promptId: string): Promise<PromptRecord | undefined>;
  createPrompt(input: CreatePromptInput): Promise<PromptRecord>;
  previewPrompt(promptId: string, input: PromptPreviewInput): Promise<PromptPreviewResult | undefined>;
  getAgent(agentId: string): Promise<AgentRecord | undefined>;
  createAgent(input: CreateAgentInput): Promise<AgentRecord>;
  getDataset(datasetId: string): Promise<Dataset | undefined>;
  createDataset(input: {
    name: string;
    description: string;
    datasetType: Dataset["datasetType"];
    sampleCount: number;
    schema: Dataset["schema"];
  }): Promise<Dataset>;
  updateDataset(
    datasetId: string,
    input: {
      name: string;
      description: string;
      datasetType: Dataset["datasetType"];
      sampleCount: number;
      schema: Dataset["schema"];
    },
  ): Promise<Dataset | undefined>;
  listDatasetCases(datasetId: string): Promise<DatasetCaseRecord[] | undefined>;
  getDatasetCase(datasetId: string, caseId: string): Promise<DatasetCaseRecord | undefined>;
  replaceDatasetCases(
    datasetId: string,
    input: ReplaceDatasetCasesInput,
  ): Promise<DatasetCaseRecord[] | undefined>;
  createDatasetCase(
    datasetId: string,
    input: CreateDatasetCaseInput,
  ): Promise<DatasetCaseRecord | undefined>;
  updateDatasetCase(
    datasetId: string,
    nextCase: UpdateDatasetCaseInput,
  ): Promise<DatasetCaseRecord | undefined>;
  deleteDatasetCase(datasetId: string, caseId: string): Promise<boolean>;
  synthesizeDatasetCases(
    datasetId: string,
    input: SynthesizeDatasetInput,
  ): Promise<DatasetSynthesisResult | undefined>;
  getExperiment(experimentId: string): Promise<ExperimentRun | undefined>;
  getExperimentDetail(experimentId: string): Promise<ExperimentDetailRecord | undefined>;
}

export const toDatasetListItem = (dataset: Dataset): DatasetListItem => ({
  id: dataset.id,
  name: dataset.name,
  datasetType: dataset.datasetType,
  description: dataset.description,
  itemCount: dataset.cases.length,
  version: dataset.version,
});

export const toEvaluatorListItem = (evaluator: Evaluator): EvaluatorListItem => ({
  id: evaluator.id,
  name: evaluator.name,
  layer: evaluator.layer,
  family: evaluator.family,
  metricType: evaluator.metricType,
  version: evaluator.version,
  description: evaluator.description,
});

const buildEvaluatorSummary = (
  experiment: ExperimentRun,
): ExperimentListItemRecord["evaluator_summary"] => {
  const bindings = experiment.configuration?.evaluators ?? [];
  const grouped = new Map<string, { count: number; names: string[] }>();

  for (const binding of bindings) {
    const current = grouped.get(binding.layer) ?? { count: 0, names: [] };
    grouped.set(binding.layer, {
      count: current.count + 1,
      names: [...current.names, binding.evaluatorName],
    });
  }

  return {
    total_count: bindings.length,
    names: bindings.map((binding) => binding.evaluatorName),
    by_layer: [...grouped.entries()].map(([layer, value]) => ({
      layer: layer as ExperimentListItemRecord["evaluator_summary"]["by_layer"][number]["layer"],
      count: value.count,
      evaluator_names: value.names,
    })),
  };
};

const toExecutionState = (status: ExperimentRun["status"]): ExperimentListItemRecord["execution_state"] => {
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

const buildFailureReason = (experiment: ExperimentRun): string | null => {
  const reasons = experiment.caseRuns
    .map((caseRun) => {
      const runtimeError = caseRun.trace.answerTrace.outputs.error;
      if (typeof runtimeError === "string" && runtimeError.trim().length > 0) {
        return runtimeError;
      }

      const traceError = caseRun.trace.error;
      if (typeof traceError === "string" && traceError.trim().length > 0) {
        return traceError;
      }

      if (caseRun.status === "runtime_error") {
        return "Case failed during execution";
      }

      if (
        caseRun.status === "invalid_judgment" ||
        (typeof caseRun.trace.answerTrace.outputs.answerOutput === "string" &&
          caseRun.trace.answerTrace.outputs.answerOutput.trim().length === 0 &&
          caseRun.layerMetrics.length === 0)
      ) {
        return "No model output returned";
      }

      return null;
    })
    .filter((reason): reason is string => Boolean(reason));

  if (reasons.length === 0) {
    return null;
  }

  return [...new Set(reasons)].slice(0, 2).join("；");
};

const buildOverallScore = (experiment: ExperimentRun): number | null => {
  const scores = experiment.caseRuns
    .flatMap((caseRun) => caseRun.layerMetrics)
    .filter((metric) => metric.layer === "overall" && typeof metric.score === "number")
    .map((metric) => metric.score as number);

  if (scores.length === 0) {
    return null;
  }

  return Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(4));
};

export const toExperimentListItem = (experiment: ExperimentRun): ExperimentListItemRecord => ({
  id: experiment.experimentId,
  creator: "system",
  description: experiment.configuration
    ? `Run ${experiment.configuration.target.label} on ${experiment.configuration.dataset.name} with ${experiment.configuration.evaluators.length} evaluator${experiment.configuration.evaluators.length === 1 ? "" : "s"}.`
    : `${experiment.target.name} run`,
  dataset_id: experiment.datasetId ?? "",
  target: experiment.targetSelection
    ? {
        id: experiment.targetSelection.id,
        type: experiment.targetSelection.type,
        name: experiment.target.name,
        version: experiment.targetSelection.version,
        label: experiment.targetSelection.label,
        scenario: experiment.targetSelection.type === "prompt" ? undefined : "ai_search",
        entry_type: experiment.targetSelection.type === "prompt" ? "prompt" : "workflow",
      }
    : undefined,
  pipeline_version: {
    id: experiment.target.id,
    name: experiment.target.name,
    version: experiment.target.version,
    query_processor: experiment.target.queryProcessor,
    retriever: experiment.target.retriever,
    reranker: experiment.target.reranker,
    answerer: experiment.target.answerer,
  },
  evaluator_summary: buildEvaluatorSummary(experiment),
  status: experiment.status,
  execution_state: toExecutionState(experiment.status),
  failure_reason: buildFailureReason(experiment),
  overall_score: buildOverallScore(experiment),
  case_count: experiment.summary.totalCases,
  completed_case_count: experiment.summary.completedCases,
  failed_case_count: experiment.summary.failedCases,
  invalid_judgment_count: experiment.summary.invalidJudgmentCount,
  started_at: experiment.startedAt ?? null,
  finished_at: experiment.finishedAt ?? null,
});

export const listTracesFromExperiments = (experiments: ExperimentRun[]): TraceRun[] =>
  experiments.flatMap((experiment) => experiment.caseRuns.map((caseRun) => caseRun.trace));
