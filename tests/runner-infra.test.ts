import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockEvalLoopApi } from "../src/contracts/mock-api.js";
import { loadAppConfig } from "../src/infra/config.js";
import { FileBackedLocalStore } from "../src/infra/store.js";
import { ExperimentRunner } from "../src/runner/experiment-runner.js";
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

    expect(bootstrap.datasets.length).toBeGreaterThan(0);
    expect(bootstrap.evaluators.length).toBeGreaterThan(0);
    expect(bootstrap.experiments.length).toBeGreaterThan(0);
    expect(bootstrap.comparison.rootCauseSummary.length).toBeGreaterThan(0);
  });
});
