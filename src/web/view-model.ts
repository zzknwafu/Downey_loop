import { compareExperiments } from "../domain/comparison.js";
import { metricDefinitions } from "../domain/evaluators.js";
import { buildSampleExperiments, sampleCases } from "../domain/sample-data.js";
import { ExperimentRun, MetricResult } from "../domain/types.js";

const { baseline, candidate } = buildSampleExperiments();
const comparison = compareExperiments(baseline, candidate);

const metricMap = (metrics: MetricResult[]) =>
  new Map(metrics.map((metric) => [`${metric.layer}:${metric.metricName}`, metric]));

const groupMetrics = (experiment: ExperimentRun) => {
  const groups = new Map<string, MetricResult[]>();
  for (const caseRun of experiment.caseRuns) {
    for (const metric of caseRun.layerMetrics) {
      const key = metric.layer;
      const list = groups.get(key) ?? [];
      list.push(metric);
      groups.set(key, list);
    }
  }
  return groups;
};

export const demoViewModel = {
  baseline,
  candidate,
  comparison,
  metricDefinitions,
  sampleCases,
  groupedBaselineMetrics: groupMetrics(baseline),
  groupedCandidateMetrics: groupMetrics(candidate),
  caseDetails: sampleCases.map((evalCase) => {
    const baselineRun = baseline.caseRuns.find((run) => run.caseId === evalCase.caseId)!;
    const candidateRun = candidate.caseRuns.find((run) => run.caseId === evalCase.caseId)!;
    const baselineMetrics = metricMap(baselineRun.layerMetrics);
    const candidateMetrics = metricMap(candidateRun.layerMetrics);

    return {
      caseId: evalCase.caseId,
      title: evalCase.userQuery,
      domain: evalCase.domain,
      baselineRun,
      candidateRun,
      deltas: ["retrieval", "rerank", "answer"].map((layer) => {
        const keys = baselineRun.layerMetrics
          .filter((metric) => metric.layer === layer)
          .map((metric) => `${metric.layer}:${metric.metricName}`);

        const baselineAverage =
          keys.reduce((sum, key) => sum + Number(baselineMetrics.get(key)?.score ?? 0), 0) /
          Math.max(1, keys.length);
        const candidateAverage =
          keys.reduce((sum, key) => sum + Number(candidateMetrics.get(key)?.score ?? 0), 0) /
          Math.max(1, keys.length);

        return {
          layer,
          baselineAverage: Number(baselineAverage.toFixed(4)),
          candidateAverage: Number(candidateAverage.toFixed(4)),
          delta: Number((candidateAverage - baselineAverage).toFixed(4)),
        };
      }),
    };
  }),
};
