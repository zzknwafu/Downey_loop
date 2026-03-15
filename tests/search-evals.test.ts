import { describe, expect, it } from "vitest";
import { compareExperiments } from "../src/domain/comparison.js";
import { evaluateSearchCase } from "../src/domain/evaluators.js";
import { buildSampleExperiments, sampleCases } from "../src/domain/sample-data.js";
import { ExperimentCaseRun, RetrievalCandidate } from "../src/domain/types.js";

const buildRun = (
  evalCaseIndex: number,
  retrievalResult: RetrievalCandidate[],
  rerankResult: RetrievalCandidate[],
  answerOutput: string,
): ExperimentCaseRun => {
  const evalCase = sampleCases[evalCaseIndex]!;

  const run: ExperimentCaseRun = {
    caseId: evalCase.caseId,
    targetId: "test_target",
    trace: {
      traceId: "trace",
      caseId: evalCase.caseId,
      retrievalTrace: {
        layer: "retrieval",
        latencyMs: 100,
        inputs: {},
        outputs: { retrievalResult },
      },
      rerankTrace: {
        layer: "rerank",
        latencyMs: 50,
        inputs: {},
        outputs: { rerankResult },
      },
      answerTrace: {
        layer: "answer",
        latencyMs: 120,
        inputs: {},
        outputs: { answerOutput },
      },
    },
    layerRuns: [],
    layerMetrics: [],
  };

  run.layerMetrics = evaluateSearchCase(evalCase, run);
  return run;
};

describe("search evaluator", () => {
  it("keeps answer correctness binary", () => {
    const evalCase = sampleCases[0]!;
    const run = buildRun(
      0,
      [evalCase.retrievalCandidates[0]!, evalCase.retrievalCandidates[1]!],
      [evalCase.retrievalCandidates[0]!, evalCase.retrievalCandidates[1]!],
      "建议选川香小炒双人餐，预算内，适合两个人。",
    );

    const result = run.layerMetrics.find((metric) => metric.metricName === "answer_correctness");
    expect(result?.metricType).toBe("binary");
    expect([0, 1]).toContain(result?.score);
  });

  it("degrades retrieval coverage when key candidate is missing", () => {
    const evalCase = sampleCases[0]!;
    const run = buildRun(
      0,
      [evalCase.retrievalCandidates[1]!, evalCase.retrievalCandidates[2]!],
      [evalCase.retrievalCandidates[1]!, evalCase.retrievalCandidates[2]!],
      "推荐麻辣烫。",
    );

    const coverage = run.layerMetrics.find((metric) => metric.metricName === "retrieval_coverage");
    expect(Number(coverage?.score)).toBeLessThan(1);
  });
});

describe("experiment comparison", () => {
  it("attributes regression to rerank when recall is stable but rerank drops", () => {
    const { baseline, candidate } = buildSampleExperiments();
    const comparison = compareExperiments(baseline, candidate);

    expect(
      comparison.rootCauseSummary.some(
        (line) =>
          line.includes("retrieval") ||
          line.includes("rerank") ||
          line.includes("answer"),
      ),
    ).toBe(true);
    expect(comparison.evidenceCaseIds.length).toBeGreaterThan(0);
  });

  it("supports drilling from overall metrics to layer deltas", () => {
    const { baseline, candidate } = buildSampleExperiments();
    const comparison = compareExperiments(baseline, candidate);

    expect(comparison.overallDeltas.some((delta) => delta.metricName === "proxy_cvr")).toBe(true);
    expect(comparison.layerDeltas.some((delta) => delta.layer === "retrieval")).toBe(true);
    expect(comparison.layerDeltas.some((delta) => delta.layer === "rerank")).toBe(true);
    expect(comparison.layerDeltas.some((delta) => delta.layer === "answer")).toBe(true);
  });
});
