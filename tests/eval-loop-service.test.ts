import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { candidatePipeline, sampleDatasets } from "../src/domain/sample-data.js";
import { FileBackedLocalStore } from "../src/infra/store.js";
import {
  createReferencePipelineExecutor,
  EvalLoopService,
} from "../src/services/eval-loop-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("eval loop service", () => {
  it("seeds default datasets, evaluators, experiments and comparisons", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-seed-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());

    const snapshot = await service.seedDefaults();

    expect(snapshot.datasets.length).toBeGreaterThan(0);
    expect(snapshot.evaluators.length).toBeGreaterThan(0);
    expect(snapshot.prompts.length).toBeGreaterThan(0);
    expect(snapshot.agents.length).toBeGreaterThan(0);
    expect(snapshot.experiments.length).toBeGreaterThan(0);
    expect(snapshot.comparisons.length).toBeGreaterThan(0);
  });

  it("runs and persists a new experiment using seeded defaults", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-run-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());
    await service.seedDefaults();

    const experiment = await service.runExperiment({
      datasetId: sampleDatasets[0]!.id,
      target: candidatePipeline,
    });

    const experiments = await service.listExperiments();
    expect(experiment.status).toBe("FINISHED");
    expect(experiment.summary.totalCases).toBe(sampleDatasets[0]!.cases.length);
    expect(experiments.some((item) => item.experimentId === experiment.experimentId)).toBe(true);
  });

  it("persists comparison results for two experiment runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-compare-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());
    const seeded = await service.seedDefaults();

    const comparison = await service.compareExperimentRuns(
      seeded.experiments[0]!.experimentId,
      seeded.experiments[1]!.experimentId,
    );

    const comparisons = await service.listComparisons();
    expect(comparison.rootCauseSummary.length).toBeGreaterThan(0);
    expect(comparisons.length).toBeGreaterThan(0);
    expect(
      comparisons.some(
        (item) =>
          item.baselineExperimentId === seeded.experiments[0]!.experimentId &&
          item.candidateExperimentId === seeded.experiments[1]!.experimentId,
      ),
    ).toBe(true);
  });

  it("creates dataset and evaluator records and exposes traces from runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-create-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());
    await service.seedDefaults();

    const dataset = await service.createDataset({
      name: "Custom Dataset",
      description: "for API create flow",
      datasetType: "ideal_output",
      sampleCount: 12,
      schema: [
        {
          name: "input",
          dataType: "String",
          required: true,
          description: "input",
        },
        {
          name: "reference_output",
          dataType: "String",
          required: false,
          description: "reference output",
        },
        {
          name: "context",
          dataType: "JSON",
          required: false,
          description: "context",
        },
      ],
    });

    const evaluator = await service.createEvaluator({
      name: "custom_evaluator",
      layer: "answer",
      family: "code",
      metricType: "binary",
      description: "for API create flow",
      config: { pattern: "ok" },
      codeStrategy: "exact_match",
    });

    await service.runExperiment({
      datasetId: sampleDatasets[0]!.id,
      target: candidatePipeline,
    });

    const traces = await service.listTraces();

    expect(dataset.id).toContain("dataset_custom_");
    expect(evaluator.id).toContain("evaluator_custom_");
    expect(traces.length).toBeGreaterThan(0);
    expect(await service.getTrace(traces[0]!.traceId)).toBeDefined();
    expect(await service.getLatestComparison()).toBeDefined();
  });

  it("updates dataset metadata and schema while preserving stored identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-update-dataset-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());

    const dataset = await service.createDataset({
      name: "Custom Dataset",
      description: "for update flow",
      datasetType: "ideal_output",
      sampleCount: 12,
      schema: [
        {
          name: "input",
          dataType: "String",
          required: true,
          description: "input",
        },
        {
          name: "reference_output",
          dataType: "String",
          required: false,
          description: "reference output",
        },
        {
          name: "context",
          dataType: "JSON",
          required: false,
          description: "context",
        },
      ],
    });

    const updated = await service.updateDataset(dataset.id, {
      name: "Workflow Dataset",
      description: "updated workflow schema",
      datasetType: "workflow",
      sampleCount: 14,
      schema: [
        {
          name: "input",
          dataType: "String",
          required: true,
          description: "workflow input",
        },
        {
          name: "workflow_output",
          dataType: "JSON",
          required: true,
          description: "workflow result",
        },
        {
          name: "expected_steps",
          dataType: "JSON",
          required: false,
          description: "expected steps",
        },
      ],
    });

    const stored = await service.getDataset(dataset.id);

    expect(updated.id).toBe(dataset.id);
    expect(updated.createdAt).toBe(dataset.createdAt);
    expect(updated.updatedAt).not.toBe(dataset.updatedAt);
    expect(updated.datasetType).toBe("workflow");
    expect(stored?.name).toBe("Workflow Dataset");
    expect(stored?.schema).toHaveLength(3);
  });

  it("rejects dataset create requests when sample count is below minimum", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-dataset-min-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());

    await expect(
      service.createDataset({
        name: "Too Small Dataset",
        description: "invalid sample count",
        datasetType: "ideal_output",
        sampleCount: 9,
        schema: [
          {
            name: "input",
            dataType: "String",
            required: true,
            description: "input",
          },
          {
            name: "reference_output",
            dataType: "String",
            required: false,
            description: "reference output",
          },
          {
            name: "context",
            dataType: "JSON",
            required: false,
            description: "context",
          },
        ],
      }),
    ).rejects.toThrow(/at least 10/);
  });

  it("supports dataset case create update and delete through the service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-dataset-cases-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());

    const dataset = await service.createDataset({
      name: "Editable Dataset",
      description: "case editing flow",
      datasetType: "ideal_output",
      sampleCount: 12,
      schema: [
        {
          name: "input",
          dataType: "String",
          required: true,
          description: "input",
        },
        {
          name: "reference_output",
          dataType: "String",
          required: false,
          description: "reference output",
        },
        {
          name: "context",
          dataType: "JSON",
          required: false,
          description: "context",
        },
      ],
    });

    const created = await service.createDatasetCase(dataset.id, {
      caseId: "case_001",
      input: "用户输入",
      referenceOutput: "参考答案",
      context: { channel: "food_delivery" },
    });
    expect(created.cases).toHaveLength(1);

    const updated = await service.updateDatasetCase(dataset.id, {
      caseId: "case_001",
      input: "更新输入",
      referenceOutput: "更新参考答案",
      context: { channel: "grocery" },
    });
    expect(updated.cases[0]).toMatchObject({
      caseId: "case_001",
      input: "更新输入",
      referenceOutput: "更新参考答案",
    });

    const deleted = await service.deleteDatasetCase(dataset.id, "case_001");
    expect(deleted.cases).toHaveLength(0);
  });

  it("rejects dataset type change through the service when editable cases already exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-dataset-type-guard-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());

    const dataset = await service.createDataset({
      name: "Editable Dataset",
      description: "type guard flow",
      datasetType: "ideal_output",
      sampleCount: 12,
      schema: [
        {
          name: "input",
          dataType: "String",
          required: true,
          description: "input",
        },
        {
          name: "reference_output",
          dataType: "String",
          required: false,
          description: "reference output",
        },
        {
          name: "context",
          dataType: "JSON",
          required: false,
          description: "context",
        },
      ],
    });

    await service.createDatasetCase(dataset.id, {
      caseId: "case_001",
      input: "用户输入",
      referenceOutput: "参考答案",
      context: {},
    });

    await expect(
      service.updateDataset(dataset.id, {
        name: "Workflow Dataset",
        description: "updated workflow schema",
        datasetType: "workflow",
        sampleCount: 12,
        schema: [
          {
            name: "input",
            dataType: "String",
            required: true,
            description: "workflow input",
          },
          {
            name: "workflow_output",
            dataType: "JSON",
            required: true,
            description: "workflow result",
          },
          {
            name: "expected_steps",
            dataType: "JSON",
            required: false,
            description: "expected steps",
          },
        ],
      }),
    ).rejects.toThrow(/Cannot change datasetType/);
  });

  it("creates lightweight prompt and agent targets for experiments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-targets-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());

    const prompt = await service.createPrompt({
      name: "食搜回答 Prompt",
      description: "简洁推荐版",
      systemPrompt: "你是 AI 搜索助手。",
      userTemplate: "输入：{{input}}",
    });

    const agent = await service.createAgent({
      name: "食搜 Agent",
      description: "baseline",
      queryProcessor: "qp-v1",
      retriever: "retriever-v1",
      reranker: "reranker-v1",
      answerer: "answerer-v1",
    });

    const prompts = await service.listPrompts();
    const agents = await service.listAgents();

    expect(prompt.id).toContain("prompt_custom_");
    expect(agent.id).toContain("agent_custom_");
    expect(prompts.some((item) => item.id === prompt.id)).toBe(true);
    expect(agents.some((item) => item.id === agent.id)).toBe(true);
  });
});
