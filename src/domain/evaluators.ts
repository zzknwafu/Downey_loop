import {
  EvalCase,
  Evaluator,
  ExperimentCaseRun,
  MetricDefinition,
  MetricResult,
  RetrievalCandidate,
} from "./types.js";

const asSet = (values: string[]) => new Set(values);
const normalizeToken = (value: string) => value.trim().toLowerCase();

const overlapRatio = (actual: string[], expected: string[]): number => {
  if (expected.length === 0) {
    return 1;
  }

  const actualSet = asSet(actual);
  const hitCount = expected.filter((item) => actualSet.has(item)).length;
  return hitCount / expected.length;
};

const computeNoiseRate = (actual: string[], relevant: string[]): number => {
  if (actual.length === 0) {
    return 1;
  }

  const relevantSet = asSet(relevant);
  const noiseCount = actual.filter((item) => !relevantSet.has(item)).length;
  return noiseCount / actual.length;
};

const topKHit = (actual: string[], expected: string[], k: number): number => {
  const topK = actual.slice(0, k);
  return expected.some((item) => topK.includes(item)) ? 1 : 0;
};

const top1Quality = (actual: string[], expected: string[]): number => {
  if (actual.length === 0) {
    return 0;
  }

  return expected.includes(actual[0]!) ? 1 : 0;
};

const constraintPreservation = (actual: RetrievalCandidate[], evalCase: EvalCase): number => {
  const constraints = evalCase.queryConstraints;
  if (!constraints) {
    return 1;
  }

  if (actual.length === 0) {
    return 0;
  }

  const preservedCount = actual.filter((candidate) => {
    const attrs = candidate.attributes ?? {};

    if (
      constraints.budgetMax !== undefined &&
      typeof attrs.price === "number" &&
      attrs.price > constraints.budgetMax
    ) {
      return false;
    }

    if (
      constraints.maxDistanceKm !== undefined &&
      typeof attrs.distanceKm === "number" &&
      attrs.distanceKm > constraints.maxDistanceKm
    ) {
      return false;
    }

    if (
      constraints.deliveryWithinMinutes !== undefined &&
      typeof attrs.deliveryEtaMin === "number" &&
      attrs.deliveryEtaMin > constraints.deliveryWithinMinutes
    ) {
      return false;
    }

    if (constraints.inStockOnly && attrs.inStock !== undefined && attrs.inStock !== true) {
      return false;
    }

    return true;
  }).length;

  return preservedCount / actual.length;
};

const simpleTokenSet = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[\s,.;:!?，。；：、]+/)
    .map((token) => token.trim())
    .filter(Boolean);

const lexicalOverlap = (left: string, right: string): number => {
  const leftTokens = simpleTokenSet(left);
  const rightSet = asSet(simpleTokenSet(right));

  if (leftTokens.length === 0) {
    return 0;
  }

  const hitCount = leftTokens.filter((token) => rightSet.has(token)).length;
  return hitCount / leftTokens.length;
};

const outputContainsCandidateTitle = (
  output: string,
  ids: string[],
  candidates: RetrievalCandidate[],
): boolean =>
  candidates
    .filter((candidate) => ids.includes(candidate.id))
    .some((candidate) => output.includes(candidate.title));

const average = (values: number[]) =>
  values.length === 0 ? 0 : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));

const targetClozeScore = (actual: number, target: number) =>
  Number(Math.max(0, 1 - Math.abs(actual - target)).toFixed(4));

const attributeTokenSet = (value: string | number | boolean | undefined): string[] => {
  if (typeof value === "string") {
    return value
      .split(/[,/，、]/)
      .map(normalizeToken)
      .filter(Boolean);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value).toLowerCase()];
  }

  return [];
};

const constraintMatchRatio = (actualTokens: string[], expectedTokens: string[]): number => {
  if (expectedTokens.length === 0) {
    return 1;
  }

  if (actualTokens.length === 0) {
    return 0;
  }

  const actualSet = asSet(actualTokens.map(normalizeToken));
  const hitCount = expectedTokens
    .map(normalizeToken)
    .filter((token) => actualSet.has(token)).length;
  return Number((hitCount / expectedTokens.length).toFixed(4));
};

const candidateIntentScore = (candidate: RetrievalCandidate, evalCase: EvalCase): number => {
  const constraints = evalCase.queryConstraints;
  if (!constraints) {
    return 1;
  }

  const attrs = candidate.attributes ?? {};
  const checks: number[] = [];

  if (constraints.category?.length) {
    checks.push(
      constraintMatchRatio(attributeTokenSet(attrs.category), constraints.category),
    );
  }

  if (constraints.flavor?.length) {
    checks.push(
      constraintMatchRatio(attributeTokenSet(attrs.flavorTags), constraints.flavor),
    );
  }

  if (constraints.dietary?.length) {
    checks.push(
      constraintMatchRatio(attributeTokenSet(attrs.dietaryTags), constraints.dietary),
    );
  }

  if (constraints.budgetMax !== undefined && typeof attrs.price === "number") {
    checks.push(attrs.price <= constraints.budgetMax ? 1 : 0);
  }

  if (constraints.maxDistanceKm !== undefined && typeof attrs.distanceKm === "number") {
    checks.push(attrs.distanceKm <= constraints.maxDistanceKm ? 1 : 0);
  }

  if (constraints.deliveryWithinMinutes !== undefined && typeof attrs.deliveryEtaMin === "number") {
    checks.push(attrs.deliveryEtaMin <= constraints.deliveryWithinMinutes ? 1 : 0);
  }

  if (constraints.inStockOnly) {
    checks.push(attrs.inStock === true ? 1 : 0);
  }

  return average(checks);
};

const topCandidateHardConstraintPass = (
  candidate: RetrievalCandidate | undefined,
  evalCase: EvalCase,
): number => {
  if (!candidate) {
    return 0;
  }

  return Number(constraintPreservation([candidate], evalCase).toFixed(4));
};

const cozeLoopTemplateMap: Record<
  string,
  {
    sourceTemplates: string[];
    businessRubric: string;
  }
> = {
  retrieval_coverage: {
    sourceTemplates: ["相关性"],
    businessRubric: "检查关键候选是否被稳定召回，避免搜索链路首层漏掉高转化商品。",
  },
  retrieval_intent_match: {
    sourceTemplates: ["相关性", "指令遵从度"],
    businessRubric: "检查召回结果是否真正匹配用户在预算、口味、类目、库存、时效上的明确意图。",
  },
  hard_constraint_recall: {
    sourceTemplates: ["指令遵从度"],
    businessRubric: "检查预算、库存、距离、时效等硬约束是否在召回层就被遵守。",
  },
  stock_guardrail: {
    sourceTemplates: ["Agent 任务完成度"],
    businessRubric: "检查有货约束下是否把缺货候选放进结果，避免用户走到下单前才失败。",
  },
  noise_rate: {
    sourceTemplates: ["相关性"],
    businessRubric: "衡量无关召回占比，噪声越高，后续 rerank 与 answer 越容易漂移。",
  },
  evidence_sufficiency: {
    sourceTemplates: ["深度性", "细节性"],
    businessRubric: "检查召回结果是否足够支撑最终回答，不足时应主动降级或追问。",
  },
  rerank_hit_at_k: {
    sourceTemplates: ["相关性"],
    businessRubric: "检查重排结果是否把高价值候选稳定抬进前列。",
  },
  rerank_top1_quality: {
    sourceTemplates: ["有益性", "Agent 任务完成度"],
    businessRubric: "检查首位推荐是否最适合下单，不只是勉强可用。",
  },
  constraint_preservation: {
    sourceTemplates: ["指令遵从度"],
    businessRubric: "检查 rerank 后是否仍保住预算、库存、时效等关键约束。",
  },
  budget_guardrail: {
    sourceTemplates: ["Agent 任务完成度"],
    businessRubric: "检查首位推荐是否超预算，避免高意向场景直接损失转化。",
  },
  delivery_eta_guardrail: {
    sourceTemplates: ["Agent 任务完成度"],
    businessRubric: "检查首位推荐是否违反用户明确的配送时效要求。",
  },
  preference_alignment: {
    sourceTemplates: ["有益性", "参考答案遵从度"],
    businessRubric: "检查排序是否贴近用户偏好，例如清淡、辣度、健康或大包装诉求。",
  },
  answer_correctness: {
    sourceTemplates: ["正确性"],
    businessRubric: "检查答案是否命中推荐对象与关键事实。",
  },
  answer_groundedness: {
    sourceTemplates: ["幻觉现象", "参考答案遵从度"],
    businessRubric: "检查回答是否明确锚定在真实候选结果上，而不是自由发挥。",
  },
  answer_trustworthiness: {
    sourceTemplates: ["正确性", "幻觉现象"],
    businessRubric: "检查回答是否可信，是否在事实、约束、推荐对象三方面都没有误导。",
  },
  answer_conciseness: {
    sourceTemplates: ["简洁性"],
    businessRubric: "检查回答是否短、直、可执行，不堆砌解释。",
  },
  answer_actionability: {
    sourceTemplates: ["有益性"],
    businessRubric: "检查回答是否真能帮助用户做出下单决策。",
  },
  recommendation_explanation_quality: {
    sourceTemplates: ["深度性", "细节性"],
    businessRubric: "检查推荐理由是否覆盖价格、库存、时效、规格、口味等关键信息。",
  },
  answer_top_item_consistency: {
    sourceTemplates: ["参考答案遵从度"],
    businessRubric: "检查最终回答是否和 top1 推荐保持一致，避免排序和生成脱节。",
  },
  clarification_decision: {
    sourceTemplates: ["Agent 轨迹质量"],
    businessRubric: "检查证据不足时是否应该追问，而不是硬答。",
  },
  business_goal_alignment: {
    sourceTemplates: ["有益性", "Agent 任务完成度"],
    businessRubric: "综合衡量回答是否同时对点击、转化、停留和信任目标有正向帮助。",
  },
  proxy_ctr: {
    sourceTemplates: ["有益性"],
    businessRubric: "离线代理点击意图，反映结果是否吸引用户继续浏览。",
  },
  proxy_cvr: {
    sourceTemplates: ["Agent 任务完成度", "有益性"],
    businessRubric: "离线代理转化意图，反映用户是否更可能下单。",
  },
  proxy_dwell_time: {
    sourceTemplates: ["细节性"],
    businessRubric: "离线代理停留时长，反映用户是否愿意继续阅读与比较。",
  },
  proxy_satisfaction: {
    sourceTemplates: ["有益性", "正确性"],
    businessRubric: "离线代理满意度，反映结果是否整体解决用户问题。",
  },
  proxy_trust: {
    sourceTemplates: ["幻觉现象", "正确性"],
    businessRubric: "离线代理信任度，反映用户是否愿意相信推荐并下单。",
  },
  business_guardrail_pass: {
    sourceTemplates: ["Agent 任务完成度"],
    businessRubric: "聚合预算、库存、时效、答案一致性等硬护栏，只要一项失守就判失败。",
  },
  latency: {
    sourceTemplates: ["Agent 轨迹质量"],
    businessRubric: "衡量端到端响应时延，防止高质量但不可用的慢回答。",
  },
};

export const metricDefinitions: MetricDefinition[] = [
  {
    name: "retrieval_coverage",
    layer: "retrieval",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "召回是否覆盖关键候选",
  },
  {
    name: "retrieval_intent_match",
    layer: "retrieval",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "召回是否真正命中用户意图与显式约束",
  },
  {
    name: "hard_constraint_recall",
    layer: "retrieval",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "预算、库存、距离等硬约束是否保住",
  },
  {
    name: "stock_guardrail",
    layer: "retrieval",
    metricType: "binary",
    evaluatorFamily: "model",
    description: "有库存要求时是否召回了缺货候选",
  },
  {
    name: "noise_rate",
    layer: "retrieval",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "召回中的无关项占比",
  },
  {
    name: "evidence_sufficiency",
    layer: "retrieval",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "召回结果是否足以支撑后续生成",
  },
  {
    name: "rerank_hit_at_k",
    layer: "rerank",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "正确候选是否进入 top-k",
  },
  {
    name: "rerank_top1_quality",
    layer: "rerank",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "第一推荐是否合理",
  },
  {
    name: "constraint_preservation",
    layer: "rerank",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "重排后硬约束是否仍被满足",
  },
  {
    name: "budget_guardrail",
    layer: "rerank",
    metricType: "binary",
    evaluatorFamily: "model",
    description: "有预算约束时首位候选是否超预算",
  },
  {
    name: "delivery_eta_guardrail",
    layer: "rerank",
    metricType: "binary",
    evaluatorFamily: "code",
    codeStrategy: "python_script",
    description: "有时效约束时首位候选是否超出配送时长",
  },
  {
    name: "preference_alignment",
    layer: "rerank",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "排序结果是否贴近用户偏好",
  },
  {
    name: "answer_correctness",
    layer: "answer",
    metricType: "binary",
    evaluatorFamily: "model",
    description: "答案是否正确",
  },
  {
    name: "answer_groundedness",
    layer: "answer",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "答案是否基于候选结果",
  },
  {
    name: "answer_trustworthiness",
    layer: "answer",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "答案是否可信且没有误导性业务风险",
  },
  {
    name: "answer_conciseness",
    layer: "answer",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "答案是否简洁",
  },
  {
    name: "answer_actionability",
    layer: "answer",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "答案是否帮助决策",
  },
  {
    name: "recommendation_explanation_quality",
    layer: "answer",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "推荐解释质量",
  },
  {
    name: "answer_top_item_consistency",
    layer: "answer",
    metricType: "binary",
    evaluatorFamily: "code",
    codeStrategy: "python_script",
    description: "最终答案是否与重排 top1 保持一致",
  },
  {
    name: "clarification_decision",
    layer: "answer",
    metricType: "binary",
    evaluatorFamily: "model",
    description: "信息不足时是否应主动追问",
  },
  {
    name: "proxy_ctr",
    layer: "overall",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "点击意图代理指标",
  },
  {
    name: "proxy_cvr",
    layer: "overall",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "转化意图代理指标",
  },
  {
    name: "proxy_dwell_time",
    layer: "overall",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "停留时长代理指标",
  },
  {
    name: "proxy_satisfaction",
    layer: "overall",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "满意度代理指标",
  },
  {
    name: "proxy_trust",
    layer: "overall",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "信任代理指标",
  },
  {
    name: "business_goal_alignment",
    layer: "overall",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "点击、转化、停留、信任等业务目标的综合对齐程度",
  },
  {
    name: "business_guardrail_pass",
    layer: "overall",
    metricType: "binary",
    evaluatorFamily: "code",
    codeStrategy: "python_script",
    description: "业务关键护栏是否全部通过",
  },
  {
    name: "latency",
    layer: "overall",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "整体响应时延",
  },
  {
    name: "exact_match",
    layer: "answer",
    metricType: "binary",
    evaluatorFamily: "code",
    codeStrategy: "exact_match",
    description: "精准匹配：输出与参考答案完全一致才通过",
  },
  {
    name: "regex_match",
    layer: "answer",
    metricType: "binary",
    evaluatorFamily: "code",
    codeStrategy: "regex_match",
    description: "正则匹配：输出满足指定正则表达式则通过",
  },
  {
    name: "fuzzy_match",
    layer: "answer",
    metricType: "continuous",
    evaluatorFamily: "code",
    codeStrategy: "fuzzy_match",
    description: "模糊匹配：按字符串相似度或编辑距离给分",
  },
  {
    name: "python_script",
    layer: "overall",
    metricType: "continuous",
    evaluatorFamily: "code",
    codeStrategy: "python_script",
    description: "Python 脚本：使用自定义 Python 逻辑返回分数与原因",
  },
];

const binaryResult = (
  metricName: string,
  layer: MetricResult["layer"],
  score: number,
  reason: string,
  evidence?: string[],
): MetricResult => {
  if (score !== 0 && score !== 1) {
    return {
      metricName,
      layer,
      metricType: "binary",
      score,
      status: "invalid_judgment",
      reason: `${reason}；binary 指标只能返回 0 或 1`,
      evidence,
    };
  }

  return {
    metricName,
    layer,
    metricType: "binary",
    score,
    status: "success",
    reason,
    evidence,
  };
};

export const evaluateSearchCase = (evalCase: EvalCase, run: ExperimentCaseRun): MetricResult[] => {
  const retrievalCandidates =
    (run.trace.retrievalTrace.outputs.retrievalResult as RetrievalCandidate[]) ?? [];
  const retrievalIds = retrievalCandidates.map((candidate) => candidate.id);
  const rerankCandidates = (run.trace.rerankTrace.outputs.rerankResult as RetrievalCandidate[]) ?? [];
  const rerankIds = rerankCandidates.map((candidate) => candidate.id);
  const answerOutput = String(run.trace.answerTrace.outputs.answerOutput ?? "");
  const relevantIds = [
    ...new Set([...evalCase.expectedRetrievalIds, ...evalCase.acceptableRetrievalIds]),
  ];

  const retrievalCoverage = overlapRatio(retrievalIds, evalCase.expectedRetrievalIds);
  const hardConstraintRecall = constraintPreservation(retrievalCandidates, evalCase);
  const stockGuardrailScore =
    evalCase.queryConstraints?.inStockOnly === true &&
    retrievalCandidates.some((candidate) => candidate.attributes?.inStock === false)
      ? 0
      : 1;
  const noiseRate = computeNoiseRate(retrievalIds, relevantIds);
  const evidenceSufficiency =
    retrievalCoverage >= 1 && hardConstraintRecall >= 0.8
      ? 1
      : Number(((retrievalCoverage + hardConstraintRecall) / 2).toFixed(4));

  const rerankHitAtK = topKHit(rerankIds, evalCase.expectedTopItems, 3);
  const rerankTop1 = top1Quality(rerankIds, evalCase.expectedTopItems);
  const rerankConstraintPreservation = constraintPreservation(rerankCandidates, evalCase);
  const retrievalIntentMatch = average(
    retrievalCandidates.slice(0, 3).map((candidate) => candidateIntentScore(candidate, evalCase)),
  );
  const topRerankCandidate = rerankCandidates[0];
  const topRerankPrice = Number(topRerankCandidate?.attributes?.price ?? 0);
  const budgetGuardrailScore =
    evalCase.queryConstraints?.budgetMax !== undefined &&
    (!topRerankCandidate || topRerankPrice > evalCase.queryConstraints.budgetMax)
      ? 0
      : 1;
  const topRerankEta = Number(topRerankCandidate?.attributes?.deliveryEtaMin ?? 0);
  const deliveryEtaGuardrailScore =
    evalCase.queryConstraints?.deliveryWithinMinutes !== undefined &&
    (!topRerankCandidate || topRerankEta > evalCase.queryConstraints.deliveryWithinMinutes)
      ? 0
      : 1;
  const preferenceAlignment = overlapRatio(rerankIds.slice(0, 3), evalCase.expectedTopItems);

  const lexicalCorrectness = lexicalOverlap(answerOutput, evalCase.answerReference);
  const topRerankTitle = topRerankCandidate?.title ?? "";
  const mentionsTopItem = outputContainsCandidateTitle(
    answerOutput,
    evalCase.expectedTopItems,
    rerankCandidates,
  );
  const answerTopItemConsistencyScore =
    topRerankTitle.length > 0 && answerOutput.includes(topRerankTitle) ? 1 : 0;
  const rawBinaryScore = lexicalCorrectness > 0.45 || mentionsTopItem ? 1 : 0;
  const answerCorrectness = binaryResult(
    "answer_correctness",
    "answer",
    rawBinaryScore,
    rawBinaryScore === 1 ? "答案命中参考关键信息" : "答案未命中参考关键信息",
    evalCase.expectedTopItems,
  );

  const answerGroundedness = Number(
    (
      rerankCandidates.filter((candidate) =>
        answerOutput.trim().toLowerCase().includes(candidate.title.trim().toLowerCase()),
      ).length /
      Math.max(1, Math.min(3, rerankCandidates.length))
    ).toFixed(4),
  );
  const answerConciseness = Number(
    Math.max(0, 1 - Math.max(0, answerOutput.length - 80) / 220).toFixed(4),
  );
  const answerActionability = Number(
    ((answerGroundedness + (mentionsTopItem ? 1 : 0) + (answerOutput.includes("建议") ? 1 : 0)) / 3).toFixed(4),
  );
  const explanationQuality = Number(
    ((lexicalCorrectness + answerGroundedness + answerActionability) / 3).toFixed(4),
  );
  const clarificationDecisionScore = evidenceSufficiency < 0.5 && !mentionsTopItem ? 1 : 0;
  const answerTrustworthiness = average([
    answerGroundedness,
    rawBinaryScore,
    topCandidateHardConstraintPass(topRerankCandidate, evalCase),
    answerTopItemConsistencyScore === 1 ? 1 : 0.4,
  ]);

  const proxyCtr = Number(
    ((preferenceAlignment + answerConciseness + answerGroundedness) / 3).toFixed(4),
  );
  const proxyCvr = Number(
    ((rerankHitAtK + answerActionability + explanationQuality) / 3).toFixed(4),
  );
  const proxyDwellTime = Number(
    ((answerConciseness + explanationQuality + answerActionability) / 3).toFixed(4),
  );
  const proxySatisfaction = Number(
    ((retrievalCoverage + rerankConstraintPreservation + lexicalCorrectness) / 3).toFixed(4),
  );
  const proxyTrust = average([
    answerGroundedness,
    rawBinaryScore,
    clarificationDecisionScore === 1 ? 1 : mentionsTopItem ? 1 : 0.6,
  ]);
  const businessOutcomeLabels = evalCase.businessOutcomeLabels;
  const expectedDwellScore =
    businessOutcomeLabels?.dwellLevel === "high"
      ? 0.9
      : businessOutcomeLabels?.dwellLevel === "medium"
        ? 0.6
        : businessOutcomeLabels?.dwellLevel === "low"
          ? 0.3
          : proxyDwellTime;
  const expectedTrustScore =
    businessOutcomeLabels?.trustRisk === "low"
      ? 0.9
      : businessOutcomeLabels?.trustRisk === "medium"
        ? 0.7
        : businessOutcomeLabels?.trustRisk === "high"
          ? 0.45
          : answerTrustworthiness;
  const businessGoalAlignment = average([
    businessOutcomeLabels?.wouldClick === undefined
      ? proxyCtr
      : businessOutcomeLabels.wouldClick
        ? proxyCtr
        : Number((1 - proxyCtr).toFixed(4)),
    businessOutcomeLabels?.wouldConvert === undefined
      ? proxyCvr
      : businessOutcomeLabels.wouldConvert
        ? proxyCvr
        : Number((1 - proxyCvr).toFixed(4)),
    targetClozeScore(proxyDwellTime, expectedDwellScore),
    targetClozeScore(answerTrustworthiness, expectedTrustScore),
  ]);
  const businessGuardrailPassScore = [
    stockGuardrailScore,
    budgetGuardrailScore,
    deliveryEtaGuardrailScore,
    answerTopItemConsistencyScore,
  ].every((score) => score === 1)
    ? 1
    : 0;
  const latencyMs =
    run.trace.retrievalTrace.latencyMs +
    run.trace.rerankTrace.latencyMs +
    run.trace.answerTrace.latencyMs;

  return [
    {
      metricName: "retrieval_coverage",
      layer: "retrieval",
      metricType: "continuous",
      score: Number(retrievalCoverage.toFixed(4)),
      status: "success",
      reason: "关键召回命中率",
      evidence: evalCase.expectedRetrievalIds,
    },
    {
      metricName: "retrieval_intent_match",
      layer: "retrieval",
      metricType: "continuous",
      score: retrievalIntentMatch,
      status: "success",
      reason: "召回结果对预算、类目、口味、库存、时效等用户意图的贴合度",
    },
    {
      metricName: "hard_constraint_recall",
      layer: "retrieval",
      metricType: "continuous",
      score: Number(hardConstraintRecall.toFixed(4)),
      status: "success",
      reason: "召回约束保持率",
    },
    binaryResult(
      "stock_guardrail",
      "retrieval",
      stockGuardrailScore,
      stockGuardrailScore === 1 ? "未发现缺货候选进入召回结果" : "召回结果包含缺货候选",
    ),
    {
      metricName: "noise_rate",
      layer: "retrieval",
      metricType: "continuous",
      score: Number(noiseRate.toFixed(4)),
      status: "success",
      reason: "召回噪声占比，越低越好",
    },
    {
      metricName: "evidence_sufficiency",
      layer: "retrieval",
      metricType: "continuous",
      score: evidenceSufficiency,
      status: "success",
      reason: "召回结果是否足以支撑生成",
    },
    {
      metricName: "rerank_hit_at_k",
      layer: "rerank",
      metricType: "continuous",
      score: rerankHitAtK,
      status: "success",
      reason: "top-k 命中关键候选情况",
      evidence: evalCase.expectedTopItems,
    },
    {
      metricName: "rerank_top1_quality",
      layer: "rerank",
      metricType: "continuous",
      score: rerankTop1,
      status: "success",
      reason: "首位候选是否合理",
    },
    {
      metricName: "constraint_preservation",
      layer: "rerank",
      metricType: "continuous",
      score: Number(rerankConstraintPreservation.toFixed(4)),
      status: "success",
      reason: "重排后保留硬约束能力",
    },
    binaryResult(
      "budget_guardrail",
      "rerank",
      budgetGuardrailScore,
      budgetGuardrailScore === 1 ? "首位候选未超预算" : "首位候选超出预算约束",
    ),
    binaryResult(
      "delivery_eta_guardrail",
      "rerank",
      deliveryEtaGuardrailScore,
      deliveryEtaGuardrailScore === 1 ? "首位候选满足配送时效要求" : "首位候选超出配送时效约束",
    ),
    {
      metricName: "preference_alignment",
      layer: "rerank",
      metricType: "continuous",
      score: Number(preferenceAlignment.toFixed(4)),
      status: "success",
      reason: "重排是否贴近用户偏好",
    },
    answerCorrectness,
    {
      metricName: "answer_groundedness",
      layer: "answer",
      metricType: "continuous",
      score: answerGroundedness,
      status: "success",
      reason: "答案是否引用重排后候选",
    },
    {
      metricName: "answer_trustworthiness",
      layer: "answer",
      metricType: "continuous",
      score: answerTrustworthiness,
      status: "success",
      reason: "答案在事实、约束和推荐对象上的可信度",
    },
    {
      metricName: "answer_conciseness",
      layer: "answer",
      metricType: "continuous",
      score: answerConciseness,
      status: "success",
      reason: "答案长度与简洁度",
    },
    {
      metricName: "answer_actionability",
      layer: "answer",
      metricType: "continuous",
      score: answerActionability,
      status: "success",
      reason: "答案是否帮助用户决策",
    },
    {
      metricName: "recommendation_explanation_quality",
      layer: "answer",
      metricType: "continuous",
      score: explanationQuality,
      status: "success",
      reason: "推荐解释质量",
    },
    binaryResult(
      "answer_top_item_consistency",
      "answer",
      answerTopItemConsistencyScore,
      answerTopItemConsistencyScore === 1 ? "答案与重排 top1 推荐保持一致" : "答案未明确承接重排 top1 推荐",
      topRerankTitle ? [topRerankTitle] : undefined,
    ),
    binaryResult(
      "clarification_decision",
      "answer",
      clarificationDecisionScore,
      clarificationDecisionScore === 1 ? "当前证据不足，系统应主动追问" : "当前证据足够，系统可直接回答",
    ),
    {
      metricName: "proxy_ctr",
      layer: "overall",
      metricType: "continuous",
      score: proxyCtr,
      status: "success",
      reason: "点击意图离线代理指标",
    },
    {
      metricName: "proxy_cvr",
      layer: "overall",
      metricType: "continuous",
      score: proxyCvr,
      status: "success",
      reason: "转化意图离线代理指标",
    },
    {
      metricName: "proxy_dwell_time",
      layer: "overall",
      metricType: "continuous",
      score: proxyDwellTime,
      status: "success",
      reason: "停留时长离线代理指标",
    },
    {
      metricName: "proxy_satisfaction",
      layer: "overall",
      metricType: "continuous",
      score: proxySatisfaction,
      status: "success",
      reason: "满意度离线代理指标",
    },
    {
      metricName: "proxy_trust",
      layer: "overall",
      metricType: "continuous",
      score: proxyTrust,
      status: "success",
      reason: "用户信任离线代理指标",
    },
    {
      metricName: "business_goal_alignment",
      layer: "overall",
      metricType: "continuous",
      score: businessGoalAlignment,
      status: "success",
      reason: "对点击、转化、停留和信任业务目标的综合对齐程度",
    },
    binaryResult(
      "business_guardrail_pass",
      "overall",
      businessGuardrailPassScore,
      businessGuardrailPassScore === 1
        ? "预算、库存、时效和答案一致性等关键护栏全部通过"
        : "至少一项关键业务护栏失败",
    ),
    {
      metricName: "latency",
      layer: "overall",
      metricType: "continuous",
      score: latencyMs,
      status: "success",
      reason: "整体响应时延",
    },
  ];
};

export const builtInEvaluators: Evaluator[] = metricDefinitions.map((metric) => ({
  id: `eval_${metric.name}`,
  name: metric.name,
  layer: metric.layer,
  family: metric.evaluatorFamily,
  metricType: metric.metricType,
  version: "0.3.0",
  description: metric.description,
  config:
    metric.evaluatorFamily === "code"
      ? {
          judgeType: "code",
          domainScope: ["food_delivery", "grocery"],
          strategy: metric.codeStrategy ?? "python_script",
          ruleName: metric.name,
          cozeLoopSourceTemplates: cozeLoopTemplateMap[metric.name]?.sourceTemplates ?? [],
          businessRubric: cozeLoopTemplateMap[metric.name]?.businessRubric ?? metric.description,
        }
      : {
          judgeType: "llm",
          domainScope: ["food_delivery", "grocery"],
          rubric: metric.description,
          strictBinary: metric.metricType === "binary",
          cozeLoopSourceTemplates: cozeLoopTemplateMap[metric.name]?.sourceTemplates ?? [],
          businessRubric: cozeLoopTemplateMap[metric.name]?.businessRubric ?? metric.description,
        },
  codeStrategy: metric.codeStrategy,
}));

const normalizeValue = (value: string) => value.trim().toLowerCase();

const diceCoefficient = (left: string, right: string): number => {
  const leftValue = normalizeValue(left);
  const rightValue = normalizeValue(right);

  if (!leftValue.length || !rightValue.length) {
    return 0;
  }

  const bigrams = (input: string) => {
    const result = new Map<string, number>();
    for (let index = 0; index < input.length - 1; index += 1) {
      const token = input.slice(index, index + 2);
      result.set(token, (result.get(token) ?? 0) + 1);
    }
    return result;
  };

  const leftPairs = bigrams(leftValue);
  const rightPairs = bigrams(rightValue);
  let intersection = 0;

  for (const [token, count] of leftPairs.entries()) {
    if (!rightPairs.has(token)) {
      continue;
    }
    intersection += Math.min(count, rightPairs.get(token) ?? 0);
  }

  return Number(((2 * intersection) / Math.max(1, leftValue.length + rightValue.length - 2)).toFixed(4));
};

export const runCodeEvaluator = (
  strategy: NonNullable<Evaluator["codeStrategy"]>,
  output: string,
  reference: string,
  config: Record<string, unknown> = {},
): MetricResult => {
  if (strategy === "exact_match") {
    const score = normalizeValue(output) === normalizeValue(reference) ? 1 : 0;
    return {
      metricName: "exact_match",
      layer: "answer",
      metricType: "binary",
      score,
      status: "success",
      reason: score === 1 ? "输出与参考答案完全一致" : "输出与参考答案不一致",
    };
  }

  if (strategy === "regex_match") {
    const pattern = String(config.pattern ?? reference);
    const flags = String(config.flags ?? "");
    const matched = new RegExp(pattern, flags).test(output);
    return {
      metricName: "regex_match",
      layer: "answer",
      metricType: "binary",
      score: matched ? 1 : 0,
      status: "success",
      reason: matched ? "输出命中正则规则" : "输出未命中正则规则",
    };
  }

  if (strategy === "fuzzy_match") {
    const score = diceCoefficient(output, reference);
    return {
      metricName: "fuzzy_match",
      layer: "answer",
      metricType: "continuous",
      score,
      status: "success",
      reason: "按字符串相似度计算模糊匹配分数",
    };
  }

  return {
    metricName: "python_script",
    layer: "answer",
    metricType: "continuous",
    score: 0,
    status: "runtime_error",
    reason:
      "Python script 评估需要在后端 runner / integration 层执行，前端共享 contract 仅保留该评估器类型定义。",
  };
};
