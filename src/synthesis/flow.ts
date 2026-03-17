import type {
  DatasetCaseRecord,
  DatasetRecord,
  DatasetSchemaField,
  DatasetSynthesisDirection,
  DatasetSynthesisResult,
  DatasetSynthesisSource,
  SynthesizeDatasetInput,
} from "../shared/contracts.js";

export const MIN_SYNTHESIS_SAMPLE_COUNT = 10;

export const synthesisWizardSteps = [
  {
    key: "scenario_and_source",
    title: "Synthesis Scenario And Source",
    description: "Define the synthesis scenario, source and directional intent.",
  },
  {
    key: "sample_configuration",
    title: "Synthesis Sample Configuration",
    description: "Choose columns, generation requirements and draft sample count.",
  },
] as const;

export type SynthesisWizardStepKey = (typeof synthesisWizardSteps)[number]["key"];

export interface SynthesisDirectionDefinition {
  key: DatasetSynthesisDirection;
  label: string;
  summary: string;
  suitableSources: DatasetSynthesisSource[];
  draftFocus: string;
}

export const synthesisDirectionDefinitions: Record<
  DatasetSynthesisDirection,
  SynthesisDirectionDefinition
> = {
  generalize: {
    key: "generalize",
    label: "Generalize",
    summary: "Expand an existing evaluation set into adjacent but still relevant user intents.",
    suitableSources: ["dataset", "online"],
    draftFocus: "Coverage expansion around known good evaluation structure.",
  },
  augment_failures: {
    key: "augment_failures",
    label: "Augment Failures",
    summary: "Generate more cases around known failure patterns and unstable model behavior.",
    suitableSources: ["dataset", "online"],
    draftFocus: "Failure-focused drafts for regression prevention.",
  },
  augment_guardrails: {
    key: "augment_guardrails",
    label: "Augment Guardrails",
    summary: "Stress business constraints, safety limits and hard-rule preservation.",
    suitableSources: ["dataset", "online"],
    draftFocus: "Constraint-heavy drafts that should be reviewed before merge.",
  },
  align_online_distribution: {
    key: "align_online_distribution",
    label: "Align Online Distribution",
    summary: "Pull the evaluation set closer to online traffic shape without replacing the formal set.",
    suitableSources: ["online", "dataset"],
    draftFocus: "Distribution alignment drafts sourced from recent traffic windows.",
  },
};

export interface SynthesisWizardColumnDraft {
  name: string;
  enabled: boolean;
  description: string;
  generationRequirement: string;
}

export interface SynthesisWizardState {
  targetDatasetId: string;
  source: DatasetSynthesisSource;
  sourceDatasetId?: string;
  direction: DatasetSynthesisDirection;
  scenarioDescription: string;
  useCaseDescription: string;
  sampleCount: number;
  columns: SynthesisWizardColumnDraft[];
}

export interface SynthesisDraftReviewItem {
  itemId: string;
  mergeKey: string;
  decision: "append_candidate" | "duplicate_review";
  reason?: string;
  item: DatasetCaseRecord;
}

export interface SynthesisDraftRecord {
  draftId: string;
  targetDatasetId: string;
  source: DatasetSynthesisSource;
  direction: DatasetSynthesisDirection;
  request: SynthesizeDatasetInput;
  status: "draft";
  createdAt: string;
  review: {
    totalItems: number;
    readyToConfirmCount: number;
    duplicateReviewCount: number;
    items: SynthesisDraftReviewItem[];
  };
  mergeProposal: {
    status: "pending_confirmation";
    targetDatasetId: string;
    operation: "append_cases";
    defaultSelectedItemIds: string[];
    blockedItemIds: string[];
  };
}

export interface ConfirmSynthesisDraftInput {
  targetDatasetId: string;
  draftId: string;
  selectedItemIds: string[];
}

export interface ConfirmSynthesisDraftResult {
  targetDatasetId: string;
  draftId: string;
  status: "ready_for_merge";
  casesToAppend: DatasetCaseRecord[];
  skippedItemIds: string[];
  blockedItemIds: string[];
}

const normalizeText = (value: string) => value.trim();

const normalizeSampleCount = (sampleCount: number) => {
  if (!Number.isFinite(sampleCount)) {
    return MIN_SYNTHESIS_SAMPLE_COUNT;
  }

  return Math.max(MIN_SYNTHESIS_SAMPLE_COUNT, Math.floor(sampleCount));
};

const defaultGenerationRequirement = (field: DatasetSchemaField) =>
  field.required
    ? `Generate ${field.name} with complete coverage for this draft item.`
    : `Generate ${field.name} when it helps the synthesis intent.`;

const caseMergeKey = (item: DatasetCaseRecord) => {
  if ("trace_id" in item) {
    return `trace_monitor:${normalizeText(item.trace_id).toLowerCase()}`;
  }

  if ("workflow_output" in item) {
    return `workflow:${normalizeText(item.input).toLowerCase()}`;
  }

  return `ideal_output:${normalizeText(item.input).toLowerCase()}`;
};

const seedSourceRef = (state: SynthesisWizardState) => {
  if (state.source === "dataset") {
    return `dataset:${state.sourceDatasetId ?? state.targetDatasetId}`;
  }

  return "online:latest-window";
};

const enabledColumns = (columns: SynthesisWizardColumnDraft[]) =>
  columns
    .filter((column) => column.enabled)
    .map((column) => ({
      name: normalizeText(column.name),
      description: normalizeText(column.description),
      generation_requirement: normalizeText(column.generationRequirement),
    }))
    .filter(
      (column) =>
        column.name.length > 0 &&
        column.description.length > 0 &&
        column.generation_requirement.length > 0,
    );

export const createSynthesisWizardState = (
  dataset: Pick<DatasetRecord, "id" | "schema">,
): SynthesisWizardState => ({
  targetDatasetId: dataset.id,
  source: "dataset",
  sourceDatasetId: dataset.id,
  direction: "generalize",
  scenarioDescription: "",
  useCaseDescription: "",
  sampleCount: MIN_SYNTHESIS_SAMPLE_COUNT,
  columns: dataset.schema.map((field) => ({
    name: field.name,
    enabled: true,
    description: field.description,
    generationRequirement: defaultGenerationRequirement(field),
  })),
});

export const buildSynthesisRequest = (state: SynthesisWizardState): SynthesizeDatasetInput => {
  const scenarioDescription = normalizeText(state.scenarioDescription);
  const useCaseDescription = normalizeText(state.useCaseDescription);
  const columns = enabledColumns(state.columns);

  if (scenarioDescription.length === 0) {
    throw new Error("Synthesis scenario description is required");
  }

  if (useCaseDescription.length === 0) {
    throw new Error("Synthesis use case description is required");
  }

  if (state.source === "dataset" && normalizeText(state.sourceDatasetId ?? "").length === 0) {
    throw new Error("Synthesis dataset source requires sourceDatasetId");
  }

  if (columns.length === 0) {
    throw new Error("Synthesis sample configuration requires at least one enabled column");
  }

  return {
    dataset_id: state.targetDatasetId,
    source: state.source,
    direction: state.direction,
    scenario_description: scenarioDescription,
    use_case_description: useCaseDescription,
    seed_source_ref: seedSourceRef(state),
    columns,
    sample_count: normalizeSampleCount(state.sampleCount),
  };
};

export const createSynthesisDraftRecord = (args: {
  targetDataset: Pick<DatasetRecord, "id" | "cases">;
  request: SynthesizeDatasetInput;
  result: DatasetSynthesisResult;
}): SynthesisDraftRecord => {
  const existingKeys = new Set(args.targetDataset.cases.map(caseMergeKey));
  const reviewItems = args.result.items.map((item) => {
    const mergeKey = caseMergeKey(item);
    const duplicate = existingKeys.has(mergeKey);

    return {
      itemId: "id" in item ? item.id : mergeKey,
      mergeKey,
      decision: duplicate ? "duplicate_review" : "append_candidate",
      reason: duplicate ? "Potential duplicate against the current evaluation set." : undefined,
      item,
    } satisfies SynthesisDraftReviewItem;
  });

  const defaultSelectedItemIds = reviewItems
    .filter((item) => item.decision === "append_candidate")
    .map((item) => item.itemId);
  const blockedItemIds = reviewItems
    .filter((item) => item.decision === "duplicate_review")
    .map((item) => item.itemId);

  return {
    draftId: `synthesis_draft:${args.result.dataset_id}:${args.result.created_at}`,
    targetDatasetId: args.targetDataset.id,
    source: args.result.source,
    direction: args.result.direction,
    request: args.request,
    status: "draft",
    createdAt: args.result.created_at,
    review: {
      totalItems: reviewItems.length,
      readyToConfirmCount: defaultSelectedItemIds.length,
      duplicateReviewCount: blockedItemIds.length,
      items: reviewItems,
    },
    mergeProposal: {
      status: "pending_confirmation",
      targetDatasetId: args.targetDataset.id,
      operation: "append_cases",
      defaultSelectedItemIds,
      blockedItemIds,
    },
  };
};

export const buildConfirmSynthesisDraftResult = (
  draft: SynthesisDraftRecord,
  input: ConfirmSynthesisDraftInput,
): ConfirmSynthesisDraftResult => {
  if (draft.draftId !== input.draftId) {
    throw new Error("Draft id mismatch for synthesis confirmation");
  }

  if (draft.targetDatasetId !== input.targetDatasetId) {
    throw new Error("Target dataset mismatch for synthesis confirmation");
  }

  const selectedItemIds = new Set(input.selectedItemIds);
  const casesToAppend = draft.review.items
    .filter((item) => selectedItemIds.has(item.itemId) && item.decision === "append_candidate")
    .map((item) => item.item);
  const skippedItemIds = draft.review.items
    .filter((item) => !selectedItemIds.has(item.itemId))
    .map((item) => item.itemId);
  const blockedItemIds = draft.review.items
    .filter((item) => selectedItemIds.has(item.itemId) && item.decision === "duplicate_review")
    .map((item) => item.itemId);

  return {
    targetDatasetId: draft.targetDatasetId,
    draftId: draft.draftId,
    status: "ready_for_merge",
    casesToAppend,
    skippedItemIds,
    blockedItemIds,
  };
};
