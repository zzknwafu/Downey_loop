import {
  EvalCase,
  ExperimentCaseRun,
  ExperimentRun,
  RetrievalCandidate,
  SearchPipelineVersion,
} from "./types.js";
import { evaluateSearchCase } from "./evaluators.js";

const candidate = (
  id: string,
  title: string,
  price: number,
  distanceKm: number,
  inStock = true,
): RetrievalCandidate => ({
  id,
  title,
  attributes: { price, distanceKm, inStock },
});

export const sampleCases: EvalCase[] = [
  {
    caseId: "food_001",
    domain: "food_delivery",
    taskType: "ai_search",
    userQuery: "两个人晚饭，预算 40，想吃辣但别太油",
    queryConstraints: {
      budgetMax: 40,
      maxDistanceKm: 4,
      flavor: ["spicy", "light"],
    },
    retrievalCandidates: [
      candidate("sku_a", "川香小炒双人餐", 38, 2.2),
      candidate("sku_b", "麻辣烫双人餐", 35, 1.9),
      candidate("sku_c", "炸鸡桶套餐", 42, 1.5),
      candidate("sku_d", "清汤牛肉粉", 28, 3.1),
    ],
    expectedRetrievalIds: ["sku_a", "sku_b"],
    acceptableRetrievalIds: ["sku_d"],
    expectedTopItems: ["sku_a"],
    answerReference: "推荐川香小炒双人餐，预算内，口味偏辣但不算太油，适合两个人晚饭。",
    businessOutcomeLabels: {
      wouldClick: true,
      wouldConvert: true,
      dwellLevel: "high",
      trustRisk: "low",
    },
  },
  {
    caseId: "grocery_001",
    domain: "grocery",
    taskType: "ai_search",
    userQuery: "低糖酸奶，适合孩子喝的",
    queryConstraints: {
      inStockOnly: true,
      category: ["yogurt"],
    },
    retrievalCandidates: [
      candidate("sku_y1", "儿童低糖酸奶 6 杯装", 26, 2.5),
      candidate("sku_y2", "无糖希腊酸奶", 22, 1.8),
      candidate("sku_y3", "高糖风味酸奶", 18, 2.1),
      candidate("sku_y4", "儿童奶酪棒", 30, 2.4),
    ],
    expectedRetrievalIds: ["sku_y1", "sku_y2"],
    acceptableRetrievalIds: ["sku_y4"],
    expectedTopItems: ["sku_y1"],
    answerReference: "优先推荐儿童低糖酸奶 6 杯装，低糖且更适合孩子；如果更看重配料简单，也可以考虑无糖希腊酸奶。",
    businessOutcomeLabels: {
      wouldClick: true,
      wouldConvert: true,
      dwellLevel: "medium",
      trustRisk: "low",
    },
  },
];

export const baselinePipeline: SearchPipelineVersion = {
  id: "search_pipeline_v1",
  name: "AI Search Baseline",
  version: "1.0.0",
  queryProcessor: "keyword-intent-v1",
  retriever: "hybrid-recall-v1",
  reranker: "business-rerank-v1",
  answerer: "gpt-answer-v1",
};

export const candidatePipeline: SearchPipelineVersion = {
  id: "search_pipeline_v2",
  name: "AI Search Candidate",
  version: "1.1.0",
  queryProcessor: "keyword-intent-v2",
  retriever: "hybrid-recall-v2",
  reranker: "business-rerank-v2",
  answerer: "gpt-answer-v2",
};

const buildCaseRun = (
  evalCase: EvalCase,
  targetId: string,
  retrievalResult: RetrievalCandidate[],
  rerankResult: RetrievalCandidate[],
  answerOutput: string,
  latencyMs: { retrieval: number; rerank: number; answer: number },
): ExperimentCaseRun => {
  const run: ExperimentCaseRun = {
    caseId: evalCase.caseId,
    targetId,
    trace: {
      traceId: `${targetId}_${evalCase.caseId}`,
      caseId: evalCase.caseId,
      retrievalTrace: {
        layer: "retrieval",
        latencyMs: latencyMs.retrieval,
        inputs: { userQuery: evalCase.userQuery },
        outputs: { retrievalResult },
      },
      rerankTrace: {
        layer: "rerank",
        latencyMs: latencyMs.rerank,
        inputs: { retrievalResult },
        outputs: { rerankResult },
      },
      answerTrace: {
        layer: "answer",
        latencyMs: latencyMs.answer,
        inputs: { rerankResult },
        outputs: { answerOutput },
      },
    },
    layerRuns: [
      {
        caseId: evalCase.caseId,
        layer: "retrieval",
        outputs: { retrievalResult },
      },
      {
        caseId: evalCase.caseId,
        layer: "rerank",
        outputs: { rerankResult },
      },
      {
        caseId: evalCase.caseId,
        layer: "answer",
        outputs: { answerOutput },
      },
      {
        caseId: evalCase.caseId,
        layer: "overall",
        outputs: {},
      },
    ],
    layerMetrics: [],
  };

  run.layerMetrics = evaluateSearchCase(evalCase, run);
  run.trace.layerMetrics = Object.fromEntries(
    run.layerMetrics.map((metric) => [metric.metricName, metric]),
  );
  return run;
};

export const buildSampleExperiments = (): {
  baseline: ExperimentRun;
  candidate: ExperimentRun;
} => {
  const [foodCase, groceryCase] = sampleCases;

  const baseline: ExperimentRun = {
    experimentId: "exp_baseline",
    target: baselinePipeline,
    caseRuns: [
      buildCaseRun(
        foodCase,
        baselinePipeline.id,
        [foodCase.retrievalCandidates[0]!, foodCase.retrievalCandidates[1]!, foodCase.retrievalCandidates[3]!],
        [foodCase.retrievalCandidates[0]!, foodCase.retrievalCandidates[1]!, foodCase.retrievalCandidates[3]!],
        "建议选川香小炒双人餐，38 元，口味偏辣但不算油，适合两个人晚饭。",
        { retrieval: 120, rerank: 55, answer: 220 },
      ),
      buildCaseRun(
        groceryCase,
        baselinePipeline.id,
        [groceryCase.retrievalCandidates[0]!, groceryCase.retrievalCandidates[1]!, groceryCase.retrievalCandidates[3]!],
        [groceryCase.retrievalCandidates[0]!, groceryCase.retrievalCandidates[1]!, groceryCase.retrievalCandidates[3]!],
        "优先推荐儿童低糖酸奶 6 杯装，低糖更适合孩子；如果想要更简单配料，也可以看无糖希腊酸奶。",
        { retrieval: 110, rerank: 48, answer: 190 },
      ),
    ],
  };

  const candidate: ExperimentRun = {
    experimentId: "exp_candidate",
    target: candidatePipeline,
    caseRuns: [
      buildCaseRun(
        foodCase,
        candidatePipeline.id,
        [foodCase.retrievalCandidates[1]!, foodCase.retrievalCandidates[2]!, foodCase.retrievalCandidates[3]!],
        [foodCase.retrievalCandidates[2]!, foodCase.retrievalCandidates[1]!, foodCase.retrievalCandidates[3]!],
        "这里有几种选择。我先从整体风味、热量、受欢迎程度、配送稳定性四个维度给你展开分析。第一，炸鸡桶套餐虽然 42 元略超预算，但很适合分享；第二，麻辣烫也可以考虑。",
        { retrieval: 150, rerank: 70, answer: 320 },
      ),
      buildCaseRun(
        groceryCase,
        candidatePipeline.id,
        [groceryCase.retrievalCandidates[0]!, groceryCase.retrievalCandidates[2]!, groceryCase.retrievalCandidates[3]!],
        [groceryCase.retrievalCandidates[2]!, groceryCase.retrievalCandidates[0]!, groceryCase.retrievalCandidates[3]!],
        "我给你详细分析一下。高糖风味酸奶口感会更好，儿童低糖酸奶也可以，但如果不确定口味你还可以先都看看，再结合活动价格做决定。",
        { retrieval: 135, rerank: 68, answer: 300 },
      ),
    ],
  };

  return { baseline, candidate };
};
