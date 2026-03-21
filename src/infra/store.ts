import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createDatasetCaseDefinition,
  deleteDatasetCaseDefinition,
  replaceDatasetCasesDefinition,
  updateDatasetCaseDefinition,
  updateDatasetDefinition,
} from "../domain/datasets.js";
import {
  AgentVersion,
  Dataset,
  EditableDatasetCase,
  Evaluator,
  ExperimentComparison,
  ExperimentRun,
  LocalStoreSnapshot,
  PromptVersion,
  TraceRun,
} from "../domain/types.js";
import type {
  CreateExperimentInput,
  DatasetCaseRecord,
  DatasetSynthesisDirection,
  DatasetSynthesisResult,
} from "../shared/contracts.js";

const emptySnapshot = (): LocalStoreSnapshot => ({
  datasets: [],
  evaluators: [],
  prompts: [],
  agents: [],
  experiments: [],
  comparisons: [],
  traces: [],
});

export class FileBackedLocalStore {
  private readonly experimentContractFile: string;

  constructor(private readonly storeFile: string) {
    this.experimentContractFile = `${storeFile}.experiment-contracts.json`;
  }

  async load(): Promise<LocalStoreSnapshot> {
    try {
      const raw = await readFile(this.storeFile, "utf-8");
      return {
        ...emptySnapshot(),
        ...JSON.parse(raw),
      } as LocalStoreSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptySnapshot();
      }
      throw error;
    }
  }

  async save(snapshot: LocalStoreSnapshot): Promise<void> {
    await mkdir(dirname(this.storeFile), { recursive: true });
    await writeFile(this.storeFile, JSON.stringify(snapshot, null, 2), "utf-8");
  }

  async upsertExperimentContract(experimentId: string, contract: CreateExperimentInput): Promise<void> {
    const snapshot = await this.loadExperimentContracts();
    snapshot[experimentId] = contract;
    await this.saveExperimentContracts(snapshot);
  }

  async upsertDataset(dataset: Dataset): Promise<void> {
    const snapshot = await this.load();
    snapshot.datasets = upsertById(snapshot.datasets, dataset);
    await this.save(snapshot);
  }

  async updateDataset(
    datasetId: string,
    input: {
      name: string;
      description: string;
      datasetType: Dataset["datasetType"];
      schema: Dataset["schema"];
      sampleCount: number;
      timestamp: string;
    },
  ): Promise<Dataset | undefined> {
    const snapshot = await this.load();
    const existingIndex = snapshot.datasets.findIndex((dataset) => dataset.id === datasetId);
    if (existingIndex === -1) {
      return undefined;
    }

    const existing = snapshot.datasets[existingIndex]!;
    const updated = updateDatasetDefinition({
      current: existing,
      name: input.name,
      description: input.description,
      datasetType: input.datasetType,
      schema: input.schema,
      sampleCount: input.sampleCount,
      timestamp: input.timestamp,
    });

    snapshot.datasets[existingIndex] = updated;
    await this.save(snapshot);
    return updated;
  }

  async listDatasetCases(datasetId: string): Promise<Dataset["cases"] | undefined> {
    const dataset = await this.getDataset(datasetId);
    return dataset?.cases;
  }

  async getDatasetCase(
    datasetId: string,
    caseId: string,
  ): Promise<Dataset["cases"][number] | undefined> {
    const dataset = await this.getDataset(datasetId);
    return dataset?.cases.find((item) => datasetCaseKey(item) === caseId);
  }

  async updateDatasetCase(
    datasetId: string,
    item: EditableDatasetCase,
    timestamp: string,
  ): Promise<Dataset<EditableDatasetCase> | undefined> {
    const snapshot = await this.load();
    const datasetIndex = snapshot.datasets.findIndex((dataset) => dataset.id === datasetId);
    if (datasetIndex === -1) {
      return undefined;
    }

    const current = snapshot.datasets[datasetIndex] as unknown as Dataset<EditableDatasetCase>;
    const updatedDataset = updateDatasetCaseDefinition({
      current,
      item,
      timestamp,
    });

    snapshot.datasets[datasetIndex] = updatedDataset as unknown as Dataset;
    await this.save(snapshot);
    return updatedDataset;
  }

  async replaceDatasetCases(
    datasetId: string,
    cases: EditableDatasetCase[],
    timestamp: string,
  ): Promise<Dataset<EditableDatasetCase> | undefined> {
    const snapshot = await this.load();
    const datasetIndex = snapshot.datasets.findIndex((dataset) => dataset.id === datasetId);
    if (datasetIndex === -1) {
      return undefined;
    }

    const current = snapshot.datasets[datasetIndex] as unknown as Dataset<EditableDatasetCase>;
    const updatedDataset = replaceDatasetCasesDefinition({
      current,
      cases,
      timestamp,
    });

    snapshot.datasets[datasetIndex] = updatedDataset as unknown as Dataset;
    await this.save(snapshot);
    return updatedDataset;
  }

  async createDatasetCase(
    datasetId: string,
    item: EditableDatasetCase,
    timestamp: string,
  ): Promise<Dataset<EditableDatasetCase> | undefined> {
    const snapshot = await this.load();
    const datasetIndex = snapshot.datasets.findIndex((dataset) => dataset.id === datasetId);
    if (datasetIndex === -1) {
      return undefined;
    }

    const current = snapshot.datasets[datasetIndex] as unknown as Dataset<EditableDatasetCase>;
    const updatedDataset = createDatasetCaseDefinition({
      current,
      item,
      timestamp,
    });

    snapshot.datasets[datasetIndex] = updatedDataset as unknown as Dataset;
    await this.save(snapshot);
    return updatedDataset;
  }

  async deleteDatasetCase(
    datasetId: string,
    caseId: string,
    timestamp: string,
  ): Promise<Dataset<EditableDatasetCase> | undefined> {
    const snapshot = await this.load();
    const datasetIndex = snapshot.datasets.findIndex((dataset) => dataset.id === datasetId);
    if (datasetIndex === -1) {
      return undefined;
    }

    const current = snapshot.datasets[datasetIndex] as unknown as Dataset<EditableDatasetCase>;
    const updatedDataset = deleteDatasetCaseDefinition({
      current,
      caseId,
      timestamp,
    });

    snapshot.datasets[datasetIndex] = updatedDataset as unknown as Dataset;
    await this.save(snapshot);
    return updatedDataset;
  }

  async synthesizeDatasetCases(
    datasetId: string,
    input: {
      source: "dataset" | "online";
      direction: DatasetSynthesisDirection;
      scenario_description: string;
      use_case_description: string;
      seed_source_ref: string;
      columns: Array<{
        name: string;
        description: string;
        generation_requirement: string;
      }>;
      sample_count: number;
    },
  ): Promise<DatasetSynthesisResult | undefined> {
    const dataset = await this.getDataset(datasetId);
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
        columns: input.columns,
        index,
      }),
    );

    return {
      dataset_id: datasetId,
      source: input.source,
      direction: input.direction,
      items,
      status: "draft",
      created_at: new Date().toISOString(),
    };
  }

  async upsertEvaluator(evaluator: Evaluator): Promise<void> {
    const snapshot = await this.load();
    snapshot.evaluators = upsertById(snapshot.evaluators, evaluator);
    await this.save(snapshot);
  }

  async upsertPrompt(prompt: PromptVersion): Promise<void> {
    const snapshot = await this.load();
    snapshot.prompts = upsertById(snapshot.prompts, prompt);
    await this.save(snapshot);
  }

  async upsertAgent(agent: AgentVersion): Promise<void> {
    const snapshot = await this.load();
    snapshot.agents = upsertById(snapshot.agents, agent);
    await this.save(snapshot);
  }

  async upsertExperiment(experiment: ExperimentRun): Promise<void> {
    const snapshot = await this.load();
    snapshot.experiments = upsertById(snapshot.experiments, experiment, "experimentId");
    snapshot.traces = dedupeTraces([...snapshot.traces, ...experiment.caseRuns.map((caseRun) => caseRun.trace)]);
    await this.save(snapshot);
  }

  async upsertComparison(comparison: ExperimentComparison): Promise<void> {
    const snapshot = await this.load();
    snapshot.comparisons = upsertComparison(snapshot.comparisons, comparison);
    await this.save(snapshot);
  }

  async listDatasets(): Promise<Dataset[]> {
    const snapshot = await this.load();
    return snapshot.datasets;
  }

  async listEvaluators(): Promise<Evaluator[]> {
    const snapshot = await this.load();
    return snapshot.evaluators;
  }

  async listPrompts(): Promise<PromptVersion[]> {
    const snapshot = await this.load();
    return snapshot.prompts;
  }

  async listAgents(): Promise<AgentVersion[]> {
    const snapshot = await this.load();
    return snapshot.agents;
  }

  async listExperiments(): Promise<ExperimentRun[]> {
    const snapshot = await this.load();
    return snapshot.experiments;
  }

  async listComparisons(): Promise<ExperimentComparison[]> {
    const snapshot = await this.load();
    return snapshot.comparisons;
  }

  async listTraces(): Promise<TraceRun[]> {
    const snapshot = await this.load();
    return snapshot.traces;
  }

  async getDataset(id: string): Promise<Dataset | undefined> {
    const snapshot = await this.load();
    return snapshot.datasets.find((dataset) => dataset.id === id);
  }

  async getEvaluator(id: string): Promise<Evaluator | undefined> {
    const snapshot = await this.load();
    return snapshot.evaluators.find((evaluator) => evaluator.id === id);
  }

  async getPrompt(id: string): Promise<PromptVersion | undefined> {
    const snapshot = await this.load();
    return snapshot.prompts.find((prompt) => prompt.id === id);
  }

  async getAgent(id: string): Promise<AgentVersion | undefined> {
    const snapshot = await this.load();
    return snapshot.agents.find((agent) => agent.id === id);
  }

  async getExperiment(experimentId: string): Promise<ExperimentRun | undefined> {
    const snapshot = await this.load();
    return snapshot.experiments.find((experiment) => experiment.experimentId === experimentId);
  }

  async getExperimentDetailBundle(experimentId: string): Promise<
    | {
        experiment: ExperimentRun;
        dataset?: Dataset;
        prompt?: PromptVersion;
        evaluators: Evaluator[];
        comparisons: ExperimentComparison[];
        traces: TraceRun[];
        contract?: CreateExperimentInput;
      }
    | undefined
  > {
    const snapshot = await this.load();
    const experimentContracts = await this.loadExperimentContracts();
    const experiment = snapshot.experiments.find((item) => item.experimentId === experimentId);
    if (!experiment) {
      return undefined;
    }

    const contract = experimentContracts[experimentId];
    const dataset = experiment.datasetId
      ? snapshot.datasets.find((item) => item.id === experiment.datasetId)
      : undefined;
    const prompt =
      contract?.prompt_id ? snapshot.prompts.find((item) => item.id === contract.prompt_id) : undefined;
    const evaluators =
      experiment.evaluatorIds && experiment.evaluatorIds.length > 0
        ? experiment.evaluatorIds.flatMap((evaluatorId) => {
            const evaluator = snapshot.evaluators.find((item) => item.id === evaluatorId);
            return evaluator ? [evaluator] : [];
          })
        : snapshot.evaluators;
    const comparisons = snapshot.comparisons.filter(
      (comparison) =>
        comparison.baselineExperimentId === experimentId ||
        comparison.candidateExperimentId === experimentId,
    );
    const traces = experiment.caseRuns
      .map((caseRun) => caseRun.trace.traceId)
      .flatMap((traceId) => {
        const trace = snapshot.traces.find((item) => item.traceId === traceId);
        return trace ? [trace] : [];
      });

    return {
      experiment,
      dataset,
      prompt,
      evaluators,
      comparisons,
      traces,
      contract,
    };
  }

  async getComparison(
    baselineExperimentId: string,
    candidateExperimentId: string,
  ): Promise<ExperimentComparison | undefined> {
    const snapshot = await this.load();
    return snapshot.comparisons.find(
      (comparison) =>
        comparison.baselineExperimentId === baselineExperimentId &&
        comparison.candidateExperimentId === candidateExperimentId,
    );
  }

  async getTrace(traceId: string): Promise<TraceRun | undefined> {
    const snapshot = await this.load();
    return snapshot.traces.find((trace) => trace.traceId === traceId);
  }

  async seed(snapshot: LocalStoreSnapshot): Promise<void> {
    await this.save(snapshot);
  }

  private async loadExperimentContracts(): Promise<Record<string, CreateExperimentInput>> {
    try {
      const raw = await readFile(this.experimentContractFile, "utf-8");
      return JSON.parse(raw) as Record<string, CreateExperimentInput>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }

      throw error;
    }
  }

  private async saveExperimentContracts(snapshot: Record<string, CreateExperimentInput>): Promise<void> {
    await mkdir(dirname(this.experimentContractFile), { recursive: true });
    await writeFile(this.experimentContractFile, JSON.stringify(snapshot, null, 2), "utf-8");
  }
}

const upsertById = <T>(
  items: T[],
  nextItem: T,
  idField = "id",
): T[] => {
  const existingIndex = items.findIndex(
    (item) =>
      Reflect.get(item as object, idField) === Reflect.get(nextItem as object, idField),
  );
  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  const copy = [...items];
  copy[existingIndex] = nextItem;
  return copy;
};

const upsertComparison = (
  items: ExperimentComparison[],
  nextItem: ExperimentComparison,
): ExperimentComparison[] => {
  const existingIndex = items.findIndex(
    (item) =>
      item.baselineExperimentId === nextItem.baselineExperimentId &&
      item.candidateExperimentId === nextItem.candidateExperimentId,
  );

  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  const copy = [...items];
  copy[existingIndex] = nextItem;
  return copy;
};

const dedupeTraces = (traces: TraceRun[]): TraceRun[] => {
  const seen = new Map<string, TraceRun>();
  for (const trace of traces) {
    seen.set(trace.traceId, trace);
  }
  return [...seen.values()];
};

const datasetCaseKey = (item: Dataset["cases"][number]): string | undefined => {
  const caseId = Reflect.get(item as object, "caseId");
  if (typeof caseId === "string") {
    return caseId;
  }

  const id = Reflect.get(item as object, "id");
  return typeof id === "string" ? id : undefined;
};

const buildSynthesisDraftCase = (input: {
  datasetId: string;
  datasetType: Dataset["datasetType"];
  source: "dataset" | "online";
  direction: DatasetSynthesisDirection;
  scenarioDescription: string;
  useCaseDescription: string;
  seedSourceRef: string;
  columns: Array<{
    name: string;
    description: string;
    generation_requirement: string;
  }>;
  index: number;
}): DatasetCaseRecord => {
  const draftId = `${input.datasetId}_draft_${input.direction}_${input.index + 1}`;
  const columnHints = input.columns.reduce<Record<string, string>>((result, column) => {
    result[column.name] = column.generation_requirement;
    return result;
  }, {});
  const baseContext = {
    source: input.source,
    direction: input.direction,
    scenario_description: input.scenarioDescription,
    use_case_description: input.useCaseDescription,
    seed_source_ref: input.seedSourceRef,
    column_hints: columnHints,
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
