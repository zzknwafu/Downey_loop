import {
  AgentVersion,
  ApiContract,
  Dataset,
  Evaluator,
  ExperimentComparison,
  ExperimentRun,
  PromptVersion,
  TraceRun,
} from "../domain/types.js";
import type {
  AgentRecord,
  CreateAgentInput,
  CreatePromptInput,
  CreateDatasetCaseInput,
  DatasetCaseRecord,
  DatasetSynthesisResult,
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

export interface ExperimentListItem {
  experimentId: string;
  datasetId?: string;
  pipelineVersionId?: string;
  status: ExperimentRun["status"];
  totalCases: number;
  completedCases: number;
  invalidJudgmentCount: number;
}

export interface BootstrapPayload {
  datasets: DatasetListItem[];
  evaluators: EvaluatorListItem[];
  experiments: ExperimentListItem[];
  comparison: ExperimentComparison;
}

export interface EvalLoopApi extends ApiContract {
  bootstrap(): Promise<BootstrapPayload>;
  listPrompts(): Promise<PromptVersion[]>;
  listAgents(): Promise<AgentVersion[]>;
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

export const toExperimentListItem = (experiment: ExperimentRun): ExperimentListItem => ({
  experimentId: experiment.experimentId,
  datasetId: experiment.datasetId,
  pipelineVersionId: experiment.pipelineVersionId,
  status: experiment.status,
  totalCases: experiment.summary.totalCases,
  completedCases: experiment.summary.completedCases,
  invalidJudgmentCount: experiment.summary.invalidJudgmentCount,
});

export const listTracesFromExperiments = (experiments: ExperimentRun[]): TraceRun[] =>
  experiments.flatMap((experiment) => experiment.caseRuns.map((caseRun) => caseRun.trace));
