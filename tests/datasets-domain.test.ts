import { describe, expect, it } from "vitest";
import {
  createDatasetCaseDefinition,
  createDatasetDefinition,
  deleteDatasetCaseDefinition,
  datasetRequiredFields,
  datasetSchemaTemplates,
  MIN_DATASET_SAMPLE_COUNT,
  replaceDatasetCasesDefinition,
  updateDatasetDefinition,
  updateDatasetCaseDefinition,
  validateEditableCaseSchemaCompatibility,
  validateDatasetSampleCount,
  validateDatasetSchema,
} from "../src/domain/datasets.js";
import { EditableDatasetCase } from "../src/domain/types.js";

describe("dataset domain helpers", () => {
  it("exposes schema templates for three dataset types", () => {
    expect(Object.keys(datasetSchemaTemplates)).toEqual([
      "ideal_output",
      "workflow",
      "trace_monitor",
    ]);
  });

  it("validates required fields by dataset type", () => {
    expect(() =>
      validateDatasetSchema("workflow", [
        {
          name: "input",
          dataType: "String",
          required: true,
          description: "input",
        },
      ]),
    ).toThrow(/workflow_output/);

    expect(datasetRequiredFields.trace_monitor).toContain("trace_id");
  });

  it("rejects duplicate schema fields", () => {
    expect(() =>
      validateDatasetSchema("ideal_output", [
        {
          name: "input",
          dataType: "String",
          required: true,
          description: "input",
        },
        {
          name: "input",
          dataType: "String",
          required: false,
          description: "dup",
        },
        {
          name: "reference_output",
          dataType: "String",
          required: false,
          description: "reference",
        },
        {
          name: "context",
          dataType: "JSON",
          required: false,
          description: "context",
        },
      ]),
    ).toThrow(/Duplicate schema field/);
  });

  it("enforces minimum dataset sample count", () => {
    expect(() => validateDatasetSampleCount(MIN_DATASET_SAMPLE_COUNT - 1)).toThrow(
      /at least 10/,
    );
    expect(() => validateDatasetSampleCount(MIN_DATASET_SAMPLE_COUNT)).not.toThrow();
  });

  it("creates a normalized dataset definition for local creation flow", () => {
    const dataset = createDatasetDefinition({
      id: "dataset_custom_test",
      name: "  Custom Dataset  ",
      description: "  local flow  ",
      datasetType: "ideal_output",
      schema: datasetSchemaTemplates.ideal_output,
      sampleCount: 12,
      timestamp: "2026-03-17T00:00:00.000Z",
    });

    expect(dataset.name).toBe("Custom Dataset");
    expect(dataset.description).toBe("local flow");
    expect(dataset.cases).toHaveLength(0);
    expect(dataset.schema).toHaveLength(3);
  });

  it("updates dataset definition within the same type while preserving identity and cases", () => {
    const current = createDatasetDefinition({
      id: "dataset_custom_test",
      name: "Custom Dataset",
      description: "local flow",
      datasetType: "ideal_output",
      schema: datasetSchemaTemplates.ideal_output,
      sampleCount: 12,
      timestamp: "2026-03-17T00:00:00.000Z",
    });
    current.cases = [
      {
        caseId: "case_001",
        domain: "food_delivery",
        taskType: "ai_search",
        userQuery: "来点清淡晚饭",
        retrievalCandidates: [],
        expectedRetrievalIds: [],
        acceptableRetrievalIds: [],
        expectedTopItems: [],
        answerReference: "推荐清淡套餐。",
      },
    ];

    const updated = updateDatasetDefinition({
      current,
      name: "  Updated Dataset  ",
      description: "  updated description  ",
      datasetType: "ideal_output",
      schema: datasetSchemaTemplates.ideal_output,
      sampleCount: 16,
      timestamp: "2026-03-17T01:00:00.000Z",
    });

    expect(updated.id).toBe(current.id);
    expect(updated.createdAt).toBe(current.createdAt);
    expect(updated.updatedAt).toBe("2026-03-17T01:00:00.000Z");
    expect(updated.name).toBe("Updated Dataset");
    expect(updated.description).toBe("updated description");
    expect(updated.datasetType).toBe("ideal_output");
    expect(updated.cases).toEqual(current.cases);
  });

  it("rejects dataset type change when cases already exist", () => {
    const current = createDatasetDefinition({
      id: "dataset_type_change_test",
      name: "Type Change Dataset",
      description: "type change flow",
      datasetType: "ideal_output",
      schema: datasetSchemaTemplates.ideal_output,
      sampleCount: 12,
      timestamp: "2026-03-18T00:00:00.000Z",
    });
    current.cases = [
      {
        caseId: "case_001",
        domain: "food_delivery",
        taskType: "ai_search",
        userQuery: "来点清淡晚饭",
        retrievalCandidates: [],
        expectedRetrievalIds: [],
        acceptableRetrievalIds: [],
        expectedTopItems: [],
        answerReference: "推荐清淡套餐。",
      },
    ];

    expect(() =>
      updateDatasetDefinition({
        current,
        name: "Workflow Dataset",
        description: "updated workflow schema",
        datasetType: "workflow",
        schema: datasetSchemaTemplates.workflow,
        sampleCount: 12,
        timestamp: "2026-03-18T01:00:00.000Z",
      }),
    ).toThrow(/Cannot change datasetType/);
  });

  it("supports editable dataset case create update and delete flows", () => {
    const current = createDatasetDefinition({
      id: "dataset_editable_test",
      name: "Editable Dataset",
      description: "editable flow",
      datasetType: "ideal_output",
      schema: datasetSchemaTemplates.ideal_output,
      sampleCount: 12,
      timestamp: "2026-03-17T00:00:00.000Z",
    }) as DatasetWithEditableCases;

    const created = createDatasetCaseDefinition({
      current,
      item: {
        caseId: "case_001",
        input: "用户输入",
        referenceOutput: "参考答案",
        context: { channel: "food_delivery" },
      },
      timestamp: "2026-03-17T01:00:00.000Z",
    });

    expect(created.cases).toHaveLength(1);

    const updated = updateDatasetCaseDefinition({
      current: created,
      item: {
        caseId: "case_001",
        input: "更新后的用户输入",
        referenceOutput: "更新后的参考答案",
        context: { channel: "grocery" },
      },
      timestamp: "2026-03-17T02:00:00.000Z",
    });

    expect(updated.cases[0]).toEqual({
      caseId: "case_001",
      input: "更新后的用户输入",
      referenceOutput: "更新后的参考答案",
      context: { channel: "grocery" },
    });

    const deleted = deleteDatasetCaseDefinition({
      current: updated,
      caseId: "case_001",
      timestamp: "2026-03-17T03:00:00.000Z",
    });

    expect(deleted.cases).toHaveLength(0);
  });

  it("replaces editable dataset case collections with duplicate checks", () => {
    const current = createDatasetDefinition({
      id: "dataset_replace_test",
      name: "Replace Dataset",
      description: "replace flow",
      datasetType: "workflow",
      schema: datasetSchemaTemplates.workflow,
      sampleCount: 15,
      timestamp: "2026-03-17T00:00:00.000Z",
    }) as DatasetWithEditableCases;

    const replaced = replaceDatasetCasesDefinition({
      current,
      cases: [
        {
          caseId: "case_001",
          input: "执行工作流",
          workflowOutput: { status: "ok" },
          expectedSteps: ["retrieve", "answer"],
        },
      ],
      timestamp: "2026-03-17T01:00:00.000Z",
    });

    expect(replaced.cases).toHaveLength(1);

    expect(() =>
      replaceDatasetCasesDefinition({
        current,
        cases: [
          {
            caseId: "dup_case",
            input: "a",
            workflowOutput: { status: "ok" },
            expectedSteps: ["retrieve"],
          },
          {
            caseId: "dup_case",
            input: "b",
            workflowOutput: { status: "ok" },
            expectedSteps: ["answer"],
          },
        ],
        timestamp: "2026-03-17T02:00:00.000Z",
      }),
    ).toThrow(/Duplicate dataset caseId/);
  });

  it("rejects editable dataset case fields that are not declared in schema", () => {
    const schemaWithoutContext = [
      {
        name: "input",
        dataType: "String" as const,
        required: true,
        description: "workflow input",
      },
      {
        name: "workflow_output",
        dataType: "JSON" as const,
        required: true,
        description: "workflow result",
      },
      {
        name: "expected_steps",
        dataType: "JSON" as const,
        required: false,
        description: "expected steps",
      },
    ];

    expect(() =>
      validateEditableCaseSchemaCompatibility("workflow", schemaWithoutContext, {
        caseId: "case_001",
        input: "执行工作流",
        workflowOutput: { status: "ok" },
        expectedSteps: ["retrieve", "answer"],
        context: { source: "ui" },
      }),
    ).toThrow(/context schema field/);
  });

  it("rejects required schema fields that editable case api cannot represent", () => {
    const schemaWithUnsupportedRequiredField = [
      ...datasetSchemaTemplates.ideal_output,
      {
        name: "custom_required",
        dataType: "String" as const,
        required: true,
        description: "custom field",
      },
    ];

    expect(() =>
      validateEditableCaseSchemaCompatibility("ideal_output", schemaWithUnsupportedRequiredField, {
        caseId: "case_001",
        input: "用户输入",
        referenceOutput: "参考答案",
        context: {},
      }),
    ).toThrow(/do not support required schema fields/);
  });
});

type DatasetWithEditableCases = ReturnType<typeof createDatasetDefinition> & {
  cases: EditableDatasetCase[];
};
