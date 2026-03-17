import { describe, expect, it } from "vitest";
import { baselinePipeline, samplePrompts } from "../src/domain/sample-data.js";
import { formatTargetLabel, isAgentVersion, isPromptVersion, toTargetRef } from "../src/domain/targets.js";

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
});
