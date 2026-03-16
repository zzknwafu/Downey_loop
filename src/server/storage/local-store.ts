import fs from "node:fs/promises";
import path from "node:path";
import type {
  AppDataSnapshot,
  CreateDatasetInput,
  CreateEvaluatorInput,
  DatasetRecord,
  EvaluatorRecord,
} from "../../shared/contracts.js";
import { createSeedSnapshot } from "../../shared/mock-data.js";
import type { AppConfig } from "../config.js";

const nowIso = () => new Date().toISOString();

const customId = (prefix: string) =>
  `${prefix}_custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class LocalStore {
  constructor(private readonly config: AppConfig) {}

  private async ensureSeeded() {
    await fs.mkdir(this.config.dataDir, { recursive: true });

    try {
      await fs.access(this.config.stateFilePath);
    } catch {
      await this.writeState(createSeedSnapshot());
    }
  }

  private async readState(): Promise<AppDataSnapshot> {
    await this.ensureSeeded();
    const raw = await fs.readFile(this.config.stateFilePath, "utf8");
    return JSON.parse(raw) as AppDataSnapshot;
  }

  private async writeState(state: AppDataSnapshot) {
    await fs.mkdir(path.dirname(this.config.stateFilePath), { recursive: true });
    await fs.writeFile(this.config.stateFilePath, JSON.stringify(state, null, 2));
  }

  async getState() {
    return this.readState();
  }

  async listDatasets() {
    const state = await this.readState();
    return state.datasets;
  }

  async createDataset(input: CreateDatasetInput): Promise<DatasetRecord> {
    const state = await this.readState();
    const timestamp = nowIso();
    const record: DatasetRecord = {
      id: customId("dataset"),
      name: input.name,
      description: input.description,
      dataset_type: input.dataset_type,
      schema: input.schema,
      cases: [],
      version: "0.1.0",
      created_at: timestamp,
      updated_at: timestamp,
    };

    state.datasets = [record, ...state.datasets];
    await this.writeState(state);
    return record;
  }

  async listEvaluators() {
    const state = await this.readState();
    return state.evaluators;
  }

  async createEvaluator(input: CreateEvaluatorInput): Promise<EvaluatorRecord> {
    const state = await this.readState();
    const timestamp = nowIso();
    const record: EvaluatorRecord = {
      id: customId("evaluator"),
      name: input.name,
      family: input.family,
      layer: input.layer,
      metric_type: input.metric_type,
      code_strategy: input.code_strategy,
      description: input.description,
      config: input.config,
      created_at: timestamp,
      updated_at: timestamp,
    };

    state.evaluators = [record, ...state.evaluators];
    await this.writeState(state);
    return record;
  }

  async listExperiments() {
    const state = await this.readState();
    return state.experiments;
  }

  async getExperiment(experimentId: string) {
    const state = await this.readState();
    return state.experiments.find((experiment) => experiment.id === experimentId) ?? null;
  }

  async listTraces() {
    const state = await this.readState();
    return state.traces;
  }

  async getTrace(traceId: string) {
    const state = await this.readState();
    return state.traces.find((trace) => trace.id === traceId) ?? null;
  }

  async getBootstrapData() {
    return this.readState();
  }
}
