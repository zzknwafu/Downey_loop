import { AgentVersion, EvalTarget, PromptVersion, TargetRef } from "./types.js";

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

