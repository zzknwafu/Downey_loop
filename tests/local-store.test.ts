import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

    expect(initialState.datasets).toHaveLength(3);
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
});
