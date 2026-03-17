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
});
