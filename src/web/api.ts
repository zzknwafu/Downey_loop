import type {
  AbExperimentRecord,
  AgentRecord,
  CreateAgentInput,
  BootstrapResponse,
  CreateDatasetCaseInput,
  CreateComparisonInput,
  CreateDatasetInput,
  CreateEvaluatorInput,
  CreateExperimentInput,
  CreatePromptInput,
  DatasetCaseRecord,
  DatasetRecord,
  DatasetSynthesisDirection,
  DatasetSynthesisResult,
  EvaluatorRecord,
  ExperimentDetailRecord,
  ExperimentListItemRecord,
  ExperimentRunRecord,
  ItemResponse,
  ListResponse,
  PromptPreviewInput,
  PromptPreviewResult,
  PromptRecord,
  ReplaceDatasetCasesInput,
  SynthesizeDatasetInput,
  TraceRunRecord,
  UpdateDatasetInput,
  UpdateDatasetCaseInput,
} from "../shared/contracts.js";

type LegacySynthesizeDatasetInput = {
  source: "dataset" | "online";
  mode: "generalize" | "augment" | "synthesize";
};

const expectOk = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    let message = `API request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (typeof payload.error === "string" && payload.error.trim().length > 0) {
        message = payload.error;
      }
    } catch {
      // Preserve the status-only fallback when the body is empty or invalid JSON.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
};

export const fetchBootstrap = async () => {
  const response = await fetch("/api/bootstrap");
  return expectOk<BootstrapResponse>(response);
};

export const fetchPrompts = async () => {
  const response = await fetch("/api/prompts");
  return expectOk<ListResponse<PromptRecord>>(response);
};

export const fetchPrompt = async (promptId: string) => {
  const response = await fetch(`/api/prompts/${promptId}`);
  return expectOk<ItemResponse<PromptRecord>>(response);
};

export const createPrompt = async (payload: CreatePromptInput) => {
  const response = await fetch("/api/prompts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ItemResponse<PromptRecord>>(response);
};

export const previewPrompt = async (promptId: string, payload: PromptPreviewInput) => {
  const response = await fetch(`/api/prompts/${promptId}/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ItemResponse<PromptPreviewResult>>(response);
};

export const fetchAgents = async () => {
  const response = await fetch("/api/agents");
  return expectOk<ListResponse<AgentRecord>>(response);
};

export const fetchAgent = async (agentId: string) => {
  const response = await fetch(`/api/agents/${agentId}`);
  return expectOk<ItemResponse<AgentRecord>>(response);
};

export const createAgent = async (payload: CreateAgentInput) => {
  const response = await fetch("/api/agents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ItemResponse<AgentRecord>>(response);
};

export const createDataset = async (payload: CreateDatasetInput) => {
  const response = await fetch("/api/datasets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ItemResponse<DatasetRecord>>(response);
};

export const fetchDataset = async (datasetId: string) => {
  const response = await fetch(`/api/datasets/${datasetId}`);
  return expectOk<ItemResponse<DatasetRecord>>(response);
};

export const updateDataset = async (datasetId: string, payload: UpdateDatasetInput) => {
  const response = await fetch(`/api/datasets/${datasetId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ItemResponse<DatasetRecord>>(response);
};

export const fetchDatasetCases = async (datasetId: string) => {
  const response = await fetch(`/api/datasets/${datasetId}/cases`);
  return expectOk<ListResponse<DatasetCaseRecord>>(response);
};

export const fetchDatasetCase = async (datasetId: string, caseId: string) => {
  const response = await fetch(`/api/datasets/${datasetId}/cases/${caseId}`);
  return expectOk<ItemResponse<DatasetCaseRecord>>(response);
};

export const replaceDatasetCases = async (
  datasetId: string,
  payload: ReplaceDatasetCasesInput,
) => {
  const response = await fetch(`/api/datasets/${datasetId}/cases`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ListResponse<DatasetCaseRecord>>(response);
};

export const createDatasetCase = async (
  datasetId: string,
  payload: CreateDatasetCaseInput,
) => {
  const response = await fetch(`/api/datasets/${datasetId}/cases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ItemResponse<DatasetCaseRecord>>(response);
};

export const updateDatasetCase = async (
  datasetId: string,
  caseId: string,
  payload: UpdateDatasetCaseInput,
) => {
  const response = await fetch(`/api/datasets/${datasetId}/cases/${caseId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ItemResponse<DatasetCaseRecord>>(response);
};

export const deleteDatasetCase = async (datasetId: string, caseId: string) => {
  const response = await fetch(`/api/datasets/${datasetId}/cases/${caseId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
};

export const synthesizeDatasetCases = async (
  datasetId: string,
  payload: SynthesizeDatasetInput | LegacySynthesizeDatasetInput,
) => {
  const response = await fetch(`/api/datasets/${datasetId}/synthesis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(normalizeSynthesisInput(datasetId, payload)),
  });

  return expectOk<ItemResponse<DatasetSynthesisResult>>(response);
};

export const createEvaluator = async (payload: CreateEvaluatorInput) => {
  const response = await fetch("/api/evaluators", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ItemResponse<EvaluatorRecord>>(response);
};

export const createExperiment = async (payload: CreateExperimentInput) => {
  const response = await fetch("/api/experiments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ItemResponse<ExperimentRunRecord>>(response);
};

export const createComparison = async (payload: CreateComparisonInput) => {
  const response = await fetch("/api/comparisons", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return expectOk<ItemResponse<AbExperimentRecord>>(response);
};

export const fetchExperimentItems = async () => {
  const response = await fetch("/api/experiments");
  return expectOk<ListResponse<ExperimentListItemRecord>>(response);
};

export const fetchExperiment = async (experimentId: string) => {
  const response = await fetch(`/api/experiments/${experimentId}`);
  return expectOk<ItemResponse<ExperimentRunRecord>>(response);
};

export const fetchExperimentDetail = async (experimentId: string) => {
  const response = await fetch(`/api/experiments/${experimentId}/detail`);
  return expectOk<ItemResponse<ExperimentDetailRecord>>(response);
};

export const fetchTrace = async (traceId: string) => {
  const response = await fetch(`/api/traces/${traceId}`);
  return expectOk<ItemResponse<TraceRunRecord>>(response);
};

const normalizeSynthesisInput = (
  datasetId: string,
  payload: SynthesizeDatasetInput | LegacySynthesizeDatasetInput,
): SynthesizeDatasetInput => {
  if ("direction" in payload) {
    return {
      ...payload,
      dataset_id: datasetId,
    };
  }

  return {
    dataset_id: datasetId,
    source: payload.source,
    direction: legacyModeToDirection(payload.mode),
    scenario_description: "Legacy synthesis request from current dataset page",
    use_case_description: "Draft dataset augmentation",
    seed_source_ref: payload.source === "dataset" ? `dataset:${datasetId}` : "online:latest-window",
    columns: [
      {
        name: "input",
        description: "legacy compatibility input column",
        generation_requirement: `follow ${payload.mode} direction`,
      },
    ],
    sample_count: 10,
  };
};

const legacyModeToDirection = (mode: LegacySynthesizeDatasetInput["mode"]): DatasetSynthesisDirection => {
  switch (mode) {
    case "generalize":
      return "generalize";
    case "augment":
      return "augment_failures";
    case "synthesize":
      return "align_online_distribution";
  }
};
