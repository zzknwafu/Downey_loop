import { describe, expect, it } from "vitest";
import { compareExperiments } from "../src/domain/comparison.js";
import { builtInEvaluators, evaluateSearchCase } from "../src/domain/evaluators.js";
import { buildRootCauseSummary } from "../src/domain/root-cause.js";
import { buildSampleExperiments, sampleCases } from "../src/domain/sample-data.js";
import { ExperimentCaseRun, MetricDelta, RetrievalCandidate } from "../src/domain/types.js";

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
    status: "success",
    output: answerOutput,
    scores: [],
    traceId: "trace",
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
  run.scores = run.layerMetrics;
  return run;
};

describe("search evaluator", () => {
  it("assigns stable evaluator lineage keys to built-in evaluators", () => {
    const keys = new Set(builtInEvaluators.map((evaluator) => evaluator.evaluatorKey));

    expect(keys.size).toBe(builtInEvaluators.length);
    expect(builtInEvaluators.every((evaluator) => evaluator.version.length > 0)).toBe(true);
  });

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

  it("requires clarification when evidence is weak", () => {
    const evalCase = sampleCases[0]!;
    const run = buildRun(
      0,
      [evalCase.retrievalCandidates[1]!, evalCase.retrievalCandidates[2]!],
      [evalCase.retrievalCandidates[1]!, evalCase.retrievalCandidates[2]!],
      "推荐麻辣烫。",
    );

    const clarificationDecision = run.layerMetrics.find(
      (metric) => metric.metricName === "clarification_decision",
    );
    expect(clarificationDecision?.metricType).toBe("binary");
    expect(clarificationDecision?.score).toBe(0);
  });

  it("includes PRD-required answer and overall metrics", () => {
    const evalCase = sampleCases[0]!;
    const run = buildRun(
      0,
      [evalCase.retrievalCandidates[0]!, evalCase.retrievalCandidates[1]!],
      [evalCase.retrievalCandidates[0]!, evalCase.retrievalCandidates[1]!],
      "建议选川香小炒双人餐，预算内，适合两个人。",
    );

    expect(run.layerMetrics.some((metric) => metric.metricName === "clarification_decision")).toBe(true);
    expect(run.layerMetrics.some((metric) => metric.metricName === "proxy_dwell_time")).toBe(true);
    expect(run.layerMetrics.some((metric) => metric.metricName === "proxy_trust")).toBe(true);
    expect(run.layerMetrics.some((metric) => metric.metricName === "latency")).toBe(true);
    expect(run.layerMetrics.some((metric) => metric.metricName === "rerank_hit_at_k")).toBe(true);
  });

  it("scores retrieval intent match on constrained healthy-meal search", () => {
    const evalCase = sampleCases.find((item) => item.caseId === "food_004")!;
    const run = buildRun(
      sampleCases.findIndex((item) => item.caseId === "food_004"),
      [evalCase.retrievalCandidates[0]!, evalCase.retrievalCandidates[1]!],
      [evalCase.retrievalCandidates[0]!, evalCase.retrievalCandidates[1]!],
      "推荐香煎鸡胸能量碗，高蛋白且比较清爽。",
    );

    const metric = run.layerMetrics.find((item) => item.metricName === "retrieval_intent_match");
    expect(Number(metric?.score)).toBeGreaterThan(0.8);
  });

  it("fails eta guardrail and aggregated business guardrail on late top result", () => {
    const evalCase = sampleCases.find((item) => item.caseId === "food_002")!;
    const caseIndex = sampleCases.findIndex((item) => item.caseId === "food_002");
    const lateCandidate = evalCase.retrievalCandidates.find((item) => item.id === "sku_f2_d")!;
    const strongCandidate = evalCase.retrievalCandidates.find((item) => item.id === "sku_f2_a")!;

    const run = buildRun(
      caseIndex,
      [strongCandidate, lateCandidate],
      [lateCandidate, strongCandidate],
      "推荐麻辣香锅，味道更重一些。",
    );

    const etaGuardrail = run.layerMetrics.find((item) => item.metricName === "delivery_eta_guardrail");
    const businessGuardrail = run.layerMetrics.find((item) => item.metricName === "business_guardrail_pass");

    expect(etaGuardrail?.score).toBe(0);
    expect(businessGuardrail?.score).toBe(0);
  });

  it("separates trustworthiness from top-item consistency when answer drifts", () => {
    const evalCase = sampleCases.find((item) => item.caseId === "grocery_004")!;
    const caseIndex = sampleCases.findIndex((item) => item.caseId === "grocery_004");

    const run = buildRun(
      caseIndex,
      [evalCase.retrievalCandidates[0]!, evalCase.retrievalCandidates[1]!],
      [evalCase.retrievalCandidates[0]!, evalCase.retrievalCandidates[1]!],
      "可以先看婴儿纸尿裤 XL 52 片，价格也更合适。",
    );

    const trustworthiness = run.layerMetrics.find(
      (item) => item.metricName === "answer_trustworthiness",
    );
    const topConsistency = run.layerMetrics.find(
      (item) => item.metricName === "answer_top_item_consistency",
    );

    expect(topConsistency?.score).toBe(0);
    expect(Number(trustworthiness?.score)).toBeLessThan(1);
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
    expect(Array.isArray(comparison.driverPositive)).toBe(true);
    expect(Array.isArray(comparison.driverNegative)).toBe(true);
    expect(typeof comparison.confidence).toBe("number");
  });

  it("supports drilling from overall metrics to layer deltas", () => {
    const { baseline, candidate } = buildSampleExperiments();
    const comparison = compareExperiments(baseline, candidate);

    expect(comparison.overallDeltas.some((delta) => delta.metricName === "proxy_cvr")).toBe(true);
    expect(comparison.layerDeltas.some((delta) => delta.layer === "retrieval")).toBe(true);
    expect(comparison.layerDeltas.some((delta) => delta.layer === "rerank")).toBe(true);
    expect(comparison.layerDeltas.some((delta) => delta.layer === "answer")).toBe(true);
  });

  it("produces layer insights for retrieval, rerank, answer and overall", () => {
    const { baseline, candidate } = buildSampleExperiments();
    const comparison = compareExperiments(baseline, candidate);

    expect(comparison.layerInsights).toHaveLength(4);
    expect(comparison.layerInsights.some((insight) => insight.layer === "retrieval")).toBe(true);
    expect(comparison.layerInsights.some((insight) => insight.layer === "rerank")).toBe(true);
    expect(comparison.layerInsights.some((insight) => insight.layer === "answer")).toBe(true);
    expect(comparison.layerInsights.some((insight) => insight.layer === "overall")).toBe(true);
  });

  it("attributes regression to stock guardrail before generic retrieval drop", () => {
    const overallDeltas: MetricDelta[] = [
      {
        metricName: "proxy_trust",
        layer: "overall",
        baselineValue: 0.8,
        candidateValue: 0.5,
        delta: -0.3,
      },
    ];
    const layerDeltas: MetricDelta[] = [
      {
        metricName: "stock_guardrail",
        layer: "retrieval",
        baselineValue: 1,
        candidateValue: 0,
        delta: -1,
      },
      {
        metricName: "retrieval_coverage",
        layer: "retrieval",
        baselineValue: 1,
        candidateValue: 0.92,
        delta: -0.08,
      },
    ];

    const result = buildRootCauseSummary(
      overallDeltas,
      layerDeltas,
      {
        retrieval: ["grocery_004"],
        rerank: [],
        answer: [],
      },
      ["grocery_004"],
    );

    expect(result.headline).toContain("stock guardrail");
    expect(result.driverNegative).toContain("stock_guardrail");
  });

  it("attributes regression to budget guardrail before generic rerank hit drop", () => {
    const overallDeltas: MetricDelta[] = [
      {
        metricName: "proxy_cvr",
        layer: "overall",
        baselineValue: 0.72,
        candidateValue: 0.51,
        delta: -0.21,
      },
    ];
    const layerDeltas: MetricDelta[] = [
      {
        metricName: "budget_guardrail",
        layer: "rerank",
        baselineValue: 1,
        candidateValue: 0,
        delta: -1,
      },
      {
        metricName: "rerank_hit_at_k",
        layer: "rerank",
        baselineValue: 1,
        candidateValue: 0.94,
        delta: -0.06,
      },
    ];

    const result = buildRootCauseSummary(
      overallDeltas,
      layerDeltas,
      {
        retrieval: [],
        rerank: ["food_001"],
        answer: [],
      },
      ["food_001"],
    );

    expect(result.headline).toContain("budget guardrail");
    expect(result.driverNegative).toContain("budget_guardrail");
  });

  it("attributes regression to delivery eta guardrail before generic rerank hit drop", () => {
    const overallDeltas: MetricDelta[] = [
      {
        metricName: "business_goal_alignment",
        layer: "overall",
        baselineValue: 0.84,
        candidateValue: 0.57,
        delta: -0.27,
      },
    ];
    const layerDeltas: MetricDelta[] = [
      {
        metricName: "delivery_eta_guardrail",
        layer: "rerank",
        baselineValue: 1,
        candidateValue: 0,
        delta: -1,
      },
      {
        metricName: "rerank_hit_at_k",
        layer: "rerank",
        baselineValue: 1,
        candidateValue: 0.9,
        delta: -0.1,
      },
    ];

    const result = buildRootCauseSummary(
      overallDeltas,
      layerDeltas,
      {
        retrieval: [],
        rerank: ["food_002"],
        answer: [],
      },
      ["food_002"],
    );

    expect(result.headline).toContain("delivery-ETA guardrail");
    expect(result.driverNegative).toContain("delivery_eta_guardrail");
  });
});
