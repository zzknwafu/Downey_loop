import { describe, expect, it } from "vitest";
import { createSeedSnapshot } from "../src/shared/mock-data.js";
import { sampleCases, sampleDatasets } from "../src/domain/sample-data.js";

describe("bootstrap contract", () => {
  it("provides the minimal dataset/evaluator/experiment/trace loop", () => {
    const snapshot = createSeedSnapshot();

    expect(snapshot.datasets).toHaveLength(sampleDatasets.length + 2);
    expect(snapshot.evaluators.length).toBeGreaterThan(0);
    expect(snapshot.experiments).toHaveLength(2);
    expect(snapshot.traces).toHaveLength(sampleCases.length * 2);
    expect(snapshot.ab_experiment.baseline_run_id).toBe("exp_baseline");
    expect(snapshot.ab_experiment.candidate_run_id).toBe("exp_candidate");
  });

  it("keeps dataset cases aligned with declared schema families", () => {
    const snapshot = createSeedSnapshot();
    const idealDataset = snapshot.datasets.find((dataset) => dataset.dataset_type === "ideal_output");
    const workflowDataset = snapshot.datasets.find((dataset) => dataset.dataset_type === "workflow");
    const traceDataset = snapshot.datasets.find((dataset) => dataset.dataset_type === "trace_monitor");

    expect(idealDataset?.cases[0]).toMatchObject({
      id: expect.any(String),
      input: expect.any(String),
      reference_output: expect.any(String),
    });
    expect(workflowDataset?.cases[0]).toMatchObject({
      id: expect.any(String),
      input: expect.any(String),
      expected_steps: expect.any(Array),
    });
    expect(traceDataset?.cases[0]).toMatchObject({
      id: expect.any(String),
      trace_id: expect.any(String),
      final_output: expect.any(String),
    });
  });

  it("includes scenario-driven evaluator datasets for retrieval, rerank, answer and overall", () => {
    const datasetIds = sampleDatasets.map((dataset) => dataset.id);

    expect(datasetIds).toContain("dataset_retrieval_intent_001");
    expect(datasetIds).toContain("dataset_rerank_guardrail_001");
    expect(datasetIds).toContain("dataset_answer_trust_001");
    expect(datasetIds).toContain("dataset_business_goal_001");

    const retrievalDataset = sampleDatasets.find(
      (dataset) => dataset.id === "dataset_retrieval_intent_001",
    );
    const guardrailDataset = sampleDatasets.find(
      (dataset) => dataset.id === "dataset_rerank_guardrail_001",
    );

    expect(retrievalDataset?.cases.length).toBeGreaterThanOrEqual(10);
    expect(guardrailDataset?.cases.length).toBeGreaterThanOrEqual(10);
    expect(retrievalDataset?.cases.map((item) => item.caseId)).toEqual(
      expect.arrayContaining(["food_001", "food_004", "grocery_001", "grocery_003"]),
    );
    expect(guardrailDataset?.cases.map((item) => item.caseId)).toEqual(
      expect.arrayContaining(["food_002", "food_003", "grocery_002", "grocery_004"]),
    );
  });

  it("keeps seeded ideal-output datasets at realistic item counts", () => {
    for (const dataset of sampleDatasets) {
      expect(dataset.cases.length).toBeGreaterThanOrEqual(10);
      expect(dataset.cases.length).toBeLessThanOrEqual(20);
    }
  });
});
