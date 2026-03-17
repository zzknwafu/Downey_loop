import {
  AgentVersion,
  Dataset,
  DatasetColumn,
  EvalCase,
  ExperimentRun,
  PipelineExecutionResult,
  PromptVersion,
  RetrievalCandidate,
  SearchPipelineVersion,
} from "./types.js";
import { buildExperimentCaseRun, summarizeExperimentRun } from "./experiment.js";
import { builtInEvaluators } from "./evaluators.js";
import { toTargetRef, toTargetSelection } from "./targets.js";

const now = "2026-03-17T00:00:00.000Z";
const primaryDatasetId = "dataset_ai_search_core_001";

const datasetColumns: Record<Dataset["datasetType"], DatasetColumn[]> = {
  ideal_output: [
    {
      name: "input",
      dataType: "String",
      required: true,
      description: "评测对象的输入内容",
    },
    {
      name: "reference_output",
      dataType: "String",
      required: false,
      description: "理想输出，可作为参考标准",
    },
    {
      name: "context",
      dataType: "JSON",
      required: false,
      description: "补充上下文、业务标签或召回候选",
    },
  ],
  workflow: [
    {
      name: "input",
      dataType: "String",
      required: true,
      description: "工作流原始输入",
    },
    {
      name: "workflow_output",
      dataType: "JSON",
      required: true,
      description: "工作流最终输出",
    },
    {
      name: "expected_steps",
      dataType: "JSON",
      required: false,
      description: "期望的步骤列表",
    },
  ],
  trace_monitor: [
    {
      name: "trace_id",
      dataType: "String",
      required: true,
      description: "trace 唯一标识",
    },
    {
      name: "final_output",
      dataType: "String",
      required: true,
      description: "最终输出",
    },
    {
      name: "trajectory",
      dataType: "JSON",
      required: false,
      description: "轨迹与工具调用详情",
    },
  ],
};

const candidate = (
  id: string,
  title: string,
  attributes: Record<string, string | number | boolean>,
): RetrievalCandidate => ({
  id,
  title,
  attributes,
});

const foodSearchCases: EvalCase[] = [
  {
    caseId: "food_001",
    domain: "food_delivery",
    taskType: "ai_search",
    userQuery: "两个人晚饭，预算 40，想吃辣但别太油",
    queryConstraints: {
      budgetMax: 40,
      maxDistanceKm: 4,
      flavor: ["spicy", "light"],
      category: ["stir_fry", "soup"],
    },
    retrievalCandidates: [
      candidate("sku_a", "川香小炒双人餐", {
        price: 38,
        distanceKm: 2.2,
        deliveryEtaMin: 32,
        inStock: true,
        category: "stir_fry",
        flavorTags: "spicy,light",
      }),
      candidate("sku_b", "麻辣烫双人餐", {
        price: 35,
        distanceKm: 1.9,
        deliveryEtaMin: 28,
        inStock: true,
        category: "soup",
        flavorTags: "spicy",
      }),
      candidate("sku_c", "炸鸡桶套餐", {
        price: 42,
        distanceKm: 1.5,
        deliveryEtaMin: 24,
        inStock: true,
        category: "fried_chicken",
        flavorTags: "crispy,heavy",
      }),
      candidate("sku_d", "清汤牛肉粉", {
        price: 28,
        distanceKm: 3.1,
        deliveryEtaMin: 26,
        inStock: true,
        category: "soup",
        flavorTags: "light",
      }),
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
    caseId: "food_002",
    domain: "food_delivery",
    taskType: "ai_search",
    userQuery: "一个人午饭，30 元内，30 分钟送到，想吃热汤面",
    queryConstraints: {
      budgetMax: 30,
      maxDistanceKm: 3,
      deliveryWithinMinutes: 30,
      category: ["noodles"],
      flavor: ["hot", "light"],
    },
    retrievalCandidates: [
      candidate("sku_f2_a", "兰州牛肉面", {
        price: 28,
        distanceKm: 2.1,
        deliveryEtaMin: 24,
        inStock: true,
        category: "noodles",
        flavorTags: "hot,light",
      }),
      candidate("sku_f2_b", "番茄肥牛米线", {
        price: 29,
        distanceKm: 2.8,
        deliveryEtaMin: 29,
        inStock: true,
        category: "noodles",
        flavorTags: "hot",
      }),
      candidate("sku_f2_c", "寿司拼盘", {
        price: 26,
        distanceKm: 1.5,
        deliveryEtaMin: 20,
        inStock: true,
        category: "sushi",
        flavorTags: "cold",
      }),
      candidate("sku_f2_d", "麻辣香锅", {
        price: 32,
        distanceKm: 2.0,
        deliveryEtaMin: 35,
        inStock: true,
        category: "stir_fry",
        flavorTags: "spicy,hot",
      }),
    ],
    expectedRetrievalIds: ["sku_f2_a", "sku_f2_b"],
    acceptableRetrievalIds: [],
    expectedTopItems: ["sku_f2_a"],
    answerReference: "推荐兰州牛肉面，30 元内且 30 分钟左右能送到，符合想吃热汤面的需求。",
    businessOutcomeLabels: {
      wouldClick: true,
      wouldConvert: true,
      dwellLevel: "medium",
      trustRisk: "low",
    },
  },
  {
    caseId: "food_003",
    domain: "food_delivery",
    taskType: "ai_search",
    userQuery: "夜宵想吃烧烤，不要太辣，离我近一点",
    queryConstraints: {
      budgetMax: 60,
      maxDistanceKm: 2.5,
      deliveryWithinMinutes: 35,
      category: ["bbq"],
      flavor: ["mild"],
    },
    retrievalCandidates: [
      candidate("sku_f3_a", "双人轻辣烧烤拼盘", {
        price: 58,
        distanceKm: 1.3,
        deliveryEtaMin: 30,
        inStock: true,
        category: "bbq",
        flavorTags: "mild",
      }),
      candidate("sku_f3_b", "孜然鸡翅玉米组合", {
        price: 46,
        distanceKm: 2.1,
        deliveryEtaMin: 28,
        inStock: true,
        category: "bbq",
        flavorTags: "mild,smoky",
      }),
      candidate("sku_f3_c", "麻辣烤鱼", {
        price: 72,
        distanceKm: 2.4,
        deliveryEtaMin: 34,
        inStock: true,
        category: "grilled_fish",
        flavorTags: "spicy",
      }),
      candidate("sku_f3_d", "蒜香小龙虾", {
        price: 88,
        distanceKm: 1.8,
        deliveryEtaMin: 40,
        inStock: true,
        category: "seafood",
        flavorTags: "garlic",
      }),
    ],
    expectedRetrievalIds: ["sku_f3_a", "sku_f3_b"],
    acceptableRetrievalIds: [],
    expectedTopItems: ["sku_f3_a"],
    answerReference: "推荐双人轻辣烧烤拼盘，离你近、配送快，而且不会太辣，适合作为夜宵。",
    businessOutcomeLabels: {
      wouldClick: true,
      wouldConvert: true,
      dwellLevel: "high",
      trustRisk: "low",
    },
  },
  {
    caseId: "food_004",
    domain: "food_delivery",
    taskType: "ai_search",
    userQuery: "健身后想吃高蛋白轻食，预算 45",
    queryConstraints: {
      budgetMax: 45,
      maxDistanceKm: 4,
      dietary: ["high_protein"],
      flavor: ["light"],
      category: ["salad", "bowl"],
    },
    retrievalCandidates: [
      candidate("sku_f4_a", "香煎鸡胸能量碗", {
        price: 42,
        distanceKm: 3.2,
        deliveryEtaMin: 31,
        inStock: true,
        category: "bowl",
        flavorTags: "light",
        dietaryTags: "high_protein",
      }),
      candidate("sku_f4_b", "牛肉藜麦沙拉", {
        price: 44,
        distanceKm: 2.5,
        deliveryEtaMin: 26,
        inStock: true,
        category: "salad",
        flavorTags: "light",
        dietaryTags: "high_protein,low_fat",
      }),
      candidate("sku_f4_c", "芝士培根意面", {
        price: 39,
        distanceKm: 2.7,
        deliveryEtaMin: 23,
        inStock: true,
        category: "pasta",
        flavorTags: "creamy",
        dietaryTags: "high_carb",
      }),
      candidate("sku_f4_d", "炸鸡全家桶", {
        price: 45,
        distanceKm: 3.0,
        deliveryEtaMin: 25,
        inStock: true,
        category: "fried_chicken",
        flavorTags: "crispy",
        dietaryTags: "fried",
      }),
    ],
    expectedRetrievalIds: ["sku_f4_a", "sku_f4_b"],
    acceptableRetrievalIds: [],
    expectedTopItems: ["sku_f4_a"],
    answerReference: "推荐香煎鸡胸能量碗，高蛋白又比较清爽，预算也在 45 元以内。",
    businessOutcomeLabels: {
      wouldClick: true,
      wouldConvert: true,
      dwellLevel: "medium",
      trustRisk: "low",
    },
  },
];

const grocerySearchCases: EvalCase[] = [
  {
    caseId: "grocery_001",
    domain: "grocery",
    taskType: "ai_search",
    userQuery: "低糖酸奶，适合孩子喝的",
    queryConstraints: {
      inStockOnly: true,
      category: ["yogurt"],
      dietary: ["low_sugar"],
    },
    retrievalCandidates: [
      candidate("sku_y1", "儿童低糖酸奶 6 杯装", {
        price: 26,
        distanceKm: 2.5,
        deliveryEtaMin: 42,
        inStock: true,
        category: "yogurt",
        dietaryTags: "low_sugar",
        audience: "kids",
      }),
      candidate("sku_y2", "无糖希腊酸奶", {
        price: 22,
        distanceKm: 1.8,
        deliveryEtaMin: 35,
        inStock: true,
        category: "yogurt",
        dietaryTags: "no_sugar",
        audience: "general",
      }),
      candidate("sku_y3", "高糖风味酸奶", {
        price: 18,
        distanceKm: 2.1,
        deliveryEtaMin: 33,
        inStock: true,
        category: "yogurt",
        dietaryTags: "high_sugar",
        audience: "general",
      }),
      candidate("sku_y4", "儿童奶酪棒", {
        price: 30,
        distanceKm: 2.4,
        deliveryEtaMin: 40,
        inStock: true,
        category: "snack",
        dietaryTags: "high_protein",
        audience: "kids",
      }),
    ],
    expectedRetrievalIds: ["sku_y1", "sku_y2"],
    acceptableRetrievalIds: ["sku_y4"],
    expectedTopItems: ["sku_y1"],
    answerReference:
      "优先推荐儿童低糖酸奶 6 杯装，低糖且更适合孩子；如果更看重配料简单，也可以考虑无糖希腊酸奶。",
    businessOutcomeLabels: {
      wouldClick: true,
      wouldConvert: true,
      dwellLevel: "medium",
      trustRisk: "low",
    },
  },
  {
    caseId: "grocery_002",
    domain: "grocery",
    taskType: "ai_search",
    userQuery: "今晚做火锅，想买牛羊肉和生菜，1 小时内送到",
    queryConstraints: {
      inStockOnly: true,
      deliveryWithinMinutes: 60,
      category: ["hotpot"],
    },
    retrievalCandidates: [
      candidate("sku_g2_a", "火锅肥牛卷", {
        price: 39,
        distanceKm: 3.4,
        deliveryEtaMin: 38,
        inStock: true,
        category: "hotpot",
      }),
      candidate("sku_g2_b", "新鲜生菜", {
        price: 8,
        distanceKm: 2.8,
        deliveryEtaMin: 35,
        inStock: true,
        category: "hotpot",
      }),
      candidate("sku_g2_c", "精品羊肉卷", {
        price: 42,
        distanceKm: 4.1,
        deliveryEtaMin: 55,
        inStock: true,
        category: "hotpot",
      }),
      candidate("sku_g2_d", "冷冻披萨", {
        price: 29,
        distanceKm: 1.9,
        deliveryEtaMin: 24,
        inStock: true,
        category: "frozen",
      }),
    ],
    expectedRetrievalIds: ["sku_g2_a", "sku_g2_b", "sku_g2_c"],
    acceptableRetrievalIds: [],
    expectedTopItems: ["sku_g2_a", "sku_g2_b"],
    answerReference: "优先把火锅肥牛卷和新鲜生菜加入购物车，1 小时内可以送到；如果还想补羊肉，也可以加精品羊肉卷。",
    businessOutcomeLabels: {
      wouldClick: true,
      wouldConvert: true,
      dwellLevel: "high",
      trustRisk: "low",
    },
  },
  {
    caseId: "grocery_003",
    domain: "grocery",
    taskType: "ai_search",
    userQuery: "早餐想买全麦面包和无糖豆浆",
    queryConstraints: {
      inStockOnly: true,
      category: ["breakfast"],
      dietary: ["whole_grain", "no_added_sugar"],
    },
    retrievalCandidates: [
      candidate("sku_g3_a", "全麦切片面包", {
        price: 14,
        distanceKm: 1.6,
        deliveryEtaMin: 26,
        inStock: true,
        category: "breakfast",
        dietaryTags: "whole_grain",
      }),
      candidate("sku_g3_b", "无糖豆浆 2 瓶装", {
        price: 12,
        distanceKm: 1.4,
        deliveryEtaMin: 22,
        inStock: true,
        category: "breakfast",
        dietaryTags: "no_added_sugar",
      }),
      candidate("sku_g3_c", "奶油夹心面包", {
        price: 11,
        distanceKm: 1.2,
        deliveryEtaMin: 18,
        inStock: true,
        category: "dessert",
        dietaryTags: "high_sugar",
      }),
      candidate("sku_g3_d", "含糖豆奶饮料", {
        price: 9,
        distanceKm: 1.3,
        deliveryEtaMin: 19,
        inStock: true,
        category: "beverage",
        dietaryTags: "high_sugar",
      }),
    ],
    expectedRetrievalIds: ["sku_g3_a", "sku_g3_b"],
    acceptableRetrievalIds: [],
    expectedTopItems: ["sku_g3_a", "sku_g3_b"],
    answerReference: "推荐全麦切片面包和无糖豆浆 2 瓶装，刚好满足早餐的全麦和低糖需求。",
    businessOutcomeLabels: {
      wouldClick: true,
      wouldConvert: true,
      dwellLevel: "medium",
      trustRisk: "low",
    },
  },
  {
    caseId: "grocery_004",
    domain: "grocery",
    taskType: "ai_search",
    userQuery: "给宝宝买 XL 纸尿裤，要大包装，别缺货",
    queryConstraints: {
      inStockOnly: true,
      category: ["baby_care"],
    },
    retrievalCandidates: [
      candidate("sku_g4_a", "婴儿拉拉裤 XL 64 片", {
        price: 129,
        distanceKm: 2.2,
        deliveryEtaMin: 36,
        inStock: true,
        category: "baby_care",
      }),
      candidate("sku_g4_b", "婴儿纸尿裤 XL 52 片", {
        price: 109,
        distanceKm: 2.4,
        deliveryEtaMin: 32,
        inStock: true,
        category: "baby_care",
      }),
      candidate("sku_g4_c", "婴儿湿巾 20 包", {
        price: 39,
        distanceKm: 1.8,
        deliveryEtaMin: 28,
        inStock: true,
        category: "baby_care",
      }),
      candidate("sku_g4_d", "婴儿拉拉裤 XL 32 片", {
        price: 72,
        distanceKm: 2.0,
        deliveryEtaMin: 29,
        inStock: false,
        category: "baby_care",
      }),
    ],
    expectedRetrievalIds: ["sku_g4_a", "sku_g4_b"],
    acceptableRetrievalIds: ["sku_g4_c"],
    expectedTopItems: ["sku_g4_a"],
    answerReference: "优先推荐婴儿拉拉裤 XL 64 片，大包装且有货；如果想稍微便宜一点，也可以看婴儿纸尿裤 XL 52 片。",
    businessOutcomeLabels: {
      wouldClick: true,
      wouldConvert: true,
      dwellLevel: "high",
      trustRisk: "low",
    },
  },
];

export const sampleCases: EvalCase[] = [...foodSearchCases, ...grocerySearchCases];

const caseById = new Map(sampleCases.map((item) => [item.caseId, item]));

const pickCases = (...caseIds: string[]): EvalCase[] =>
  caseIds.map((caseId) => {
    const match = caseById.get(caseId);
    if (!match) {
      throw new Error(`Missing sample case ${caseId}`);
    }
    return match;
  });

export const sampleDatasets: Dataset[] = [
  {
    id: primaryDatasetId,
    name: "外卖与商超 AI 搜综合理想输出集",
    description: "覆盖外卖和商超 AI 搜索主链路的综合模拟数据集。",
    datasetType: "ideal_output",
    schema: datasetColumns.ideal_output,
    cases: sampleCases,
    version: "0.2.0",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "dataset_food_search_001",
    name: "外卖 AI 搜专项集",
    description: "聚焦预算、配送时效、口味与轻食诉求的外卖搜索样本。",
    datasetType: "ideal_output",
    schema: datasetColumns.ideal_output,
    cases: foodSearchCases,
    version: "0.2.0",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "dataset_grocery_search_001",
    name: "商超 AI 搜专项集",
    description: "聚焦库存、品类、健康诉求与家庭购物意图的商超搜索样本。",
    datasetType: "ideal_output",
    schema: datasetColumns.ideal_output,
    cases: grocerySearchCases,
    version: "0.2.0",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "dataset_guardrail_001",
    name: "AI 搜业务护栏专项集",
    description: "聚焦预算、库存、时效和推荐可信度的高风险模拟样本。",
    datasetType: "ideal_output",
    schema: datasetColumns.ideal_output,
    cases: [foodSearchCases[1]!, foodSearchCases[3]!, grocerySearchCases[0]!, grocerySearchCases[3]!],
    version: "0.2.0",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "dataset_retrieval_intent_001",
    name: "AI 搜意图命中评估集",
    description:
      "按 retrieval evaluator 场景组织，覆盖预算、口味、类目、低糖、高蛋白等显式意图与硬约束。",
    datasetType: "ideal_output",
    schema: datasetColumns.ideal_output,
    cases: pickCases("food_001", "food_004", "grocery_001", "grocery_003"),
    version: "0.3.0",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "dataset_rerank_guardrail_001",
    name: "AI 搜排序护栏评估集",
    description:
      "按 rerank evaluator 场景组织，重点验证 top-k、预算护栏、时效护栏、库存约束和偏好保持。",
    datasetType: "ideal_output",
    schema: datasetColumns.ideal_output,
    cases: pickCases("food_002", "food_003", "grocery_002", "grocery_004"),
    version: "0.3.0",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "dataset_answer_trust_001",
    name: "AI 搜答案可信度评估集",
    description:
      "按 answer evaluator 场景组织，聚焦正确性、基于候选作答、答案与 top1 一致性、是否需要追问。",
    datasetType: "ideal_output",
    schema: datasetColumns.ideal_output,
    cases: pickCases("food_001", "food_002", "grocery_001", "grocery_004"),
    version: "0.3.0",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "dataset_business_goal_001",
    name: "AI 搜业务目标对齐评估集",
    description:
      "按 overall evaluator 场景组织，验证点击、转化、停留、信任及关键业务护栏的综合表现。",
    datasetType: "ideal_output",
    schema: datasetColumns.ideal_output,
    cases: pickCases("food_001", "food_003", "grocery_002", "grocery_004"),
    version: "0.3.0",
    createdAt: now,
    updatedAt: now,
  },
];

export const sampleEvaluators = builtInEvaluators;

const businessPrompts: PromptVersion[] = [
  {
    id: "prompt_food_search_v1",
    name: "外卖搜索回答 Prompt",
    version: "1.0.0",
    description: "强调预算、时效和口味约束的简洁回答模板。",
    systemPrompt:
      "你是外卖 AI 搜索助手。必须优先满足预算、时效和口味约束，用简洁可执行的中文给出推荐。",
    userTemplate:
      "用户问题：{{input}}\n候选结果：{{retrieval_candidates}}\n请基于候选结果给出推荐理由，并避免虚构信息。",
    inputSchema: {
      input: "string",
      retrieval_candidates: "json",
    },
  },
  {
    id: "prompt_grocery_search_v1",
    name: "商超搜索回答 Prompt",
    version: "1.0.0",
    description: "强调库存、规格和家庭购物诉求的推荐模板。",
    systemPrompt:
      "你是商超 AI 导购助手。优先满足库存、规格、时效和健康诉求，用可信、直接的中文给出推荐。",
    userTemplate:
      "用户问题：{{input}}\n候选结果：{{retrieval_candidates}}\n请基于候选结果生成最终回答，必要时指出备选。",
    inputSchema: {
      input: "string",
      retrieval_candidates: "json",
    },
  },
];

const migratedCozeLoopEvaluatorPrompts: PromptVersion[] = [
  {
    id: "prompt_eval_correctness_coze_v1",
    name: "Coze Loop 正确性评估 Prompt",
    version: "1.0.0-coze",
    description: "迁移自 Coze Loop evaluator template「正确性」，用于评估答案准确性与完整性。",
    systemPrompt:
      "你是一位专业的数据标注员，负责评估模型输出的正确性。请重点检查事实准确性、信息完整性、逻辑一致性与术语是否精确，只基于输入、输出与参考答案作判断。",
    userTemplate:
      "<input>\n{{input}}\n</input>\n\n<output>\n{{output}}\n</output>\n\n<reference_output>\n{{reference_output}}\n</reference_output>\n\n请输出结构化评估结果：score 和 reasoning。",
    inputSchema: {
      input: "string",
      output: "string",
      reference_output: "string",
    },
  },
  {
    id: "prompt_eval_hallucination_coze_v1",
    name: "Coze Loop 幻觉现象评估 Prompt",
    version: "1.0.0-coze",
    description: "迁移自 Coze Loop evaluator template「幻觉现象」，用于评估回答是否脱离候选或上下文。",
    systemPrompt:
      "你是一位专业的数据标注员，负责评估模型输出是否存在幻觉现象。请核对回答中的每个关键事实是否都能被上下文、候选结果或参考答案支持。",
    userTemplate:
      "<context>\n{{context}}\n</context>\n\n<input>\n{{input}}\n</input>\n\n<output>\n{{output}}\n</output>\n\n<reference_output>\n{{reference_output}}\n</reference_output>\n\n请输出结构化评估结果：score 和 reasoning。",
    inputSchema: {
      context: "string",
      input: "string",
      output: "string",
      reference_output: "string",
    },
  },
  {
    id: "prompt_eval_conciseness_coze_v1",
    name: "Coze Loop 简洁性评估 Prompt",
    version: "1.0.0-coze",
    description: "迁移自 Coze Loop evaluator template「简洁性」，用于评估推荐回答是否简洁直接。",
    systemPrompt:
      "你是一位专业的数据标注员，负责评估模型输出的简洁性。请检查回答是否只包含必要信息，避免冗余解释、客套话与不必要背景。",
    userTemplate:
      "<input>\n{{input}}\n</input>\n\n<output>\n{{output}}\n</output>\n\n请输出结构化评估结果：score 和 reasoning。",
    inputSchema: {
      input: "string",
      output: "string",
    },
  },
  {
    id: "prompt_eval_helpfulness_coze_v1",
    name: "Coze Loop 有益性评估 Prompt",
    version: "1.0.0-coze",
    description: "迁移自 Coze Loop evaluator template「有益性」，用于评估回答是否真的帮助用户做决策。",
    systemPrompt:
      "你是一位专业的数据标注员，负责评估模型输出的有益性。请判断回答是否真正解决用户问题、是否有助于做出下单或购买决策。",
    userTemplate:
      "<input>\n{{input}}\n</input>\n\n<output>\n{{output}}\n</output>\n\n<reference_output>\n{{reference_output}}\n</reference_output>\n\n请输出结构化评估结果：score 和 reasoning。",
    inputSchema: {
      input: "string",
      output: "string",
      reference_output: "string",
    },
  },
  {
    id: "prompt_eval_detail_coze_v1",
    name: "Coze Loop 细节性评估 Prompt",
    version: "1.0.0-coze",
    description: "迁移自 Coze Loop evaluator template「细节性」，用于评估推荐理由是否覆盖价格、库存、时效等关键信息。",
    systemPrompt:
      "你是一位专业的数据标注员，负责评估模型输出的细节性。请重点检查回答是否给出了足够的业务细节，例如价格、库存、配送时效、规格、口味或适用人群。",
    userTemplate:
      "<context>\n{{context}}\n</context>\n\n<input>\n{{input}}\n</input>\n\n<output>\n{{output}}\n</output>\n\n请输出结构化评估结果：score 和 reasoning。",
    inputSchema: {
      context: "string",
      input: "string",
      output: "string",
    },
  },
  {
    id: "prompt_eval_reference_alignment_coze_v1",
    name: "Coze Loop 参考答案遵从度评估 Prompt",
    version: "1.0.0-coze",
    description: "迁移自 Coze Loop evaluator template「参考答案遵从度」，用于评估回答与理想输出的一致程度。",
    systemPrompt:
      "你是一位专业的数据标注员，负责评估模型输出对参考答案的遵从度。请比较输出与参考答案在推荐对象、关键事实和表达目标上的一致性。",
    userTemplate:
      "<input>\n{{input}}\n</input>\n\n<output>\n{{output}}\n</output>\n\n<reference_output>\n{{reference_output}}\n</reference_output>\n\n请输出结构化评估结果：score 和 reasoning。",
    inputSchema: {
      input: "string",
      output: "string",
      reference_output: "string",
    },
  },
  {
    id: "prompt_eval_instruction_following_coze_v1",
    name: "Coze Loop 指令遵从度评估 Prompt",
    version: "1.0.0-coze",
    description: "迁移自 Coze Loop evaluator template「指令遵从度」，用于评估预算、库存、时效等约束是否被遵守。",
    systemPrompt:
      "你是一位专业的数据标注员，负责评估模型输出的指令遵从度。请检查回答是否遵守用户明确提出的预算、库存、时效、口味、品类或健康约束。",
    userTemplate:
      "<input>\n{{input}}\n</input>\n\n<context>\n{{context}}\n</context>\n\n<output>\n{{output}}\n</output>\n\n请输出结构化评估结果：score 和 reasoning。",
    inputSchema: {
      input: "string",
      context: "string",
      output: "string",
    },
  },
  {
    id: "prompt_eval_agent_task_completion_coze_v1",
    name: "Coze Loop Agent 任务完成度评估 Prompt",
    version: "1.0.0-coze",
    description: "迁移自 Coze Loop evaluator template「Agent 任务完成度」，用于评估搜索链路是否成功完成业务目标。",
    systemPrompt:
      "你是一位专业的数据标注员，负责评估 Agent 的任务完成度。请判断这次搜索或导购任务是否成功满足用户目标，并兼顾业务护栏与结果可执行性。",
    userTemplate:
      "<input>\n{{input}}\n</input>\n\n<context>\n{{context}}\n</context>\n\n<output>\n{{output}}\n</output>\n\n<reference_output>\n{{reference_output}}\n</reference_output>\n\n请输出结构化评估结果：score 和 reasoning。",
    inputSchema: {
      input: "string",
      context: "string",
      output: "string",
      reference_output: "string",
    },
  },
  {
    id: "prompt_eval_agent_trajectory_coze_v1",
    name: "Coze Loop Agent 轨迹质量评估 Prompt",
    version: "1.0.0-coze",
    description: "迁移自 Coze Loop evaluator template「Agent 轨迹质量」，用于评估是否该追问、是否存在多余步骤。",
    systemPrompt:
      "你是一位专业的数据标注员，负责评估 Agent 轨迹质量。请判断当前轨迹是否高效、步骤是否必要，以及在证据不足时是否应该追问而不是直接回答。",
    userTemplate:
      "<input>\n{{input}}\n</input>\n\n<trajectory>\n{{trajectory}}\n</trajectory>\n\n<output>\n{{output}}\n</output>\n\n请输出结构化评估结果：score 和 reasoning。",
    inputSchema: {
      input: "string",
      trajectory: "json",
      output: "string",
    },
  },
];

export const samplePrompts: PromptVersion[] = [
  ...businessPrompts,
  ...migratedCozeLoopEvaluatorPrompts,
];

export const baselinePipeline: SearchPipelineVersion = {
  id: "agent_search_pipeline_v1",
  name: "AI Search Baseline",
  version: "1.0.0",
  description: "基线版 AI 搜索 Agent，偏稳健约束匹配。",
  queryProcessor: "keyword-intent-v1",
  retriever: "hybrid-recall-v1",
  reranker: "business-rerank-v1",
  answerer: "gpt-answer-v1",
};

export const candidatePipeline: SearchPipelineVersion = {
  id: "agent_search_pipeline_v2",
  name: "AI Search Candidate",
  version: "1.1.0",
  description: "实验版 AI 搜索 Agent，召回与生成策略更激进。",
  queryProcessor: "keyword-intent-v2",
  retriever: "hybrid-recall-v2",
  reranker: "business-rerank-v2",
  answerer: "gpt-answer-v2",
};

export const sampleAgents: AgentVersion[] = [baselinePipeline, candidatePipeline];

interface ExecutionSpec {
  retrievalIds: string[];
  rerankIds: string[];
  answerOutput: string;
  latencyMs: PipelineExecutionResult["latencyMs"];
}

const buildExecutionResult = (evalCase: EvalCase, spec: ExecutionSpec): PipelineExecutionResult => {
  const findCandidate = (id: string) => {
    const match = evalCase.retrievalCandidates.find((candidateItem) => candidateItem.id === id);
    if (!match) {
      throw new Error(`Missing retrieval candidate ${id} for case ${evalCase.caseId}`);
    }
    return match;
  };

  return {
    retrievalResult: spec.retrievalIds.map(findCandidate),
    rerankResult: spec.rerankIds.map(findCandidate),
    answerOutput: spec.answerOutput,
    latencyMs: spec.latencyMs,
  };
};

const baselineSpecs: Record<string, ExecutionSpec> = {
  food_001: {
    retrievalIds: ["sku_a", "sku_b", "sku_d"],
    rerankIds: ["sku_a", "sku_b", "sku_d"],
    answerOutput: "建议选川香小炒双人餐，38 元，偏辣但不算油，适合两个人晚饭。",
    latencyMs: { retrieval: 120, rerank: 55, answer: 220 },
  },
  food_002: {
    retrievalIds: ["sku_f2_a", "sku_f2_b", "sku_f2_c"],
    rerankIds: ["sku_f2_a", "sku_f2_b", "sku_f2_c"],
    answerOutput: "推荐兰州牛肉面，28 元，能在 30 分钟内送到，也符合热汤面的需求。",
    latencyMs: { retrieval: 115, rerank: 52, answer: 205 },
  },
  food_003: {
    retrievalIds: ["sku_f3_a", "sku_f3_b", "sku_f3_c"],
    rerankIds: ["sku_f3_a", "sku_f3_b", "sku_f3_c"],
    answerOutput: "推荐双人轻辣烧烤拼盘，离你近、不会太辣，做夜宵比较稳妥。",
    latencyMs: { retrieval: 118, rerank: 57, answer: 214 },
  },
  food_004: {
    retrievalIds: ["sku_f4_a", "sku_f4_b", "sku_f4_c"],
    rerankIds: ["sku_f4_a", "sku_f4_b", "sku_f4_c"],
    answerOutput: "首选香煎鸡胸能量碗，高蛋白又清爽，预算也在 45 元以内。",
    latencyMs: { retrieval: 108, rerank: 51, answer: 198 },
  },
  grocery_001: {
    retrievalIds: ["sku_y1", "sku_y2", "sku_y4"],
    rerankIds: ["sku_y1", "sku_y2", "sku_y4"],
    answerOutput: "优先推荐儿童低糖酸奶 6 杯装，低糖且更适合孩子；备选是无糖希腊酸奶。",
    latencyMs: { retrieval: 110, rerank: 48, answer: 190 },
  },
  grocery_002: {
    retrievalIds: ["sku_g2_a", "sku_g2_b", "sku_g2_c"],
    rerankIds: ["sku_g2_a", "sku_g2_b", "sku_g2_c"],
    answerOutput: "先买火锅肥牛卷和新鲜生菜，1 小时内能送到；还需要肉的话再加精品羊肉卷。",
    latencyMs: { retrieval: 125, rerank: 59, answer: 228 },
  },
  grocery_003: {
    retrievalIds: ["sku_g3_a", "sku_g3_b", "sku_g3_c"],
    rerankIds: ["sku_g3_a", "sku_g3_b", "sku_g3_c"],
    answerOutput: "推荐全麦切片面包和无糖豆浆 2 瓶装，比较适合作为早餐搭配。",
    latencyMs: { retrieval: 102, rerank: 44, answer: 176 },
  },
  grocery_004: {
    retrievalIds: ["sku_g4_a", "sku_g4_b", "sku_g4_c"],
    rerankIds: ["sku_g4_a", "sku_g4_b", "sku_g4_c"],
    answerOutput: "优先推荐婴儿拉拉裤 XL 64 片，大包装且目前有货；备选是婴儿纸尿裤 XL 52 片。",
    latencyMs: { retrieval: 104, rerank: 46, answer: 184 },
  },
};

const candidateSpecs: Record<string, ExecutionSpec> = {
  food_001: {
    retrievalIds: ["sku_b", "sku_c", "sku_d"],
    rerankIds: ["sku_c", "sku_b", "sku_d"],
    answerOutput:
      "这里有几种选择。我先从整体风味、热量、受欢迎程度、配送稳定性四个维度展开分析。炸鸡桶套餐虽然 42 元略超预算，但很适合分享，麻辣烫也能考虑。",
    latencyMs: { retrieval: 150, rerank: 70, answer: 320 },
  },
  food_002: {
    retrievalIds: ["sku_f2_a", "sku_f2_c", "sku_f2_d"],
    rerankIds: ["sku_f2_c", "sku_f2_a", "sku_f2_d"],
    answerOutput: "寿司拼盘配送更快，你也可以一起看看兰州牛肉面，最后按口味再决定。",
    latencyMs: { retrieval: 142, rerank: 69, answer: 288 },
  },
  food_003: {
    retrievalIds: ["sku_f3_c", "sku_f3_d", "sku_f3_b"],
    rerankIds: ["sku_f3_c", "sku_f3_d", "sku_f3_b"],
    answerOutput: "麻辣烤鱼更有满足感，如果你夜宵想吃得重一点可以直接下单。",
    latencyMs: { retrieval: 148, rerank: 72, answer: 301 },
  },
  food_004: {
    retrievalIds: ["sku_f4_c", "sku_f4_a", "sku_f4_d"],
    rerankIds: ["sku_f4_c", "sku_f4_d", "sku_f4_a"],
    answerOutput: "芝士培根意面热量会更足，运动后补一补也不错，炸鸡全家桶性价比也很高。",
    latencyMs: { retrieval: 139, rerank: 66, answer: 276 },
  },
  grocery_001: {
    retrievalIds: ["sku_y1", "sku_y3", "sku_y4"],
    rerankIds: ["sku_y3", "sku_y1", "sku_y4"],
    answerOutput: "高糖风味酸奶口感会更好，儿童低糖酸奶也可以，再根据活动价格决定。",
    latencyMs: { retrieval: 135, rerank: 68, answer: 300 },
  },
  grocery_002: {
    retrievalIds: ["sku_g2_a", "sku_g2_d", "sku_g2_b"],
    rerankIds: ["sku_g2_d", "sku_g2_a", "sku_g2_b"],
    answerOutput: "可以先买冷冻披萨，再补一份火锅肥牛卷，方便又省事。",
    latencyMs: { retrieval: 152, rerank: 74, answer: 312 },
  },
  grocery_003: {
    retrievalIds: ["sku_g3_c", "sku_g3_d", "sku_g3_a"],
    rerankIds: ["sku_g3_c", "sku_g3_d", "sku_g3_a"],
    answerOutput: "早餐可以试试奶油夹心面包和豆奶饮料，口感会更好一些。",
    latencyMs: { retrieval: 134, rerank: 63, answer: 261 },
  },
  grocery_004: {
    retrievalIds: ["sku_g4_d", "sku_g4_a", "sku_g4_c"],
    rerankIds: ["sku_g4_d", "sku_g4_a", "sku_g4_c"],
    answerOutput: "建议先买婴儿拉拉裤 XL 32 片，价格更低，也方便先试试看。",
    latencyMs: { retrieval: 136, rerank: 64, answer: 254 },
  },
};

const buildCaseRuns = (
  target: SearchPipelineVersion,
  specs: Record<string, ExecutionSpec>,
) =>
  sampleCases.map((evalCase) =>
    buildExperimentCaseRun(evalCase, target, buildExecutionResult(evalCase, specs[evalCase.caseId]!)),
  );

export const buildSampleExperiments = (): {
  baseline: ExperimentRun;
  candidate: ExperimentRun;
} => {
  const baselineCaseRuns = buildCaseRuns(baselinePipeline, baselineSpecs);
  const candidateCaseRuns = buildCaseRuns(candidatePipeline, candidateSpecs);

  const baseline: ExperimentRun = {
    experimentId: "exp_baseline",
    datasetId: primaryDatasetId,
    evaluatorIds: sampleEvaluators.map((item) => item.id),
    targetRef: toTargetRef(baselinePipeline),
    targetSelection: toTargetSelection(baselinePipeline),
    pipelineVersionId: baselinePipeline.id,
    target: baselinePipeline,
    status: "FINISHED",
    startedAt: now,
    finishedAt: now,
    summary: summarizeExperimentRun(baselineCaseRuns),
    caseRuns: baselineCaseRuns,
  };

  const candidate: ExperimentRun = {
    experimentId: "exp_candidate",
    datasetId: primaryDatasetId,
    evaluatorIds: sampleEvaluators.map((item) => item.id),
    targetRef: toTargetRef(candidatePipeline),
    targetSelection: toTargetSelection(candidatePipeline),
    pipelineVersionId: candidatePipeline.id,
    target: candidatePipeline,
    status: "FINISHED",
    startedAt: now,
    finishedAt: now,
    summary: summarizeExperimentRun(candidateCaseRuns),
    caseRuns: candidateCaseRuns,
  };

  return { baseline, candidate };
};
