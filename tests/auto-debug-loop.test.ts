import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();
const coreModuleUrl = pathToFileURL(
  path.join(workspaceRoot, "scripts/lib/auto-debug-loop-core.mjs"),
).href;

const tempDirs: string[] = [];

const createFixtureRepo = () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "auto-debug-loop-"));
  tempDirs.push(repoPath);

  fs.cpSync(path.join(workspaceRoot, "src"), path.join(repoPath, "src"), { recursive: true });
  fs.mkdirSync(path.join(repoPath, "scripts"), { recursive: true });

  fs.writeFileSync(
    path.join(repoPath, "package.json"),
    JSON.stringify(
      {
        name: "fixture-repo",
        private: true,
        type: "module",
        scripts: {
          test: "node scripts/test-check.mjs",
          build: "node scripts/build-check.mjs",
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(path.join(repoPath, "scripts/test-check.mjs"), "process.exit(0);\n");
  fs.writeFileSync(path.join(repoPath, "scripts/build-check.mjs"), "process.exit(0);\n");

  return repoPath;
};

afterEach(() => {
  for (const repoPath of tempDirs.splice(0)) {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

describe("auto debug loop", () => {
  it("reports a healthy repo in detect-only mode", async () => {
    const repoPath = createFixtureRepo();
    const { runAutoDebugLoop } = await import(coreModuleUrl);

    const report = runAutoDebugLoop({
      repoPath,
      mode: "detect-only",
    });

    expect(report.finalStatus).toBe("healthy");
    expect(report.requiresManualReview).toBe(false);
    expect(report.initialDetection.summary.totalFindings).toBe(0);
  });

  it("restores evaluator baseline for known binary contract bugs", async () => {
    const repoPath = createFixtureRepo();
    const evaluatorPath = path.join(repoPath, "src/domain/evaluators.ts");
    const broken = fs
      .readFileSync(evaluatorPath, "utf8")
      .replace('metricType: "binary"', 'metricType: "continuous"')
      .replace("score !== 0 && score !== 1", "score < 0");
    fs.writeFileSync(evaluatorPath, broken);

    const { runAutoDebugLoop } = await import(coreModuleUrl);
    const report = runAutoDebugLoop({
      repoPath,
      mode: "detect-and-fix",
      maxRounds: 1,
    });

    expect(report.initialDetection.summary.totalFindings).toBeGreaterThan(0);
    expect(report.finalStatus).toBe("fixed");
    expect(report.finalDetection.summary.totalFindings).toBe(0);
    expect(fs.readFileSync(evaluatorPath, "utf8")).toContain('metricType: "binary"');
    expect(fs.readFileSync(evaluatorPath, "utf8")).toContain("score !== 0 && score !== 1");
  }, 20000);

  it("rolls back fixes when validation introduces new command failures", async () => {
    const repoPath = createFixtureRepo();
    const evaluatorPath = path.join(repoPath, "src/domain/evaluators.ts");
    const broken = `${fs
      .readFileSync(evaluatorPath, "utf8")
      .replace("score !== 0 && score !== 1", "score < 0")}\n// BROKEN_MARKER\n`;
    fs.writeFileSync(evaluatorPath, broken);

    const requiresMarker = [
      'import fs from "node:fs";',
      'const text = fs.readFileSync(new URL("../src/domain/evaluators.ts", import.meta.url), "utf8");',
      'process.exit(text.includes("BROKEN_MARKER") ? 0 : 1);',
      "",
    ].join("\n");
    fs.writeFileSync(path.join(repoPath, "scripts/test-check.mjs"), requiresMarker);
    fs.writeFileSync(path.join(repoPath, "scripts/build-check.mjs"), requiresMarker);

    const { runAutoDebugLoop } = await import(coreModuleUrl);
    const report = runAutoDebugLoop({
      repoPath,
      mode: "detect-and-fix",
      maxRounds: 1,
      maxConsecutiveFailures: 1,
    });

    expect(report.rounds).toHaveLength(1);
    expect(report.rounds[0]?.rolledBack).toBe(true);
    expect(report.finalStatus).toBe("manual_review_required");
    expect(report.finalDetection.summary.failedCommands).toBe(0);
    expect(fs.readFileSync(evaluatorPath, "utf8")).toContain("BROKEN_MARKER");
  });
});
