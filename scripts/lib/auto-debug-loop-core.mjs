import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..", "..");
const baselineRoot = path.resolve(workspaceRoot, "scripts", "auto-debug-loop-baselines");

const REQUIRED_ENTRY_FILES = [
  "src/index.ts",
  "src/web/main.tsx",
  "src/web/App.tsx",
  "src/web/view-model.ts",
  "src/domain/evaluators.ts",
  "src/domain/comparison.ts",
];

const BASELINE_RESTORE_MAP = {
  "src/domain/evaluators.ts": path.join(baselineRoot, "src/domain/evaluators.ts"),
  "src/domain/comparison.ts": path.join(baselineRoot, "src/domain/comparison.ts"),
  "src/web/view-model.ts": path.join(baselineRoot, "src/web/view-model.ts"),
};

const DEFAULTS = {
  mode: "detect-only",
  maxRounds: 2,
  maxModifiedFiles: 3,
  maxConsecutiveFailures: 2,
};

const readText = (filePath) => fs.readFileSync(filePath, "utf8");

const safeReadText = (filePath) => {
  try {
    return readText(filePath);
  } catch {
    return null;
  }
};

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

const runShellCommand = (repoPath, command) => {
  try {
    const stdout = execSync(command, {
      cwd: repoPath,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, CI: "1" },
    });

    return {
      command,
      ok: true,
      exitCode: 0,
      stdout,
      stderr: "",
    };
  } catch (error) {
    return {
      command,
      ok: false,
      exitCode: typeof error.status === "number" ? error.status : 1,
      stdout: error.stdout ? String(error.stdout) : "",
      stderr: error.stderr ? String(error.stderr) : error.message,
    };
  }
};

const toRepoPath = (repoPath, relativePath) => path.join(repoPath, relativePath);

const fileExists = (repoPath, relativePath) => fs.existsSync(toRepoPath(repoPath, relativePath));

const countMatches = (text, pattern) => {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
};

const commandOutputExcerpt = (result) => {
  const merged = `${result.stdout}\n${result.stderr}`.trim();
  if (!merged) {
    return "";
  }

  return merged.split("\n").slice(-12).join("\n");
};

const createFinding = ({
  id,
  category,
  priority,
  symptom,
  likelyFiles,
  confidence,
  fixGuardrails,
  autoFixable = false,
  details,
}) => ({
  id,
  category,
  priority,
  symptom,
  likelyFiles,
  confidence,
  fixGuardrails,
  autoFixable,
  details,
});

const inspectRepo = (repoPath) => {
  const packageJsonPath = toRepoPath(repoPath, "package.json");
  const packageJson = JSON.parse(readText(packageJsonPath));
  const missingEntries = REQUIRED_ENTRY_FILES.filter((file) => !fileExists(repoPath, file));

  return {
    repoPath,
    packageName: packageJson.name ?? "unknown",
    scripts: packageJson.scripts ?? {},
    missingEntries,
    entryFiles: REQUIRED_ENTRY_FILES.map((file) => ({
      path: file,
      exists: fileExists(repoPath, file),
    })),
  };
};

const detectCommandFailures = (inspection) => {
  const findings = [];
  const commandResults = [];

  for (const scriptName of ["test", "build"]) {
    if (!inspection.scripts[scriptName]) {
      findings.push(
        createFinding({
          id: `missing_${scriptName}_script`,
          category: "executability",
          priority: "high",
          symptom: `package.json 缺少 ${scriptName} 脚本，自动回归闭环无法运行。`,
          likelyFiles: ["package.json"],
          confidence: 0.98,
          fixGuardrails: ["只允许补充脚本定义，不允许绕过真实检查。"],
        }),
      );
      continue;
    }

    const result = runShellCommand(inspection.repoPath, `npm run ${scriptName}`);
    commandResults.push(result);

    if (!result.ok) {
      findings.push(
        createFinding({
          id: `${scriptName}_command_failed`,
          category: "executability",
          priority: "high",
          symptom: `npm run ${scriptName} 执行失败。`,
          likelyFiles: scriptName === "test" ? ["tests/search-evals.test.ts", "src/domain/evaluators.ts"] : ["vite.config.ts", "src/web/main.tsx", "src/domain/comparison.ts"],
          confidence: 0.86,
          fixGuardrails: ["先修生产代码，再修测试。", "禁止通过删除脚本或弱化命令来让检查变绿。"],
          details: commandOutputExcerpt(result),
        }),
      );
    }
  }

  return { commandResults, findings };
};

const detectEntryIssues = (inspection) => {
  const findings = [];

  if (inspection.missingEntries.length > 0) {
    findings.push(
      createFinding({
        id: "missing_entry_files",
        category: "executability",
        priority: "high",
        symptom: `关键入口文件缺失：${inspection.missingEntries.join(", ")}`,
        likelyFiles: inspection.missingEntries,
        confidence: 0.99,
        fixGuardrails: ["只能恢复缺失入口，不允许改动检查范围。"],
      }),
    );
  }

  const mainText = safeReadText(toRepoPath(inspection.repoPath, "src/web/main.tsx"));
  if (mainText && !mainText.includes('from "./App.js"')) {
    findings.push(
      createFinding({
        id: "web_main_import_contract",
        category: "ui_contract",
        priority: "medium",
        symptom: "src/web/main.tsx 未按约定导入 App 入口。",
        likelyFiles: ["src/web/main.tsx"],
        confidence: 0.74,
        fixGuardrails: ["只修正入口导入路径，不改页面逻辑。"],
      }),
    );
  }

  return findings;
};

const detectEvaluatorIssues = (inspection) => {
  const evaluatorPath = toRepoPath(inspection.repoPath, "src/domain/evaluators.ts");
  const evaluatorText = safeReadText(evaluatorPath);
  if (!evaluatorText) {
    return [];
  }

  const findings = [];

  if (!evaluatorText.includes('name: "answer_correctness"') || !evaluatorText.includes('metricType: "binary"')) {
    findings.push(
      createFinding({
        id: "answer_correctness_definition_invalid",
        category: "evaluator_invariant",
        priority: "high",
        symptom: "answer_correctness 定义缺失或不再是 binary 指标。",
        likelyFiles: ["src/domain/evaluators.ts"],
        confidence: 0.95,
        fixGuardrails: ["必须保持 answer_correctness 为 binary。"],
        autoFixable: true,
      }),
    );
  }

  if (!evaluatorText.includes("score !== 0 && score !== 1")) {
    findings.push(
      createFinding({
        id: "answer_correctness_binary_guard_missing",
        category: "evaluator_invariant",
        priority: "high",
        symptom: "binaryResult 缺少 0/1 守卫，binary 语义不再受保护。",
        likelyFiles: ["src/domain/evaluators.ts"],
        confidence: 0.97,
        fixGuardrails: ["必须恢复 invalid_judgment 降级，而不是放宽 binary 约束。"],
        autoFixable: true,
      }),
    );
  }

  for (const layer of ["retrieval", "rerank", "answer", "overall"]) {
    if (!evaluatorText.includes(`layer: "${layer}"`)) {
      findings.push(
        createFinding({
          id: `missing_${layer}_layer_metrics`,
          category: "evaluator_invariant",
          priority: "high",
          symptom: `评测定义缺少 ${layer} 层，层级完整性被破坏。`,
          likelyFiles: ["src/domain/evaluators.ts"],
          confidence: 0.9,
          fixGuardrails: ["必须恢复四层结构，不允许通过改 UI/测试绕过。"],
          autoFixable: true,
        }),
      );
    }
  }

  if (!evaluatorText.includes('status: "invalid_judgment"')) {
    findings.push(
      createFinding({
        id: "invalid_judgment_fallback_missing",
        category: "evaluator_invariant",
        priority: "medium",
        symptom: "评测缺少 invalid_judgment 降级结果，异常判断不可解释。",
        likelyFiles: ["src/domain/evaluators.ts"],
        confidence: 0.83,
        fixGuardrails: ["异常时必须返回可解释 metric result。"],
        autoFixable: true,
      }),
    );
  }

  return findings;
};

const detectComparisonIssues = (inspection) => {
  const comparisonText = safeReadText(toRepoPath(inspection.repoPath, "src/domain/comparison.ts"));
  if (!comparisonText) {
    return [];
  }

  const findings = [];
  const requiredTokens = ["overallDeltas", "layerDeltas", "rootCauseSummary", "evidenceCaseIds"];

  for (const token of requiredTokens) {
    if (!comparisonText.includes(token)) {
      findings.push(
        createFinding({
          id: `comparison_contract_missing_${token}`,
          category: "comparison_contract",
          priority: "high",
          symptom: `comparison 结果缺少 ${token}，下钻链路会断裂。`,
          likelyFiles: ["src/domain/comparison.ts"],
          confidence: 0.94,
          fixGuardrails: ["必须保持 overall/layer/case 归因结构。"],
          autoFixable: true,
        }),
      );
    }
  }

  if (!comparisonText.includes("proxy_cvr") || !comparisonText.includes("rerank_hit_at_3")) {
    findings.push(
      createFinding({
        id: "comparison_root_cause_rules_missing",
        category: "comparison_contract",
        priority: "medium",
        symptom: "root-cause 规则缺失关键指标，归因结果可能失真。",
        likelyFiles: ["src/domain/comparison.ts"],
        confidence: 0.78,
        fixGuardrails: ["只能恢复归因规则，不改实验数据语义。"],
        autoFixable: true,
      }),
    );
  }

  return findings;
};

const detectUiContractIssues = (inspection) => {
  const viewModelText = safeReadText(toRepoPath(inspection.repoPath, "src/web/view-model.ts"));
  const appText = safeReadText(toRepoPath(inspection.repoPath, "src/web/App.tsx"));

  if (!viewModelText || !appText) {
    return [];
  }

  const findings = [];
  const requiredViewModelTokens = ["export const demoViewModel", "comparison", "caseDetails", "groupedBaselineMetrics", "groupedCandidateMetrics"];

  for (const token of requiredViewModelTokens) {
    if (!viewModelText.includes(token)) {
      findings.push(
        createFinding({
          id: `view_model_contract_missing_${token.replace(/\W+/g, "_")}`,
          category: "ui_contract",
          priority: "high",
          symptom: `view-model 缺少 ${token}，页面数据契约会断裂。`,
          likelyFiles: ["src/web/view-model.ts"],
          confidence: 0.92,
          fixGuardrails: ["只恢复页面消费字段，不改变 domain 数据结构。"],
          autoFixable: true,
        }),
      );
    }
  }

  if (!appText.includes('from "./view-model.js"') || !appText.includes("demoViewModel")) {
    findings.push(
      createFinding({
        id: "app_view_model_binding_missing",
        category: "ui_contract",
        priority: "medium",
        symptom: "App 未正确绑定 demoViewModel，实验页无法下钻。",
        likelyFiles: ["src/web/App.tsx"],
        confidence: 0.81,
        fixGuardrails: ["只恢复绑定关系，不重写 UI 结构。"],
      }),
    );
  }

  return findings;
};

const dedupeFindings = (findings) => {
  const seen = new Set();
  return findings.filter((finding) => {
    if (seen.has(finding.id)) {
      return false;
    }
    seen.add(finding.id);
    return true;
  });
};

const runDetection = (inspection) => {
  const commandResult = detectCommandFailures(inspection);
  const findings = dedupeFindings([
    ...commandResult.findings,
    ...detectEntryIssues(inspection),
    ...detectEvaluatorIssues(inspection),
    ...detectComparisonIssues(inspection),
    ...detectUiContractIssues(inspection),
  ]);

  return {
    commandResults: commandResult.commandResults,
    findings,
    summary: {
      totalFindings: findings.length,
      failedCommands: commandResult.commandResults.filter((result) => !result.ok).length,
      autoFixableFindings: findings.filter((finding) => finding.autoFixable).length,
    },
  };
};

const buildFixPlan = (findings, limits) => {
  const fixes = [];
  const chosenFiles = new Set();

  for (const finding of findings) {
    if (!finding.autoFixable) {
      continue;
    }

    for (const candidateFile of finding.likelyFiles) {
      if (!BASELINE_RESTORE_MAP[candidateFile] || chosenFiles.has(candidateFile)) {
        continue;
      }

      fixes.push({
        findingId: finding.id,
        targetFile: candidateFile,
        baselineFile: BASELINE_RESTORE_MAP[candidateFile],
        strategy: "restore_from_baseline",
        reason: finding.symptom,
      });
      chosenFiles.add(candidateFile);
      break;
    }

    if (fixes.length >= limits.maxModifiedFiles) {
      break;
    }
  }

  return fixes;
};

const captureAuditSnapshot = (repoPath, targetFiles) => {
  try {
    if (targetFiles.length === 0) {
      return "";
    }

    const args = targetFiles.map((file) => `"${file}"`).join(" ");
    return execSync(`git diff --no-ext-diff --relative -- ${args}`, {
      cwd: repoPath,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    return "";
  }
};

const backupFiles = (repoPath, targetFiles) =>
  Object.fromEntries(
    targetFiles.map((file) => {
      const absolutePath = toRepoPath(repoPath, file);
      return [file, safeReadText(absolutePath)];
    }),
  );

const restoreBackup = (repoPath, backup) => {
  for (const [file, content] of Object.entries(backup)) {
    const absolutePath = toRepoPath(repoPath, file);
    if (content === null) {
      if (fs.existsSync(absolutePath)) {
        fs.rmSync(absolutePath);
      }
      continue;
    }

    writeText(absolutePath, content);
  }
};

const applyFixes = (repoPath, fixes) => {
  const applied = [];

  for (const fix of fixes) {
    const targetPath = toRepoPath(repoPath, fix.targetFile);
    const baselineText = readText(fix.baselineFile);
    const previousText = safeReadText(targetPath);

    if (previousText === baselineText) {
      continue;
    }

    writeText(targetPath, baselineText);
    applied.push({
      ...fix,
      changed: true,
      previousLineCount: previousText ? countMatches(previousText, /\n/g) + 1 : 0,
      newLineCount: countMatches(baselineText, /\n/g) + 1,
    });
  }

  return applied;
};

const evaluateRegressionRisk = (before, after) => {
  const worsened = after.summary.totalFindings > before.summary.totalFindings;
  const newCommandFailures = after.summary.failedCommands > before.summary.failedCommands;

  return {
    worsened,
    newCommandFailures,
    shouldRollback: worsened || newCommandFailures,
  };
};

const buildRoundResult = (roundIndex, beforeDetection, plannedFixes, auditBefore, appliedFixes, afterDetection, auditAfter, risk, rolledBack) => ({
  round: roundIndex,
  before: beforeDetection.summary,
  findingsBefore: beforeDetection.findings,
  plannedFixes,
  auditBefore,
  appliedFixes,
  after: afterDetection.summary,
  findingsAfter: afterDetection.findings,
  auditAfter,
  risk,
  rolledBack,
});

export const runAutoDebugLoop = (options = {}) => {
  const repoPath = path.resolve(options.repoPath ?? process.cwd());
  const mode = options.mode ?? DEFAULTS.mode;
  const limits = {
    maxRounds: options.maxRounds ?? DEFAULTS.maxRounds,
    maxModifiedFiles: options.maxModifiedFiles ?? DEFAULTS.maxModifiedFiles,
    maxConsecutiveFailures: options.maxConsecutiveFailures ?? DEFAULTS.maxConsecutiveFailures,
  };

  const inspection = inspectRepo(repoPath);
  const initialDetection = runDetection(inspection);
  const report = {
    repoPath,
    mode,
    startedAt: new Date().toISOString(),
    inspection,
    initialDetection,
    rounds: [],
    finalStatus: "healthy",
    requiresManualReview: false,
    summary: [],
  };

  if (initialDetection.summary.totalFindings === 0) {
    report.summary.push("未发现显性失败，仓库当前通过基础 gate。");
  } else {
    report.summary.push(`初始发现 ${initialDetection.summary.totalFindings} 个问题。`);
  }

  if (mode === "detect-only" || initialDetection.summary.totalFindings === 0) {
    report.finalDetection = initialDetection;
    report.finalStatus = initialDetection.summary.totalFindings === 0 ? "healthy" : "issues_detected";
    report.requiresManualReview = initialDetection.summary.totalFindings > 0;
    return report;
  }

  let consecutiveFailures = 0;
  let currentDetection = initialDetection;

  for (let roundIndex = 1; roundIndex <= limits.maxRounds; roundIndex += 1) {
    const roundBeforeDetection = currentDetection;
    const plannedFixes = buildFixPlan(roundBeforeDetection.findings, limits);
    if (plannedFixes.length === 0) {
      report.summary.push("没有命中可自动修复的规则，转人工 review。");
      report.requiresManualReview = true;
      report.finalStatus = "manual_review_required";
      break;
    }

    const targetFiles = [...new Set(plannedFixes.map((fix) => fix.targetFile))];
    const backup = backupFiles(repoPath, targetFiles);
    const auditBefore = captureAuditSnapshot(repoPath, targetFiles);
    const appliedFixes = applyFixes(repoPath, plannedFixes);
    const afterDetection = runDetection(inspectRepo(repoPath));
    const auditAfter = captureAuditSnapshot(repoPath, targetFiles);
    const risk = evaluateRegressionRisk(roundBeforeDetection, afterDetection);
    let rolledBack = false;

    if (appliedFixes.length === 0) {
      consecutiveFailures += 1;
    } else if (risk.shouldRollback) {
      restoreBackup(repoPath, backup);
      rolledBack = true;
      consecutiveFailures += 1;
    } else {
      consecutiveFailures = 0;
      currentDetection = afterDetection;
    }

    report.rounds.push(
      buildRoundResult(
        roundIndex,
        roundBeforeDetection,
        plannedFixes,
        auditBefore,
        appliedFixes,
        afterDetection,
        auditAfter,
        risk,
        rolledBack,
      ),
    );

    if (!rolledBack) {
      currentDetection = afterDetection;
    }

    if (currentDetection.summary.totalFindings === 0) {
      report.finalStatus = "fixed";
      report.summary.push(`第 ${roundIndex} 轮后问题清零。`);
      break;
    }

    if (consecutiveFailures >= limits.maxConsecutiveFailures) {
      report.finalStatus = "manual_review_required";
      report.requiresManualReview = true;
      report.summary.push("自动修复连续未收敛，已停机等待人工处理。");
      break;
    }
  }

  if (!report.finalDetection) {
    report.finalDetection = runDetection(inspectRepo(repoPath));
  }

  if (report.finalDetection.summary.totalFindings > 0 && report.finalStatus === "healthy") {
    report.finalStatus = "issues_detected";
    report.requiresManualReview = true;
  }

  return report;
};

export const parseCliArgs = (argv) => {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo") {
      options.repoPath = argv[index + 1];
      index += 1;
    } else if (token === "--mode") {
      options.mode = argv[index + 1];
      index += 1;
    } else if (token === "--max-rounds") {
      options.maxRounds = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--max-modified-files") {
      options.maxModifiedFiles = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--max-consecutive-failures") {
      options.maxConsecutiveFailures = Number(argv[index + 1]);
      index += 1;
    }
  }

  return options;
};
