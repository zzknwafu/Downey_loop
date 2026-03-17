import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AgentVersion,
  Dataset,
  Evaluator,
  ExperimentComparison,
  ExperimentRun,
  LocalStoreSnapshot,
  PromptVersion,
  TraceRun,
} from "../domain/types.js";

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
  constructor(private readonly storeFile: string) {}

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

  async upsertDataset(dataset: Dataset): Promise<void> {
    const snapshot = await this.load();
    snapshot.datasets = upsertById(snapshot.datasets, dataset);
    await this.save(snapshot);
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
