import {
  AgentVersion,
  DatasetType,
  EvalTarget,
  ExperimentTargetSelection,
  PromptVersion,
  SearchPipelineVersion,
  TargetRef,
  TargetType,
} from "./types.js";

const DEFAULT_TARGET_VERSION = "0.1.0";

const ensureNonEmpty = (value: string, fieldName: string) => {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
};

export interface CreatePromptVersionInput {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  userTemplate: string;
}

export interface CreateAgentVersionInput {
  id: string;
  name: string;
  description?: string;
  queryProcessor: string;
  retriever: string;
  reranker: string;
  answerer: string;
}

export const targetDatasetCompatibility: Record<TargetType, DatasetType[]> = {
  prompt: ["ideal_output"],
  agent: ["ideal_output", "workflow", "trace_monitor"],
};

export const isPromptVersion = (target: EvalTarget): target is PromptVersion =>
  "systemPrompt" in target && "userTemplate" in target;

export const isAgentVersion = (target: EvalTarget): target is AgentVersion =>
  "queryProcessor" in target &&
  "retriever" in target &&
  "reranker" in target &&
  "answerer" in target;

const isTargetSelection = (
  target: EvalTarget | ExperimentTargetSelection | TargetType,
): target is ExperimentTargetSelection =>
  typeof target !== "string" && "type" in target && "label" in target;

export const toTargetRef = (target: EvalTarget): TargetRef => ({
  id: target.id,
  type: isPromptVersion(target) ? "prompt" : "agent",
  version: target.version,
});

export const formatTargetLabel = (target: EvalTarget): string =>
  `${target.name} v${target.version}`;

export const toTargetSelection = (target: EvalTarget): ExperimentTargetSelection => ({
  ...toTargetRef(target),
  label: formatTargetLabel(target),
});

export const describeTargetSelection = (selection: ExperimentTargetSelection): string =>
  selection.type === "prompt"
    ? `Prompt ${selection.label}`
    : `Agent ${selection.label}`;

export const createPromptVersion = (input: CreatePromptVersionInput): PromptVersion => {
  ensureNonEmpty(input.name, "Prompt name");
  ensureNonEmpty(input.systemPrompt, "Prompt systemPrompt");
  ensureNonEmpty(input.userTemplate, "Prompt userTemplate");

  return {
    id: input.id,
    name: input.name.trim(),
    version: DEFAULT_TARGET_VERSION,
    description: input.description?.trim(),
    systemPrompt: input.systemPrompt.trim(),
    userTemplate: input.userTemplate.trim(),
    inputSchema: {
      input: "string",
    },
  };
};

export const createAgentVersion = (input: CreateAgentVersionInput): AgentVersion => {
  ensureNonEmpty(input.name, "Agent name");
  ensureNonEmpty(input.queryProcessor, "Agent queryProcessor");
  ensureNonEmpty(input.retriever, "Agent retriever");
  ensureNonEmpty(input.reranker, "Agent reranker");
  ensureNonEmpty(input.answerer, "Agent answerer");

  return {
    id: input.id,
    name: input.name.trim(),
    version: DEFAULT_TARGET_VERSION,
    description: input.description?.trim(),
    queryProcessor: input.queryProcessor.trim(),
    retriever: input.retriever.trim(),
    reranker: input.reranker.trim(),
    answerer: input.answerer.trim(),
  };
};

export const toExecutionTarget = (target: EvalTarget): SearchPipelineVersion => {
  if (isAgentVersion(target)) {
    return target;
  }

  return {
    id: `${target.id}__prompt_execution`,
    name: `${target.name} Prompt Execution`,
    version: target.version,
    description: target.description,
    queryProcessor: target.systemPrompt,
    retriever: "prompt_retrieval_passthrough",
    reranker: "prompt_rerank_passthrough",
    answerer: target.userTemplate,
  };
};

export const listCompatibleDatasetTypes = (
  target: EvalTarget | ExperimentTargetSelection | TargetType,
): DatasetType[] => {
  if (typeof target === "string") {
    return [...targetDatasetCompatibility[target]];
  }

  const targetType =
    isTargetSelection(target) ? target.type : isPromptVersion(target) ? "prompt" : "agent";
  return [...targetDatasetCompatibility[targetType]];
};

export const isTargetDatasetCompatible = (
  target: EvalTarget | ExperimentTargetSelection | TargetType,
  datasetType: DatasetType,
): boolean => listCompatibleDatasetTypes(target).includes(datasetType);

export const validateTargetDatasetCompatibility = (
  target: EvalTarget | ExperimentTargetSelection | TargetType,
  datasetType: DatasetType,
): void => {
  if (isTargetDatasetCompatible(target, datasetType)) {
    return;
  }

  const targetType =
    typeof target === "string"
      ? target
      : isTargetSelection(target)
        ? target.type
        : isPromptVersion(target)
          ? "prompt"
          : "agent";

  throw new Error(
    `Target type ${targetType} is not compatible with dataset type ${datasetType}`,
  );
};
