import { describe, expect, it } from "vitest";
import { runCodeEvaluator } from "../src/domain/evaluators.js";

describe("code evaluator", () => {
  it("supports exact match", () => {
    const result = runCodeEvaluator("exact_match", "hello", "hello");
    expect(result.metricName).toBe("exact_match");
    expect(result.score).toBe(1);
  });

  it("supports regex match", () => {
    const result = runCodeEvaluator("regex_match", "order_123", "^order_\\d+$", {
      pattern: "^order_\\d+$",
    });
    expect(result.metricName).toBe("regex_match");
    expect(result.score).toBe(1);
  });

  it("supports fuzzy match", () => {
    const result = runCodeEvaluator("fuzzy_match", "儿童低糖酸奶", "儿童低糖酸奶 6 杯装");
    expect(result.metricName).toBe("fuzzy_match");
    expect(Number(result.score)).toBeGreaterThan(0);
  });
});
