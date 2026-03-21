import { compareExperiments } from "../domain/comparison.js";
import {
  buildEvaluatorKey,
  bumpEvaluatorVersion,
  latestEvaluatorVersion,
} from "../domain/evaluators.js";
import {
  AgentVersion,
  Dataset,
  DatasetColumn,
  EditableDatasetCase,
  EvalCase,
  EvalTarget,
  Evaluator,
  ExperimentComparison,
  ExperimentFieldMapping,
  ExperimentRunConfig,
  ExperimentRun,
  LocalStoreSnapshot,
  PipelineExecutionResult,
  PromptModelConfig,
  PromptVersion,
  StartExperimentInput,
  SearchPipelineVersion,
} from "../domain/types.js";
import type { PromptPreviewInput, PromptPreviewResult } from "../shared/contracts.js";
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
import {
  createAgentVersion,
  createPromptVersion,
  validateTargetDatasetCompatibility,
} from "../domain/targets.js";
import {
  callGeminiText,
  renderPromptTemplate,
  resolvePromptVariables,
  type GeminiConfig,
} from "../infra/openai.js";
import { FileBackedLocalStore } from "../infra/store.js";
import { ExperimentRunner, PipelineExecutor } from "../runner/experiment-runner.js";

export interface RunExperimentRequest {
  datasetId: string;
  target: EvalTarget;
  evaluatorIds?: string[];
  promptBinding?: {
    variableMappings?: ExperimentFieldMapping[];
    modelConfig?: Partial<PromptModelConfig>;
    modelParams?: Record<string, unknown>;
  };
  runConfig?: Partial<ExperimentRunConfig>;
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
  evaluatorKey?: string;
  changeSummary?: string;
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
    private readonly geminiConfig?: GeminiConfig,
  ) {
    this.runner = new ExperimentRunner(pipelineExecutor);
  }

  async seedDefaults(): Promise<LocalStoreSnapshot> {
    const existing = await this.store.load();
    const seededDatasets = buildSeededDatasets();
    const { baseline, candidate } = buildSampleExperiments();
    const comparison = compareExperiments(baseline, candidate);
    const sampleTraces = [...baseline.caseRuns, ...candidate.caseRuns].map((caseRun) => caseRun.trace);
    const snapshot: LocalStoreSnapshot = {
      datasets: mergeMissingById(existing.datasets, seededDatasets, "id"),
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
    const prompt = createPromptVersion({
      id: customId("prompt"),
      name: request.name,
      description: request.description,
      systemPrompt: request.systemPrompt,
      userTemplate: request.userTemplate,
    });

    await this.store.upsertPrompt(prompt);
    return prompt;
  }

  async previewPrompt(promptId: string, input: PromptPreviewInput): Promise<PromptPreviewResult> {
    const prompt = await this.store.getPrompt(promptId);
    if (!prompt) {
      throw new Error(`Missing prompt: ${promptId}`);
    }

    const geminiConfig = this.requireGeminiConfig();
    const source = {
      input: input.input,
      ...(input.variables ?? {}),
    } as Record<string, unknown>;
    const renderedSystemPrompt = renderPromptTemplate(prompt.systemPrompt, source);
    const renderedUserPrompt = renderPromptTemplate(prompt.userTemplate, source);
    const result = await callGeminiText(geminiConfig, {
      systemPrompt: renderedSystemPrompt,
      userPrompt: renderedUserPrompt,
      timeoutMs: 30_000,
    });

    return {
      prompt_id: prompt.id,
      input: input.input,
      rendered_system_prompt: renderedSystemPrompt,
      rendered_user_prompt: renderedUserPrompt,
      output_preview: result.outputText,
      actual_model_output: result.outputText,
      debug_info: {
        prompt_id: prompt.id,
        prompt_version: prompt.version,
        model: geminiConfig.model,
        response_id: result.responseId,
        usage: result.usage,
        rendered_system_prompt: renderedSystemPrompt,
        rendered_user_prompt: renderedUserPrompt,
      },
      created_at: now(),
    };
  }

  async createAgent(request: CreateAgentRequest): Promise<AgentVersion> {
    const agent = createAgentVersion({
      id: customId("agent"),
      name: request.name,
      description: request.description,
      queryProcessor: request.queryProcessor,
      retriever: request.retriever,
      reranker: request.reranker,
      answerer: request.answerer,
    });

    await this.store.upsertAgent(agent);
    return agent;
  }

  async createEvaluator(request: CreateEvaluatorRequest): Promise<Evaluator> {
    validateEvaluatorRequest(request);
    const existingEvaluators = await this.store.listEvaluators();
    const evaluatorKey =
      request.evaluatorKey?.trim() ||
      buildEvaluatorKey({
        name: request.name.trim(),
        layer: request.layer,
        family: request.family,
      });
    const lineage = existingEvaluators.filter((item) => item.evaluatorKey === evaluatorKey);
    const previousVersion = latestEvaluatorVersion(lineage);

    const evaluator: Evaluator = {
      id: customId("evaluator"),
      evaluatorKey,
      name: request.name.trim(),
      layer: request.layer,
      family: request.family,
      metricType: request.metricType,
      version: previousVersion ? bumpEvaluatorVersion(previousVersion.version) : "0.1.0",
      previousVersionId: previousVersion?.id,
      changeSummary: request.changeSummary?.trim(),
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
    const dataset = normalizeRunnableDataset((await this.requireDataset(request.datasetId)) as Dataset<unknown>);
    validateTargetDatasetCompatibility(request.target, dataset.datasetType);
    const evaluators = await this.resolveEvaluators(request.evaluatorIds);

    const startExperimentInput: StartExperimentInput = {
      dataset,
      target: request.target,
      evaluators,
      promptBinding: request.promptBinding
        ? {
            variableMappings: request.promptBinding.variableMappings,
            modelConfig: buildPromptModelConfig(
              this.geminiConfig?.model ?? "gemini-2.5-flash",
              request.promptBinding.modelConfig,
            ),
          }
        : undefined,
      runConfig: request.runConfig,
    };

    const runner = this.isPromptTarget(request.target)
      ? new ExperimentRunner(
          this.createPromptPipelineExecutor({
            target: request.target,
            promptBinding: request.promptBinding,
            runConfig: request.runConfig,
          }),
        )
      : this.runner;

    const { experiment } = await runner.runExperiment(startExperimentInput);

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

  private requireGeminiConfig(): GeminiConfig {
    if (!this.geminiConfig || !this.geminiConfig.apiKey) {
      throw new Error("Gemini API key is required for prompt execution");
    }

    return this.geminiConfig;
  }

  private isPromptTarget(target: EvalTarget): target is PromptVersion {
    return "systemPrompt" in target && "userTemplate" in target;
  }

  private createPromptPipelineExecutor(input: {
    target: PromptVersion;
    promptBinding?: RunExperimentRequest["promptBinding"];
    runConfig?: Partial<ExperimentRunConfig>;
  }): PipelineExecutor {
    const geminiConfig = this.requireGeminiConfig();
    const timeoutMs = input.runConfig?.timeoutMs ?? 30_000;
    const retryLimit = Math.max(0, input.runConfig?.retryLimit ?? 0);

    return async (evalCase) => {
      const source = buildPromptExecutionSource(evalCase);
      const resolvedVariables = resolvePromptVariables(
        source,
        (input.promptBinding?.variableMappings ?? []).map((mapping) => ({
          source_field: mapping.sourceField,
          target_field: mapping.targetField,
          source_type: mapping.sourceType,
          target_type: mapping.targetType,
        })),
      );
      const renderedSystemPrompt = renderPromptTemplate(input.target.systemPrompt, {
        ...source,
        ...resolvedVariables,
      });
      const renderedUserPrompt = renderPromptTemplate(input.target.userTemplate, {
        ...source,
        ...resolvedVariables,
      });
      const modelParams = normalizePromptModelParams(input.promptBinding?.modelParams);

      let lastError: unknown;
      for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
        try {
          const result = await callGeminiText(geminiConfig, {
            systemPrompt: renderedSystemPrompt,
            userPrompt: renderedUserPrompt,
            modelParams,
            timeoutMs,
          });

          return {
            retrievalResult: [],
            rerankResult: [],
            answerOutput: result.outputText,
            supportingEvidence: [],
            latencyMs: { retrieval: 0, rerank: 0, answer: 0 },
            debugInfo: {
              prompt_id: input.target.id,
              prompt_version: input.target.version,
              attempt,
              model: geminiConfig.model,
              response_id: result.responseId,
              usage: result.usage,
              rendered_system_prompt: renderedSystemPrompt,
              rendered_user_prompt: renderedUserPrompt,
              resolved_variables: resolvedVariables,
              model_params: modelParams,
            },
          } satisfies PipelineExecutionResult;
        } catch (error) {
          lastError = error;
          if (attempt >= retryLimit) {
            throw error instanceof Error ? error : new Error("Gemini prompt execution failed");
          }
        }
      }

      throw lastError instanceof Error ? lastError : new Error("Gemini prompt execution failed");
    };
  }
}

const buildSeededDatasets = (): Dataset[] => {
  const { baseline } = buildSampleExperiments();
  const primaryDataset = sampleDatasets[0]!;

  const workflowDataset = {
    id: "dataset_workflow_001",
    name: "AI 搜 Workflow 执行集",
    description: "同一批样本按 workflow 视角表达，用于节点执行、工具调用与回放联调。",
    datasetType: "workflow" as const,
    schema: [
      {
        name: "input",
        dataType: "String" as const,
        required: true,
        description: "工作流输入。",
      },
      {
        name: "workflow_output",
        dataType: "JSON" as const,
        required: true,
        description: "工作流最终输出。",
      },
      {
        name: "expected_steps",
        dataType: "JSON" as const,
        required: false,
        description: "期望步骤。",
      },
    ],
    cases: primaryDataset.cases.map((sample) => ({
      caseId: `workflow_${sample.caseId}`,
      input: sample.userQuery,
      workflowOutput: {
        retrieval_candidates: sample.retrievalCandidates,
        expected_top_items: sample.expectedTopItems,
        answer_reference: sample.answerReference,
      },
      expectedSteps: ["retrieval", "rerank", "answer"],
      context: {
        domain: sample.domain,
        task_type: sample.taskType,
      },
    })),
    version: "0.1.0",
    createdAt: "2026-03-16T00:00:00.000Z",
    updatedAt: "2026-03-16T00:00:00.000Z",
  } as unknown as Dataset;

  const traceMonitorDataset = {
    id: "dataset_trace_001",
    name: "AI 搜 Trace 监控集",
    description: "从 baseline 实验直接派生的 trace 回放样本。",
    datasetType: "trace_monitor" as const,
    schema: [
      {
        name: "trace_id",
        dataType: "String" as const,
        required: true,
        description: "轨迹唯一标识。",
      },
      {
        name: "final_output",
        dataType: "String" as const,
        required: true,
        description: "最终回答。",
      },
      {
        name: "trajectory",
        dataType: "JSON" as const,
        required: false,
        description: "轨迹步骤。",
      },
    ],
    cases: baseline.caseRuns.map((run) => ({
      caseId: `trace_case_${run.trace.traceId}`,
      traceId: run.trace.traceId,
      finalOutput: String(run.trace.answerTrace.outputs.answerOutput ?? ""),
      trajectory: [
        {
          layer: "retrieval",
          latencyMs: run.trace.retrievalTrace.latencyMs,
          inputs: run.trace.retrievalTrace.inputs,
          outputs: run.trace.retrievalTrace.outputs,
        },
        {
          layer: "rerank",
          latencyMs: run.trace.rerankTrace.latencyMs,
          inputs: run.trace.rerankTrace.inputs,
          outputs: run.trace.rerankTrace.outputs,
        },
        {
          layer: "answer",
          latencyMs: run.trace.answerTrace.latencyMs,
          inputs: run.trace.answerTrace.inputs,
          outputs: run.trace.answerTrace.outputs,
        },
      ],
      context: {
        case_id: run.caseId,
      },
    })),
    version: "0.1.0",
    createdAt: "2026-03-16T00:00:00.000Z",
    updatedAt: "2026-03-16T00:00:00.000Z",
  } as unknown as Dataset;

  return [...sampleDatasets, workflowDataset, traceMonitorDataset];
};

const mergeMissingById = <T>(existing: T[], seeded: T[], idField: string): T[] => {
  const existingIds = new Set(
    existing.map((item) => String(Reflect.get(item as object, idField))),
  );
  const missingSeeded = seeded.filter(
    (item) => !existingIds.has(String(Reflect.get(item as object, idField))),
  );
  if (missingSeeded.length === 0) {
    return existing;
  }
  return [...existing, ...missingSeeded];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const normalizeRunnableDataset = (dataset: Dataset<unknown>): Dataset => ({
  ...dataset,
  cases: dataset.cases.map((item) => normalizeEvalCase(item)),
});

const normalizeEvalCase = (item: unknown): EvalCase => {
  if (isRecord(item) && "caseId" in item) {
    return {
      caseId: typeof item.caseId === "string" ? item.caseId : `case_${Date.now().toString(36)}`,
      expectedRetrievalIds: Array.isArray(item.expectedRetrievalIds) ? item.expectedRetrievalIds : [],
      acceptableRetrievalIds: Array.isArray(item.acceptableRetrievalIds) ? item.acceptableRetrievalIds : [],
      expectedTopItems: Array.isArray(item.expectedTopItems) ? item.expectedTopItems : [],
      retrievalCandidates: Array.isArray(item.retrievalCandidates) ? item.retrievalCandidates : [],
      answerReference: typeof item.answerReference === "string" ? item.answerReference : "",
      userQuery: typeof item.userQuery === "string" ? item.userQuery : "",
      domain: item.domain === "grocery" ? "grocery" : "food_delivery",
      taskType:
        item.taskType === "recommendation" || item.taskType === "fulfillment_qa" || item.taskType === "aftersales"
          ? item.taskType
          : "ai_search",
    };
  }

  if (isRecord(item) && "input" in item && "reference_output" in item) {
    const context = isRecord(item.context) ? item.context : {};
    return {
      caseId: typeof item.id === "string" ? item.id : `case_${Date.now().toString(36)}`,
      domain: context.domain === "grocery" ? "grocery" : "food_delivery",
      taskType:
        context.task_type === "recommendation" ||
        context.task_type === "fulfillment_qa" ||
        context.task_type === "aftersales"
          ? context.task_type
          : "ai_search",
      userQuery: typeof item.input === "string" ? item.input : "",
      queryConstraints: isRecord(context.query_constraints)
        ? (context.query_constraints as EvalCase["queryConstraints"])
        : undefined,
      retrievalCandidates: Array.isArray(context.retrieval_candidates)
        ? (context.retrieval_candidates as EvalCase["retrievalCandidates"])
        : [],
      expectedRetrievalIds: asStringArray(context.expected_retrieval_ids),
      acceptableRetrievalIds: asStringArray(context.acceptable_retrieval_ids),
      expectedTopItems: asStringArray(context.expected_top_items),
      answerReference: typeof item.reference_output === "string" ? item.reference_output : "",
      businessOutcomeLabels: isRecord(context.business_labels)
        ? (context.business_labels as EvalCase["businessOutcomeLabels"])
        : undefined,
    };
  }

  return {
    caseId: String(Reflect.get(item as object, "id") ?? `case_${Date.now().toString(36)}`),
    domain: "food_delivery",
    taskType: "ai_search",
    userQuery: String(Reflect.get(item as object, "input") ?? ""),
    queryConstraints: undefined,
    retrievalCandidates: [],
    expectedRetrievalIds: [],
    acceptableRetrievalIds: [],
    expectedTopItems: [],
    answerReference: String(Reflect.get(item as object, "final_output") ?? ""),
  };
};

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

const buildPromptExecutionSource = (evalCase: EvalCase): Record<string, unknown> => ({
  input: evalCase.userQuery,
  userQuery: evalCase.userQuery,
  reference_output: evalCase.answerReference,
  answerReference: evalCase.answerReference,
  domain: evalCase.domain,
  task_type: evalCase.taskType,
  taskType: evalCase.taskType,
  query_constraints: evalCase.queryConstraints ?? {},
  queryConstraints: evalCase.queryConstraints ?? {},
  retrieval_candidates: evalCase.retrievalCandidates,
  retrievalCandidates: evalCase.retrievalCandidates,
  expected_retrieval_ids: evalCase.expectedRetrievalIds,
  expectedRetrievalIds: evalCase.expectedRetrievalIds,
  acceptable_retrieval_ids: evalCase.acceptableRetrievalIds,
  acceptableRetrievalIds: evalCase.acceptableRetrievalIds,
  expected_top_items: evalCase.expectedTopItems,
  expectedTopItems: evalCase.expectedTopItems,
  business_labels: evalCase.businessOutcomeLabels ?? {},
  business_outcome_labels: evalCase.businessOutcomeLabels ?? {},
  businessOutcomeLabels: evalCase.businessOutcomeLabels ?? {},
});

const normalizePromptModelParams = (modelParams?: Record<string, unknown>) => {
  if (!modelParams) {
    return undefined;
  }

  const normalized: Record<string, unknown> = {};
  if (typeof modelParams.temperature === "number") {
    normalized.temperature = modelParams.temperature;
  }
  const topP = modelParams.top_p ?? modelParams.topP;
  if (typeof topP === "number") {
    normalized.top_p = topP;
  }
  const maxOutputTokens = modelParams.max_output_tokens ?? modelParams.maxTokens;
  if (typeof maxOutputTokens === "number") {
    normalized.max_output_tokens = maxOutputTokens;
  }
  const presencePenalty = modelParams.presence_penalty ?? modelParams.presencePenalty;
  if (typeof presencePenalty === "number") {
    normalized.presence_penalty = presencePenalty;
  }
  const frequencyPenalty = modelParams.frequency_penalty ?? modelParams.frequencyPenalty;
  if (typeof frequencyPenalty === "number") {
    normalized.frequency_penalty = frequencyPenalty;
  }
  const seed = modelParams.seed;
  if (typeof seed === "number") {
    normalized.seed = seed;
  }
  for (const [key, value] of Object.entries(modelParams)) {
    if (
      value !== undefined &&
      key !== "model" &&
      key !== "temperature" &&
      key !== "top_p" &&
      key !== "topP" &&
      key !== "max_output_tokens" &&
      key !== "maxTokens" &&
      key !== "presence_penalty" &&
      key !== "presencePenalty" &&
      key !== "frequency_penalty" &&
      key !== "frequencyPenalty" &&
      key !== "seed"
    ) {
      normalized[key] = value;
    }
  }

  return normalized;
};

const buildPromptModelConfig = (model: string, modelConfig?: Partial<PromptModelConfig>) => ({
  model,
  ...(typeof modelConfig?.temperature === "number" ? { temperature: modelConfig.temperature } : {}),
  ...(typeof modelConfig?.topP === "number" ? { topP: modelConfig.topP } : {}),
  ...(typeof modelConfig?.maxTokens === "number" ? { maxTokens: modelConfig.maxTokens } : {}),
});
