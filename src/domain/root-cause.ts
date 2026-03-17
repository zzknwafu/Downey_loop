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
  evidenceByLayer: Record<"retrieval" | "rerank" | "answer", string[]>,
  evidenceCaseIds: string[],
): {
  headline: string;
  summary: string[];
  attributions: AttributionRecord[];
  driverPositive: string[];
  driverNegative: string[];
  confidence: number;
} => {
  const summary: string[] = [];
  const attributions: AttributionRecord[] = [];
  let headline = "Layer metrics are stable, but case-level trace review is still recommended";
  const proxyCvrDelta = overallDeltas.find((delta) => delta.metricName === "proxy_cvr");
  const businessGoalAlignmentDelta = overallDeltas.find(
    (delta) => delta.metricName === "business_goal_alignment",
  );

  if (proxyCvrDelta) {
    const direction = proxyCvrDelta.delta >= 0 ? "上升" : "下降";
    summary.push(`实验组 proxy_cvr ${direction} ${Math.abs(proxyCvrDelta.delta * 100).toFixed(1)}%`);
  }

  const retrievalCoverageDelta = layerDeltas.find((delta) => delta.metricName === "retrieval_coverage");
  const retrievalIntentMatchDelta = layerDeltas.find(
    (delta) => delta.metricName === "retrieval_intent_match",
  );
  const stockGuardrailDelta = layerDeltas.find((delta) => delta.metricName === "stock_guardrail");
  const rerankDelta = layerDeltas.find((delta) => delta.metricName === "rerank_hit_at_k");
  const budgetGuardrailDelta = layerDeltas.find((delta) => delta.metricName === "budget_guardrail");
  const deliveryEtaGuardrailDelta = layerDeltas.find(
    (delta) => delta.metricName === "delivery_eta_guardrail",
  );
  const answerGroundednessDelta = layerDeltas.find((delta) => delta.metricName === "answer_groundedness");
  const answerConcisenessDelta = layerDeltas.find((delta) => delta.metricName === "answer_conciseness");
  const answerActionabilityDelta = layerDeltas.find((delta) => delta.metricName === "answer_actionability");
  const answerTrustworthinessDelta = layerDeltas.find(
    (delta) => delta.metricName === "answer_trustworthiness",
  );
  const proxyTrustDelta = overallDeltas.find((delta) => delta.metricName === "proxy_trust");
  const proxyDwellDelta = overallDeltas.find((delta) => delta.metricName === "proxy_dwell_time");

  if (stockGuardrailDelta && stockGuardrailDelta.delta <= -0.08) {
    headline = "Retrieval stock guardrail regression is the primary driver of overall drop";
    summary.push("主要负向驱动是 retrieval 层召回了缺货候选，破坏了有库存约束的搜索体验");
    attributions.push({
      targetMetric: "proxy_trust",
      candidateDriver: "stock_guardrail",
      layer: "retrieval",
      delta: stockGuardrailDelta.delta,
      confidence: 0.88,
      evidenceCaseIds: evidenceByLayer.retrieval,
    });
  } else if (retrievalIntentMatchDelta && retrievalIntentMatchDelta.delta <= -0.08) {
    headline = "Retrieval intent-match regression is the primary driver of overall drop";
    summary.push("主要负向驱动是 retrieval 虽然有召回，但对预算、口味、品类或时效意图的匹配变差");
    attributions.push({
      targetMetric: "business_goal_alignment",
      candidateDriver: "retrieval_intent_match",
      layer: "retrieval",
      delta: retrievalIntentMatchDelta.delta,
      confidence: 0.85,
      evidenceCaseIds: evidenceByLayer.retrieval,
    });
  } else if (retrievalCoverageDelta && retrievalCoverageDelta.delta <= -0.08) {
    headline = "Retrieval regression is the primary driver of overall drop";
    summary.push("主要负向驱动是 retrieval coverage 下降，关键候选未被稳定召回");
    attributions.push({
      targetMetric: "proxy_cvr",
      candidateDriver: "retrieval_coverage",
      layer: "retrieval",
      delta: retrievalCoverageDelta.delta,
      confidence: 0.86,
      evidenceCaseIds: evidenceByLayer.retrieval,
    });
  } else if (budgetGuardrailDelta && budgetGuardrailDelta.delta <= -0.08) {
    headline = "Rerank budget guardrail regression is the primary driver of overall drop";
    summary.push("主要负向驱动是 rerank 首位候选超预算，导致推荐结果偏离用户硬约束");
    attributions.push({
      targetMetric: "proxy_cvr",
      candidateDriver: "budget_guardrail",
      layer: "rerank",
      delta: budgetGuardrailDelta.delta,
      confidence: 0.84,
      evidenceCaseIds: evidenceByLayer.rerank,
    });
  } else if (deliveryEtaGuardrailDelta && deliveryEtaGuardrailDelta.delta <= -0.08) {
    headline = "Rerank delivery-ETA guardrail regression is the primary driver of overall drop";
    summary.push("主要负向驱动是 rerank 首位候选超出配送时效约束，影响高时效搜索场景的转化");
    attributions.push({
      targetMetric: "business_goal_alignment",
      candidateDriver: "delivery_eta_guardrail",
      layer: "rerank",
      delta: deliveryEtaGuardrailDelta.delta,
      confidence: 0.83,
      evidenceCaseIds: evidenceByLayer.rerank,
    });
  } else if (rerankDelta && rerankDelta.delta <= -0.08) {
    headline = "Rerank regression is the primary driver of overall drop";
    summary.push("主要负向驱动是 rerank hit@k 下降，优质候选未进入最终答案");
    attributions.push({
      targetMetric: "proxy_cvr",
      candidateDriver: "rerank_hit_at_k",
      layer: "rerank",
      delta: rerankDelta.delta,
      confidence: 0.82,
      evidenceCaseIds: evidenceByLayer.rerank,
    });
  } else if (
    (answerTrustworthinessDelta && answerTrustworthinessDelta.delta <= -0.08) ||
    (answerGroundednessDelta && answerGroundednessDelta.delta <= -0.08) ||
    (answerActionabilityDelta && answerActionabilityDelta.delta <= -0.08)
  ) {
    headline = "Answer regression is the primary driver of overall drop";
    summary.push("主要负向驱动是 answer 层质量下降，回答缺少依据或不利于用户决策");
    attributions.push({
      targetMetric: answerTrustworthinessDelta && answerTrustworthinessDelta.delta <= -0.08
        ? "proxy_trust"
        : "proxy_cvr",
      candidateDriver:
        answerTrustworthinessDelta && answerTrustworthinessDelta.delta <= -0.08
          ? "answer_trustworthiness"
          : answerGroundednessDelta && answerGroundednessDelta.delta <= -0.08
            ? "answer_groundedness"
            : "answer_actionability",
      layer: "answer",
      delta:
        answerTrustworthinessDelta?.delta ??
        answerGroundednessDelta?.delta ??
        answerActionabilityDelta?.delta ??
        0,
      confidence: 0.8,
      evidenceCaseIds: evidenceByLayer.answer,
    });
  } else if (proxyCvrDelta && proxyCvrDelta.delta > 0.05) {
    headline = "Candidate improves conversion proxy without a dominant regression signal";
  }

  if (answerConcisenessDelta && answerConcisenessDelta.delta <= -0.08) {
    summary.push("次要问题是答案更冗长，可能拖累停留质量和决策效率");
    attributions.push({
      targetMetric: "proxy_ctr",
      candidateDriver: "answer_conciseness",
      layer: "answer",
      delta: answerConcisenessDelta.delta,
      confidence: 0.74,
      evidenceCaseIds: evidenceByLayer.answer,
    });
  }

  if (evidenceCaseIds.length > 0) {
    summary.push(`证据样本：${evidenceCaseIds.join(", ")}`);
  }

  if (proxyTrustDelta && proxyTrustDelta.delta > 0.05) {
    summary.push("实验组的 trust proxy 上升，说明回答依据性或风险控制有所改善");
  }

  if (businessGoalAlignmentDelta && businessGoalAlignmentDelta.delta > 0.05) {
    summary.push("实验组的 business goal alignment 上升，说明点击、转化与信任目标更一致");
  }

  if (stockGuardrailDelta && stockGuardrailDelta.delta > 0.05) {
    summary.push("实验组在库存护栏上更稳，说明缺货候选被更好地拦截");
  }

  if (budgetGuardrailDelta && budgetGuardrailDelta.delta > 0.05) {
    summary.push("实验组在预算护栏上更稳，说明首位推荐更少超出预算");
  }

  if (deliveryEtaGuardrailDelta && deliveryEtaGuardrailDelta.delta > 0.05) {
    summary.push("实验组在时效护栏上更稳，说明首位推荐更少超出配送承诺");
  }

  if (proxyDwellDelta && proxyDwellDelta.delta > 0.05) {
    summary.push("实验组的 dwell proxy 上升，说明用户停留和阅读意愿更强");
  }

  if (summary.length === 0) {
    summary.push("整体差异较小，但建议继续下钻单 case 和 trace 检查层级波动");
  }

  const driverNegative = [...new Set(attributions.filter((item) => item.delta < 0).map((item) => item.candidateDriver))];
  const driverPositive = [...new Set(attributions.filter((item) => item.delta > 0).map((item) => item.candidateDriver))];
  const confidence =
    attributions.length > 0
      ? Number((attributions.reduce((sum, item) => sum + item.confidence, 0) / attributions.length).toFixed(2))
      : 0.5;

  return {
    headline,
    summary,
    attributions,
    driverPositive,
    driverNegative,
    confidence,
  };
};
