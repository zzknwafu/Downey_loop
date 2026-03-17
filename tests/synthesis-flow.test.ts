import { describe, expect, it } from "vitest";
import type { DatasetRecord, DatasetSynthesisResult } from "../src/shared/contracts.js";
import {
  buildConfirmSynthesisDraftResult,
  buildSynthesisRequest,
  createSynthesisDraftRecord,
  createSynthesisWizardState,
  MIN_SYNTHESIS_SAMPLE_COUNT,
  synthesisDirectionDefinitions,
  synthesisWizardSteps,
} from "../src/synthesis/flow.js";

const createIdealOutputDataset = (): DatasetRecord => ({
  id: "dataset_eval_food",
  name: "Food Search Evaluation Set",
  description: "Formal evaluation set",
  dataset_type: "ideal_output",
  schema: [
    {
      name: "input",
      data_type: "String",
      required: true,
      description: "User input",
    },
    {
      name: "reference_output",
      data_type: "String",
      required: true,
      description: "Reference output",
    },
    {
      name: "context",
      data_type: "JSON",
      required: false,
      description: "Context payload",
    },
  ],
  cases: [
    {
      id: "case_existing",
      input: "cheap milk tea near office",
      reference_output: "existing answer",
      context: { budget: 20 },
    },
  ],
  version: "0.1.0",
  created_at: "2026-03-18T00:00:00.000Z",
  updated_at: "2026-03-18T00:00:00.000Z",
});

const createSynthesisResult = (): DatasetSynthesisResult => ({
  dataset_id: "dataset_eval_food",
  source: "dataset",
  direction: "augment_failures",
  status: "draft",
  created_at: "2026-03-18T01:00:00.000Z",
  items: [
    {
      id: "draft_case_duplicate",
      input: "cheap milk tea near office",
      reference_output: "duplicate answer",
      context: { failure_mode: "budget_conflict" },
    },
    {
      id: "draft_case_new",
      input: "late night dessert under 30",
      reference_output: "new answer",
      context: { failure_mode: "stock_conflict" },
    },
  ],
});

describe("synthesis flow sidecar", () => {
  it("defines the two-step wizard and four synthesis directions", () => {
    expect(synthesisWizardSteps.map((step) => step.key)).toEqual([
      "scenario_and_source",
      "sample_configuration",
    ]);

    expect(Object.keys(synthesisDirectionDefinitions)).toEqual([
      "generalize",
      "augment_failures",
      "augment_guardrails",
      "align_online_distribution",
    ]);
  });

  it("normalizes a two-step wizard state into a synthesis request", () => {
    const dataset = createIdealOutputDataset();
    const state = createSynthesisWizardState(dataset);
    state.direction = "augment_guardrails";
    state.scenarioDescription = "  budget and inventory stress cases  ";
    state.useCaseDescription = "  expand guardrail coverage for food search  ";
    state.sampleCount = 3;
    state.columns[2]!.enabled = false;

    const request = buildSynthesisRequest(state);

    expect(request.dataset_id).toBe(dataset.id);
    expect(request.direction).toBe("augment_guardrails");
    expect(request.seed_source_ref).toBe(`dataset:${dataset.id}`);
    expect(request.sample_count).toBe(MIN_SYNTHESIS_SAMPLE_COUNT);
    expect(request.columns.map((column) => column.name)).toEqual(["input", "reference_output"]);
  });

  it("keeps synthesis output in draft and prepares a separate confirmation payload", () => {
    const dataset = createIdealOutputDataset();
    const request = buildSynthesisRequest({
      ...createSynthesisWizardState(dataset),
      direction: "augment_failures",
      scenarioDescription: "failure-oriented cases for retrieval miss and answer mismatch",
      useCaseDescription: "augment known bad patterns before they enter the formal set",
    });
    const result = createSynthesisResult();

    const draft = createSynthesisDraftRecord({
      targetDataset: dataset,
      request,
      result,
    });

    expect(draft.status).toBe("draft");
    expect(draft.review.readyToConfirmCount).toBe(1);
    expect(draft.review.duplicateReviewCount).toBe(1);
    expect(draft.mergeProposal.status).toBe("pending_confirmation");

    const confirmation = buildConfirmSynthesisDraftResult(draft, {
      targetDatasetId: dataset.id,
      draftId: draft.draftId,
      selectedItemIds: ["draft_case_duplicate", "draft_case_new"],
    });

    expect(confirmation.status).toBe("ready_for_merge");
    expect(confirmation.casesToAppend).toHaveLength(1);
    expect(confirmation.blockedItemIds).toEqual(["draft_case_duplicate"]);
    expect(confirmation.skippedItemIds).toEqual([]);
  });
});
