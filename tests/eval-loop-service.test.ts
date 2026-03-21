import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { candidatePipeline, sampleDatasets, samplePrompts } from "../src/domain/sample-data.js";
import { FileBackedLocalStore } from "../src/infra/store.js";
import {
  createReferencePipelineExecutor,
  EvalLoopService,
} from "../src/services/eval-loop-service.js";

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const installMockOpenAI = () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "resp_test_001",
        candidates: [
          {
            content: {
              parts: [{ text: "mocked gemini output" }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )) as typeof fetch;
};

const openAiConfig = {
  apiKey: "test-key",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  model: "gemini-2.5-flash",
};

describe("eval loop service", () => {
  it("seeds default datasets, evaluators, experiments and comparisons", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-seed-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    installMockOpenAI();
    const service = new EvalLoopService(store, createReferencePipelineExecutor(), openAiConfig);

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
    installMockOpenAI();
    const service = new EvalLoopService(store, createReferencePipelineExecutor(), openAiConfig);
    await service.seedDefaults();

    const experiment = await service.runExperiment({
      datasetId: sampleDatasets[0]!.id,
      target: candidatePipeline,
    });

    const experiments = await service.listExperiments();
    expect(experiment.status).toBe("FINISHED");
    expect(experiment.summary.totalCases).toBe(sampleDatasets[0]!.cases.length);
    expect(experiment.configuration?.target.id).toBe(candidatePipeline.id);
    expect(experiment.configuration?.dataset.id).toBe(sampleDatasets[0]!.id);
    expect(experiment.configuration?.evaluators.length).toBeGreaterThan(1);
    expect(experiment.evaluatorSet?.bindings.length).toBeGreaterThan(1);
    expect(experiment.basicInfo?.target.type).toBe("agent");
    expect(experiments.some((item) => item.experimentId === experiment.experimentId)).toBe(true);
  });

  it("persists explicit experiment run config into configuration snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-run-config-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    installMockOpenAI();
    const service = new EvalLoopService(store, createReferencePipelineExecutor(), openAiConfig);
    await service.seedDefaults();

    const experiment = await service.runExperiment({
      datasetId: sampleDatasets[0]!.id,
      target: candidatePipeline,
      runConfig: {
        timeoutMs: 45_000,
        retryLimit: 2,
        concurrency: 6,
      },
    });

    expect(experiment.configuration?.runConfig.sampleCount).toBe(sampleDatasets[0]!.cases.length);
    expect(experiment.configuration?.runConfig.timeoutMs).toBe(45_000);
    expect(experiment.configuration?.runConfig.retryLimit).toBe(2);
    expect(experiment.configuration?.runConfig.concurrency).toBe(6);
  });

  it("runs prompt targets against ideal_output datasets with multi-evaluator output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-prompt-run-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    installMockOpenAI();
    const service = new EvalLoopService(store, createReferencePipelineExecutor(), openAiConfig);
    await service.seedDefaults();

    const experiment = await service.runExperiment({
      datasetId: sampleDatasets[0]!.id,
      target: samplePrompts[0]!,
    });

    expect(experiment.targetSelection?.type).toBe("prompt");
    expect(experiment.basicInfo?.target.type).toBe("prompt");
    expect(experiment.caseRuns[0]?.scores.length).toBeGreaterThan(1);
    expect(experiment.configuration?.evaluators.length).toBeGreaterThan(1);
    expect(experiment.configuration?.promptBinding?.promptId).toBe(samplePrompts[0]!.id);
    expect(experiment.configuration?.promptBinding?.modelConfig.model).toBe("gemini-2.5-flash");
    expect(experiment.configuration?.promptBinding?.variableMappings[0]?.sourceField).toBe("input");
  });

  it("persists selected evaluator bindings instead of scoring the full built-in set", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-selected-evals-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    installMockOpenAI();
    const service = new EvalLoopService(store, createReferencePipelineExecutor(), openAiConfig);
    await service.seedDefaults();

    const selectedEvaluatorIds = [
      "eval_retrieval_coverage",
      "eval_answer_correctness",
      "eval_proxy_cvr",
    ];

    const experiment = await service.runExperiment({
      datasetId: sampleDatasets[0]!.id,
      target: samplePrompts[0]!,
      evaluatorIds: selectedEvaluatorIds,
    });

    expect(experiment.evaluatorSet?.evaluatorIds).toEqual(selectedEvaluatorIds);
    expect(experiment.configuration?.evaluators).toHaveLength(3);
    expect(experiment.configuration?.evaluators.every((binding) => binding.evaluatorVersion.length > 0)).toBe(
      true,
    );
    expect(experiment.caseRuns[0]?.scores.map((metric) => metric.metricName)).toEqual([
      "retrieval_coverage",
      "answer_correctness",
      "proxy_cvr",
    ]);
  });

  it("persists explicit prompt variable mappings and model params into configuration snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-prompt-binding-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    installMockOpenAI();
    const service = new EvalLoopService(store, createReferencePipelineExecutor(), openAiConfig);
    await service.seedDefaults();

    const experiment = await service.runExperiment({
      datasetId: sampleDatasets[0]!.id,
      target: samplePrompts[0]!,
      evaluatorIds: ["eval_answer_correctness"],
      promptBinding: {
        variableMappings: [
          {
            sourceField: "input",
            targetField: "query",
            sourceType: "String",
            targetType: "runtime",
          },
        ],
        modelConfig: {
          model: "gemini-2.5-flash",
          temperature: 0.4,
          maxTokens: 512,
        },
      },
    });

    expect(experiment.configuration?.promptBinding?.variableMappings).toEqual([
      {
        sourceField: "input",
        targetField: "query",
        sourceType: "String",
        targetType: "runtime",
      },
    ]);
    expect(experiment.configuration?.promptBinding?.modelConfig).toMatchObject({
      model: "gemini-2.5-flash",
      temperature: 0.4,
      maxTokens: 512,
      topP: 1,
    });
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

  it("creates evaluator versions within the same evaluator lineage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-evaluator-version-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());

    const first = await service.createEvaluator({
      name: "answer_correctness_custom",
      layer: "answer",
      family: "model",
      metricType: "binary",
      description: "first version",
      config: {},
      changeSummary: "initial version",
    });

    const second = await service.createEvaluator({
      name: "answer_correctness_custom",
      layer: "answer",
      family: "model",
      metricType: "binary",
      description: "second version",
      config: {},
      evaluatorKey: first.evaluatorKey,
      changeSummary: "tighten binary rubric",
    });

    expect(first.version).toBe("0.1.0");
    expect(second.version).toBe("0.1.1");
    expect(second.previousVersionId).toBe(first.id);
    expect(second.evaluatorKey).toBe(first.evaluatorKey);
    expect(second.changeSummary).toBe("tighten binary rubric");
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
    expect(prompt.name).toBe("食搜回答 Prompt");
    expect(agent.queryProcessor).toBe("qp-v1");
  });

  it("rejects invalid prompt and agent target payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-service-target-validation-"));
    tempDirs.push(directory);

    const store = new FileBackedLocalStore(join(directory, "store.json"));
    const service = new EvalLoopService(store, createReferencePipelineExecutor());

    await expect(
      service.createPrompt({
        name: "坏 Prompt",
        systemPrompt: "  ",
        userTemplate: "输入：{{input}}",
      }),
    ).rejects.toThrow(/systemPrompt is required/);

    await expect(
      service.createAgent({
        name: "坏 Agent",
        queryProcessor: "qp-v1",
        retriever: "retriever-v1",
        reranker: "  ",
        answerer: "answerer-v1",
      }),
    ).rejects.toThrow(/reranker is required/);
  });
});
