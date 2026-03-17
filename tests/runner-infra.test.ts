import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockEvalLoopApi } from "../src/contracts/mock-api.js";
import { loadAppConfig } from "../src/infra/config.js";
import { FileBackedLocalStore } from "../src/infra/store.js";
import { ExperimentRunner } from "../src/runner/experiment-runner.js";
import { createSeedSnapshot } from "../src/shared/mock-data.js";
import { sampleDatasets, sampleEvaluators, baselinePipeline } from "../src/domain/sample-data.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("runner and infra", () => {
  it("runs experiments with experiment and case jobs", async () => {
    const dataset = sampleDatasets[0]!;
    const runner = new ExperimentRunner(async (evalCase) => ({
      retrievalResult: evalCase.retrievalCandidates.slice(0, 2),
      rerankResult: evalCase.retrievalCandidates.slice(0, 2),
      answerOutput: evalCase.answerReference,
      latencyMs: { retrieval: 10, rerank: 10, answer: 10 },
    }));

    const { experiment, job } = await runner.runExperiment({
      dataset,
      target: baselinePipeline,
      evaluators: sampleEvaluators,
    });

    expect(job.caseJobs).toHaveLength(dataset.cases.length);
    expect(job.status).toBe("completed");
    expect(experiment.status).toBe("FINISHED");
    expect(experiment.summary.totalCases).toBe(dataset.cases.length);
    expect(experiment.summary.completedCases).toBe(dataset.cases.length);
  });

  it("loads config defaults without requiring explicit env", () => {
    const config = loadAppConfig({});
    expect(config.openAiBaseUrl).toBe("https://api.openai.com/v1");
    expect(config.openAiModel).toBe("gpt-4.1-mini");
    expect(config.storeFile.endsWith("downey-evals-store.json")).toBe(true);
  });

  it("persists datasets and experiments via local file store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "downey-store-"));
    tempDirs.push(directory);
    const store = new FileBackedLocalStore(join(directory, "store.json"));

    await store.upsertDataset(sampleDatasets[0]!);
    const api = createMockEvalLoopApi();
    const experiments = await api.listExperiments();
    await store.upsertExperiment(experiments[0]!);

    const snapshot = await store.load();
    expect(snapshot.datasets).toHaveLength(1);
    expect(snapshot.experiments).toHaveLength(1);
    expect(snapshot.traces.length).toBeGreaterThan(0);
  });

  it("exposes a stable mock api contract for frontend and integration", async () => {
    const api = createMockEvalLoopApi();
    const bootstrap = await api.bootstrap();
    const prompts = await api.listPrompts();
    const agents = await api.listAgents();

    expect(bootstrap.datasets.length).toBeGreaterThan(0);
    expect(bootstrap.evaluators.length).toBeGreaterThan(0);
    expect(bootstrap.experiments.length).toBeGreaterThan(0);
    expect(bootstrap.comparison.rootCauseSummary.length).toBeGreaterThan(0);
    expect(prompts.length).toBeGreaterThan(0);
    expect(agents.length).toBeGreaterThan(0);
  });

  it("supports targets contract and prompt preview/debug through the mock api", async () => {
    const api = createMockEvalLoopApi();

    const createdPrompt = await api.createPrompt({
      name: "Debug Prompt",
      description: "preview prompt",
      system_prompt: "You are a helper for {{input}}.",
      user_template: "Question: {{input}}",
    });
    const createdAgent = await api.createAgent({
      name: "Debug Agent",
      description: "preview agent",
      query_processor: "qp-debug",
      retriever: "ret-debug",
      reranker: "rr-debug",
      answerer: "ans-debug",
    });

    const prompts = await api.listPrompts();
    const agents = await api.listAgents();
    const fetchedPrompt = await api.getPrompt(createdPrompt.id);
    const fetchedAgent = await api.getAgent(createdAgent.id);
    const preview = await api.previewPrompt(createdPrompt.id, {
      input: "spicy noodles",
    });

    expect(prompts[0]?.id).toBe(createdPrompt.id);
    expect(agents[0]?.id).toBe(createdAgent.id);
    expect(fetchedPrompt?.system_prompt).toContain("{{input}}");
    expect(fetchedAgent?.query_processor).toBe("qp-debug");
    expect(preview?.rendered_user_prompt).toContain("spicy noodles");
    expect(preview?.output_preview).toContain("spicy noodles");
  });

  it("supports dataset list, get and create through the mock api contract", async () => {
    const api = createMockEvalLoopApi();
    const existing = await api.listDatasets();

    const created = await api.createDataset({
      name: "Mock Dataset",
      description: "for frontend integration",
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
          required: true,
          description: "reference output",
        },
        {
          name: "context",
          dataType: "JSON",
          required: true,
          description: "context",
        },
      ],
    });

    const listed = await api.listDatasets();
    const fetched = await api.getDataset(created.id);

    expect(existing.length).toBeGreaterThan(0);
    expect(listed[0]?.id).toBe(created.id);
    expect(fetched?.name).toBe("Mock Dataset");
    expect(fetched?.cases).toHaveLength(0);
  });

  it("supports dataset update through the mock api contract", async () => {
    const api = createMockEvalLoopApi();
    const dataset = sampleDatasets[0]!;

    const updated = await api.updateDataset(dataset.id, {
      name: "Updated Dataset",
      description: "updated from contract layer",
      datasetType: dataset.datasetType,
      sampleCount: 12,
      schema: dataset.schema,
    });

    const fetched = await api.getDataset(dataset.id);

    expect(updated?.name).toBe("Updated Dataset");
    expect(updated?.description).toBe("updated from contract layer");
    expect(fetched?.updatedAt).toBe("2026-03-17T00:00:00.000Z");
  });

  it("supports dataset case list, detail, replace, create, update, delete and synthesis through the mock api contract", async () => {
    const api = createMockEvalLoopApi();
    const dataset = await api.createDataset({
      name: "Editable Dataset",
      description: "mock api editable dataset",
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

    const listedCases = await api.listDatasetCases(dataset.id);
    expect(listedCases).toHaveLength(0);
    const replacedCases = await api.replaceDatasetCases(dataset.id, {
      cases: [
        {
          id: "case_replaced",
          input: "replaced input",
          reference_output: "replaced output",
          context: { source: "replace" },
        },
      ],
    });
    const originalCase = replacedCases?.[0];
    const fetchedCase = await api.getDatasetCase(dataset.id, originalCase!.id);
    const createdCase = await api.createDatasetCase(dataset.id, {
      id: "case_created",
      input: "created input",
      reference_output: "created output",
      context: { source: "create" },
    });
    const updatedCase = await api.updateDatasetCase(dataset.id, {
      id: "case_created",
      input: "case_created updated",
      reference_output: "created output",
      context: { source: "update" },
    });
    const deleted = await api.deleteDatasetCase(dataset.id, "case_created");
    const synthesis = await api.synthesizeDatasetCases(dataset.id, {
      dataset_id: dataset.id,
      source: "online",
      direction: "align_online_distribution",
      scenario_description: "商超搜索补齐线上分布",
      use_case_description: "回灌真实高频失败 query",
      seed_source_ref: "online:7d",
      columns: [
        {
          name: "input",
          description: "query text",
          generation_requirement: "更贴近线上失败样本分布",
        },
      ],
      sample_count: 10,
    });

    expect(listedCases?.length).toBe(0);
    expect(fetchedCase?.id).toBe(originalCase.id);
    expect(replacedCases?.[0]?.id).toBe("case_replaced");
    expect(createdCase?.id).toBe("case_created");
    expect(updatedCase && "input" in updatedCase ? updatedCase.input : "").toContain("updated");
    expect(deleted).toBe(true);
    expect(synthesis?.source).toBe("online");
    expect(synthesis?.direction).toBe("align_online_distribution");
    expect(synthesis?.status).toBe("draft");
    expect(synthesis?.items).toHaveLength(10);
  });

  it("keeps shared mock snapshot ids aligned with experiment and comparison records", () => {
    const snapshot = createSeedSnapshot();
    const experimentIds = new Set(snapshot.experiments.map((experiment) => experiment.id));

    expect(experimentIds.has(snapshot.ab_experiment.baseline_run_id)).toBe(true);
    expect(experimentIds.has(snapshot.ab_experiment.candidate_run_id)).toBe(true);
  });
});
