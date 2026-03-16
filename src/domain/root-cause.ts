import {
  AttributionRecord,
  LayerInsight,
  LayerName,
  MetricDelta,
} from "./types.js";

const layerOrder: Array<Exclude<LayerName, "query">> = ["retrieval", "rerank", "answer", "overall"];

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
};

const strongestMetric = (
  deltas: MetricDelta[],
  direction: "negative" | "positive",
): string | undefined => {
  const sorted = [...deltas].sort((left, right) =>
    direction === "negative" ? left.delta - right.delta : right.delta - left.delta,
  );
  const winner = sorted[0];
  if (!winner) {
    return undefined;
  }

  if (direction === "negative" && winner.delta >= 0) {
    return undefined;
  }

  if (direction === "positive" && winner.delta <= 0) {
    return undefined;
  }

  return winner.metricName;
};

export const buildLayerInsights = (
  layerDeltas: MetricDelta[],
  evidenceByLayer: Record<"retrieval" | "rerank" | "answer", string[]>,
): LayerInsight[] =>
  layerOrder.map((layer) => {
    const metrics = layerDeltas.filter((delta) => delta.layer === layer);
    const averageDelta = average(metrics.map((metric) => metric.delta));
    const strongestNegativeMetric = strongestMetric(metrics, "negative");
    const strongestPositiveMetric = strongestMetric(metrics, "positive");

    let status: LayerInsight["status"] = "healthy";
    if (averageDelta <= -0.08 || strongestNegativeMetric) {
      status = "regressed";
    } else if (averageDelta < 0 || metrics.some((metric) => metric.delta < 0)) {
      status = "warning";
    }

    return {
      layer,
      status,
      averageDelta,
      strongestNegativeMetric,
      strongestPositiveMetric,
      evidenceCaseIds:
        layer === "overall"
          ? [...new Set([...evidenceByLayer.retrieval, ...evidenceByLayer.rerank, ...evidenceByLayer.answer])]
          : evidenceByLayer[layer],
    };
  });

export const buildRootCauseSummary = (
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
