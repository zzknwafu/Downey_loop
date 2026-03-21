import { describe, expect, it } from "vitest";
import { baselinePipeline, samplePrompts } from "../src/domain/sample-data.js";
import {
  createAgentVersion,
  createPromptVersion,
  describeTargetSelection,
  formatTargetLabel,
  isAgentVersion,
  isPromptVersion,
  listCompatibleDatasetTypes,
  toTargetRef,
  toTargetSelection,
  validateTargetDatasetCompatibility,
} from "../src/domain/targets.js";

describe("target domain helpers", () => {
  it("builds prompt refs with stable target type", () => {
    const prompt = samplePrompts[0]!;
    const targetRef = toTargetRef(prompt);

    expect(isPromptVersion(prompt)).toBe(true);
    expect(targetRef.type).toBe("prompt");
    expect(targetRef.id).toBe(prompt.id);
  });

  it("builds agent refs with stable target type", () => {
    const targetRef = toTargetRef(baselinePipeline);

    expect(isAgentVersion(baselinePipeline)).toBe(true);
    expect(targetRef.type).toBe("agent");
    expect(targetRef.version).toBe(baselinePipeline.version);
  });

  it("formats target labels for prompt and agent lists", () => {
    expect(formatTargetLabel(samplePrompts[0]!)).toContain("v");
    expect(formatTargetLabel(baselinePipeline)).toContain("v");
  });

  it("builds experiment target selections for prompt and agent flows", () => {
    const promptSelection = toTargetSelection(samplePrompts[0]!);
    const agentSelection = toTargetSelection(baselinePipeline);

    expect(promptSelection.type).toBe("prompt");
    expect(agentSelection.type).toBe("agent");
    expect(describeTargetSelection(promptSelection)).toContain("Prompt");
    expect(describeTargetSelection(agentSelection)).toContain("Agent");
  });

  it("creates normalized prompt and agent versions for target management", () => {
    const prompt = createPromptVersion({
      id: "prompt_custom_test",
      name: "  食搜 Prompt  ",
      description: "  简洁回答  ",
      systemPrompt: "  你是食搜助手  ",
      userTemplate: "  输入：{{input}}  ",
    });
    const agent = createAgentVersion({
      id: "agent_custom_test",
      name: "  食搜 Agent  ",
      description: "  baseline  ",
      queryProcessor: " qp-v1 ",
      retriever: " retriever-v1 ",
      reranker: " reranker-v1 ",
      answerer: " answerer-v1 ",
    });

    expect(prompt.name).toBe("食搜 Prompt");
    expect(prompt.systemPrompt).toBe("你是食搜助手");
    expect(prompt.userTemplate).toBe("输入：{{input}}");
    expect(agent.name).toBe("食搜 Agent");
    expect(agent.retriever).toBe("retriever-v1");
  });

  it("locks target and dataset compatibility for experiment setup", () => {
    expect(listCompatibleDatasetTypes("prompt")).toEqual(["ideal_output"]);
    expect(listCompatibleDatasetTypes("agent")).toEqual([
      "ideal_output",
      "workflow",
      "trace_monitor",
    ]);

    expect(() => validateTargetDatasetCompatibility(samplePrompts[0]!, "ideal_output")).not.toThrow();
    expect(() => validateTargetDatasetCompatibility(samplePrompts[0]!, "workflow")).toThrow(
      /not compatible/,
    );
    expect(() => validateTargetDatasetCompatibility(baselinePipeline, "trace_monitor")).not.toThrow();
  });

  it("includes migrated Coze Loop evaluator prompts in prompt assets", () => {
    const promptIds = samplePrompts.map((item) => item.id);

    expect(promptIds).toContain("prompt_eval_correctness_coze_v1");
    expect(promptIds).toContain("prompt_eval_hallucination_coze_v1");
    expect(promptIds).toContain("prompt_eval_instruction_following_coze_v1");
    expect(promptIds).toContain("prompt_eval_agent_task_completion_coze_v1");
  });
});
