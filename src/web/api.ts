import type {
  AbExperimentRecord,
  BootstrapResponse,
  CreateComparisonInput,
  CreateDatasetInput,
  CreateEvaluatorInput,
  CreateExperimentInput,
  DatasetRecord,
  EvaluatorRecord,
  ExperimentRunRecord,
  ItemResponse,
  TraceRunRecord,
} from "../shared/contracts.js";

const expectOk = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
};

export const fetchBootstrap = async () => {
  const response = await fetch("/api/bootstrap");
  return expectOk<BootstrapResponse>(response);
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

export const fetchExperiment = async (experimentId: string) => {
  const response = await fetch(`/api/experiments/${experimentId}`);
  return expectOk<ItemResponse<ExperimentRunRecord>>(response);
};

export const fetchTrace = async (traceId: string) => {
  const response = await fetch(`/api/traces/${traceId}`);
  return expectOk<ItemResponse<TraceRunRecord>>(response);
};
