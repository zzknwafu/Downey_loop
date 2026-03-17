import { describe, expect, it } from "vitest";
import { baselinePipeline, samplePrompts } from "../src/domain/sample-data.js";
import {
  describeTargetSelection,
  formatTargetLabel,
  isAgentVersion,
  isPromptVersion,
  toTargetRef,
  toTargetSelection,
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

  it("includes migrated Coze Loop evaluator prompts in prompt assets", () => {
    const promptIds = samplePrompts.map((item) => item.id);

    expect(promptIds).toContain("prompt_eval_correctness_coze_v1");
    expect(promptIds).toContain("prompt_eval_hallucination_coze_v1");
    expect(promptIds).toContain("prompt_eval_instruction_following_coze_v1");
    expect(promptIds).toContain("prompt_eval_agent_task_completion_coze_v1");
  });
});
