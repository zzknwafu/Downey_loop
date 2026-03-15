import { FormEvent, useMemo, useState } from "react";
import { CodeEvaluatorStrategy, MetricDelta, MetricResult, MetricType } from "../domain/types.js";
import { demoViewModel } from "./view-model.js";

type NavItem =
  | "prompt"
  | "playground"
  | "datasets"
  | "evaluators"
  | "experiments_run"
  | "experiments_ab"
  | "trace"
  | "stats"
  | "automation";

type CustomDataset = {
  id: string;
  name: string;
  description: string;
  datasetType: "ideal_output" | "workflow" | "trace_monitor";
  columns: Array<{
    name: string;
    dataType: string;
    required: boolean;
    description: string;
  }>;
  itemCount: number;
  version: string;
};

type CustomEvaluator = {
  name: string;
  layer: string;
  metricType: MetricType;
  evaluatorFamily: "model" | "code";
  codeStrategy?: CodeEvaluatorStrategy;
  description: string;
  config?: string;
};

const layerInspectionGuide: Array<{
  layer: "retrieval" | "rerank" | "answer" | "overall";
  title: string;
  checkpoints: string[];
}> = [
  {
    layer: "retrieval",
    title: "召回层检查点",
    checkpoints: ["是否召回关键候选", "硬约束是否被保住", "噪声候选是否过多", "证据是否足以支持下游生成"],
  },
  {
    layer: "rerank",
    title: "重排层检查点",
    checkpoints: ["正确候选是否进入 Top-K", "Top1 是否合理", "重排后是否仍保留约束", "是否更贴近用户偏好"],
  },
  {
    layer: "answer",
    title: "回答层检查点",
    checkpoints: ["答案是否正确", "是否基于候选生成", "是否简洁", "是否帮助决策", "解释是否清楚"],
  },
  {
    layer: "overall",
    title: "端到端检查点",
    checkpoints: ["CTR 代理指标", "CVR 代理指标", "满意度", "整体时延"],
  },
];

const layerMetricNames: Record<"retrieval" | "rerank" | "answer" | "overall", string[]> = {
  retrieval: ["retrieval_coverage", "hard_constraint_recall", "noise_rate", "evidence_sufficiency"],
  rerank: ["rerank_hit_at_3", "rerank_top1_quality", "constraint_preservation", "preference_alignment"],
  answer: [
    "answer_correctness",
    "answer_groundedness",
    "answer_conciseness",
    "answer_actionability",
    "recommendation_explanation_quality",
  ],
  overall: ["proxy_ctr", "proxy_cvr", "proxy_satisfaction", "latency_ms"],
};

const navConfig: Array<{
  title: string;
  items: Array<{ id: NavItem; label: string }>;
}> = [
  {
    title: "Prompt 工程",
    items: [
      { id: "prompt", label: "Prompt 开发" },
      { id: "playground", label: "Playground" },
    ],
  },
  {
    title: "评测",
    items: [
      { id: "datasets", label: "评测集" },
      { id: "evaluators", label: "评估器" },
      { id: "experiments_run", label: "实验运行" },
      { id: "experiments_ab", label: "AB 实验" },
    ],
  },
  {
    title: "观测",
    items: [
      { id: "trace", label: "Trace" },
      { id: "stats", label: "统计" },
      { id: "automation", label: "自动化任务" },
    ],
  },
];

const layerLabel: Record<string, string> = {
  retrieval: "召回层 Retrieval",
  rerank: "重排层 Rerank",
  answer: "回答层 Answer",
  overall: "端到端 Overall",
};

const fieldMeta = [
  { key: "caseId", label: "样本 ID", description: "每条评测样本的唯一编号。" },
  { key: "domain", label: "业务域", description: "当前样本属于外卖还是商超。" },
  { key: "taskType", label: "任务类型", description: "如 AI 搜索、推荐、履约问答、售后等。" },
  { key: "userQuery", label: "用户问题", description: "用户真实输入的问题或需求。" },
  { key: "queryConstraints", label: "查询约束", description: "预算、库存、距离、口味等强约束。" },
  { key: "retrievalCandidates", label: "召回候选", description: "检索阶段拿到的商品/商家候选列表。" },
  { key: "expectedRetrievalIds", label: "必须召回项", description: "理论上必须被召回的关键候选。" },
  { key: "acceptableRetrievalIds", label: "可接受召回项", description: "不是最佳，但业务上可接受的候选。" },
  { key: "expectedTopItems", label: "期望 Top 结果", description: "重排后理应进入前列的结果。" },
  { key: "answerReference", label: "参考答案", description: "用于比对生成质量的参考输出。" },
  { key: "businessOutcomeLabels", label: "业务结果标签", description: "用于 CTR/CVR/停留等代理指标的标签。" },
];

const datasetTypeMeta: Record<
  CustomDataset["datasetType"],
  { title: string; description: string; columns: CustomDataset["columns"] }
> = {
  ideal_output: {
    title: "普通数据集",
    description: "适合理想输出评测，包含 input 和 reference_output。",
    columns: [
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
  },
  workflow: {
    title: "Workflow 数据集",
    description: "面向工作流执行评测，关注步骤、工具调用和中间状态。",
    columns: [
      {
        name: "input",
        dataType: "String",
        required: true,
        description: "工作流的原始输入",
      },
      {
        name: "workflow_output",
        dataType: "JSON",
        required: true,
        description: "工作流最终结果或节点输出",
      },
      {
        name: "expected_steps",
        dataType: "JSON",
        required: false,
        description: "期望执行步骤或关键节点轨迹",
      },
    ],
  },
  trace_monitor: {
    title: "Trace 监控集",
    description: "用于轨迹监控和观测回放，覆盖 trace、tool call、trajectory。",
    columns: [
      {
        name: "trace_id",
        dataType: "String",
        required: true,
        description: "运行轨迹唯一标识",
      },
      {
        name: "final_output",
        dataType: "String",
        required: true,
        description: "最终输出结果",
      },
      {
        name: "trajectory",
        dataType: "JSON",
        required: false,
        description: "完整轨迹、工具调用和步骤信息",
      },
    ],
  },
};

const builtInDatasets: CustomDataset[] = [
  {
    id: "dataset_ideal_001",
    name: "外卖 AI 搜理想输出集",
    description: "外卖/商超 AI 搜的基础理想输出评测集",
    datasetType: "ideal_output",
    columns: datasetTypeMeta.ideal_output.columns,
    itemCount: demoViewModel.sampleCases.length,
    version: "0.1.0",
  },
  {
    id: "dataset_workflow_001",
    name: "AI 搜 Workflow 执行集",
    description: "面向 agent workflow 节点执行与工具调用评测",
    datasetType: "workflow",
    columns: datasetTypeMeta.workflow.columns,
    itemCount: 12,
    version: "0.1.0",
  },
  {
    id: "dataset_trace_001",
    name: "AI 搜 Trace 监控集",
    description: "面向运行轨迹监控、异常归因与 replay 观察",
    datasetType: "trace_monitor",
    columns: datasetTypeMeta.trace_monitor.columns,
    itemCount: 18,
    version: "0.1.0",
  },
];

const viewMeta: Record<NavItem, { eyebrow: string; title: string; description: string }> = {
  prompt: {
    eyebrow: "Prompt workspace",
    title: "Prompt 版本视图",
    description: "这里展示搜索链路中会用到的 prompt 相关组件版本，后续可以扩成 system prompt 编辑和版本 diff。",
  },
  playground: {
    eyebrow: "Prompt playground",
    title: "Playground",
    description: "当前先展示样例输入、约束和参考答案。后续接 GPT API 后，这里可直接做单 query 调试。",
  },
  datasets: {
    eyebrow: "Dataset explorer",
    title: "评测集",
    description: "这一页现在支持查看 schema、中文字段说明，以及本地新建评测样本入口。",
  },
  evaluators: {
    eyebrow: "Evaluator catalog",
    title: "评估器",
    description: "评估器按 AI 搜索链路分层展示，并支持本地新增自定义 evaluator。",
  },
  experiments_run: {
    eyebrow: "Experiment runs",
    title: "实验运行",
    description: "这一层保留更接近 Coze 的实验逻辑：看单次实验、单 case、单指标结果，适合日常跑批与逐条检查。",
  },
  experiments_ab: {
    eyebrow: "Experiment comparison",
    title: "AB 实验",
    description: "先看端到端代理结果，再下钻到 retrieval、rerank、answer，最后定位到具体 case 和 trace。",
  },
  trace: {
    eyebrow: "Trace explorer",
    title: "Trace",
    description: "这里重点看每一步到底产出了什么，方便判断问题是在召回、重排还是生成。",
  },
  stats: {
    eyebrow: "Stats overview",
    title: "统计",
    description: "统计页展示各层均值和端到端代理指标，后续可扩成趋势、分桶和回归看板。",
  },
  automation: {
    eyebrow: "Automation",
    title: "自动化任务",
    description: "自动化页说明如何定时回归实验、发现显著回退时自动告警或导出证据样本。",
  },
};

const formatMetricValue = (value: number) => {
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(3);
};

const formatDelta = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

const averageForMetric = (metrics: MetricResult[], metricName: string) => {
  const filtered = metrics.filter(
    (metric) => metric.metricName === metricName && typeof metric.score === "number",
  );
  if (filtered.length === 0) {
    return 0;
  }

  return filtered.reduce((sum, metric) => sum + Number(metric.score), 0) / filtered.length;
};

const MetricCard = ({
  title,
  subtitle,
  baselineValue,
  candidateValue,
  deltaLabel,
}: {
  title: string;
  subtitle: string;
  baselineValue: string;
  candidateValue: string;
  deltaLabel: string;
}) => (
  <article className="metric-card">
    <div className="metric-card__title">{title}</div>
    <div className="metric-card__subtitle">{subtitle}</div>
    <div className="metric-card__values">
      <div>
        <span className="metric-card__label">对照组 Baseline</span>
        <strong>{baselineValue}</strong>
      </div>
      <div>
        <span className="metric-card__label">实验组 Candidate</span>
        <strong>{candidateValue}</strong>
      </div>
    </div>
    <div className={`metric-card__delta ${deltaLabel.startsWith("-") ? "is-negative" : "is-positive"}`}>
      {deltaLabel}
    </div>
  </article>
);

const DeltaTable = ({ rows }: { rows: MetricDelta[] }) => (
  <div className="panel table-panel">
    <div className="panel__header">
      <h3>分层指标变化</h3>
      <span>按层定位实验差异</span>
    </div>
    <table className="delta-table">
      <thead>
        <tr>
          <th>层级</th>
          <th>指标</th>
          <th>对照组</th>
          <th>实验组</th>
          <th>变化</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.layer}-${row.metricName}`}>
            <td>{layerLabel[row.layer]}</td>
            <td>{row.metricName}</td>
            <td>{formatMetricValue(row.baselineValue)}</td>
            <td>{formatMetricValue(row.candidateValue)}</td>
            <td className={row.delta < 0 ? "is-negative" : "is-positive"}>
              {row.metricName === "latency_ms" ? `${row.delta.toFixed(1)}ms` : formatDelta(row.delta)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const TracePanel = ({
  label,
  run,
}: {
  label: string;
  run: (typeof demoViewModel.caseDetails)[number]["baselineRun"];
}) => (
  <section className="trace-column">
    <h4>{label}</h4>
    <div className="trace-stack">
      <div className="trace-card">
        <div className="trace-card__title">召回结果 Retrieval</div>
        <div className="trace-chip-list">
          {(run.trace.retrievalTrace.outputs.retrievalResult as { id: string; title: string }[]).map((item) => (
            <span key={item.id} className="trace-chip">
              {item.title}
            </span>
          ))}
        </div>
      </div>
      <div className="trace-card">
        <div className="trace-card__title">重排结果 Rerank</div>
        <div className="trace-chip-list">
          {(run.trace.rerankTrace.outputs.rerankResult as { id: string; title: string }[]).map((item, index) => (
            <span key={item.id} className="trace-chip">
              #{index + 1} {item.title}
            </span>
          ))}
        </div>
      </div>
      <div className="trace-card">
        <div className="trace-card__title">最终回答 Answer</div>
        <p>{String(run.trace.answerTrace.outputs.answerOutput)}</p>
      </div>
    </div>
  </section>
);

const PromptView = () => (
  <section className="single-panel-grid">
    <div className="panel">
      <div className="panel__header">
        <h3>Prompt / 组件版本</h3>
        <span>当前链路版本</span>
      </div>
      <div className="kv-grid">
        <div className="kv-card">
          <span>查询理解 Query Processor</span>
          <strong>{demoViewModel.baseline.target.queryProcessor}</strong>
        </div>
        <div className="kv-card">
          <span>召回器 Retriever</span>
          <strong>{demoViewModel.baseline.target.retriever}</strong>
        </div>
        <div className="kv-card">
          <span>重排器 Reranker</span>
          <strong>{demoViewModel.baseline.target.reranker}</strong>
        </div>
        <div className="kv-card">
          <span>回答器 Answerer</span>
          <strong>{demoViewModel.baseline.target.answerer}</strong>
        </div>
      </div>
    </div>
  </section>
);

const PlaygroundView = () => (
  <section className="single-panel-grid">
    <div className="panel">
      <div className="panel__header">
        <h3>样例调试预览</h3>
        <span>后续接 GPT API 后可在此直接试跑</span>
      </div>
      <div className="playground-preview">
        <div className="trace-card">
          <div className="trace-card__title">输入问题</div>
          <p>{demoViewModel.sampleCases[0]?.userQuery}</p>
        </div>
        <div className="trace-card">
          <div className="trace-card__title">约束条件</div>
          <div className="trace-chip-list">
            {Object.entries(demoViewModel.sampleCases[0]?.queryConstraints ?? {}).map(([key, value]) => (
              <span key={key} className="trace-chip">
                {fieldMeta.find((item) => item.key === key)?.label ?? key}: {Array.isArray(value) ? value.join(", ") : String(value)}
              </span>
            ))}
          </div>
        </div>
        <div className="trace-card">
          <div className="trace-card__title">参考答案</div>
          <p>{demoViewModel.sampleCases[0]?.answerReference}</p>
        </div>
      </div>
    </div>
  </section>
);

const DatasetView = ({
  datasets,
  onCreate,
}: {
  datasets: CustomDataset[];
  onCreate: (dataset: CustomDataset) => void;
}) => {
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<"choose_type" | "configure">("choose_type");
  const [selectedType, setSelectedType] = useState<CustomDataset["datasetType"]>("ideal_output");
  const [formState, setFormState] = useState({
    name: "",
    description: "",
    columns: datasetTypeMeta.ideal_output.columns,
  });

  const allDatasets = [...builtInDatasets, ...datasets];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = formState.name.trim();
    if (!trimmedName) {
      return;
    }

    onCreate({
      id: `dataset_custom_${datasets.length + 1}`,
      name: trimmedName,
      description: formState.description.trim(),
      datasetType: selectedType,
      columns: formState.columns,
      itemCount: 0,
      version: "0.1.0",
    });
    setFormState({
      name: "",
      description: "",
      columns: datasetTypeMeta.ideal_output.columns,
    });
    setShowCreate(false);
    setCreateStep("choose_type");
    setSelectedType("ideal_output");
  };

  return (
    <section className="single-panel-grid">
      <div className="panel">
        <div className="panel__header">
          <h3>评测集</h3>
          <div className="toolbar">
            <input className="toolbar__search" placeholder="搜索数据集名称" />
            <button type="button" className="ghost-button">
              刷新
            </button>
            <button type="button" className="primary-button" onClick={() => setShowCreate(true)}>
              + 新建评测集
            </button>
          </div>
        </div>
        <div className="dataset-table-wrap">
          <table className="delta-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>列字段</th>
                <th>数据量</th>
                <th>最新版本</th>
                <th>描述</th>
              </tr>
            </thead>
            <tbody>
              {allDatasets.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>
                    {
                      {
                        ideal_output: "普通数据集",
                        workflow: "Workflow",
                        trace_monitor: "Trace 监控",
                      }[item.datasetType]
                    }
                  </td>
                  <td>
                    <div className="trace-chip-list">
                      {item.columns.map((column) => (
                        <span key={column.name} className="trace-chip">
                          {column.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{item.itemCount}</td>
                  <td>{item.version}</td>
                  <td>{item.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showCreate ? (
        <div className="modal-overlay" role="presentation" onClick={() => setShowCreate(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-card__header">
              <h3>新建评测集</h3>
              <button type="button" className="modal-card__close" onClick={() => setShowCreate(false)}>
                ×
              </button>
            </div>
            {createStep === "choose_type" ? (
              <div className="modal-card__body">
                <div className="config-preset-grid">
                  {(Object.entries(datasetTypeMeta) as Array<[CustomDataset["datasetType"], (typeof datasetTypeMeta)[CustomDataset["datasetType"]]]>).map(
                    ([key, value]) => (
                      <button
                        key={key}
                        type="button"
                        className={`preset-card ${selectedType === key ? "is-selected" : ""}`}
                        onClick={() => {
                          setSelectedType(key);
                          setFormState((prev) => ({ ...prev, columns: value.columns }));
                        }}
                      >
                        <strong>{value.title}</strong>
                        <p>{value.description}</p>
                      </button>
                    ),
                  )}
                </div>
                <div className="form-actions">
                  <button type="button" className="primary-button" onClick={() => setCreateStep("configure")}>
                    下一步
                  </button>
                </div>
              </div>
            ) : (
              <form className="modal-card__body form-card form-card--modal" onSubmit={handleSubmit}>
                <div className="form-grid">
                  <label className="form-field">
                    <span>名称</span>
                    <input
                      value={formState.name}
                      onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="请输入评测集名称"
                    />
                  </label>
                  <div className="form-field">
                    <span>数据集类型</span>
                    <div className="field-hint">{datasetTypeMeta[selectedType].title}</div>
                  </div>
                </div>
                <label className="form-field">
                  <span>描述</span>
                  <textarea
                    value={formState.description}
                    onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
                    placeholder="请输入评测集描述"
                  />
                </label>
                <div className="dataset-columns-panel">
                  <div className="trace-card__title">配置列</div>
                  <div className="config-preset-grid config-preset-grid--inline">
                    {(Object.entries(datasetTypeMeta) as Array<[CustomDataset["datasetType"], (typeof datasetTypeMeta)[CustomDataset["datasetType"]]]>).map(
                      ([key, value]) => (
                        <button
                          key={key}
                          type="button"
                          className={`preset-card ${selectedType === key ? "is-selected" : ""}`}
                          onClick={() => {
                            setSelectedType(key);
                            setFormState((prev) => ({ ...prev, columns: value.columns }));
                          }}
                        >
                          <strong>{value.title}</strong>
                          <p>{value.description}</p>
                        </button>
                      ),
                    )}
                  </div>
                  <div className="column-editor-list">
                    {formState.columns.map((column, index) => (
                      <div key={`${column.name}-${index}`} className="column-editor-card">
                        <div className="form-grid">
                          <label className="form-field">
                            <span>列名</span>
                            <input
                              value={column.name}
                              onChange={(event) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  columns: prev.columns.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, name: event.target.value } : item,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <label className="form-field">
                            <span>数据类型</span>
                            <select
                              value={column.dataType}
                              onChange={(event) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  columns: prev.columns.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, dataType: event.target.value } : item,
                                  ),
                                }))
                              }
                            >
                              <option value="String">String</option>
                              <option value="Number">Number</option>
                              <option value="Boolean">Boolean</option>
                              <option value="JSON">JSON</option>
                            </select>
                          </label>
                        </div>
                        <div className="form-grid">
                          <label className="form-field">
                            <span>说明</span>
                            <input
                              value={column.description}
                              onChange={(event) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  columns: prev.columns.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, description: event.target.value } : item,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <label className="form-field">
                            <span>必填</span>
                            <select
                              value={column.required ? "yes" : "no"}
                              onChange={(event) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  columns: prev.columns.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, required: event.target.value === "yes" }
                                      : item,
                                  ),
                                }))
                              }
                            >
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="form-actions">
                  <button type="button" className="ghost-button" onClick={() => setCreateStep("choose_type")}>
                    返回选择类型
                  </button>
                  <button type="button" className="ghost-button" onClick={() => setShowCreate(false)}>
                    取消
                  </button>
                  <button type="submit" className="primary-button">
                    创建
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
};

const EvaluatorView = ({
  evaluators,
  onCreate,
}: {
  evaluators: CustomEvaluator[];
  onCreate: (evaluator: CustomEvaluator) => void;
}) => {
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<"choose_family" | "configure">("choose_family");
  const [selectedLayer, setSelectedLayer] = useState<"retrieval" | "rerank" | "answer" | "overall">("retrieval");
  const [hoveredLayer, setHoveredLayer] = useState<"retrieval" | "rerank" | "answer" | "overall" | null>(null);
  const [selectedEvaluatorName, setSelectedEvaluatorName] = useState("retrieval_coverage");
  const [draftOverrides, setDraftOverrides] = useState<Record<string, CustomEvaluator>>({});
  const [formState, setFormState] = useState<CustomEvaluator>({
    name: "",
    layer: "retrieval",
    metricType: "continuous",
    evaluatorFamily: "model",
    description: "",
    config: "",
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.name.trim() || !formState.description.trim()) {
      return;
    }
    onCreate({
      ...formState,
      name: formState.name.trim(),
      description: formState.description.trim(),
    });
    setShowCreate(false);
    setCreateStep("choose_family");
    setFormState({
      name: "",
      layer: "retrieval",
      metricType: "continuous",
      evaluatorFamily: "model",
      description: "",
      config: "",
    });
  };

  const allEvaluators = [
    ...demoViewModel.metricDefinitions.map((metric) => ({
      name: metric.name,
      layer: metric.layer,
      metricType: metric.metricType,
      evaluatorFamily: metric.evaluatorFamily,
      codeStrategy: metric.codeStrategy,
      description: metric.description,
      config: "",
    })),
    ...evaluators,
  ].map((metric) => draftOverrides[metric.name] ?? metric);

  const visibleLayer = hoveredLayer ?? selectedLayer;
  const visibleGuide = layerInspectionGuide.find((item) => item.layer === visibleLayer)!;
  const visibleModelEvaluators = allEvaluators.filter(
    (metric) => metric.evaluatorFamily === "model" && metric.layer === selectedLayer,
  );
  const codeEvaluators = allEvaluators.filter((metric) => metric.evaluatorFamily === "code");

  const selectedEvaluator =
    allEvaluators.find((metric) => metric.name === selectedEvaluatorName) ??
    visibleModelEvaluators[0] ??
    codeEvaluators[0] ??
    allEvaluators[0];

  const handleEdit = <K extends keyof CustomEvaluator>(key: K, value: CustomEvaluator[K]) => {
    if (!selectedEvaluator) {
      return;
    }

    setDraftOverrides((prev) => ({
      ...prev,
      [selectedEvaluator.name]: {
        ...selectedEvaluator,
        [key]: value,
      },
    }));
  };

  const openCreateModal = () => {
    setShowCreate(true);
    setCreateStep("choose_family");
    setFormState({
      name: "",
      layer: selectedLayer,
      metricType: "continuous",
      evaluatorFamily: "model",
      description: "",
      config: "",
    });
  };

  return (
    <section className="single-panel-grid">
      <div className="panel">
        <div className="panel__header">
          <h3>评估器目录</h3>
          <div className="toolbar">
            <input className="toolbar__search" placeholder="搜索评估器名" />
            <button type="button" className="ghost-button">
              刷新
            </button>
            <button type="button" className="primary-button" onClick={openCreateModal}>
              + 新建评估器
            </button>
          </div>
        </div>
        <div className="flow-panel">
          <div className="trace-card">
            <div className="trace-card__title">搜索评估流程图</div>
            <div className="flowchart">
              {layerInspectionGuide.map((item, index) => (
                <div key={item.layer} className="flowchart__row">
                  <button
                    type="button"
                    className={`flowchart__node ${selectedLayer === item.layer ? "is-selected" : ""}`}
                    onMouseEnter={() => setHoveredLayer(item.layer)}
                    onMouseLeave={() => setHoveredLayer(null)}
                    onClick={() => {
                      setSelectedLayer(item.layer);
                      const firstMetric = allEvaluators.find(
                        (metric) => metric.evaluatorFamily === "model" && metric.layer === item.layer,
                      );
                      if (firstMetric) {
                        setSelectedEvaluatorName(firstMetric.name);
                      }
                    }}
                  >
                    <span className="flowchart__step">{index + 1}</span>
                    <strong>{layerLabel[item.layer]}</strong>
                    <p>{item.title}</p>
                  </button>
                  {index < layerInspectionGuide.length - 1 ? <div className="flowchart__arrow">→</div> : null}
                </div>
              ))}
            </div>
          </div>
          <div className="trace-card">
            <div className="trace-card__title">当前层预览</div>
            <div className="layer-guide-grid">
              <div className="layer-guide-card is-focus">
                <strong>{visibleGuide.title}</strong>
                <div className="trace-chip-list">
                  {visibleGuide.checkpoints.map((checkpoint) => (
                    <span key={checkpoint} className="trace-chip">
                      {checkpoint}
                    </span>
                  ))}
                </div>
              </div>
              <div className="layer-metric-preview">
                <div className="layer-metric-preview__title">该层关键指标</div>
                <div className="trace-chip-list">
                  {layerMetricNames[visibleLayer].map((metricName) => (
                    <span key={metricName} className="trace-chip">
                      {metricName}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="evaluator-workbench">
          <div className="evaluator-grid evaluator-grid--table">
            <div className="trace-card evaluator-section">
              <div className="trace-card__title">{layerLabel[selectedLayer]} 模型评估器</div>
              <div className="evaluator-stack">
                {visibleModelEvaluators.map((metric) => (
                  <button
                    key={`${metric.layer}-${metric.name}`}
                    type="button"
                    className={`evaluator-item ${selectedEvaluator?.name === metric.name ? "is-selected" : ""}`}
                    onClick={() => setSelectedEvaluatorName(metric.name)}
                  >
                    <div className="evaluator-item__top">
                      <strong>{metric.name}</strong>
                      <span className={`metric-type metric-type--${metric.metricType}`}>{metric.metricType}</span>
                    </div>
                    <p>{metric.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="trace-card evaluator-editor">
            <div className="trace-card__title">评估器详情</div>
            {selectedEvaluator ? (
              <div className="editor-form">
                <label className="form-field">
                  <span>评估器名称</span>
                  <input
                    value={selectedEvaluator.name}
                    onChange={(event) => handleEdit("name", event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>所属层级</span>
                  <select
                    value={selectedEvaluator.layer}
                    onChange={(event) => handleEdit("layer", event.target.value)}
                  >
                    <option value="retrieval">召回层 Retrieval</option>
                    <option value="rerank">重排层 Rerank</option>
                    <option value="answer">回答层 Answer</option>
                    <option value="overall">端到端 Overall</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>指标类型</span>
                  <select
                    value={selectedEvaluator.metricType}
                    onChange={(event) => handleEdit("metricType", event.target.value as MetricType)}
                  >
                    <option value="binary">binary 二值</option>
                    <option value="continuous">continuous 连续分</option>
                    <option value="categorical">categorical 分类</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>中文说明</span>
                  <textarea
                    value={selectedEvaluator.description}
                    onChange={(event) => handleEdit("description", event.target.value)}
                  />
                </label>
                <div className="editor-note">
                  这一页核心展示 AI 搜索流程下的模型评估器。代码评估器通过“新建评估器”浮窗进入，不再和主流程混在一起。
                </div>
              </div>
            ) : (
              <p>请选择一个评估器。</p>
            )}
          </div>
        </div>
        <div className="trace-card code-summary-panel">
          <div className="trace-card__title">代码评估能力</div>
          <div className="trace-chip-list">
            {codeEvaluators.map((metric) => (
              <span key={metric.name} className="trace-chip">
                {metric.codeStrategy}: {metric.name}
              </span>
            ))}
          </div>
        </div>
      </div>
      {showCreate ? (
        <div className="modal-overlay" role="presentation" onClick={() => setShowCreate(false)}>
          <div className="modal-card modal-card--narrow" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-card__header">
              <h3>新建评估器</h3>
              <button type="button" className="modal-card__close" onClick={() => setShowCreate(false)}>
                ×
              </button>
            </div>
            {createStep === "choose_family" ? (
              <div className="modal-card__body modal-card__body--narrow">
                <div className="modal-choice-grid">
                  <button
                    type="button"
                    className="modal-choice-card"
                    onClick={() => {
                      setFormState((prev) => ({
                        ...prev,
                        evaluatorFamily: "model",
                        codeStrategy: undefined,
                        layer: selectedLayer,
                        metricType: "continuous",
                      }));
                      setCreateStep("configure");
                    }}
                  >
                    <strong>LLM Evaluator</strong>
                    <p>用于正确性、groundedness、简洁性、actionability 等模型评估。</p>
                  </button>
                  <button
                    type="button"
                    className="modal-choice-card"
                    onClick={() => {
                      setFormState((prev) => ({
                        ...prev,
                        evaluatorFamily: "code",
                        codeStrategy: "exact_match",
                        layer: "answer",
                        metricType: "binary",
                      }));
                      setCreateStep("configure");
                    }}
                  >
                    <strong>Code Evaluator</strong>
                    <p>支持精准匹配、正则匹配、模糊匹配和 Python 脚本。</p>
                  </button>
                </div>
              </div>
            ) : (
              <form className="modal-card__body modal-card__body--narrow form-card form-card--modal" onSubmit={handleSubmit}>
                <div className="form-grid">
                  <label className="form-field">
                    <span>评估器名称</span>
                    <input
                      value={formState.name}
                      onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="例如：delivery_policy_compliance"
                    />
                  </label>
                  <label className="form-field">
                    <span>所属层级</span>
                    <select
                      value={formState.layer}
                      onChange={(event) => setFormState((prev) => ({ ...prev, layer: event.target.value }))}
                    >
                      <option value="retrieval">召回层 Retrieval</option>
                      <option value="rerank">重排层 Rerank</option>
                      <option value="answer">回答层 Answer</option>
                      <option value="overall">端到端 Overall</option>
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label className="form-field">
                    <span>指标类型</span>
                    <select
                      value={formState.metricType}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, metricType: event.target.value as MetricType }))
                      }
                    >
                      <option value="binary">binary 二值</option>
                      <option value="continuous">continuous 连续分</option>
                      <option value="categorical">categorical 分类</option>
                    </select>
                  </label>
                  <div className="form-field">
                    <span>评估器类型</span>
                    <div className="field-hint">
                      {formState.evaluatorFamily === "model" ? "LLM Evaluator" : "Code Evaluator"}
                    </div>
                  </div>
                </div>
                {formState.evaluatorFamily === "code" ? (
                  <label className="form-field">
                    <span>代码评估方式</span>
                    <select
                      value={formState.codeStrategy ?? "exact_match"}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          codeStrategy: event.target.value as CodeEvaluatorStrategy,
                        }))
                      }
                    >
                      <option value="exact_match">精准匹配</option>
                      <option value="regex_match">正则匹配</option>
                      <option value="fuzzy_match">模糊匹配</option>
                      <option value="python_script">Python 脚本</option>
                    </select>
                  </label>
                ) : null}
                <label className="form-field">
                  <span>中文说明</span>
                  <textarea
                    value={formState.description}
                    onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
                    placeholder="例如：配送政策是否被正确解释，必须 0/1。"
                  />
                </label>
                {formState.evaluatorFamily === "code" ? (
                  <label className="form-field">
                    <span>代码/规则配置</span>
                    <textarea
                      value={formState.config ?? ""}
                      onChange={(event) => setFormState((prev) => ({ ...prev, config: event.target.value }))}
                      placeholder={
                        formState.codeStrategy === "python_script"
                          ? "def evaluate(input, output, reference_output):\n    return {\"score\": 1, \"reason\": \"ok\"}"
                          : "填写 pattern、目标值或模糊匹配阈值"
                      }
                    />
                  </label>
                ) : null}
                <div className="form-actions">
                  <button type="button" className="ghost-button" onClick={() => setCreateStep("choose_family")}>
                    返回选择类型
                  </button>
                  <button type="button" className="ghost-button" onClick={() => setShowCreate(false)}>
                    取消
                  </button>
                  <button type="submit" className="primary-button">
                    创建评估器
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
};

const ExperimentRunView = ({
  selectedCaseId,
  setSelectedCaseId,
}: {
  selectedCaseId: string;
  setSelectedCaseId: (value: string) => void;
}) => {
  const selectedCase =
    demoViewModel.caseDetails.find((item) => item.caseId === selectedCaseId) ?? demoViewModel.caseDetails[0];
  const baselineMetrics = selectedCase.baselineRun.layerMetrics;
  const candidateMetrics = selectedCase.candidateRun.layerMetrics;

  return (
    <section className="single-panel-grid">
      <div className="panel">
        <div className="panel__header">
          <h3>实验运行明细</h3>
          <div className="toolbar">
            <input className="toolbar__search" placeholder="搜索 case id" />
            <button type="button" className="ghost-button">
              刷新
            </button>
          </div>
        </div>
        <div className="dataset-table-wrap">
          <table className="delta-table">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>输入问题</th>
                <th>参考答案</th>
                <th>对照组结果</th>
                <th>实验组结果</th>
              </tr>
            </thead>
            <tbody>
              {demoViewModel.sampleCases.map((sample) => {
                const caseItem = demoViewModel.caseDetails.find((item) => item.caseId === sample.caseId)!;
                return (
                  <tr
                    key={sample.caseId}
                    className={`is-clickable-row ${selectedCaseId === sample.caseId ? "is-row-selected" : ""}`}
                    onClick={() => setSelectedCaseId(sample.caseId)}
                  >
                    <td>{sample.caseId}</td>
                    <td>{sample.userQuery}</td>
                    <td>{sample.answerReference}</td>
                    <td>{String(caseItem.baselineRun.trace.answerTrace.outputs.answerOutput)}</td>
                    <td>{String(caseItem.candidateRun.trace.answerTrace.outputs.answerOutput)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel__header">
          <h3>当前 Case 指标</h3>
          <span>{selectedCase.caseId}</span>
        </div>
        <div className="trace-detail-layout">
          <div className="trace-card">
            <div className="trace-card__title">对照组 Baseline</div>
            <div className="metric-result-list">
              {baselineMetrics.map((metric) => (
                <div key={`baseline-${metric.metricName}`} className="metric-result-item">
                  <strong>{metric.metricName}</strong>
                  <span>{String(metric.score)}</span>
                  <p>{metric.reason}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="trace-card">
            <div className="trace-card__title">实验组 Candidate</div>
            <div className="metric-result-list">
              {candidateMetrics.map((metric) => (
                <div key={`candidate-${metric.metricName}`} className="metric-result-item">
                  <strong>{metric.metricName}</strong>
                  <span>{String(metric.score)}</span>
                  <p>{metric.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const ExperimentsView = ({
  selectedCaseId,
  setSelectedCaseId,
}: {
  selectedCaseId: string;
  setSelectedCaseId: (value: string) => void;
}) => {
  const selectedCase = demoViewModel.caseDetails.find((item) => item.caseId === selectedCaseId) ?? demoViewModel.caseDetails[0];
  const baselineOverall = demoViewModel.groupedBaselineMetrics.get("overall") ?? [];
  const candidateOverall = demoViewModel.groupedCandidateMetrics.get("overall") ?? [];

  return (
    <>
      <section className="metric-grid">
        <MetricCard
          title="Proxy CTR"
          subtitle="点击意图代理指标"
          baselineValue={formatMetricValue(averageForMetric(baselineOverall, "proxy_ctr"))}
          candidateValue={formatMetricValue(averageForMetric(candidateOverall, "proxy_ctr"))}
          deltaLabel={formatDelta(averageForMetric(candidateOverall, "proxy_ctr") - averageForMetric(baselineOverall, "proxy_ctr"))}
        />
        <MetricCard
          title="Proxy CVR"
          subtitle="转化意图代理指标"
          baselineValue={formatMetricValue(averageForMetric(baselineOverall, "proxy_cvr"))}
          candidateValue={formatMetricValue(averageForMetric(candidateOverall, "proxy_cvr"))}
          deltaLabel={formatDelta(averageForMetric(candidateOverall, "proxy_cvr") - averageForMetric(baselineOverall, "proxy_cvr"))}
        />
        <MetricCard
          title="Satisfaction"
          subtitle="满意度代理指标"
          baselineValue={formatMetricValue(averageForMetric(baselineOverall, "proxy_satisfaction"))}
          candidateValue={formatMetricValue(averageForMetric(candidateOverall, "proxy_satisfaction"))}
          deltaLabel={formatDelta(averageForMetric(candidateOverall, "proxy_satisfaction") - averageForMetric(baselineOverall, "proxy_satisfaction"))}
        />
        <MetricCard
          title="Latency"
          subtitle="总耗时"
          baselineValue={`${formatMetricValue(averageForMetric(baselineOverall, "latency_ms"))}ms`}
          candidateValue={`${formatMetricValue(averageForMetric(candidateOverall, "latency_ms"))}ms`}
          deltaLabel={`${(averageForMetric(candidateOverall, "latency_ms") - averageForMetric(baselineOverall, "latency_ms")).toFixed(1)}ms`}
        />
      </section>

      <section className="insight-layout">
        <div className="panel insight-panel">
          <div className="panel__header">
            <h3>归因摘要</h3>
            <span>先看整体结果，再看根因</span>
          </div>
          <div className="summary-list">
            {demoViewModel.comparison.rootCauseSummary.map((line) => (
              <div key={line} className="summary-list__item">
                {line}
              </div>
            ))}
          </div>
        </div>
        <div className="panel attribution-panel">
          <div className="panel__header">
            <h3>驱动因子</h3>
            <span>规则化 root-cause analysis</span>
          </div>
          {demoViewModel.comparison.attributionRecords.map((record) => (
            <article key={`${record.layer}-${record.candidateDriver}`} className="attribution-card">
              <div className="attribution-card__layer">{layerLabel[record.layer]}</div>
              <strong>{record.candidateDriver}</strong>
              <p>影响目标：{record.targetMetric}</p>
              <p>Delta: {formatDelta(record.delta)}</p>
              <p>Confidence: {(record.confidence * 100).toFixed(0)}%</p>
            </article>
          ))}
        </div>
      </section>

      <DeltaTable rows={[...demoViewModel.comparison.overallDeltas, ...demoViewModel.comparison.layerDeltas]} />

      <section className="case-layout">
        <div className="panel case-list-panel">
          <div className="panel__header">
            <h3>证据样本</h3>
            <span>overall -&gt; layer -&gt; case -&gt; trace</span>
          </div>
          <div className="case-list">
            {demoViewModel.caseDetails.map((caseItem) => (
              <button
                key={caseItem.caseId}
                type="button"
                className={`case-card ${selectedCase?.caseId === caseItem.caseId ? "is-selected" : ""}`}
                onClick={() => setSelectedCaseId(caseItem.caseId)}
              >
                <div className="case-card__top">
                  <span className="case-card__id">#{caseItem.caseId}</span>
                  <span className="case-card__domain">{caseItem.domain === "food_delivery" ? "外卖" : "商超"}</span>
                </div>
                <strong>{caseItem.title}</strong>
                <div className="case-card__layers">
                  {caseItem.deltas.map((delta) => (
                    <span
                      key={delta.layer}
                      className={`case-card__layer ${delta.delta < 0 ? "is-negative" : "is-positive"}`}
                    >
                      {layerLabel[delta.layer]} {formatDelta(delta.delta)}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {selectedCase ? (
          <div className="panel case-detail-panel">
            <div className="panel__header">
              <h3>Case 明细</h3>
              <span>{selectedCase.title}</span>
            </div>
            <div className="trace-grid">
              <TracePanel label="对照组 Baseline" run={selectedCase.baselineRun} />
              <TracePanel label="实验组 Candidate" run={selectedCase.candidateRun} />
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
};

const TraceView = ({
  selectedCase,
}: {
  selectedCase: (typeof demoViewModel.caseDetails)[number];
}) => (
  <section className="single-panel-grid">
    <div className="panel">
      <div className="panel__header">
        <h3>Trace 明细</h3>
        <span>{selectedCase.title}</span>
      </div>
      <div className="trace-detail-layout">
        <div className="trace-grid">
          <TracePanel label="对照组 Baseline" run={selectedCase.baselineRun} />
          <TracePanel label="实验组 Candidate" run={selectedCase.candidateRun} />
        </div>
        <div className="trace-step-panel">
          <div className="trace-card">
            <div className="trace-card__title">步骤说明 Step Breakdown</div>
            <div className="step-timeline">
              {[
                {
                  layer: "retrieval",
                  label: "召回阶段",
                  baseline: selectedCase.baselineRun.trace.retrievalTrace,
                  candidate: selectedCase.candidateRun.trace.retrievalTrace,
                },
                {
                  layer: "rerank",
                  label: "重排阶段",
                  baseline: selectedCase.baselineRun.trace.rerankTrace,
                  candidate: selectedCase.candidateRun.trace.rerankTrace,
                },
                {
                  layer: "answer",
                  label: "回答生成阶段",
                  baseline: selectedCase.baselineRun.trace.answerTrace,
                  candidate: selectedCase.candidateRun.trace.answerTrace,
                },
              ].map((step) => (
                <div key={step.layer} className="step-card">
                  <div className="step-card__top">
                    <strong>{step.label}</strong>
                    <span>
                      {step.baseline.latencyMs}ms vs {step.candidate.latencyMs}ms
                    </span>
                  </div>
                  <div className="step-card__body">
                    <div>
                      <span className="step-card__label">对照组输出</span>
                      <code>{JSON.stringify(step.baseline.outputs, null, 2)}</code>
                    </div>
                    <div>
                      <span className="step-card__label">实验组输出</span>
                      <code>{JSON.stringify(step.candidate.outputs, null, 2)}</code>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const StatsView = () => {
  const retrieval = demoViewModel.groupedCandidateMetrics.get("retrieval") ?? [];
  const rerank = demoViewModel.groupedCandidateMetrics.get("rerank") ?? [];
  const answer = demoViewModel.groupedCandidateMetrics.get("answer") ?? [];

  return (
    <section className="single-panel-grid">
      <div className="panel">
        <div className="panel__header">
          <h3>各层平均分</h3>
          <span>当前展示实验组 Candidate</span>
        </div>
        <div className="kv-grid">
          <div className="kv-card">
            <span>召回层均值</span>
            <strong>{formatMetricValue(retrieval.reduce((sum, item) => sum + Number(item.score), 0) / Math.max(1, retrieval.length))}</strong>
          </div>
          <div className="kv-card">
            <span>重排层均值</span>
            <strong>{formatMetricValue(rerank.reduce((sum, item) => sum + Number(item.score), 0) / Math.max(1, rerank.length))}</strong>
          </div>
          <div className="kv-card">
            <span>回答层均值</span>
            <strong>{formatMetricValue(answer.reduce((sum, item) => sum + Number(item.score), 0) / Math.max(1, answer.length))}</strong>
          </div>
        </div>
        <div className="bar-chart">
          {[
            { label: "召回层", value: retrieval.reduce((sum, item) => sum + Number(item.score), 0) / Math.max(1, retrieval.length) },
            { label: "重排层", value: rerank.reduce((sum, item) => sum + Number(item.score), 0) / Math.max(1, rerank.length) },
            { label: "回答层", value: answer.reduce((sum, item) => sum + Number(item.score), 0) / Math.max(1, answer.length) },
          ].map((item) => (
            <div key={item.label} className="bar-row">
              <span>{item.label}</span>
              <div className="bar-row__track">
                <div className="bar-row__fill" style={{ width: `${Math.max(6, item.value * 100)}%` }} />
              </div>
              <strong>{formatMetricValue(item.value)}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const AutomationView = () => (
  <section className="single-panel-grid">
    <div className="panel">
      <div className="panel__header">
        <h3>自动化建议</h3>
        <span>建议自动化的回归任务</span>
      </div>
      <div className="summary-list">
        <div className="summary-list__item">每天回归跑一次外卖搜索核心样本集，发现 retrieval coverage 回退就告警。</div>
        <div className="summary-list__item">当实验组 proxy_cvr 低于对照组 5% 时自动输出 root cause summary。</div>
        <div className="summary-list__item">出现 answer correctness 非法输出时，自动打上 invalid_judgment 标签并导出证据样本。</div>
      </div>
    </div>
  </section>
);

const renderContent = (
  activeView: NavItem,
  selectedCaseId: string,
  setSelectedCaseId: (value: string) => void,
  datasets: CustomDataset[],
  onCreateDataset: (dataset: CustomDataset) => void,
  evaluators: CustomEvaluator[],
  onCreateEvaluator: (evaluator: CustomEvaluator) => void,
) => {
  const selectedCase =
    demoViewModel.caseDetails.find((item) => item.caseId === selectedCaseId) ?? demoViewModel.caseDetails[0];

  switch (activeView) {
    case "prompt":
      return <PromptView />;
    case "playground":
      return <PlaygroundView />;
    case "datasets":
      return <DatasetView datasets={datasets} onCreate={onCreateDataset} />;
    case "evaluators":
      return <EvaluatorView evaluators={evaluators} onCreate={onCreateEvaluator} />;
    case "experiments_run":
      return <ExperimentRunView selectedCaseId={selectedCaseId} setSelectedCaseId={setSelectedCaseId} />;
    case "experiments_ab":
      return <ExperimentsView selectedCaseId={selectedCaseId} setSelectedCaseId={setSelectedCaseId} />;
    case "trace":
      return <TraceView selectedCase={selectedCase} />;
    case "stats":
      return <StatsView />;
    case "automation":
      return <AutomationView />;
    default:
      return null;
  }
};

export const App = () => {
  const [activeView, setActiveView] = useState<NavItem>("experiments_ab");
  const [selectedCaseId, setSelectedCaseId] = useState(demoViewModel.caseDetails[0]?.caseId ?? "");
  const [customDatasets, setCustomDatasets] = useState<CustomDataset[]>([]);
  const [customEvaluators, setCustomEvaluators] = useState<CustomEvaluator[]>([]);

  const heroMeta = useMemo(() => viewMeta[activeView], [activeView]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__mark">D</div>
          <div>
            <div className="brand__title">Downey Loop</div>
            <div className="brand__subtitle">AI Search Evals</div>
          </div>
        </div>
        <nav className="nav">
          {navConfig.map((section) => (
            <div className="nav__section" key={section.title}>
              <div className="nav__group-title">{section.title}</div>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`nav__item ${activeView === item.id ? "is-active" : ""}`}
                  onClick={() => setActiveView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="content">
        <header className="hero">
          <div>
            <div className="eyebrow">{heroMeta.eyebrow}</div>
            <h1>{heroMeta.title}</h1>
            <p>{heroMeta.description}</p>
          </div>
          <div className="hero__meta">
            <div className="hero__pill">对照组 Baseline: {demoViewModel.baseline.target.version}</div>
            <div className="hero__pill">实验组 Candidate: {demoViewModel.candidate.target.version}</div>
          </div>
        </header>
        {renderContent(
          activeView,
          selectedCaseId,
          setSelectedCaseId,
          customDatasets,
          (dataset) => setCustomDatasets((prev) => [dataset, ...prev]),
          customEvaluators,
          (evaluator) => setCustomEvaluators((prev) => [evaluator, ...prev]),
        )}
      </main>
    </div>
  );
};
