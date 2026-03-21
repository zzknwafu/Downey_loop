import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockEvalLoopApi } from "../src/contracts/mock-api.js";
import { loadAppConfig } from "../src/infra/config.js";
import { FileBackedLocalStore } from "../src/infra/store.js";
import { ExperimentRunner } from "../src/runner/experiment-runner.js";
import { createSeedSnapshot } from "../src/shared/mock-data.js";
import {
  baselinePipeline,
  sampleDatasets,
  sampleEvaluators,
  samplePrompts,
} from "../src/domain/sample-data.js";

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
    expect(experiment.configuration?.dataset.id).toBe(dataset.id);
    expect(experiment.configuration?.evaluators).toHaveLength(sampleEvaluators.length);
    expect(experiment.configuration?.runConfig.sampleCount).toBe(dataset.cases.length);
    expect(experiment.evaluatorSet?.evaluatorIds).toHaveLength(sampleEvaluators.length);
    expect(experiment.basicInfo?.dataset.id).toBe(dataset.id);
    expect(experiment.summary.metricSummaries.length).toBeGreaterThan(0);
    expect(experiment.summary.layerSummaries.some((summary) => summary.layer === "overall")).toBe(true);
  });

  it("runs prompt targets through a compatible execution target", async () => {
    const dataset = sampleDatasets[0]!;
    const runner = new ExperimentRunner(async (evalCase) => ({
      retrievalResult: evalCase.retrievalCandidates.slice(0, 2),
      rerankResult: evalCase.retrievalCandidates.slice(0, 2),
      answerOutput: evalCase.answerReference,
      latencyMs: { retrieval: 10, rerank: 10, answer: 10 },
    }));

    const { experiment } = await runner.runExperiment({
      dataset,
      target: samplePrompts[0]!,
      evaluators: sampleEvaluators,
    });

    expect(experiment.targetSelection?.type).toBe("prompt");
    expect(experiment.pipelineVersionId).toContain("__prompt_execution");
    expect(experiment.basicInfo?.target.type).toBe("prompt");
  });

  it("scores only the selected evaluator subset in experiment runs", async () => {
    const dataset = sampleDatasets[0]!;
    const selectedEvaluators = sampleEvaluators.filter((evaluator) =>
      ["retrieval_coverage", "answer_correctness", "proxy_cvr"].includes(evaluator.name),
    );
    const runner = new ExperimentRunner(async (evalCase) => ({
      retrievalResult: evalCase.retrievalCandidates.slice(0, 2),
      rerankResult: evalCase.retrievalCandidates.slice(0, 2),
      answerOutput: evalCase.answerReference,
      latencyMs: { retrieval: 10, rerank: 10, answer: 10 },
    }));

    const { experiment } = await runner.runExperiment({
      dataset,
      target: samplePrompts[0]!,
      evaluators: selectedEvaluators,
    });

    expect(experiment.evaluatorSet?.bindings).toHaveLength(3);
    expect(experiment.caseRuns[0]?.scores).toHaveLength(3);
    expect(experiment.caseRuns[0]?.scores.map((metric) => metric.metricName)).toEqual([
      "retrieval_coverage",
      "answer_correctness",
      "proxy_cvr",
    ]);
  });

  it("loads config defaults without requiring explicit env", () => {
    const config = loadAppConfig({});
    expect(config.geminiBaseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(config.geminiModel).toBe("gemini-2.5-flash");
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
      version: "1.2.0",
      description: "preview agent",
      scenario: "ai_search",
      entry_type: "workflow",
      artifact_ref: "agent://debug",
      composition: [
        { kind: "query_processor", ref: "qp-debug", role: "query_processor" },
        { kind: "retriever", ref: "ret-debug", role: "retriever" },
        { kind: "reranker", ref: "rr-debug", role: "reranker" },
        { kind: "answerer", ref: "ans-debug", role: "answerer" },
      ],
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
    expect(agents[0]?.version).toBe("1.2.0");
    expect(fetchedPrompt?.system_prompt).toContain("{{input}}");
    expect(fetchedAgent?.scenario).toBe("ai_search");
    expect(fetchedAgent?.entry_type).toBe("workflow");
    expect(fetchedAgent?.query_processor).toBe("qp-debug");
    expect(preview?.rendered_user_prompt).toContain("spicy noodles");
    expect(preview?.output_preview).toContain("spicy noodles");
    expect(preview?.actual_model_output).toContain("spicy noodles");
  });

  it("exposes experiment list items and detail summaries through the mock api", async () => {
    const api = createMockEvalLoopApi();
    const items = await api.listExperimentItems();
    const detail = await api.getExperimentDetail("exp_baseline");

    expect(items[0]?.creator).toBe("system");
    expect(items[0]?.description.length).toBeGreaterThan(0);
    expect(items[0]?.evaluator_summary.total_count).toBeGreaterThan(0);
    expect(items[0]?.evaluator_summary.by_layer.length).toBeGreaterThan(0);
    expect(detail?.aggregated_metrics.layer_summaries.length).toBeGreaterThan(0);
    expect(detail?.configuration_snapshot.evaluator_bindings.length).toBeGreaterThan(0);
    expect(detail?.configuration_snapshot.evaluator_bindings[0]?.field_mapping.length).toBeGreaterThan(0);
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

  it("exposes experiment detail contract with case detail, statistics, configuration and trace payload", async () => {
    const api = createMockEvalLoopApi();
    const detail = await api.getExperimentDetail("exp_baseline");

    expect(detail?.basic_info.id).toBe("exp_baseline");
    expect(detail?.basic_info.creator).toBe("system");
    expect(detail?.basic_info.description.length).toBeGreaterThan(0);
    expect(detail?.basic_info.evaluator_summary.total_count).toBeGreaterThan(0);
    expect(detail?.basic_info.evaluator_summary.by_layer.length).toBeGreaterThan(0);
    expect(detail?.basic_info.started_at).toBeTruthy();
    expect(detail?.basic_info.finished_at).toBeTruthy();
    expect(detail?.case_results.length).toBeGreaterThan(0);
    expect(detail?.case_results[0]?.trace?.trajectory.length).toBeGreaterThan(0);
    expect(detail?.case_results[0]?.drawer.evaluator_score_table.length).toBeGreaterThan(0);
    expect(detail?.aggregated_metrics.evaluator_aggregated_scores.length).toBeGreaterThan(0);
    expect(detail?.aggregated_metrics.latency_summary).toHaveLength(4);
    expect(detail?.configuration_snapshot.dataset_info?.id).toBeDefined();
    expect(detail?.configuration_snapshot.evaluator_list.length).toBeGreaterThan(0);
    expect(detail?.configuration_snapshot.evaluator_list.every((item) => item.version.length > 0)).toBe(
      true,
    );
    expect(detail?.configuration_snapshot.field_mappings.length).toBeGreaterThan(0);
    expect(Object.keys(detail?.configuration_snapshot.weight_multipliers ?? {})).not.toHaveLength(0);
    expect((detail?.configuration_snapshot.run_config.retry_limit as number | undefined)).toBeDefined();
    expect(detail?.root_cause.latest_comparison?.baseline_run_id).toBe("exp_baseline");
  });
});
