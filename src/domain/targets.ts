import {
  AgentVersion,
  EvalTarget,
  ExperimentTargetSelection,
  PromptVersion,
  TargetRef,
} from "./types.js";

export const isPromptVersion = (target: EvalTarget): target is PromptVersion =>
  "systemPrompt" in target && "userTemplate" in target;

export const isAgentVersion = (target: EvalTarget): target is AgentVersion =>
  "queryProcessor" in target &&
  "retriever" in target &&
  "reranker" in target &&
  "answerer" in target;

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
