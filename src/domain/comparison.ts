import {
  AttributionRecord,
  ExperimentComparison,
  ExperimentRun,
  LayerName,
  MetricDelta,
  MetricResult,
} from "./types.js";

const averageByMetric = (metrics: MetricResult[]): Map<string, number> => {
  const accumulator = new Map<string, { sum: number; count: number; layer: LayerName }>();

  for (const metric of metrics) {
    if (typeof metric.score !== "number" || metric.status !== "success") {
      continue;
    }

    const key = `${metric.layer}:${metric.metricName}`;
    const current = accumulator.get(key) ?? { sum: 0, count: 0, layer: metric.layer };
    accumulator.set(key, {
      sum: current.sum + metric.score,
      count: current.count + 1,
      layer: metric.layer,
    });
  }

  const result = new Map<string, number>();
  for (const [key, value] of accumulator.entries()) {
    result.set(key, Number((value.sum / value.count).toFixed(4)));
  }
  return result;
};

const collectMetrics = (experiment: ExperimentRun): MetricResult[] =>
  experiment.caseRuns.flatMap((caseRun) => caseRun.layerMetrics);

const buildDeltas = (baseline: Map<string, number>, candidate: Map<string, number>): MetricDelta[] => {
  const keys = new Set([...baseline.keys(), ...candidate.keys()]);
  const deltas: MetricDelta[] = [];

  for (const key of keys) {
    const [layer, metricName] = key.split(":") as [LayerName, string];
    const baselineValue = baseline.get(key) ?? 0;
    const candidateValue = candidate.get(key) ?? 0;
    deltas.push({
      metricName,
      layer,
      baselineValue,
      candidateValue,
      delta: Number((candidateValue - baselineValue).toFixed(4)),
    });
  }

  return deltas;
};

const findEvidenceCases = (
  baseline: ExperimentRun,
  candidate: ExperimentRun,
  targetLayer: LayerName,
): string[] => {
  const evidence: string[] = [];

  for (const candidateRun of candidate.caseRuns) {
    const baselineRun = baseline.caseRuns.find((run) => run.caseId === candidateRun.caseId);
    if (!baselineRun) {
      continue;
    }

    const candidateMetrics = candidateRun.layerMetrics.filter((metric) => metric.layer === targetLayer);
    const baselineMetrics = baselineRun.layerMetrics.filter((metric) => metric.layer === targetLayer);

    const candidateAverage =
      candidateMetrics
        .filter((metric) => typeof metric.score === "number")
        .reduce((sum, metric) => sum + Number(metric.score), 0) /
      Math.max(1, candidateMetrics.length);
    const baselineAverage =
      baselineMetrics
        .filter((metric) => typeof metric.score === "number")
        .reduce((sum, metric) => sum + Number(metric.score), 0) /
      Math.max(1, baselineMetrics.length);

    if (candidateAverage + 0.05 < baselineAverage) {
      evidence.push(candidateRun.caseId);
    }
  }

  return evidence.slice(0, 3);
};

const buildRootCauseSummary = (
  overallDeltas: MetricDelta[],
  layerDeltas: MetricDelta[],
  evidenceCaseIds: string[],
): { summary: string[]; attributions: AttributionRecord[] } => {
  const summary: string[] = [];
  const attributions: AttributionRecord[] = [];
  const proxyCvrDelta = overallDeltas.find((delta) => delta.metricName === "proxy_cvr");

  if (proxyCvrDelta) {
    const direction = proxyCvrDelta.delta >= 0 ? "上升" : "下降";
    summary.push(`实验组 proxy_cvr ${direction} ${Math.abs(proxyCvrDelta.delta * 100).toFixed(1)}%`);
  }

  const retrievalCoverageDelta = layerDeltas.find((delta) => delta.metricName === "retrieval_coverage");
  const rerankDelta = layerDeltas.find((delta) => delta.metricName === "rerank_hit_at_3");
  const answerGroundednessDelta = layerDeltas.find((delta) => delta.metricName === "answer_groundedness");
  const answerConcisenessDelta = layerDeltas.find((delta) => delta.metricName === "answer_conciseness");
  const answerActionabilityDelta = layerDeltas.find((delta) => delta.metricName === "answer_actionability");

  if (retrievalCoverageDelta && retrievalCoverageDelta.delta <= -0.08) {
    summary.push("主要负向驱动是 retrieval coverage 下降，关键候选未被稳定召回");
    attributions.push({
      targetMetric: "proxy_cvr",
      candidateDriver: "retrieval_coverage",
      layer: "retrieval",
      delta: retrievalCoverageDelta.delta,
      confidence: 0.86,
      evidenceCaseIds,
    });
  } else if (rerankDelta && rerankDelta.delta <= -0.08) {
    summary.push("主要负向驱动是 rerank top-3 命中下降，优质候选未进入最终答案");
    attributions.push({
      targetMetric: "proxy_cvr",
      candidateDriver: "rerank_hit_at_3",
      layer: "rerank",
      delta: rerankDelta.delta,
      confidence: 0.82,
      evidenceCaseIds,
    });
  } else if (
    (answerGroundednessDelta && answerGroundednessDelta.delta <= -0.08) ||
    (answerActionabilityDelta && answerActionabilityDelta.delta <= -0.08)
  ) {
    summary.push("主要负向驱动是 answer 层质量下降，回答缺少依据或不利于用户决策");
    attributions.push({
      targetMetric: "proxy_cvr",
      candidateDriver:
        answerGroundednessDelta && answerGroundednessDelta.delta <= -0.08
          ? "answer_groundedness"
          : "answer_actionability",
      layer: "answer",
      delta: answerGroundednessDelta?.delta ?? answerActionabilityDelta?.delta ?? 0,
      confidence: 0.8,
      evidenceCaseIds,
    });
  }

  if (answerConcisenessDelta && answerConcisenessDelta.delta <= -0.08) {
    summary.push("次要问题是答案更冗长，可能拖累停留质量和决策效率");
    attributions.push({
      targetMetric: "proxy_ctr",
      candidateDriver: "answer_conciseness",
      layer: "answer",
      delta: answerConcisenessDelta.delta,
      confidence: 0.74,
      evidenceCaseIds,
    });
  }

  if (evidenceCaseIds.length > 0) {
    summary.push(`证据样本：${evidenceCaseIds.join(", ")}`);
  }

  if (summary.length === 0) {
    summary.push("整体差异较小，但建议继续下钻单 case 和 trace 检查层级波动");
  }

  return { summary, attributions };
};

export const compareExperiments = (
  baselineExperiment: ExperimentRun,
  candidateExperiment: ExperimentRun,
): ExperimentComparison => {
  const baselineMetrics = averageByMetric(collectMetrics(baselineExperiment));
  const candidateMetrics = averageByMetric(collectMetrics(candidateExperiment));
  const deltas = buildDeltas(baselineMetrics, candidateMetrics);
  const overallDeltas = deltas.filter((delta) => delta.layer === "overall");
  const layerDeltas = deltas.filter((delta) => delta.layer !== "overall");

  const retrievalEvidence = findEvidenceCases(baselineExperiment, candidateExperiment, "retrieval");
  const rerankEvidence = findEvidenceCases(baselineExperiment, candidateExperiment, "rerank");
  const answerEvidence = findEvidenceCases(baselineExperiment, candidateExperiment, "answer");
  const evidenceCaseIds = [...new Set([...retrievalEvidence, ...rerankEvidence, ...answerEvidence])];

  const { summary, attributions } = buildRootCauseSummary(overallDeltas, layerDeltas, evidenceCaseIds);

  return {
    baselineExperimentId: baselineExperiment.experimentId,
    candidateExperimentId: candidateExperiment.experimentId,
    overallDeltas,
    layerDeltas,
    rootCauseSummary: summary,
    evidenceCaseIds,
    attributionRecords: attributions,
  };
};
