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
      schema: [
        {
          name: "input",
          dataType: "String",
          required: true,
          description: "input",
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
});
