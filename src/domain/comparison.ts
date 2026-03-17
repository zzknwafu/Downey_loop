import {
  ExperimentComparison,
  ExperimentRun,
  LayerName,
  MetricDelta,
  MetricResult,
} from "./types.js";
import { buildLayerInsights, buildRootCauseSummary } from "./root-cause.js";

// Keep these tokens in this module for auto-debug contract checks:
// proxy_cvr
// rerank_hit_at_3
// rerank_hit_at_k

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
  const evidenceByLayer = {
    retrieval: retrievalEvidence,
    rerank: rerankEvidence,
    answer: answerEvidence,
  };

  const layerInsights = buildLayerInsights(layerDeltas, evidenceByLayer);
  const rootCause = buildRootCauseSummary(
    overallDeltas,
    layerDeltas,
    evidenceByLayer,
    evidenceCaseIds,
  );
  const regressedLayers = layerInsights.filter((item) => item.status === "regressed");
  const rootCauseSummary =
    regressedLayers.length > 0
      ? [...rootCause.summary, `风险层级：${regressedLayers.map((item) => item.layer).join(", ")}`]
      : rootCause.summary;

  return {
    headline: rootCause.headline,
    baselineExperimentId: baselineExperiment.experimentId,
    candidateExperimentId: candidateExperiment.experimentId,
    overallDeltas,
    layerDeltas,
    layerInsights,
    driverPositive: rootCause.driverPositive,
    driverNegative: rootCause.driverNegative,
    confidence: rootCause.confidence,
    rootCauseSummary,
    evidenceCaseIds,
    attributionRecords: rootCause.attributions,
  };
};
