import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatasetDefinition, datasetSchemaTemplates } from "../src/domain/datasets.js";
import { sampleDatasets } from "../src/domain/sample-data.js";
import { FileBackedLocalStore } from "../src/infra/store.js";
import type { AppConfig } from "../src/server/config.js";
import { LocalStore } from "../src/server/storage/local-store.js";

const tempDirs: string[] = [];

const createConfig = async (): Promise<AppConfig> => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "downey-local-store-"));
  tempDirs.push(rootDir);
  const dataDir = path.join(rootDir, "data");

  return {
    appName: "Downey Evals Loop",
    host: "127.0.0.1",
    port: 3100,
    nodeEnv: "test",
    appBaseUrl: "http://127.0.0.1:3100",
    dataDir,
    sqlitePath: path.join(dataDir, "downey-evals-loop.sqlite"),
    stateFilePath: path.join(dataDir, "app-state.json"),
    storeFilePath: path.join(dataDir, "downey-evals-store.json"),
  };
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("local store", () => {
  it("seeds the snapshot and persists created datasets and evaluators", async () => {
    const store = new LocalStore(await createConfig());
    const initialState = await store.getState();

    expect(initialState.datasets).toHaveLength(sampleDatasets.length + 2);
    expect(initialState.evaluators.length).toBeGreaterThan(0);

    const dataset = await store.createDataset({
      name: "Custom Dataset",
      description: "custom dataset for infra test",
      dataset_type: "ideal_output",
      schema: [
        {
          name: "input",
          data_type: "String",
          required: true,
          description: "input",
        },
      ],
    });

    const evaluator = await store.createEvaluator({
      name: "custom_metric",
      family: "code",
      layer: "answer",
      metric_type: "binary",
      code_strategy: "exact_match",
      description: "custom evaluator",
      config: {
        pattern: "ok",
      },
    });

    const persisted = await store.getState();

    expect(persisted.datasets[0]?.id).toBe(dataset.id);
    expect(persisted.evaluators[0]?.id).toBe(evaluator.id);
  });

  it("updates dataset metadata and schema while preserving cases", async () => {
    const fileStore = new FileBackedLocalStore(path.join((await createConfig()).dataDir, "store.json"));
    await fileStore.upsertDataset(sampleDatasets[0]!);

    const updated = await fileStore.updateDataset(sampleDatasets[0]!.id, {
      name: "Updated Dataset Name",
      description: "updated description",
      datasetType: sampleDatasets[0]!.datasetType,
      sampleCount: 12,
      schema: sampleDatasets[0]!.schema,
      timestamp: "2026-03-17T00:00:00.000Z",
    });

    const persisted = await fileStore.getDataset(sampleDatasets[0]!.id);

    expect(updated?.name).toBe("Updated Dataset Name");
    expect(updated?.cases).toHaveLength(sampleDatasets[0]!.cases.length);
    expect(persisted?.description).toBe("updated description");
    expect(Date.parse(persisted?.updatedAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse("2026-03-17T00:00:00.000Z"),
    );
  });

  it("lists, fetches and mutates editable dataset cases in file store", async () => {
    const fileStore = new FileBackedLocalStore(path.join((await createConfig()).dataDir, "store.json"));
    const editableDataset = createDatasetDefinition({
      id: "dataset_editable_store_test",
      name: "Editable Store Dataset",
      description: "editable dataset for file store",
      datasetType: "ideal_output",
      schema: datasetSchemaTemplates.ideal_output,
      sampleCount: 12,
      timestamp: "2026-03-18T00:00:00.000Z",
    });
    editableDataset.cases = [
      {
        caseId: "case_001",
        input: "初始输入",
        referenceOutput: "初始参考答案",
        context: { source: "store-test" },
      },
    ];

    await fileStore.upsertDataset(editableDataset);

    const listedCases = await fileStore.listDatasetCases(editableDataset.id);
    const firstCase = listedCases?.[0];
    const fetchedCase = await fileStore.getDatasetCase(editableDataset.id, firstCase!.caseId);
    const created = await fileStore.createDatasetCase(
      editableDataset.id,
      {
        caseId: "case_002",
        input: "新增输入",
        referenceOutput: "新增参考答案",
        context: { source: "store-test-created" },
      },
      "2026-03-17T01:00:00.000Z",
    );
    const updated = await fileStore.updateDatasetCase(
      editableDataset.id,
      {
        caseId: firstCase!.caseId,
        input: `${"input" in firstCase! ? firstCase.input : ""} updated`,
        referenceOutput: "更新后的参考答案",
        context: { source: "store-test-updated" },
      },
      "2026-03-17T02:00:00.000Z",
    );
    const replaced = await fileStore.replaceDatasetCases(
      editableDataset.id,
      [
        {
          caseId: "case_003",
          input: "替换输入",
          referenceOutput: "替换参考答案",
          context: { source: "store-test-replaced" },
        },
      ],
      "2026-03-17T03:00:00.000Z",
    );
    const deleted = await fileStore.deleteDatasetCase(
      editableDataset.id,
      "case_003",
      "2026-03-17T04:00:00.000Z",
    );

    expect(listedCases?.length).toBe(1);
    expect(fetchedCase?.caseId).toBe(firstCase?.caseId);
    expect(created?.cases).toHaveLength(2);
    expect(updated?.cases[0] && "input" in updated.cases[0] ? updated.cases[0].input : "").toContain("updated");
    expect(replaced?.cases[0] && "input" in replaced.cases[0] ? replaced.cases[0].input : "").toBe("替换输入");
    expect(deleted?.cases).toHaveLength(0);
  });

  it("returns synthesis drafts without writing them into formal dataset cases", async () => {
    const fileStore = new FileBackedLocalStore(path.join((await createConfig()).dataDir, "store.json"));
    const dataset = sampleDatasets[0]!;
    await fileStore.upsertDataset(dataset);

    const result = await fileStore.synthesizeDatasetCases(dataset.id, {
      source: "dataset",
      direction: "augment_guardrails",
      scenario_description: "外卖搜索预算和库存护栏补样",
      use_case_description: "增强护栏相关失败样本",
      seed_source_ref: `dataset:${dataset.id}`,
      columns: [
        {
          name: "input",
          description: "用户 query",
          generation_requirement: "更偏预算和库存冲突",
        },
      ],
      sample_count: 10,
    });
    const persisted = await fileStore.getDataset(dataset.id);

    expect(result?.dataset_id).toBe(dataset.id);
    expect(result?.direction).toBe("augment_guardrails");
    expect(result?.status).toBe("draft");
    expect(result?.items).toHaveLength(10);
    expect(persisted?.cases).toHaveLength(dataset.cases.length);
  });
});
