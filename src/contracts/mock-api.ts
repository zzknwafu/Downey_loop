import { compareExperiments } from "../domain/comparison.js";
import {
  buildSampleExperiments,
  sampleAgents,
  sampleDatasets,
  sampleEvaluators,
  samplePrompts,
} from "../domain/sample-data.js";
import { TraceRun } from "../domain/types.js";
import { createDatasetDefinition } from "../domain/datasets.js";
import { toExperimentDetailRecord } from "../server/contract-adapter.js";
import {
  BootstrapPayload,
  EvalLoopApi,
  listTracesFromExperiments,
  toDatasetListItem,
  toEvaluatorListItem,
  toExperimentListItem,
} from "./api.js";
import type {
  AgentRecord,
  CreateAgentInput,
  PromptPreviewResult,
  PromptRecord,
  DatasetCaseRecord,
  DatasetSynthesisDirection,
  DatasetSynthesisResult,
  ExperimentDetailRecord,
  TraceStepRecord,
} from "../shared/contracts.js";

export const createMockEvalLoopApi = (): EvalLoopApi => {
  const { baseline, candidate } = buildSampleExperiments();
  const comparison = compareExperiments(baseline, candidate);
  const traces = listTracesFromExperiments([baseline, candidate]);
  const datasets = [...sampleDatasets];
  const prompts = [...samplePrompts];
  const agents = [...sampleAgents];
  const createdAgents: AgentRecord[] = [];

  return {
    async bootstrap() {
      const bootstrapPayload: BootstrapPayload = {
        datasets: datasets.map(toDatasetListItem),
        evaluators: sampleEvaluators.map(toEvaluatorListItem),
        experiments: [baseline, candidate].map(toExperimentListItem),
        comparison,
      };

      return bootstrapPayload;
    },
    async listDatasets() {
      return datasets;
    },
    async getDataset(datasetId: string) {
      return datasets.find((dataset) => dataset.id === datasetId);
    },
    async createDataset(input) {
      const dataset = createDatasetDefinition({
        id: `dataset_mock_${datasets.length + 1}`,
        name: input.name,
        description: input.description,
        datasetType: input.datasetType,
        schema: input.schema,
        sampleCount: input.sampleCount,
        timestamp: "2026-03-17T00:00:00.000Z",
      });

      datasets.unshift(dataset);
      return dataset;
    },
    async updateDataset(datasetId, input) {
      const index = datasets.findIndex((dataset) => dataset.id === datasetId);
      if (index === -1) {
        return undefined;
      }

      const existing = datasets[index]!;
      if (existing.datasetType !== input.datasetType) {
        throw new Error("Dataset type cannot be changed");
      }

      const updated = createDatasetDefinition({
        id: existing.id,
        name: input.name,
        description: input.description,
        datasetType: input.datasetType,
        schema: input.schema,
        sampleCount: input.sampleCount,
        version: existing.version,
        timestamp: existing.createdAt,
      });

      datasets[index] = {
        ...updated,
        cases: existing.cases,
        createdAt: existing.createdAt,
        updatedAt: "2026-03-17T00:00:00.000Z",
      };

      return datasets[index]!;
    },
    async listDatasetCases(datasetId) {
      const dataset = datasets.find((item) => item.id === datasetId);
      return dataset?.cases.map((item) => toMockDatasetCaseRecord(item));
    },
    async getDatasetCase(datasetId, caseId) {
      return datasets
        .find((dataset) => dataset.id === datasetId)
        ?.cases.map((item) => toMockDatasetCaseRecord(item))
        .find((item) => item.id === caseId);
    },
    async replaceDatasetCases(datasetId, input) {
      const datasetIndex = datasets.findIndex((dataset) => dataset.id === datasetId);
      if (datasetIndex === -1) {
        return undefined;
      }

      const dataset = datasets[datasetIndex]!;
      datasets[datasetIndex] = {
        ...dataset,
        cases: input.cases.map((item) =>
          toMockStoredDatasetCase(item, dataset.datasetType) as (typeof dataset.cases)[number],
        ),
        updatedAt: "2026-03-17T00:00:00.000Z",
      };

      return datasets[datasetIndex]!.cases.map((item) => toMockDatasetCaseRecord(item));
    },
    async createDatasetCase(datasetId, input) {
      const datasetIndex = datasets.findIndex((dataset) => dataset.id === datasetId);
      if (datasetIndex === -1) {
        return undefined;
      }

      const dataset = datasets[datasetIndex]!;
      datasets[datasetIndex] = {
        ...dataset,
        cases: [
          ...dataset.cases,
          toMockStoredDatasetCase(input, dataset.datasetType) as (typeof dataset.cases)[number],
        ],
        updatedAt: "2026-03-17T00:00:00.000Z",
      };

      return toMockDatasetCaseRecord(datasets[datasetIndex]!.cases.at(-1)!);
    },
    async updateDatasetCase(datasetId, nextCase) {
      const datasetIndex = datasets.findIndex((dataset) => dataset.id === datasetId);
      if (datasetIndex === -1) {
        return undefined;
      }

      const dataset = datasets[datasetIndex]!;
      const caseIndex = dataset.cases.findIndex((item) => datasetCaseKey(item) === nextCase.id);
      if (caseIndex === -1) {
        return undefined;
      }

      const currentCase = dataset.cases[caseIndex]!;

      datasets[datasetIndex] = {
        ...dataset,
        cases: dataset.cases.map((item, index) =>
          index === caseIndex
            ? (applyMockDatasetCaseUpdate(currentCase, nextCase) as (typeof dataset.cases)[number])
            : item,
        ),
        updatedAt: "2026-03-17T00:00:00.000Z",
      };

      return toMockDatasetCaseRecord(datasets[datasetIndex]!.cases[caseIndex]!);
    },
    async deleteDatasetCase(datasetId, caseId) {
      const datasetIndex = datasets.findIndex((dataset) => dataset.id === datasetId);
      if (datasetIndex === -1) {
        return false;
      }

      const dataset = datasets[datasetIndex]!;
      const nextCases = dataset.cases.filter((item) => datasetCaseKey(item) !== caseId);
      if (nextCases.length === dataset.cases.length) {
        return false;
      }

      datasets[datasetIndex] = {
        ...dataset,
        cases: nextCases,
        updatedAt: "2026-03-17T00:00:00.000Z",
      };

      return true;
    },
    async synthesizeDatasetCases(datasetId, input) {
      const dataset = datasets.find((item) => item.id === datasetId);
      if (!dataset) {
        return undefined;
      }

      const sampleCount = Math.max(10, input.sample_count);
      const items = Array.from({ length: sampleCount }, (_, index) =>
        buildSynthesisDraftCase({
          datasetId,
          datasetType: dataset.datasetType,
          source: input.source,
          direction: input.direction,
          scenarioDescription: input.scenario_description,
          useCaseDescription: input.use_case_description,
          seedSourceRef: input.seed_source_ref,
          index,
        }),
      );

      return {
        dataset_id: datasetId,
        source: input.source,
        direction: input.direction,
        items,
        status: "draft",
        created_at: "2026-03-18T00:00:00.000Z",
      } satisfies DatasetSynthesisResult;
    },
    async listEvaluators() {
      return sampleEvaluators;
    },
    async listPrompts() {
      return prompts.map((item) => toMockPromptRecord(item));
    },
    async getPrompt(promptId) {
      const prompt = prompts.find((item) => item.id === promptId);
      return prompt ? toMockPromptRecord(prompt) : undefined;
    },
    async createPrompt(input) {
      const prompt: PromptRecord = {
        id: `prompt_mock_${prompts.length + 1}`,
        name: input.name,
        version: "0.1.0",
        description: input.description,
        system_prompt: input.system_prompt,
        user_template: input.user_template,
      };

      prompts.unshift({
        id: prompt.id,
        name: prompt.name,
        version: prompt.version,
        description: prompt.description,
        systemPrompt: prompt.system_prompt,
        userTemplate: prompt.user_template,
        inputSchema: { input: "string" },
      });
      return prompt;
    },
    async previewPrompt(promptId, input) {
      const prompt = prompts.find((item) => item.id === promptId);
      if (!prompt) {
        return undefined;
      }

      return buildPromptPreviewResult(toMockPromptRecord(prompt), input);
    },
    async listAgents() {
      return [...createdAgents, ...agents.map((item) => toMockAgentRecord(item))];
    },
    async listExperimentItems() {
      return [baseline, candidate].map(toExperimentListItem);
    },
    async getAgent(agentId) {
      const created = createdAgents.find((item) => item.id === agentId);
      if (created) {
        return created;
      }

      const agent = agents.find((item) => item.id === agentId);
      return agent ? toMockAgentRecord(agent) : undefined;
    },
    async createAgent(input) {
      const modules = readCompatModules(input);
      const agent: AgentRecord = {
        id: `agent_mock_${createdAgents.length + agents.length + 1}`,
        name: input.name,
        version: input.version,
        description: input.description,
        scenario: input.scenario,
        entry_type: input.entry_type,
        artifact_ref: input.artifact_ref,
        composition: input.composition ?? (modules ? buildCompatComposition(modules) : undefined),
        query_processor: modules?.query_processor,
        retriever: modules?.retriever,
        reranker: modules?.reranker,
        answerer: modules?.answerer,
      };

      createdAgents.unshift(agent);
      return agent;
    },
    async listExperiments() {
      return [baseline, candidate];
    },
    async getExperiment(experimentId: string) {
      return [baseline, candidate].find((experiment) => experiment.experimentId === experimentId);
    },
    async getExperimentDetail(experimentId: string): Promise<ExperimentDetailRecord | undefined> {
      const experiment = [baseline, candidate].find((item) => item.experimentId === experimentId);
      if (!experiment) {
        return undefined;
      }

      const dataset = datasets.find((item) => item.id === experiment.datasetId);
      const evaluators =
        experiment.evaluatorIds && experiment.evaluatorIds.length > 0
          ? sampleEvaluators.filter((item) => experiment.evaluatorIds?.includes(item.id))
          : sampleEvaluators;

      return toExperimentDetailRecord({
        experiment,
        dataset,
        evaluators,
        comparisons: [comparison].filter(
          (item) =>
            item.baselineExperimentId === experiment.experimentId ||
            item.candidateExperimentId === experiment.experimentId,
        ),
      });
    },
    async getComparison() {
      return comparison;
    },
    async getTrace(traceId: string): Promise<TraceRun | undefined> {
      return traces.find((trace) => trace.traceId === traceId);
    },
  };
};

const toMockPromptRecord = (prompt: {
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

const buildCompatComposition = (modules: {
  query_processor: string;
  retriever: string;
  reranker: string;
  answerer: string;
}): NonNullable<AgentRecord["composition"]> => [
  { kind: "query_processor", ref: modules.query_processor, role: "query_processor" },
  { kind: "retriever", ref: modules.retriever, role: "retriever" },
  { kind: "reranker", ref: modules.reranker, role: "reranker" },
  { kind: "answerer", ref: modules.answerer, role: "answerer" },
];

const readCompatModules = (input: CreateAgentInput) => {
  const queryProcessor =
    input.query_processor ??
    input.composition?.find((item) => ["query_processor", "query_understanding"].includes(item.role ?? item.kind))
      ?.ref;
  const retriever =
    input.retriever ??
    input.composition?.find((item) => ["retriever", "retrieval"].includes(item.role ?? item.kind))?.ref;
  const reranker =
    input.reranker ??
    input.composition?.find((item) => ["reranker", "ranking"].includes(item.role ?? item.kind))?.ref;
  const answerer =
    input.answerer ??
    input.composition?.find((item) => ["answerer", "answer_generation"].includes(item.role ?? item.kind))
      ?.ref;

  if (!queryProcessor || !retriever || !reranker || !answerer) {
    return null;
  }

  return {
    query_processor: queryProcessor,
    retriever,
    reranker,
    answerer,
  };
};

const toMockAgentRecord = (agent: {
  id: string;
  name: string;
  version: string;
  description?: string;
  queryProcessor: string;
  retriever: string;
  reranker: string;
  answerer: string;
}): AgentRecord => ({
  id: agent.id,
  name: agent.name,
  version: agent.version,
  description: agent.description,
  scenario: "ai_search",
  entry_type: "workflow",
  artifact_ref: agent.id,
  composition: [
    { kind: "query_processor", ref: agent.queryProcessor, role: "query_processor" },
    { kind: "retriever", ref: agent.retriever, role: "retriever" },
    { kind: "reranker", ref: agent.reranker, role: "reranker" },
    { kind: "answerer", ref: agent.answerer, role: "answerer" },
  ],
  query_processor: agent.queryProcessor,
  retriever: agent.retriever,
  reranker: agent.reranker,
  answerer: agent.answerer,
});

const buildPromptPreviewResult = (
  prompt: PromptRecord,
  input: { input: string; variables?: Record<string, string> },
): PromptPreviewResult => {
  const renderedSystem = applyPromptVariables(prompt.system_prompt, input.input, input.variables);
  const renderedUser = applyPromptVariables(prompt.user_template, input.input, input.variables);

  return {
    prompt_id: prompt.id,
    input: input.input,
    rendered_system_prompt: renderedSystem,
    rendered_user_prompt: renderedUser,
    output_preview: `Preview only: ${input.input}`,
    actual_model_output: `Preview only: ${input.input}`,
    debug_info: {
      prompt_id: prompt.id,
      prompt_version: prompt.version,
      rendered_system_prompt: renderedSystem,
      rendered_user_prompt: renderedUser,
    },
    created_at: "2026-03-18T00:00:00.000Z",
  };
};

const applyPromptVariables = (
  template: string,
  input: string,
  variables?: Record<string, string>,
): string => {
  const entries = { input, ...(variables ?? {}) };
  return Object.entries(entries).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  );
};

const datasetCaseKey = (item: object): string | undefined => {
  const caseId = Reflect.get(item, "caseId");
  if (typeof caseId === "string") {
    return caseId;
  }

  const id = Reflect.get(item, "id");
  return typeof id === "string" ? id : undefined;
};

const toMockDatasetCaseRecord = (item: object): DatasetCaseRecord => {
  if (
    ("userQuery" in item && "answerReference" in item) ||
    ("input" in item && "referenceOutput" in item) ||
    ("input" in item && "reference_output" in item)
  ) {
    return {
      id: String(datasetCaseKey(item) ?? ""),
      input: String(Reflect.get(item, "userQuery") ?? Reflect.get(item, "input") ?? ""),
      reference_output: String(
        Reflect.get(item, "answerReference") ?? Reflect.get(item, "referenceOutput") ?? Reflect.get(item, "reference_output") ?? "",
      ),
      context: {
        domain: Reflect.get(item, "domain") ?? null,
        task_type: Reflect.get(item, "taskType") ?? null,
        query_constraints: Reflect.get(item, "queryConstraints") ?? null,
        retrieval_candidates: Reflect.get(item, "retrievalCandidates") ?? [],
        expected_retrieval_ids: Reflect.get(item, "expectedRetrievalIds") ?? [],
        acceptable_retrieval_ids: Reflect.get(item, "acceptableRetrievalIds") ?? [],
        expected_top_items: Reflect.get(item, "expectedTopItems") ?? [],
        business_labels: Reflect.get(item, "businessOutcomeLabels") ?? null,
      },
    };
  }

  if ("workflowOutput" in item || "expectedSteps" in item) {
    return {
      id: String(datasetCaseKey(item) ?? ""),
      input: String(Reflect.get(item, "input") ?? ""),
      workflow_output:
        (Reflect.get(item, "workflowOutput") as Record<string, unknown> | undefined) ?? {},
      expected_steps: (Reflect.get(item, "expectedSteps") as string[] | undefined) ?? [],
      context: Reflect.get(item, "context") as Record<string, unknown> | undefined,
    };
  }

  return {
    id: String(datasetCaseKey(item) ?? ""),
    trace_id: String(Reflect.get(item, "traceId") ?? Reflect.get(item, "trace_id") ?? ""),
    final_output: String(Reflect.get(item, "finalOutput") ?? Reflect.get(item, "final_output") ?? ""),
    trajectory: ((Reflect.get(item, "trajectory") as unknown as TraceStepRecord[] | undefined) ?? []),
    context: Reflect.get(item, "context") as Record<string, unknown> | undefined,
  };
};

const applyMockDatasetCaseUpdate = (current: object, next: DatasetCaseRecord): object => {
  if ("reference_output" in next) {
    if ("userQuery" in current || "answerReference" in current) {
      return {
        ...current,
        caseId: next.id,
        userQuery: next.input,
        answerReference: next.reference_output,
        domain:
          typeof next.context.domain === "string" ? next.context.domain : Reflect.get(current, "domain"),
        taskType:
          typeof next.context.task_type === "string"
            ? next.context.task_type
            : Reflect.get(current, "taskType"),
        queryConstraints:
          typeof next.context.query_constraints === "object" && next.context.query_constraints !== null
            ? next.context.query_constraints
            : Reflect.get(current, "queryConstraints"),
        retrievalCandidates: Array.isArray(next.context.retrieval_candidates)
          ? next.context.retrieval_candidates
          : Reflect.get(current, "retrievalCandidates"),
        expectedRetrievalIds: Array.isArray(next.context.expected_retrieval_ids)
          ? next.context.expected_retrieval_ids
          : Reflect.get(current, "expectedRetrievalIds"),
        acceptableRetrievalIds: Array.isArray(next.context.acceptable_retrieval_ids)
          ? next.context.acceptable_retrieval_ids
          : Reflect.get(current, "acceptableRetrievalIds"),
        expectedTopItems: Array.isArray(next.context.expected_top_items)
          ? next.context.expected_top_items
          : Reflect.get(current, "expectedTopItems"),
        businessOutcomeLabels:
          typeof next.context.business_labels === "object" && next.context.business_labels !== null
            ? next.context.business_labels
            : Reflect.get(current, "businessOutcomeLabels"),
      };
    }

    return {
      ...current,
      caseId: next.id,
      input: next.input,
      referenceOutput: next.reference_output,
      context: next.context,
    };
  }

  if ("workflow_output" in next) {
    return {
      ...current,
      caseId: next.id,
      input: next.input,
      workflowOutput: next.workflow_output,
      expectedSteps: next.expected_steps,
      context: next.context,
    };
  }

  return {
    ...current,
    caseId: next.id,
    traceId: next.trace_id,
    finalOutput: next.final_output,
    trajectory: next.trajectory,
    context: next.context,
  };
};

const toMockStoredDatasetCase = (
  next: DatasetCaseRecord,
  datasetType: (typeof sampleDatasets)[number]["datasetType"],
): object => {
  switch (datasetType) {
    case "ideal_output":
      if (!("reference_output" in next)) {
        throw new Error("Invalid ideal_output dataset case");
      }

      return {
        caseId: next.id,
        input: next.input,
        referenceOutput: next.reference_output,
        context: next.context,
      };
    case "workflow":
      if (!("workflow_output" in next)) {
        throw new Error("Invalid workflow dataset case");
      }

      return {
        caseId: next.id,
        input: next.input,
        workflowOutput: next.workflow_output,
        expectedSteps: next.expected_steps,
        context: next.context,
      };
    case "trace_monitor":
      if (!("trace_id" in next)) {
        throw new Error("Invalid trace_monitor dataset case");
      }

      return {
        caseId: next.id,
        traceId: next.trace_id,
        finalOutput: next.final_output,
        trajectory: next.trajectory,
        context: next.context,
      };
  }
};

const buildSynthesisDraftCase = (input: {
  datasetId: string;
  datasetType: (typeof sampleDatasets)[number]["datasetType"];
  source: "dataset" | "online";
  direction: DatasetSynthesisDirection;
  scenarioDescription: string;
  useCaseDescription: string;
  seedSourceRef: string;
  index: number;
}): DatasetCaseRecord => {
  const draftId = `${input.datasetId}_draft_${input.direction}_${input.index + 1}`;
  const baseContext = {
    source: input.source,
    direction: input.direction,
    scenario_description: input.scenarioDescription,
    use_case_description: input.useCaseDescription,
    seed_source_ref: input.seedSourceRef,
    draft: true,
  };

  switch (input.datasetType) {
    case "ideal_output":
      return {
        id: draftId,
        input: `Draft query ${input.index + 1}: ${input.scenarioDescription}`,
        reference_output: `Draft answer for ${input.useCaseDescription}`,
        context: baseContext,
      };
    case "workflow":
      return {
        id: draftId,
        input: `Draft workflow input ${input.index + 1}`,
        workflow_output: {
          summary: input.useCaseDescription,
          direction: input.direction,
        },
        expected_steps: ["retrieve", "reason", "respond"],
        context: baseContext,
      };
    case "trace_monitor":
      return {
        id: draftId,
        trace_id: `${draftId}_trace`,
        final_output: `Draft trace output for ${input.scenarioDescription}`,
        trajectory: [
          {
            layer: "retrieval",
            latency_ms: 42,
            inputs: { seed_source_ref: input.seedSourceRef },
            outputs: { direction: input.direction },
          },
        ],
        context: baseContext,
      };
  }
};
