import { compareExperiments } from "../domain/comparison.js";
import {
  Dataset,
  DatasetColumn,
  Evaluator,
  ExperimentComparison,
  ExperimentRun,
  LocalStoreSnapshot,
  PipelineExecutionResult,
  SearchPipelineVersion,
} from "../domain/types.js";
import { buildSampleExperiments, sampleDatasets, sampleEvaluators } from "../domain/sample-data.js";
import { FileBackedLocalStore } from "../infra/store.js";
import { ExperimentRunner, PipelineExecutor } from "../runner/experiment-runner.js";

export interface RunExperimentRequest {
  datasetId: string;
  target: SearchPipelineVersion;
  evaluatorIds?: string[];
}

export interface CreateDatasetRequest {
  name: string;
  description: string;
  datasetType: Dataset["datasetType"];
  schema: DatasetColumn[];
}

export interface CreateEvaluatorRequest {
  name: string;
  layer: Evaluator["layer"];
  family: Evaluator["family"];
  metricType: Evaluator["metricType"];
  description: string;
  config: Record<string, unknown>;
  codeStrategy?: Evaluator["codeStrategy"];
}

const now = () => new Date().toISOString();

const customId = (prefix: string) =>
  `${prefix}_custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class EvalLoopService {
  private readonly runner: ExperimentRunner;

  constructor(
    private readonly store: FileBackedLocalStore,
    pipelineExecutor: PipelineExecutor,
  ) {
    this.runner = new ExperimentRunner(pipelineExecutor);
  }

  async seedDefaults(): Promise<LocalStoreSnapshot> {
    const existing = await this.store.load();
    if (
      existing.datasets.length > 0 ||
      existing.evaluators.length > 0 ||
      existing.experiments.length > 0 ||
      existing.comparisons.length > 0
    ) {
      return existing;
    }

    const { baseline, candidate } = buildSampleExperiments();
    const comparison = compareExperiments(baseline, candidate);
    const snapshot: LocalStoreSnapshot = {
      datasets: sampleDatasets,
      evaluators: sampleEvaluators,
      experiments: [baseline, candidate],
      comparisons: [comparison],
      traces: [...baseline.caseRuns, ...candidate.caseRuns].map((caseRun) => caseRun.trace),
    };

    await this.store.seed(snapshot);
    return snapshot;
  }

  async createDataset(request: CreateDatasetRequest): Promise<Dataset> {
    const timestamp = now();
    const dataset: Dataset = {
      id: customId("dataset"),
      name: request.name,
      description: request.description,
      datasetType: request.datasetType,
      schema: request.schema,
      cases: [],
      version: "0.1.0",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.store.upsertDataset(dataset);
    return dataset;
  }

  async createEvaluator(request: CreateEvaluatorRequest): Promise<Evaluator> {
    const evaluator: Evaluator = {
      id: customId("evaluator"),
      name: request.name,
      layer: request.layer,
      family: request.family,
      metricType: request.metricType,
      version: "0.1.0",
      description: request.description,
      config: request.config,
      codeStrategy: request.codeStrategy,
    };

    await this.store.upsertEvaluator(evaluator);
    return evaluator;
  }

  async runExperiment(request: RunExperimentRequest): Promise<ExperimentRun> {
    const dataset = await this.requireDataset(request.datasetId);
    const evaluators = await this.resolveEvaluators(request.evaluatorIds);
    const { experiment } = await this.runner.runExperiment({
      dataset,
      target: request.target,
      evaluators,
    });

    await this.store.upsertExperiment(experiment);
    return experiment;
  }

  async compareExperimentRuns(
    baselineExperimentId: string,
    candidateExperimentId: string,
  ): Promise<ExperimentComparison> {
    const baseline = await this.store.getExperiment(baselineExperimentId);
    const candidate = await this.store.getExperiment(candidateExperimentId);

    if (!baseline || !candidate) {
      throw new Error("Missing experiment for comparison");
    }

    const comparison = compareExperiments(baseline, candidate);
    await this.store.upsertComparison(comparison);
    return comparison;
  }

  async listDatasets() {
    return this.store.listDatasets();
  }

  async listEvaluators() {
    return this.store.listEvaluators();
  }

  async listExperiments() {
    return this.store.listExperiments();
  }

  async listComparisons() {
    return this.store.listComparisons();
  }

  async listTraces() {
    return this.store.listTraces();
  }

  async getExperiment(experimentId: string) {
    return this.store.getExperiment(experimentId);
  }

  async getTrace(traceId: string) {
    return this.store.getTrace(traceId);
  }

  async getLatestComparison(): Promise<ExperimentComparison | undefined> {
    const comparisons = await this.store.listComparisons();
    return comparisons[comparisons.length - 1];
  }

  private async requireDataset(datasetId: string): Promise<Dataset> {
    const dataset = await this.store.getDataset(datasetId);
    if (!dataset) {
      throw new Error(`Missing dataset: ${datasetId}`);
    }
    return dataset;
  }

  private async resolveEvaluators(evaluatorIds?: string[]): Promise<Evaluator[]> {
    const allEvaluators = await this.store.listEvaluators();

    if (!evaluatorIds || evaluatorIds.length === 0) {
      return allEvaluators;
    }

    return evaluatorIds.map((evaluatorId) => {
      const evaluator = allEvaluators.find((item) => item.id === evaluatorId);
      if (!evaluator) {
        throw new Error(`Missing evaluator: ${evaluatorId}`);
      }
      return evaluator;
    });
  }
}

export const createReferencePipelineExecutor = (): PipelineExecutor => async (evalCase) => {
  const retrievalResult = evalCase.retrievalCandidates.filter(
    (candidate) =>
      evalCase.expectedRetrievalIds.includes(candidate.id) ||
      evalCase.acceptableRetrievalIds.includes(candidate.id),
  );

  const sorted = [...retrievalResult].sort((left, right) => {
    const leftRank = evalCase.expectedTopItems.includes(left.id) ? 1 : 0;
    const rightRank = evalCase.expectedTopItems.includes(right.id) ? 1 : 0;
    return rightRank - leftRank;
  });

  return {
    retrievalResult,
    rerankResult: sorted,
    answerOutput: evalCase.answerReference,
    supportingEvidence: sorted.slice(0, 2).map((candidate) => candidate.title),
    latencyMs: { retrieval: 60, rerank: 25, answer: 120 },
  } satisfies PipelineExecutionResult;
};
