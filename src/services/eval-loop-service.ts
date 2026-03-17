import { compareExperiments } from "../domain/comparison.js";
import {
  AgentVersion,
  Dataset,
  DatasetColumn,
  EditableDatasetCase,
  Evaluator,
  ExperimentComparison,
  ExperimentRun,
  LocalStoreSnapshot,
  PipelineExecutionResult,
  PromptVersion,
  SearchPipelineVersion,
} from "../domain/types.js";
import {
  buildSampleExperiments,
  sampleAgents,
  sampleDatasets,
  sampleEvaluators,
  samplePrompts,
} from "../domain/sample-data.js";
import {
  createDatasetCaseDefinition,
  createDatasetDefinition,
  deleteDatasetCaseDefinition,
  replaceDatasetCasesDefinition,
  updateDatasetCaseDefinition,
  updateDatasetDefinition,
} from "../domain/datasets.js";
import { FileBackedLocalStore } from "../infra/store.js";
import { ExperimentRunner, PipelineExecutor } from "../runner/experiment-runner.js";

export interface RunExperimentRequest {
  datasetId: string;
  target: SearchPipelineVersion;
  evaluatorIds?: string[];
}

export interface CreatePromptRequest {
  name: string;
  description?: string;
  systemPrompt: string;
  userTemplate: string;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  queryProcessor: string;
  retriever: string;
  reranker: string;
  answerer: string;
}

export interface CreateDatasetRequest {
  name: string;
  description: string;
  datasetType: Dataset["datasetType"];
  schema: DatasetColumn[];
  sampleCount: number;
}

export interface UpdateDatasetRequest {
  name: string;
  description: string;
  datasetType: Dataset["datasetType"];
  schema: DatasetColumn[];
  sampleCount: number;
}

export interface ReplaceDatasetCasesRequest {
  cases: EditableDatasetCase[];
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

const VALID_LAYERS = new Set<Evaluator["layer"]>(["retrieval", "rerank", "answer", "overall"]);
const VALID_FAMILIES = new Set<Evaluator["family"]>(["model", "code"]);
const VALID_METRIC_TYPES = new Set<Evaluator["metricType"]>(["binary", "continuous", "categorical"]);
const VALID_CODE_STRATEGIES = new Set<NonNullable<Evaluator["codeStrategy"]>>([
  "exact_match",
  "regex_match",
  "fuzzy_match",
  "python_script",
]);

const ensureNonEmpty = (value: string, fieldName: string) => {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
};

const validateEvaluatorRequest = (request: CreateEvaluatorRequest) => {
  ensureNonEmpty(request.name, "Evaluator name");
  ensureNonEmpty(request.description, "Evaluator description");

  if (!VALID_FAMILIES.has(request.family)) {
    throw new Error(`Unsupported evaluator family: ${request.family}`);
  }

  if (!VALID_LAYERS.has(request.layer)) {
    throw new Error(`Unsupported evaluator layer: ${request.layer}`);
  }

  if (!VALID_METRIC_TYPES.has(request.metricType)) {
    throw new Error(`Unsupported metric type: ${request.metricType}`);
  }

  if (request.family === "code") {
    if (!request.codeStrategy || !VALID_CODE_STRATEGIES.has(request.codeStrategy)) {
      throw new Error("Code evaluator requires a valid codeStrategy");
    }
  } else if (request.codeStrategy) {
    throw new Error("Model evaluator cannot define codeStrategy");
  }
};

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
    const { baseline, candidate } = buildSampleExperiments();
    const comparison = compareExperiments(baseline, candidate);
    const sampleTraces = [...baseline.caseRuns, ...candidate.caseRuns].map((caseRun) => caseRun.trace);
    const snapshot: LocalStoreSnapshot = {
      datasets: existing.datasets.length > 0 ? existing.datasets : sampleDatasets,
      evaluators: existing.evaluators.length > 0 ? existing.evaluators : sampleEvaluators,
      prompts: existing.prompts.length > 0 ? existing.prompts : samplePrompts,
      agents: existing.agents.length > 0 ? existing.agents : sampleAgents,
      experiments: existing.experiments.length > 0 ? existing.experiments : [baseline, candidate],
      comparisons: existing.comparisons.length > 0 ? existing.comparisons : [comparison],
      traces: existing.traces.length > 0 ? existing.traces : sampleTraces,
    };

    if (
      snapshot.datasets === existing.datasets &&
      snapshot.evaluators === existing.evaluators &&
      snapshot.prompts === existing.prompts &&
      snapshot.agents === existing.agents &&
      snapshot.experiments === existing.experiments &&
      snapshot.comparisons === existing.comparisons &&
      snapshot.traces === existing.traces
    ) {
      return existing;
    }

    await this.store.seed(snapshot);
    return snapshot;
  }

  async createDataset(request: CreateDatasetRequest): Promise<Dataset> {
    const dataset = createDatasetDefinition({
      id: customId("dataset"),
      name: request.name,
      description: request.description,
      datasetType: request.datasetType,
      schema: request.schema,
      sampleCount: request.sampleCount,
      timestamp: now(),
    });

    await this.store.upsertDataset(dataset);
    return dataset;
  }

  async updateDataset(datasetId: string, request: UpdateDatasetRequest): Promise<Dataset> {
    const current = await this.requireDataset(datasetId);
    const dataset = updateDatasetDefinition({
      current,
      name: request.name,
      description: request.description,
      datasetType: request.datasetType,
      schema: request.schema,
      sampleCount: request.sampleCount,
      timestamp: now(),
    });

    await this.store.upsertDataset(dataset);
    return dataset;
  }

  async replaceDatasetCases(
    datasetId: string,
    request: ReplaceDatasetCasesRequest,
  ): Promise<Dataset<EditableDatasetCase>> {
    const current = (await this.requireDataset(datasetId)) as unknown as Dataset<EditableDatasetCase>;
    const dataset = replaceDatasetCasesDefinition({
      current,
      cases: request.cases,
      timestamp: now(),
    });

    await this.store.upsertDataset(dataset as unknown as Dataset);
    return dataset;
  }

  async createDatasetCase(
    datasetId: string,
    item: EditableDatasetCase,
  ): Promise<Dataset<EditableDatasetCase>> {
    const current = (await this.requireDataset(datasetId)) as unknown as Dataset<EditableDatasetCase>;
    const dataset = createDatasetCaseDefinition({
      current,
      item,
      timestamp: now(),
    });

    await this.store.upsertDataset(dataset as unknown as Dataset);
    return dataset;
  }

  async updateDatasetCase(
    datasetId: string,
    item: EditableDatasetCase,
  ): Promise<Dataset<EditableDatasetCase>> {
    const current = (await this.requireDataset(datasetId)) as unknown as Dataset<EditableDatasetCase>;
    const dataset = updateDatasetCaseDefinition({
      current,
      item,
      timestamp: now(),
    });

    await this.store.upsertDataset(dataset as unknown as Dataset);
    return dataset;
  }

  async deleteDatasetCase(
    datasetId: string,
    caseId: string,
  ): Promise<Dataset<EditableDatasetCase>> {
    const current = (await this.requireDataset(datasetId)) as unknown as Dataset<EditableDatasetCase>;
    const dataset = deleteDatasetCaseDefinition({
      current,
      caseId,
      timestamp: now(),
    });

    await this.store.upsertDataset(dataset as unknown as Dataset);
    return dataset;
  }

  async createPrompt(request: CreatePromptRequest): Promise<PromptVersion> {
    ensureNonEmpty(request.name, "Prompt name");
    ensureNonEmpty(request.systemPrompt, "Prompt systemPrompt");
    ensureNonEmpty(request.userTemplate, "Prompt userTemplate");

    const prompt: PromptVersion = {
      id: customId("prompt"),
      name: request.name.trim(),
      version: "0.1.0",
      description: request.description?.trim(),
      systemPrompt: request.systemPrompt.trim(),
      userTemplate: request.userTemplate.trim(),
      inputSchema: {
        input: "string",
      },
    };

    await this.store.upsertPrompt(prompt);
    return prompt;
  }

  async createAgent(request: CreateAgentRequest): Promise<AgentVersion> {
    ensureNonEmpty(request.name, "Agent name");
    ensureNonEmpty(request.queryProcessor, "Agent queryProcessor");
    ensureNonEmpty(request.retriever, "Agent retriever");
    ensureNonEmpty(request.reranker, "Agent reranker");
    ensureNonEmpty(request.answerer, "Agent answerer");

    const agent: AgentVersion = {
      id: customId("agent"),
      name: request.name.trim(),
      version: "0.1.0",
      description: request.description?.trim(),
      queryProcessor: request.queryProcessor.trim(),
      retriever: request.retriever.trim(),
      reranker: request.reranker.trim(),
      answerer: request.answerer.trim(),
    };

    await this.store.upsertAgent(agent);
    return agent;
  }

  async createEvaluator(request: CreateEvaluatorRequest): Promise<Evaluator> {
    validateEvaluatorRequest(request);

    const evaluator: Evaluator = {
      id: customId("evaluator"),
      name: request.name.trim(),
      layer: request.layer,
      family: request.family,
      metricType: request.metricType,
      version: "0.1.0",
      description: request.description.trim(),
      config:
        request.metricType === "binary"
          ? { strictBinary: true, ...request.config }
          : request.config,
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
    if (baselineExperimentId === candidateExperimentId) {
      throw new Error("Baseline and candidate experiments must be different");
    }

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

  async listPrompts() {
    return this.store.listPrompts();
  }

  async listAgents() {
    return this.store.listAgents();
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

  async getDataset(datasetId: string) {
    return this.store.getDataset(datasetId);
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
