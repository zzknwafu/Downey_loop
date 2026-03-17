import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { sampleAgents, samplePrompts } from "../domain/sample-data.js";
import type {
  AgentVersion,
  DatasetType,
  ExperimentCaseRun,
  ExperimentRun,
  LayerName,
  MetricResult,
  PromptVersion,
} from "../domain/types.js";
import type {
  DatasetCaseRecord,
  DatasetRecord,
  DatasetSynthesisResult,
  UpdateDatasetInput,
} from "../shared/contracts.js";
import {
  createDatasetCase as createDatasetCaseRequest,
  deleteDatasetCase as deleteDatasetCaseRequest,
  fetchDataset,
  fetchDatasetCase,
  fetchDatasetCases,
  synthesizeDatasetCases as synthesizeDatasetCasesRequest,
  updateDataset as updateDatasetRequest,
  updateDatasetCase as updateDatasetCaseRequest,
} from "./api.js";
import type { DemoDataset, DemoEvaluator, DemoViewModel } from "./view-model.js";
import { demoViewModel, loadRemoteDemoViewModel } from "./view-model.js";

type ActiveView =
  | "prompt_dev"
  | "playground"
  | "datasets"
  | "evaluators"
  | "experiment_runs"
  | "ab_experiments"
  | "trace"
  | "stats"
  | "automation";

type DisplayLayer = Exclude<LayerName, "query">;
type EvaluatorFamilyChoice = "model" | "code";
type DatasetTypeFilter = "all" | DatasetType;
type DatasetDetailTab = "evaluation_set" | "synthesis";
type SynthesisDirection =
  | "generalize"
  | "augment_failures"
  | "augment_guardrails"
  | "align_online_distribution";

interface SynthesisColumnDraft {
  name: string;
  enabled: boolean;
  description: string;
  requirement: string;
}

interface ExperimentListRow {
  id: string;
  label: string;
  status: ExperimentRun["status"];
  datasetName: string;
  targetName: string;
  targetVersion: string;
  totalCases: number;
  invalidJudgmentCount: number;
  overallScore: number;
  startedAt?: string;
  finishedAt?: string;
  experiment: ExperimentRun;
}

interface TraceListRow {
  key: string;
  traceId: string;
  experimentId: string;
  experimentLabel: string;
  caseId: string;
  title: string;
  trace: ExperimentCaseRun["trace"];
  caseRun: ExperimentCaseRun;
}

interface DatasetFormState {
  name: string;
  description: string;
  datasetType: DatasetType;
  sampleCount: number;
  schema: DatasetRecord["schema"];
}

interface EvaluatorFormState {
  name: string;
  layer: DisplayLayer;
  metricType: DemoEvaluator["metricType"];
  description: string;
  codeStrategy: string;
}

interface ExperimentFormState {
  name: string;
  datasetId: string;
  targetKey: string;
  evaluatorIds: string[];
}

interface PromptPreviewState {
  payload: string;
  rendered: string;
  error: string | null;
}

const layerOrder: DisplayLayer[] = ["retrieval", "rerank", "answer", "overall"];

const layerLabels: Record<DisplayLayer, string> = {
  retrieval: "Retrieval",
  rerank: "Rerank",
  answer: "Answer",
  overall: "Overall",
};

const datasetTypeLabels: Record<DatasetType, string> = {
  ideal_output: "普通数据集",
  workflow: "Workflow 数据集",
  trace_monitor: "Trace 监控集",
};

const metricTypeLabels: Record<DemoEvaluator["metricType"], string> = {
  binary: "Binary",
  continuous: "Continuous",
  categorical: "Categorical",
};

const evaluatorFamilyLabels: Record<EvaluatorFamilyChoice, string> = {
  model: "LLM Evaluator",
  code: "Code Evaluator",
};

const datasetTemplateColumns: Record<DatasetType, Array<{ name: string; description: string }>> = {
  ideal_output: [
    { name: "input", description: "评测输入" },
    { name: "reference_output", description: "理想输出" },
    { name: "context", description: "补充上下文" },
  ],
  workflow: [
    { name: "input", description: "工作流原始输入" },
    { name: "workflow_output", description: "工作流输出" },
    { name: "expected_steps", description: "期望步骤" },
  ],
  trace_monitor: [
    { name: "trace_id", description: "trace 唯一标识" },
    { name: "final_output", description: "最终输出" },
    { name: "trajectory", description: "执行轨迹" },
  ],
};

const datasetFieldGuides: Record<
  DatasetType,
  {
    summary: string;
    recommended: string[];
    extensible: string[];
  }
> = {
  ideal_output: {
    summary: "适合理想输出评测，围绕 input / reference_output / context 组织样本。",
    recommended: ["input", "reference_output", "context"],
    extensible: ["query_constraints", "reference_items", "business_labels", "expected_top_items"],
  },
  workflow: {
    summary: "适合 agent 或 workflow 执行结果评测，强调步骤与动作回放。",
    recommended: ["input", "workflow_output", "expected_steps"],
    extensible: ["expected_actions", "tool_inputs", "tool_outputs", "step_constraints"],
  },
  trace_monitor: {
    summary: "适合轨迹回放、线上问题复现与 trace 监控。",
    recommended: ["trace_id", "final_output", "trajectory"],
    extensible: ["step_records", "tool_calls", "latency_profile", "failure_reason"],
  },
};

const buildDatasetSchema = (datasetType: DatasetType): DatasetRecord["schema"] =>
  datasetTemplateColumns[datasetType].map((column) => ({
    name: column.name,
    data_type:
      column.name === "context" || column.name === "workflow_output" || column.name === "trajectory"
        ? "JSON"
        : "String",
    required: true,
    description: column.description,
  }));

const createEmptyDatasetForm = (): DatasetFormState => ({
  name: "",
  description: "",
  datasetType: "ideal_output",
  sampleCount: 0,
  schema: buildDatasetSchema("ideal_output"),
});

const mapDatasetRecordToDemoDataset = (dataset: DatasetRecord): DemoDataset => ({
  id: dataset.id,
  name: dataset.name,
  description: dataset.description,
  datasetType: dataset.dataset_type,
  columns: dataset.schema,
  cases: dataset.cases,
  itemCount: dataset.cases.length,
  version: dataset.version,
});

const codeStrategies = [
  { value: "exact_match", label: "Exact Match", description: "输出与参考答案完全一致才通过" },
  { value: "regex_match", label: "Regex Match", description: "命中规则表达式即通过" },
  { value: "fuzzy_match", label: "Fuzzy Match", description: "按字符串相似度返回分数" },
  { value: "python_script", label: "Python Script", description: "预留后端 runner 执行自定义逻辑" },
];

const navGroups: Array<{
  title: string;
  items: Array<{ key: ActiveView; label: string }>;
}> = [
  {
    title: "Targets",
    items: [
      { key: "prompt_dev", label: "Prompts" },
      { key: "playground", label: "Agents" },
    ],
  },
  {
    title: "评测",
    items: [
      { key: "datasets", label: "评测集" },
      { key: "evaluators", label: "评估器" },
      { key: "experiment_runs", label: "实验运行" },
      { key: "ab_experiments", label: "AB 实验" },
    ],
  },
  {
    title: "观测",
    items: [
      { key: "trace", label: "Trace" },
      { key: "stats", label: "统计" },
      { key: "automation", label: "自动化任务" },
    ],
  },
];

const formatMetric = (value: number) => {
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }

  return value.toFixed(3);
};

const formatDelta = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;

const formatDate = (value?: string) => {
  if (!value) {
    return "未开始";
  }

  return value.replace("T", " ").slice(0, 16);
};

const metricScore = (value: MetricResult["score"]) => (typeof value === "number" ? value : 0);

const average = (values: number[]) =>
  values.length > 0 ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : 0;

const averageLayerScore = (metrics: MetricResult[], layer: DisplayLayer) =>
  average(metrics.filter((metric) => metric.layer === layer).map((metric) => metricScore(metric.score)));

const statusTone = (value: number) => {
  if (value > 0.03) {
    return "is-success";
  }
  if (value < -0.03) {
    return "is-danger";
  }
  return "is-warning";
};

const formatCaseValue = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
};

const cloneDatasetCaseRecord = (value: DatasetCaseRecord): DatasetCaseRecord =>
  JSON.parse(JSON.stringify(value)) as DatasetCaseRecord;

const interpolatePromptTemplate = (template: string, payload: Record<string, unknown>) =>
  template.replace(/\{\{(.*?)\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim();
    const value = payload[key];
    if (value === undefined) {
      return `{{${key}}}`;
    }

    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  });

const buildPromptPreviewState = (prompt: PromptVersion | undefined, payloadRaw: string): PromptPreviewState => {
  if (!prompt) {
    return {
      payload: payloadRaw,
      rendered: "",
      error: "未选择 prompt。",
    };
  }

  try {
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    const rendered = `${prompt.systemPrompt}\n\n${interpolatePromptTemplate(prompt.userTemplate, payload)}`;
    return {
      payload: payloadRaw,
      rendered,
      error: null,
    };
  } catch (error) {
    return {
      payload: payloadRaw,
      rendered: "",
      error: error instanceof Error ? error.message : "JSON 解析失败",
    };
  }
};

const buildPromptDebugPayload = (prompt: PromptVersion | undefined) =>
  JSON.stringify(
    Object.fromEntries(Object.keys((prompt?.inputSchema as Record<string, unknown> | undefined) ?? {}).map((key) => [key, ""])),
    null,
    2,
  );

const buildSynthesisColumns = (dataset: DemoDataset | undefined): SynthesisColumnDraft[] =>
  (dataset?.columns ?? []).map((column) => ({
    name: column.name,
    enabled: true,
    description: column.description,
    requirement: "",
  }));

const buildEmptyDatasetCase = (datasetType: DatasetType): DatasetCaseRecord => {
  const id = `case_${Date.now().toString(36)}`;

  if (datasetType === "workflow") {
    return {
      id,
      input: "",
      workflow_output: {},
      expected_steps: [],
      context: {},
    };
  }

  if (datasetType === "trace_monitor") {
    return {
      id,
      trace_id: `trace_${Date.now().toString(36)}`,
      final_output: "",
      trajectory: [],
      context: {},
    };
  }

  return {
    id,
    input: "",
    reference_output: "",
    context: {},
  };
};

const caseTitleMap = (viewModel: DemoViewModel) =>
  new Map(viewModel.sampleCases.map((sample) => [sample.caseId, sample.userQuery]));

const createExperimentRows = (viewModel: DemoViewModel): ExperimentListRow[] => {
  const datasetMap = new Map(viewModel.datasets.map((dataset) => [dataset.id, dataset.name]));

  return [
    {
      id: viewModel.baseline.experimentId,
      label: "Baseline Run",
      status: viewModel.baseline.status,
      datasetName: datasetMap.get(viewModel.baseline.datasetId ?? "") ?? "未绑定数据集",
      targetName: viewModel.baseline.target.name,
      targetVersion: viewModel.baseline.target.version,
      totalCases: viewModel.baseline.summary.totalCases,
      invalidJudgmentCount: viewModel.baseline.summary.invalidJudgmentCount,
      overallScore: averageLayerScore(
        viewModel.baseline.caseRuns.flatMap((caseRun) => caseRun.layerMetrics),
        "overall",
      ),
      startedAt: viewModel.baseline.startedAt,
      finishedAt: viewModel.baseline.finishedAt,
      experiment: viewModel.baseline,
    },
    {
      id: viewModel.candidate.experimentId,
      label: "Candidate Run",
      status: viewModel.candidate.status,
      datasetName: datasetMap.get(viewModel.candidate.datasetId ?? "") ?? "未绑定数据集",
      targetName: viewModel.candidate.target.name,
      targetVersion: viewModel.candidate.target.version,
      totalCases: viewModel.candidate.summary.totalCases,
      invalidJudgmentCount: viewModel.candidate.summary.invalidJudgmentCount,
      overallScore: averageLayerScore(
        viewModel.candidate.caseRuns.flatMap((caseRun) => caseRun.layerMetrics),
        "overall",
      ),
      startedAt: viewModel.candidate.startedAt,
      finishedAt: viewModel.candidate.finishedAt,
      experiment: viewModel.candidate,
    },
  ];
};

const buildTraceRows = (
  rows: ExperimentListRow[],
  titles: Map<string, string>,
): TraceListRow[] =>
  rows.flatMap((row) =>
    row.experiment.caseRuns.map((caseRun) => ({
      key: `${row.id}:${caseRun.trace.traceId}`,
      traceId: caseRun.trace.traceId,
      experimentId: row.id,
      experimentLabel: row.label,
      caseId: caseRun.caseId,
      title: titles.get(caseRun.caseId) ?? caseRun.caseId,
      trace: caseRun.trace,
      caseRun,
    })),
  );

const Drawer = ({
  open,
  title,
  subtitle,
  onClose,
  wide = false,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) =>
  open ? (
    <div className="overlay overlay--drawer" role="presentation" onClick={onClose}>
      <aside
        className={`drawer ${wide ? "drawer--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer__header">
          <div>
            <h3>{title}</h3>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close drawer">
            ×
          </button>
        </div>
        <div className="drawer__body">{children}</div>
      </aside>
    </div>
  ) : null;

const Modal = ({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) =>
  open ? (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div className="overlay-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="overlay-card__header">
          <div>
            <h3>{title}</h3>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </div>
        <div className="overlay-card__body">{children}</div>
      </div>
    </div>
  ) : null;

export const App = () => {
  const [viewModel, setViewModel] = useState<DemoViewModel>(demoViewModel);
  const [syncState, setSyncState] = useState<"syncing" | "ready" | "fallback">("syncing");
  const [activeView, setActiveView] = useState<ActiveView>("datasets");

  const [createdDatasets, setCreatedDatasets] = useState<DemoDataset[]>([]);
  const [createdPrompts, setCreatedPrompts] = useState<PromptVersion[]>([]);
  const [createdAgents, setCreatedAgents] = useState<AgentVersion[]>([]);
  const [editedDatasets, setEditedDatasets] = useState<Record<string, DemoDataset>>({});
  const [editedPrompts, setEditedPrompts] = useState<Record<string, PromptVersion>>({});
  const [createdEvaluators, setCreatedEvaluators] = useState<DemoEvaluator[]>([]);
  const [createdExperiments, setCreatedExperiments] = useState<ExperimentListRow[]>([]);

  const [datasetQuery, setDatasetQuery] = useState("");
  const [datasetTypeFilter, setDatasetTypeFilter] = useState<DatasetTypeFilter>("all");
  const [evaluatorQuery, setEvaluatorQuery] = useState("");
  const [traceQuery, setTraceQuery] = useState("");

  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [selectedDatasetCaseId, setSelectedDatasetCaseId] = useState<string>("");
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [selectedEvaluatorId, setSelectedEvaluatorId] = useState<string>("");
  const [selectedExperimentId, setSelectedExperimentId] = useState<string>("");
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [selectedTraceKey, setSelectedTraceKey] = useState<string>("");

  const [runLayer, setRunLayer] = useState<DisplayLayer>("overall");
  const [evaluatorLayer, setEvaluatorLayer] = useState<DisplayLayer>("retrieval");
  const [abLayer, setAbLayer] = useState<DisplayLayer>("overall");

  const [showDatasetCreate, setShowDatasetCreate] = useState(false);
  const [showDatasetEdit, setShowDatasetEdit] = useState(false);
  const [showPromptCreateModal, setShowPromptCreateModal] = useState(false);
  const [showAgentCreateModal, setShowAgentCreateModal] = useState(false);
  const [showEvaluatorTypeModal, setShowEvaluatorTypeModal] = useState(false);
  const [showEvaluatorCreate, setShowEvaluatorCreate] = useState(false);
  const [showExperimentCreate, setShowExperimentCreate] = useState(false);
  const [showDatasetDrawer, setShowDatasetDrawer] = useState(false);
  const [showDatasetCaseDrawer, setShowDatasetCaseDrawer] = useState(false);
  const [showDatasetCaseEditor, setShowDatasetCaseEditor] = useState(false);
  const [showPromptDrawer, setShowPromptDrawer] = useState(false);
  const [showEvaluatorDrawer, setShowEvaluatorDrawer] = useState(false);
  const [showRunDrawer, setShowRunDrawer] = useState(false);
  const [showComparisonDrawer, setShowComparisonDrawer] = useState(false);
  const [showTraceDrawer, setShowTraceDrawer] = useState(false);

  const [selectedEvaluatorFamily, setSelectedEvaluatorFamily] = useState<EvaluatorFamilyChoice | null>(null);
  const [datasetDetailTab, setDatasetDetailTab] = useState<DatasetDetailTab>("evaluation_set");
  const [editingDatasetId, setEditingDatasetId] = useState<string>("");
  const [datasetSubmitting, setDatasetSubmitting] = useState(false);
  const [datasetFeedback, setDatasetFeedback] = useState<{ tone: "success" | "warning"; message: string } | null>(
    null,
  );
  const [synthesisSource, setSynthesisSource] = useState<"dataset" | "online">("dataset");
  const [synthesisStep, setSynthesisStep] = useState<1 | 2>(1);
  const [synthesisScenario, setSynthesisScenario] = useState("");
  const [synthesisPurpose, setSynthesisPurpose] = useState("");
  const [synthesisDirection, setSynthesisDirection] = useState<SynthesisDirection>("generalize");
  const [synthesisSampleCount, setSynthesisSampleCount] = useState(10);
  const [synthesisColumns, setSynthesisColumns] = useState<SynthesisColumnDraft[]>([]);
  const [datasetCasesLoading, setDatasetCasesLoading] = useState(false);
  const [datasetCaseSubmitting, setDatasetCaseSubmitting] = useState(false);
  const [datasetCaseDraft, setDatasetCaseDraft] = useState<DatasetCaseRecord | null>(null);
  const [datasetCaseEditorMode, setDatasetCaseEditorMode] = useState<"create" | "edit">("edit");
  const [datasetCaseJsonDrafts, setDatasetCaseJsonDrafts] = useState<Record<string, string>>({});
  const [datasetCaseFormError, setDatasetCaseFormError] = useState<string | null>(null);
  const [synthesisLoading, setSynthesisLoading] = useState(false);
  const [datasetSynthesisResult, setDatasetSynthesisResult] = useState<DatasetSynthesisResult | null>(null);
  const [promptDraft, setPromptDraft] = useState<PromptVersion | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentVersion | null>(null);
  const [promptDebugPayload, setPromptDebugPayload] = useState("{}");

  const [datasetForm, setDatasetForm] = useState<DatasetFormState>(createEmptyDatasetForm);
  const [evaluatorForm, setEvaluatorForm] = useState<EvaluatorFormState>({
    name: "",
    layer: "retrieval",
    metricType: "continuous",
    description: "",
    codeStrategy: "exact_match",
  });
  const [experimentForm, setExperimentForm] = useState<ExperimentFormState>({
    name: "",
    datasetId: "",
    targetKey: "baseline",
    evaluatorIds: [],
  });

  useEffect(() => {
    let active = true;

    const sync = async () => {
      try {
        const remoteViewModel = await loadRemoteDemoViewModel();
        if (!active) {
          return;
        }

        setViewModel(remoteViewModel);
        setSyncState("ready");
      } catch {
        if (!active) {
          return;
        }

        setSyncState("fallback");
      }
    };

    void sync();

    return () => {
      active = false;
    };
  }, []);

  const caseTitles = useMemo(() => caseTitleMap(viewModel), [viewModel]);
  const baseExperimentRows = useMemo(() => createExperimentRows(viewModel), [viewModel]);

  const allDatasets = useMemo(
    () => [...createdDatasets, ...viewModel.datasets].map((dataset) => editedDatasets[dataset.id] ?? dataset),
    [createdDatasets, editedDatasets, viewModel.datasets],
  );
  const allPrompts = useMemo(
    () => [...createdPrompts, ...samplePrompts].map((prompt) => editedPrompts[prompt.id] ?? prompt),
    [createdPrompts, editedPrompts],
  );
  const allAgents = useMemo(() => [...createdAgents, ...sampleAgents], [createdAgents]);
  const allEvaluators = useMemo(
    () => [...createdEvaluators, ...viewModel.evaluators],
    [createdEvaluators, viewModel.evaluators],
  );
  const allExperimentRows = useMemo(
    () => [...createdExperiments, ...baseExperimentRows],
    [createdExperiments, baseExperimentRows],
  );
  const allTraceRows = useMemo(() => buildTraceRows(allExperimentRows, caseTitles), [allExperimentRows, caseTitles]);

  useEffect(() => {
    if (!selectedDatasetId && allDatasets.length > 0) {
      setSelectedDatasetId(allDatasets[0]!.id);
      setExperimentForm((current) => ({ ...current, datasetId: allDatasets[0]!.id }));
    }
  }, [allDatasets, selectedDatasetId]);

  useEffect(() => {
    if (!selectedEvaluatorId && allEvaluators.length > 0) {
      setSelectedEvaluatorId(allEvaluators[0]!.id);
    }
  }, [allEvaluators, selectedEvaluatorId]);

  useEffect(() => {
    if (!selectedPromptId && allPrompts.length > 0) {
      setSelectedPromptId(allPrompts[0]!.id);
    }
  }, [allPrompts, selectedPromptId]);

  useEffect(() => {
    if (!selectedAgentId && allAgents.length > 0) {
      setSelectedAgentId(allAgents[0]!.id);
    }
  }, [allAgents, selectedAgentId]);

  useEffect(() => {
    if (!selectedExperimentId && allExperimentRows.length > 0) {
      setSelectedExperimentId(allExperimentRows[0]!.id);
    }
  }, [allExperimentRows, selectedExperimentId]);

  useEffect(() => {
    if (!selectedTraceKey && allTraceRows.length > 0) {
      setSelectedTraceKey(allTraceRows[0]!.key);
    }
  }, [allTraceRows, selectedTraceKey]);

  const filteredDatasets = useMemo(
    () =>
      allDatasets.filter((dataset) => {
        const matchesType = datasetTypeFilter === "all" || dataset.datasetType === datasetTypeFilter;
        const matchesQuery = [dataset.name, dataset.description, datasetTypeLabels[dataset.datasetType]]
          .join(" ")
          .toLowerCase()
          .includes(datasetQuery.trim().toLowerCase());
        return matchesType && matchesQuery;
      }),
    [allDatasets, datasetQuery, datasetTypeFilter],
  );

  const datasetTypeCounts = useMemo(
    () => ({
      all: allDatasets.length,
      ideal_output: allDatasets.filter((dataset) => dataset.datasetType === "ideal_output").length,
      workflow: allDatasets.filter((dataset) => dataset.datasetType === "workflow").length,
      trace_monitor: allDatasets.filter((dataset) => dataset.datasetType === "trace_monitor").length,
    }),
    [allDatasets],
  );

  const filteredEvaluators = useMemo(
    () =>
      allEvaluators.filter((evaluator) => {
        const matchesLayer = evaluator.layer === evaluatorLayer;
        const matchesQuery = [evaluator.name, evaluator.description]
          .join(" ")
          .toLowerCase()
          .includes(evaluatorQuery.trim().toLowerCase());
        return matchesLayer && matchesQuery;
      }),
    [allEvaluators, evaluatorLayer, evaluatorQuery],
  );

  const filteredTraceRows = useMemo(
    () =>
      allTraceRows.filter((row) =>
        [row.traceId, row.caseId, row.title, row.experimentLabel]
          .join(" ")
          .toLowerCase()
          .includes(traceQuery.trim().toLowerCase()),
      ),
    [allTraceRows, traceQuery],
  );

  const selectedDataset = allDatasets.find((dataset) => dataset.id === selectedDatasetId) ?? filteredDatasets[0];
  const synthesisDatasets = allDatasets.filter((dataset) => dataset.datasetType === "ideal_output");
  const selectedSynthesisDataset =
    synthesisDatasets.find((dataset) => dataset.id === selectedDatasetId) ?? synthesisDatasets[0];
  const selectedPrompt = allPrompts.find((prompt) => prompt.id === selectedPromptId) ?? allPrompts[0];
  const selectedAgent = allAgents.find((agent) => agent.id === selectedAgentId) ?? allAgents[0];
  const selectedEvaluator = allEvaluators.find((evaluator) => evaluator.id === selectedEvaluatorId) ?? filteredEvaluators[0];
  const selectedExperimentRow =
    allExperimentRows.find((experiment) => experiment.id === selectedExperimentId) ?? allExperimentRows[0];
  const selectedTraceRow = allTraceRows.find((trace) => trace.key === selectedTraceKey) ?? allTraceRows[0];
  const selectedDatasetCase =
    selectedDataset?.cases.find((item) => item.id === selectedDatasetCaseId) ?? selectedDataset?.cases[0];

  useEffect(() => {
    if (!selectedDataset) {
      return;
    }

    if (selectedDataset.cases.length === 0) {
      setSelectedDatasetCaseId("");
      return;
    }

    const exists = selectedDataset.cases.some((item) => item.id === selectedDatasetCaseId);
    if (!selectedDatasetCaseId || !exists) {
      setSelectedDatasetCaseId(selectedDataset.cases[0]!.id);
    }
  }, [selectedDataset, selectedDatasetCaseId]);

  useEffect(() => {
    setSynthesisColumns(buildSynthesisColumns(selectedSynthesisDataset));
  }, [selectedSynthesisDataset]);

  const migratedCozePrompts = useMemo(
    () => allPrompts.filter((prompt) => prompt.version.includes("-coze") || prompt.id.includes("_coze_")),
    [allPrompts],
  );

  useEffect(() => {
    if (!selectedPrompt) {
      setPromptDraft(null);
      return;
    }

    setPromptDraft({ ...selectedPrompt });
  }, [selectedPrompt]);

  useEffect(() => {
    if (!selectedPrompt) {
      setPromptDebugPayload("{}");
      return;
    }

    setPromptDebugPayload(buildPromptDebugPayload(selectedPrompt));
  }, [selectedPrompt?.id]);

  useEffect(() => {
    if (!selectedAgent) {
      setAgentDraft(null);
      return;
    }

    setAgentDraft({ ...selectedAgent });
  }, [selectedAgent]);

  const promptPreview = useMemo(
    () => buildPromptPreviewState(promptDraft ?? selectedPrompt, promptDebugPayload),
    [promptDebugPayload, promptDraft, selectedPrompt],
  );

  const currentRunCases = useMemo(() => {
    if (!selectedExperimentRow) {
      return [];
    }

    return selectedExperimentRow.experiment.caseRuns.map((caseRun) => ({
      caseRun,
      title: caseTitles.get(caseRun.caseId) ?? caseRun.caseId,
      layerScore: averageLayerScore(caseRun.layerMetrics, runLayer),
      overallScore: averageLayerScore(caseRun.layerMetrics, "overall"),
    }));
  }, [caseTitles, runLayer, selectedExperimentRow]);

  const selectedRunCase =
    currentRunCases.find((item) => item.caseRun.caseId === selectedCaseId)?.caseRun ?? currentRunCases[0]?.caseRun;

  const selectedRunTraceRow =
    selectedRunCase && selectedExperimentRow
      ? allTraceRows.find(
          (row) => row.traceId === selectedRunCase.traceId && row.experimentId === selectedExperimentRow.id,
        ) ?? allTraceRows.find((row) => row.traceId === selectedRunCase.traceId)
      : undefined;

  const selectedExperimentAverageMetrics = Object.entries(selectedExperimentRow?.experiment.summary.averageMetrics ?? {}).slice(
    0,
    6,
  );

  const evidenceCases = useMemo(() => {
    const caseMap = new Map(viewModel.caseDetails.map((detail) => [detail.caseId, detail]));
    return viewModel.comparison.evidenceCaseIds
      .map((caseId) => caseMap.get(caseId))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .map((detail) => ({
        ...detail,
        selectedLayerDelta:
          abLayer === "overall"
            ? average(detail.deltas.map((item) => item.delta))
            : detail.deltas.find((item) => item.layer === abLayer)?.delta ?? 0,
      }));
  }, [abLayer, viewModel.caseDetails, viewModel.comparison.evidenceCaseIds]);

  const openTrace = (traceId: string, experimentId?: string) => {
    const targetTrace =
      allTraceRows.find(
        (row) => row.traceId === traceId && (experimentId ? row.experimentId === experimentId : true),
      ) ?? allTraceRows.find((row) => row.traceId === traceId);

    if (!targetTrace) {
      return;
    }

    setSelectedTraceKey(targetTrace.key);
    setActiveView("trace");
    setShowTraceDrawer(true);
  };

  const resetDatasetComposer = () => {
    setShowDatasetCreate(false);
    setShowDatasetEdit(false);
    setEditingDatasetId("");
    setDatasetSubmitting(false);
    setDatasetFeedback(null);
    setDatasetSynthesisResult(null);
    setSynthesisStep(1);
    setSynthesisScenario("");
    setSynthesisPurpose("");
    setSynthesisDirection("generalize");
    setSynthesisSource("dataset");
    setSynthesisSampleCount(10);
    setShowDatasetCaseEditor(false);
    setShowDatasetCaseDrawer(false);
    setDatasetCaseDraft(null);
    setDatasetCaseEditorMode("edit");
    setDatasetCaseJsonDrafts({});
    setDatasetCaseFormError(null);
    setDatasetForm(createEmptyDatasetForm());
  };

  const startCreateDataset = () => {
    setShowDatasetEdit(false);
    setEditingDatasetId("");
    setDatasetFeedback(null);
    setDatasetDetailTab("evaluation_set");
    setDatasetForm(createEmptyDatasetForm());
    setShowDatasetCreate(true);
  };

  const openDatasetEditor = async (datasetId: string) => {
    const currentDataset = allDatasets.find((dataset) => dataset.id === datasetId);
    if (!currentDataset) {
      return;
    }

    setSelectedDatasetId(datasetId);
    setShowDatasetCreate(false);
    setShowDatasetEdit(true);
    setDatasetDetailTab("evaluation_set");
    setEditingDatasetId(datasetId);
    setDatasetFeedback(null);
    setShowDatasetCaseDrawer(false);
    setDatasetForm({
      name: currentDataset.name,
      description: currentDataset.description,
      datasetType: currentDataset.datasetType,
      sampleCount: currentDataset.itemCount,
      schema: currentDataset.columns.map((column) => ({ ...column })),
    });

    if (datasetId.startsWith("dataset_local_")) {
      return;
    }

    try {
      const response = await fetchDataset(datasetId);
      const latestDataset = mapDatasetRecordToDemoDataset(response.item);
      setEditedDatasets((current) => ({ ...current, [datasetId]: latestDataset }));
      setDatasetForm({
        name: latestDataset.name,
        description: latestDataset.description,
        datasetType: latestDataset.datasetType,
        sampleCount: latestDataset.itemCount,
        schema: latestDataset.columns.map((column) => ({ ...column })),
      });
    } catch {
      // Keep current UI snapshot when remote detail is unavailable.
    }

    try {
      setDatasetCasesLoading(true);
      const response = await fetchDatasetCases(datasetId);
      setEditedDatasets((current) => {
        const existing = current[datasetId] ?? currentDataset;
        return {
          ...current,
          [datasetId]: {
            ...existing,
            cases: response.items,
            itemCount: response.items.length,
          },
        };
      });
    } catch {
      // Keep current case list when list API is unavailable.
    } finally {
      setDatasetCasesLoading(false);
    }
  };

  const handleCreateDataset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextDataset: DemoDataset = {
      id: `dataset_local_${Date.now().toString(36)}`,
      name: datasetForm.name.trim(),
      description: datasetForm.description.trim(),
      datasetType: datasetForm.datasetType,
      columns: datasetForm.schema.map((column) => ({ ...column })),
      cases: [],
      itemCount: datasetForm.sampleCount,
      version: "0.1.0-mock",
    };

    setCreatedDatasets((current) => [nextDataset, ...current]);
    setSelectedDatasetId(nextDataset.id);
    setShowDatasetCreate(false);
    setShowDatasetEdit(false);
    setEditingDatasetId("");
    setDatasetFeedback({
      tone: "success",
      message: "评测集已在前端 mock 状态创建，可继续查看详情或进入编辑。",
    });
    setDatasetForm(createEmptyDatasetForm());
  };

  const handleUpdateDataset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editingDatasetId) {
      return;
    }

    const currentDataset = allDatasets.find((dataset) => dataset.id === editingDatasetId);
    if (!currentDataset) {
      return;
    }

    const payload: UpdateDatasetInput = {
      name: datasetForm.name.trim(),
      description: datasetForm.description.trim(),
      dataset_type: datasetForm.datasetType,
      sample_count: currentDataset.itemCount,
      schema: datasetForm.schema.map((column) => ({ ...column })),
    };

    setDatasetSubmitting(true);

    try {
      const response = await updateDatasetRequest(editingDatasetId, payload);
      const updatedDataset = mapDatasetRecordToDemoDataset(response.item);

      setEditedDatasets((current) => ({
        ...current,
        [editingDatasetId]: updatedDataset,
      }));
      setSelectedDatasetId(updatedDataset.id);
      setShowDatasetEdit(false);
      setEditingDatasetId("");
      setDatasetFeedback({
        tone: "success",
        message: "评测集已通过 update 接口更新。",
      });
      setDatasetForm(createEmptyDatasetForm());
    } catch {
      const fallbackDataset: DemoDataset = {
        ...currentDataset,
        name: payload.name,
        description: payload.description,
        datasetType: payload.dataset_type,
        columns: payload.schema,
        cases: currentDataset.cases,
      };

      setEditedDatasets((current) => ({
        ...current,
        [editingDatasetId]: fallbackDataset,
      }));
      setSelectedDatasetId(editingDatasetId);
      setShowDatasetEdit(false);
      setEditingDatasetId("");
      setDatasetFeedback({
        tone: "warning",
        message: "update 接口当前未返回成功，前端已先用 mock 状态更新展示。",
      });
      setDatasetForm(createEmptyDatasetForm());
    } finally {
      setDatasetSubmitting(false);
    }
  };

  const openDatasetCaseDetail = async (caseId: string) => {
    if (!selectedDataset) {
      return;
    }

    setSelectedDatasetCaseId(caseId);

    try {
      const response = await fetchDatasetCase(selectedDataset.id, caseId);
      const nextCase = response.item;
      setEditedDatasets((current) => ({
        ...current,
        [selectedDataset.id]: {
          ...(current[selectedDataset.id] ?? selectedDataset),
          cases: selectedDataset.cases.map((item) => (item.id === nextCase.id ? nextCase : item)),
          itemCount: selectedDataset.cases.length,
        },
      }));
    } catch {
      // Keep local case snapshot when detail API is unavailable.
    }

    setShowDatasetCaseDrawer(true);
  };

  const openDatasetCaseEditor = async (caseId: string) => {
    if (!selectedDataset) {
      return;
    }

    setSelectedDatasetCaseId(caseId);
    setDatasetCaseEditorMode("edit");
    setDatasetCaseFormError(null);

    const currentCase = selectedDataset.cases.find((item) => item.id === caseId);
    if (!currentCase) {
      return;
    }

    let nextCase = currentCase;
    try {
      const response = await fetchDatasetCase(selectedDataset.id, caseId);
      nextCase = response.item;
    } catch {
      // Keep local case snapshot when detail API is unavailable.
    }

    setDatasetCaseDraft(cloneDatasetCaseRecord(nextCase));
    setDatasetCaseJsonDrafts(
      Object.fromEntries(
        Object.entries(nextCase)
          .filter(([, value]) => typeof value !== "string")
          .map(([key, value]) => [key, JSON.stringify(value, null, 2)]),
      ),
    );
    setShowDatasetCaseEditor(true);
  };

  const openNewDatasetCaseEditor = () => {
    if (!selectedDataset) {
      return;
    }

    const nextCase = buildEmptyDatasetCase(selectedDataset.datasetType);
    setDatasetCaseEditorMode("create");
    setDatasetCaseFormError(null);
    setDatasetCaseDraft(nextCase);
    setDatasetCaseJsonDrafts(
      Object.fromEntries(
        Object.entries(nextCase)
          .filter(([, value]) => typeof value !== "string")
          .map(([key, value]) => [key, JSON.stringify(value, null, 2)]),
      ),
    );
    setShowDatasetCaseEditor(true);
  };

  const handleDatasetCaseFieldChange = (key: string, rawValue: string) => {
    if (!datasetCaseDraft) {
      return;
    }

    const currentValue = (datasetCaseDraft as Record<string, unknown>)[key];
    if (typeof currentValue === "string") {
      setDatasetCaseDraft({
        ...(datasetCaseDraft as Record<string, unknown>),
        [key]: rawValue,
      } as DatasetCaseRecord);
      return;
    }

    setDatasetCaseJsonDrafts((current) => ({
      ...current,
      [key]: rawValue,
    }));
  };

  const handleDatasetCaseSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedDataset || !datasetCaseDraft) {
      return;
    }

    try {
      const payload = Object.fromEntries(
        Object.entries(datasetCaseDraft as Record<string, unknown>).map(([key, value]) => {
          if (typeof value === "string") {
            return [key, value];
          }

          return [key, JSON.parse(datasetCaseJsonDrafts[key] ?? JSON.stringify(value))];
        }),
      ) as DatasetCaseRecord;

      setDatasetCaseSubmitting(true);
      setDatasetCaseFormError(null);

      const response =
        datasetCaseEditorMode === "create"
          ? await createDatasetCaseRequest(selectedDataset.id, payload)
          : await updateDatasetCaseRequest(selectedDataset.id, payload.id, payload);
      const updatedCase = response.item;
      const nextCases =
        datasetCaseEditorMode === "create"
          ? [updatedCase, ...selectedDataset.cases]
          : selectedDataset.cases.map((item) => (item.id === updatedCase.id ? updatedCase : item));

      setEditedDatasets((current) => ({
        ...current,
        [selectedDataset.id]: {
          ...(current[selectedDataset.id] ?? selectedDataset),
          cases: nextCases,
          itemCount: nextCases.length,
        },
      }));
      setDatasetCaseDraft(updatedCase);
      setSelectedDatasetCaseId(updatedCase.id);
      setShowDatasetCaseEditor(false);
      setDatasetFeedback({
        tone: "success",
        message: datasetCaseEditorMode === "create" ? `样本 ${updatedCase.id} 已创建。` : `样本 ${updatedCase.id} 已更新。`,
      });
    } catch (error) {
      setDatasetCaseFormError(error instanceof Error ? error.message : "样本更新失败");
    } finally {
      setDatasetCaseSubmitting(false);
    }
  };

  const handleDatasetCaseDeleteRequest = async (caseId: string) => {
    if (!selectedDataset) {
      return;
    }

    if (!globalThis.confirm(`删除样本 ${caseId}？`)) {
      return;
    }

    try {
      await deleteDatasetCaseRequest(selectedDataset.id, caseId);
      const nextCases = selectedDataset.cases.filter((item) => item.id !== caseId);
      setEditedDatasets((current) => ({
        ...current,
        [selectedDataset.id]: {
          ...(current[selectedDataset.id] ?? selectedDataset),
          cases: nextCases,
          itemCount: nextCases.length,
        },
      }));
      if (selectedDatasetCaseId === caseId) {
        setSelectedDatasetCaseId(nextCases[0]?.id ?? "");
      }
      setShowDatasetCaseDrawer(false);
      setShowDatasetCaseEditor(false);
      setDatasetFeedback({
        tone: "success",
        message: `样本 ${caseId} 已删除。`,
      });
    } catch (error) {
      setDatasetFeedback({
        tone: "warning",
        message: error instanceof Error ? error.message : `样本 ${caseId} 删除失败。`,
      });
    }
  };

  const runDatasetSynthesis = async () => {
    if (!selectedSynthesisDataset) {
      return;
    }

    try {
      setSynthesisLoading(true);
      const response = await synthesizeDatasetCasesRequest(selectedSynthesisDataset.id, {
        source: synthesisSource,
        direction: synthesisDirection,
        scenario_description: synthesisScenario.trim(),
        use_case_description: synthesisPurpose.trim(),
        seed_source_ref:
          synthesisSource === "dataset" ? `dataset:${selectedSynthesisDataset.id}` : "online:latest-window",
        columns: synthesisColumns
          .filter((column) => column.enabled)
          .map((column) => ({
            name: column.name,
            description: column.description.trim(),
            generation_requirement: column.requirement.trim(),
          })),
        sample_count: Math.max(10, synthesisSampleCount),
      });
      setDatasetSynthesisResult(response.item);
    } catch {
      setDatasetFeedback({
        tone: "warning",
        message: "智能合成接口暂时不可用，当前仍可以继续使用已有评测样本。",
      });
    } finally {
      setSynthesisLoading(false);
    }
  };

  const handleSavePromptTemplate = () => {
    if (!promptDraft) {
      return;
    }

    setEditedPrompts((current) => ({
      ...current,
      [promptDraft.id]: {
        ...promptDraft,
        name: promptDraft.name.trim(),
        version: promptDraft.version.trim(),
        description: promptDraft.description?.trim(),
        systemPrompt: promptDraft.systemPrompt.trim(),
        userTemplate: promptDraft.userTemplate.trim(),
      },
    }));
  };

  const handleCreatePrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!promptDraft) {
      return;
    }

    const nextPrompt: PromptVersion = {
      ...promptDraft,
      id: `prompt_local_${Date.now().toString(36)}`,
      name: promptDraft.name.trim(),
      version: promptDraft.version.trim(),
      description: promptDraft.description?.trim(),
      systemPrompt: promptDraft.systemPrompt.trim(),
      userTemplate: promptDraft.userTemplate.trim(),
      inputSchema: promptDraft.inputSchema ?? {},
    };

    setCreatedPrompts((current) => [nextPrompt, ...current]);
    setSelectedPromptId(nextPrompt.id);
    setShowPromptCreateModal(false);
    setPromptDraft(nextPrompt);
  };

  const handleCreateAgent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!agentDraft) {
      return;
    }

    const nextAgent: AgentVersion = {
      ...agentDraft,
      id: `agent_local_${Date.now().toString(36)}`,
      name: agentDraft.name.trim(),
      version: agentDraft.version.trim(),
      description: agentDraft.description?.trim(),
      queryProcessor: agentDraft.queryProcessor.trim(),
      retriever: agentDraft.retriever.trim(),
      reranker: agentDraft.reranker.trim(),
      answerer: agentDraft.answerer.trim(),
    };

    setCreatedAgents((current) => [nextAgent, ...current]);
    setSelectedAgentId(nextAgent.id);
    setShowAgentCreateModal(false);
    setAgentDraft(nextAgent);
  };

  const openPromptCreateModal = () => {
    setPromptDraft({
      id: "prompt_draft",
      name: "",
      version: "0.1.0",
      description: "",
      systemPrompt: "",
      userTemplate: "",
      inputSchema: {},
    });
    setPromptDebugPayload("{}");
    setShowPromptCreateModal(true);
  };

  const openAgentCreateModal = () => {
    setAgentDraft({
      id: "agent_draft",
      name: "",
      version: "0.1.0",
      description: "",
      queryProcessor: "",
      retriever: "",
      reranker: "",
      answerer: "",
    });
    setShowAgentCreateModal(true);
  };

  const handleCreateEvaluator = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEvaluatorFamily) {
      return;
    }

    const config =
      selectedEvaluatorFamily === "code"
        ? JSON.stringify({ strategy: evaluatorForm.codeStrategy }, null, 2)
        : JSON.stringify(
            { rubric: evaluatorForm.description, strictBinary: evaluatorForm.metricType === "binary" },
            null,
            2,
          );

    const nextEvaluator: DemoEvaluator = {
      id: `evaluator_local_${Date.now().toString(36)}`,
      name: evaluatorForm.name.trim(),
      layer: evaluatorForm.layer,
      metricType: evaluatorForm.metricType,
      evaluatorFamily: selectedEvaluatorFamily,
      codeStrategy: selectedEvaluatorFamily === "code" ? evaluatorForm.codeStrategy : undefined,
      description: evaluatorForm.description.trim(),
      config,
    };

    setCreatedEvaluators((current) => [nextEvaluator, ...current]);
    setSelectedEvaluatorId(nextEvaluator.id);
    setEvaluatorLayer(nextEvaluator.layer);
    setShowEvaluatorCreate(false);
    setSelectedEvaluatorFamily(null);
    setEvaluatorForm({
      name: "",
      layer: "retrieval",
      metricType: "continuous",
      description: "",
      codeStrategy: "exact_match",
    });
  };

  const handleCreateExperiment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const template = experimentForm.targetKey === "baseline" ? viewModel.baseline : viewModel.candidate;
    const datasetName =
      allDatasets.find((dataset) => dataset.id === experimentForm.datasetId)?.name ?? "未绑定数据集";
    const id = `exp_local_${Date.now().toString(36)}`;
    const nextExperiment: ExperimentRun = {
      ...template,
      experimentId: id,
      datasetId: experimentForm.datasetId,
      evaluatorIds: experimentForm.evaluatorIds,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "FINISHED",
    };

    const row: ExperimentListRow = {
      id,
      label: experimentForm.name.trim(),
      status: nextExperiment.status,
      datasetName,
      targetName: nextExperiment.target.name,
      targetVersion: nextExperiment.target.version,
      totalCases: nextExperiment.summary.totalCases,
      invalidJudgmentCount: nextExperiment.summary.invalidJudgmentCount,
      overallScore: averageLayerScore(nextExperiment.caseRuns.flatMap((caseRun) => caseRun.layerMetrics), "overall"),
      startedAt: nextExperiment.startedAt,
      finishedAt: nextExperiment.finishedAt,
      experiment: nextExperiment,
    };

    setCreatedExperiments((current) => [row, ...current]);
    setSelectedExperimentId(id);
    setShowExperimentCreate(false);
    setExperimentForm({
      name: "",
      datasetId: allDatasets[0]?.id ?? "",
      targetKey: "baseline",
      evaluatorIds: [],
    });
  };

  const renderPromptPage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">Targets</span>
          <h1>Prompts</h1>
          <p>主线只保留 Prompt template 和 Preview and debug。重型 Prompt IDE 和 common configuration 不在本轮范围内。</p>
        </div>
        <div className="hero__meta">
          <span className="hero__pill">{allPrompts.length} prompts</span>
          <span className="hero__pill">{migratedCozePrompts.length} migrated from Coze Loop</span>
          <button className="primary-button" type="button" onClick={openPromptCreateModal}>
            + 新建 Prompt
          </button>
        </div>
      </section>

      <section className="detail-grid detail-grid--wide">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h3>Prompt List</h3>
              <span>轻量 Targets 管理。这里只承载可被实验选择的 prompt 版本。</span>
            </div>
          </div>

          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Description</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {allPrompts.map((prompt) => (
                  <tr
                    key={prompt.id}
                    className={selectedPromptId === prompt.id ? "is-selected" : ""}
                    onClick={() => setSelectedPromptId(prompt.id)}
                  >
                    <td>{prompt.name}</td>
                    <td>{prompt.version}</td>
                    <td>{prompt.description ?? "--"}</td>
                    <td>
                      <span className={`pill ${prompt.version.includes("-coze") ? "" : "pill--success"}`}>
                        {prompt.version.includes("-coze") ? "Coze Loop migrated" : "Business sample"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="content-stack">
          <section className="detail-card">
            <div className="panel__header">
              <div>
                <h3>Prompt template</h3>
                <span>支持编辑 system prompt 和 user template。</span>
              </div>
              <button className="secondary-button" type="button" onClick={handleSavePromptTemplate}>
                保存模板
              </button>
            </div>

            {promptDraft ? (
              <div className="form-layout">
                <div className="form-grid">
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={promptDraft.name}
                      onChange={(event) => setPromptDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                    />
                  </label>
                  <label className="field">
                    <span>Version</span>
                    <input
                      value={promptDraft.version}
                      onChange={(event) => setPromptDraft((current) => (current ? { ...current, version: event.target.value } : current))}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Description</span>
                  <textarea
                    value={promptDraft.description ?? ""}
                    onChange={(event) =>
                      setPromptDraft((current) => (current ? { ...current, description: event.target.value } : current))
                    }
                  />
                </label>
                <label className="field">
                  <span>System prompt</span>
                  <textarea
                    value={promptDraft.systemPrompt}
                    onChange={(event) =>
                      setPromptDraft((current) => (current ? { ...current, systemPrompt: event.target.value } : current))
                    }
                  />
                </label>
                <label className="field">
                  <span>User template</span>
                  <textarea
                    value={promptDraft.userTemplate}
                    onChange={(event) =>
                      setPromptDraft((current) => (current ? { ...current, userTemplate: event.target.value } : current))
                    }
                  />
                </label>
              </div>
            ) : null}
          </section>

          <section className="detail-card">
            <div className="panel__header">
              <div>
                <h3>Preview and debug</h3>
                <span>单次调试，不替代实验。</span>
              </div>
            </div>

            <div className="form-layout">
              <label className="field">
                <span>Debug payload</span>
                <textarea value={promptDebugPayload} onChange={(event) => setPromptDebugPayload(event.target.value)} />
              </label>
              {promptPreview.error ? <div className="notice-bar">{promptPreview.error}</div> : null}
              <div className="trace-section">
                <strong>Rendered prompt</strong>
                <pre>{promptPreview.rendered || "等待输入调试内容。"}</pre>
              </div>
            </div>
          </section>
        </article>
      </section>
    </div>
  );

  const renderPlaygroundPage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">Targets</span>
          <h1>Agents</h1>
          <p>只做轻量 AgentVersion 管理，承载被实验选择的 agent/pipeline 版本，不扩成完整工作流编排器。</p>
        </div>
        <div className="hero__meta">
          <span className="hero__pill">{allAgents.length} agents</span>
          <button className="primary-button" type="button" onClick={openAgentCreateModal}>
            + 新建 Agent
          </button>
        </div>
      </section>
      <section className="detail-grid detail-grid--wide">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h3>Agent List</h3>
              <span>名称、版本、说明和 pipeline 组件信息都在这一层查看。</span>
            </div>
          </div>
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Description</th>
                  <th>Query / Retrieve / Rerank / Answer</th>
                </tr>
              </thead>
              <tbody>
                {allAgents.map((agent) => (
                  <tr
                    key={agent.id}
                    className={selectedAgentId === agent.id ? "is-selected" : ""}
                    onClick={() => setSelectedAgentId(agent.id)}
                  >
                    <td>{agent.name}</td>
                    <td>{agent.version}</td>
                    <td>{agent.description ?? "--"}</td>
                    <td>{`${agent.queryProcessor} / ${agent.retriever} / ${agent.reranker} / ${agent.answerer}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="detail-card">
          <h2>Agent Detail</h2>
          {selectedAgent ? (
            <div className="stack-list">
              <div className="stack-item"><strong>name</strong><span>{selectedAgent.name}</span></div>
              <div className="stack-item"><strong>version</strong><span>{selectedAgent.version}</span></div>
              <div className="stack-item"><strong>query_processor</strong><span>{selectedAgent.queryProcessor}</span></div>
              <div className="stack-item"><strong>retriever</strong><span>{selectedAgent.retriever}</span></div>
              <div className="stack-item"><strong>reranker</strong><span>{selectedAgent.reranker}</span></div>
              <div className="stack-item"><strong>answerer</strong><span>{selectedAgent.answerer}</span></div>
            </div>
          ) : null}
        </article>
      </section>
    </div>
  );

  const renderDatasetsPage = () => (
    <div className="content-stack dataset-page">
      {datasetFeedback ? (
        <div className="notice-bar">
          <strong className={datasetFeedback.tone === "success" ? "is-success" : "is-warning"}>
            {datasetFeedback.message}
          </strong>
        </div>
      ) : null}

      <section className="dataset-page-head">
        <div>
          <span className="eyebrow">评测</span>
          <h1>Dataset</h1>
          <p>按 Coze Loop 的动线拆成两个主工作区。Evaluation set 管正式数据集，智能合成只做定向补样草稿。</p>
        </div>
        <div className="dataset-page-tabs">
          <button
            className={`pill-button ${datasetDetailTab === "evaluation_set" ? "is-active" : ""}`}
            type="button"
            onClick={() => setDatasetDetailTab("evaluation_set")}
          >
            Evaluation set
          </button>
          <button
            className={`pill-button ${datasetDetailTab === "synthesis" ? "is-active" : ""}`}
            type="button"
            onClick={() => setDatasetDetailTab("synthesis")}
          >
            智能合成
          </button>
        </div>
      </section>

      {datasetDetailTab === "evaluation_set" ? (
        showDatasetCreate ? (
          <section className="dataset-editor-shell">
            <div className="dataset-editor-topbar">
              <button className="secondary-button" type="button" onClick={resetDatasetComposer}>
                ← Back to evaluation set
              </button>
              <span className="meta-text">How to create an evaluation set?</span>
            </div>

            <div className="dataset-editor">
              <div className="dataset-editor__header">
                <div>
                  <span className="eyebrow">评测 / 评测集</span>
                  <h1>{showDatasetEdit ? "Edit evaluation set" : "Create evaluation set"}</h1>
                  <p>
                    {showDatasetEdit
                      ? "回填现有 dataset 信息，修改后提交 update 接口。"
                      : "保持 mock-first，先完成基本信息和 schema 配置，再补样本导入。"}
                  </p>
                </div>
                <div className="dataset-editor__meta">
                  <div className="summary-card">
                    <span>{showDatasetEdit ? "样本数" : "Mock 样本数"}</span>
                    <strong>{datasetForm.sampleCount}</strong>
                  </div>
                  <div className="summary-card">
                    <span>字段数</span>
                    <strong>{datasetForm.schema.length}</strong>
                  </div>
                </div>
              </div>

              <form
                className="dataset-editor__form"
                onSubmit={showDatasetEdit ? handleUpdateDataset : handleCreateDataset}
              >
                <section className="dataset-editor__section">
                  <div className="dataset-section-title">
                    <h3>Basic information</h3>
                  </div>
                  <div className="form-layout">
                    <label className="field">
                      <span>Name</span>
                      <input
                        value={datasetForm.name}
                        onChange={(event) => setDatasetForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Please enter the name of the evaluation set"
                        required
                      />
                    </label>

                    <label className="field">
                      <span>Description</span>
                      <textarea
                        value={datasetForm.description}
                        onChange={(event) =>
                          setDatasetForm((current) => ({ ...current, description: event.target.value }))
                        }
                        placeholder="Please enter the description of the evaluation set"
                        required
                      />
                    </label>

                    {!showDatasetEdit ? (
                      <label className="field field--compact">
                        <span>Mock data item</span>
                        <input
                          type="number"
                          min={0}
                          value={datasetForm.sampleCount}
                          onChange={(event) =>
                            setDatasetForm((current) => ({
                              ...current,
                              sampleCount: Number(event.target.value || 0),
                            }))
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                </section>

                <section className="dataset-editor__section">
                  <div className="dataset-section-title">
                    <div>
                      <h3>Config columns</h3>
                      <span>按数据集类型展示 schema 预览，不做字段级 column management。</span>
                    </div>
                  </div>

                  <div className="dataset-template-row">
                    {(["ideal_output", "workflow", "trace_monitor"] as DatasetType[]).map((type) => (
                      <button
                        key={type}
                        className={`dataset-template-option ${datasetForm.datasetType === type ? "is-selected" : ""}`}
                        type="button"
                        onClick={() =>
                          setDatasetForm((current) => ({
                            ...current,
                            datasetType: type,
                            schema: buildDatasetSchema(type),
                          }))
                        }
                      >
                        <strong>{type === "ideal_output" ? "Ideal output evaluation set" : datasetTypeLabels[type]}</strong>
                        <span>{datasetFieldGuides[type].summary}</span>
                      </button>
                    ))}
                  </div>

                  <div className="dataset-guide-row">
                    <div className="pill-list">
                      {datasetFieldGuides[datasetForm.datasetType].recommended.map((field) => (
                        <span key={field} className="pill">
                          {field}
                        </span>
                      ))}
                    </div>
                    <span className="meta-text">{datasetTypeLabels[datasetForm.datasetType]}</span>
                  </div>

                  <div className="dataset-schema-list">
                    {datasetForm.schema.map((column, index) => (
                      <article key={`${column.name}-${index}`} className="dataset-schema-card">
                        <div className="dataset-schema-card__header">
                          <div>
                            <strong>{column.name}</strong>
                          </div>
                          <span className="meta-text">
                            {column.data_type} · {column.required ? "Required" : "Optional"}
                          </span>
                        </div>
                        <p>{column.description}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <div className="dataset-editor__footer">
                  <button className="secondary-button" type="button" onClick={resetDatasetComposer}>
                    Cancel
                  </button>
                  <button className="primary-button" type="submit" disabled={datasetSubmitting}>
                    {showDatasetEdit ? (datasetSubmitting ? "Saving..." : "Save") : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : showDatasetEdit && selectedDataset ? (
          <section className="dataset-editor-shell">
            <div className="dataset-editor-topbar">
              <button className="secondary-button" type="button" onClick={resetDatasetComposer}>
                ← Back to evaluation set
              </button>
              <span className="meta-text">{selectedDataset.version}</span>
            </div>

            <div className="dataset-editor">
              <div className="dataset-editor__header">
                <div>
                  <span className="eyebrow">评测 / 评测集</span>
                  <h1>{datasetForm.name || selectedDataset.name}</h1>
                  <p>{datasetForm.description || selectedDataset.description}</p>
                </div>
                <div className="dataset-editor__meta">
                  <div className="summary-card">
                    <span>样本数</span>
                    <strong>{selectedDataset.cases.length}</strong>
                  </div>
                  <div className="summary-card">
                    <span>字段数</span>
                    <strong>{selectedDataset.columns.length}</strong>
                  </div>
                </div>
              </div>

              <form className="dataset-editor__form" onSubmit={handleUpdateDataset}>
                <section className="dataset-editor__section">
                  <div className="dataset-section-title">
                    <h3>Basic information</h3>
                  </div>
                  <div className="form-layout">
                    <label className="field">
                      <span>Name</span>
                      <input
                        value={datasetForm.name}
                        onChange={(event) => setDatasetForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Please enter the name of the evaluation set"
                        required
                      />
                    </label>

                    <label className="field">
                      <span>Description</span>
                      <textarea
                        value={datasetForm.description}
                        onChange={(event) =>
                          setDatasetForm((current) => ({ ...current, description: event.target.value }))
                        }
                        placeholder="Please enter the description of the evaluation set"
                        required
                      />
                    </label>
                  </div>
                </section>

                <section className="dataset-editor__section">
                  <div className="dataset-section-title">
                    <div>
                      <h3>Schema</h3>
                      <span>当前版本只展示 schema，不做字段级管理。</span>
                    </div>
                  </div>

                  <div className="dataset-template-row">
                    {(["ideal_output", "workflow", "trace_monitor"] as DatasetType[]).map((type) => (
                      <button
                        key={type}
                        className={`dataset-template-option ${datasetForm.datasetType === type ? "is-selected" : ""}`}
                        type="button"
                        onClick={() =>
                          setDatasetForm((current) => ({
                            ...current,
                            datasetType: type,
                            schema: buildDatasetSchema(type),
                          }))
                        }
                      >
                        <strong>{type === "ideal_output" ? "Ideal output evaluation set" : datasetTypeLabels[type]}</strong>
                        <span>{datasetFieldGuides[type].summary}</span>
                      </button>
                    ))}
                  </div>

                  <div className="dataset-schema-list">
                    {datasetForm.schema.map((column) => (
                      <article key={column.name} className="dataset-schema-card">
                        <div className="dataset-schema-card__header">
                          <strong>{column.name}</strong>
                          <span className="meta-text">
                            {column.data_type} · {column.required ? "Required" : "Optional"}
                          </span>
                        </div>
                        <p>{column.description}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="dataset-editor__section">
                  <div className="dataset-section-title">
                    <div>
                      <h3>Data item</h3>
                      <span>正式数据集样本管理。支持 case list / view / create / edit / delete。</span>
                    </div>
                    <div className="inline-actions">
                      <button className="secondary-button" type="button" onClick={openNewDatasetCaseEditor}>
                        + New case
                      </button>
                    </div>
                  </div>

                  <div className="table-shell dataset-table-shell">
                    <table className="table dataset-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>{selectedDataset.datasetType === "trace_monitor" ? "trace_id" : "input"}</th>
                          <th>
                            {selectedDataset.datasetType === "ideal_output"
                              ? "reference_output"
                              : selectedDataset.datasetType === "workflow"
                                ? "expected_steps"
                                : "final_output"}
                          </th>
                          <th>Operation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDataset.cases.map((item) => (
                          <tr
                            key={item.id}
                            className={selectedDatasetCaseId === item.id ? "is-selected" : ""}
                            onClick={() => setSelectedDatasetCaseId(item.id)}
                          >
                            <td>{item.id}</td>
                            <td>{"input" in item ? item.input : "trace_id" in item ? item.trace_id : item.id}</td>
                            <td>
                              {"reference_output" in item
                                ? item.reference_output
                                : "expected_steps" in item
                                  ? item.expected_steps.join(", ")
                                  : "final_output" in item
                                    ? item.final_output
                                    : "--"}
                            </td>
                            <td>
                              <div className="table-actions">
                                <button
                                  className="table-link"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void openDatasetCaseDetail(item.id);
                                  }}
                                >
                                  View
                                </button>
                                <button
                                  className="table-link"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void openDatasetCaseEditor(item.id);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="table-link"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDatasetCaseDeleteRequest(item.id);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {datasetCasesLoading ? <div className="meta-text">Loading dataset cases...</div> : null}
                </section>

                <div className="dataset-editor__footer">
                  <button className="secondary-button" type="button" onClick={resetDatasetComposer}>
                    Cancel
                  </button>
                  <button className="primary-button" type="submit" disabled={datasetSubmitting}>
                    {datasetSubmitting ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : (
          <section className="dataset-list-shell">
            <div className="dataset-list-header">
              <div>
                <span className="eyebrow">Evaluation set</span>
                <h1>正式数据集管理</h1>
                <p className="meta-text">列表优先，进入详情后再做 schema、样本查看与样本编辑。</p>
              </div>
            </div>

            <div className="dataset-list-toolbar">
              <input
                className="toolbar__search"
                value={datasetQuery}
                onChange={(event) => setDatasetQuery(event.target.value)}
                placeholder="Search name"
              />
              <div className="pill-list">
                {([
                  { key: "all", label: `全部 ${datasetTypeCounts.all}` },
                  { key: "ideal_output", label: `普通数据集 ${datasetTypeCounts.ideal_output}` },
                  { key: "workflow", label: `Workflow ${datasetTypeCounts.workflow}` },
                  { key: "trace_monitor", label: `Trace 监控 ${datasetTypeCounts.trace_monitor}` },
                ] as Array<{ key: DatasetTypeFilter; label: string }>).map((item) => (
                  <button
                    key={item.key}
                    className={`pill-button ${datasetTypeFilter === item.key ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setDatasetTypeFilter(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button className="primary-button" type="button" onClick={startCreateDataset}>
                + 新建数据集
              </button>
            </div>

            <div className="table-shell dataset-table-shell">
              <table className="table dataset-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Data item</th>
                    <th>Latest version</th>
                    <th>Description</th>
                    <th>Operation</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDatasets.map((dataset) => (
                    <tr
                      key={dataset.id}
                      className={selectedDatasetId === dataset.id ? "is-selected" : ""}
                      onClick={() => setSelectedDatasetId(dataset.id)}
                    >
                      <td>{dataset.name}</td>
                      <td>{datasetTypeLabels[dataset.datasetType]}</td>
                      <td>{dataset.itemCount}</td>
                      <td>{dataset.version}</td>
                      <td>{dataset.description}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="table-link"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDatasetId(dataset.id);
                              setShowDatasetDrawer(true);
                            }}
                          >
                            Detail
                          </button>
                          <button
                            className="table-link"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openDatasetEditor(dataset.id);
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="dataset-list-footer">
              <span>Total datasets: {filteredDatasets.length}</span>
              <span>{selectedDataset ? `当前选中: ${selectedDataset.name}` : "未选中数据集"}</span>
            </div>
          </section>
        )
      ) : (
        <section className="dataset-synthesis-shell">
          <div className="dataset-synthesis__header">
            <div>
              <span className="eyebrow">智能合成</span>
              <h2>智能合成侧线</h2>
              <p>保留独立 tab 占位，但不作为本轮核心验收项。主线先完成 Evaluation set 的正式管理闭环。</p>
            </div>
            <div className="dataset-editor__meta">
              <div className="summary-card is-highlight">
                <span>目标数据集</span>
                <strong>{selectedSynthesisDataset?.name ?? "暂无文本评测集"}</strong>
              </div>
              <div className="summary-card">
                <span>最小合成数</span>
                <strong>10</strong>
              </div>
            </div>
          </div>

          {selectedSynthesisDataset ? (
            <>
              <section className="detail-card synthesis-target-panel">
                <div className="synthesis-target-panel__main">
                  <label className="field">
                    <span>目标 Evaluation set</span>
                    <select value={selectedSynthesisDataset.id} onChange={(event) => setSelectedDatasetId(event.target.value)}>
                      {synthesisDatasets.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="dataset-inline-meta">
                  <span className="pill">{selectedSynthesisDataset.version}</span>
                  <span className="pill">{selectedSynthesisDataset.itemCount} samples</span>
                  <span className="pill">{selectedSynthesisDataset.columns.length} columns</span>
                </div>
              </section>

              <section className="detail-grid">
                <article className="detail-card">
                  <h2>当前状态</h2>
                  <p>智能合成已降为侧线占位。本轮主线只保证 Evaluation set 的正式管理闭环可用。</p>
                </article>
                <article className="detail-card">
                  <h2>后续范围</h2>
                  <p>后续会在这里继续承接两步向导、草稿样本预览，以及人工确认后并入 Evaluation set 的流程。</p>
                </article>
              </section>

              <section className="detail-card">
                <div className="panel__header">
                  <div>
                    <h3>Placeholder</h3>
                    <span>保留入口，不阻塞 Dataset / Evaluator / Experiment 主线验收。</span>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => setDatasetDetailTab("evaluation_set")}>
                    返回 Evaluation set
                  </button>
                </div>
                <div className="stack-list">
                  <div className="stack-item stack-item--block">
                    <strong>draft only</strong>
                    <span>生成结果必须先进入 draft，不直接写入正式数据集。</span>
                  </div>
                  <div className="stack-item stack-item--block">
                    <strong>source</strong>
                    <span>{synthesisSource}</span>
                  </div>
                  <div className="stack-item stack-item--block">
                    <strong>next</strong>
                    <span>等待侧线继续实现向导、草稿筛选和 merge 流程。</span>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <article className="detail-card">
              <h2>暂无文本评测集</h2>
              <p>智能合成只支持文本评测集。请先在 Evaluation set 中创建 `普通数据集`，再进入这里做定向补样。</p>
            </article>
          )}
        </section>
      )}
    </div>
  );

  const renderEvaluatorsPage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">评测</span>
          <h1>评估器</h1>
          <p>主视图围绕 Retrieval / Rerank / Answer / Overall 展开。新建流程先选 LLM Evaluator / Code Evaluator，再进入配置。</p>
        </div>
        <div className="hero__meta">
          <span className="hero__pill">{allEvaluators.length} evaluators</span>
          <span className="hero__pill">UI-first mock flow</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>AI 搜索流程</h3>
            <span>先选层，再看这一层的 evaluator 列表。</span>
          </div>
          <div className="inline-actions">
            <input
              className="toolbar__search"
              value={evaluatorQuery}
              onChange={(event) => setEvaluatorQuery(event.target.value)}
              placeholder="搜索评估器"
            />
            <button className="primary-button" type="button" onClick={() => setShowEvaluatorTypeModal(true)}>
              新建评估器
            </button>
          </div>
        </div>

        <div className="flow-row">
          {layerOrder.map((layer) => (
            <button
              key={layer}
              className={`flow-node ${evaluatorLayer === layer ? "is-active" : ""}`}
              type="button"
              onClick={() => setEvaluatorLayer(layer)}
            >
              <strong>{layerLabels[layer]}</strong>
            </button>
          ))}
        </div>
      </section>

      {showEvaluatorCreate && selectedEvaluatorFamily ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <h3>创建 {evaluatorFamilyLabels[selectedEvaluatorFamily]}</h3>
              <span>不在 UI 里发明新指标，只消费现有层级和类型。</span>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowEvaluatorCreate(false)}>
              返回列表
            </button>
          </div>

          <form className="form-layout" onSubmit={handleCreateEvaluator}>
            <div className="form-grid">
              <label className="field">
                <span>名称</span>
                <input
                  value={evaluatorForm.name}
                  onChange={(event) => setEvaluatorForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：Answer groundedness custom"
                  required
                />
              </label>
              <label className="field">
                <span>Layer</span>
                <select
                  value={evaluatorForm.layer}
                  onChange={(event) =>
                    setEvaluatorForm((current) => ({ ...current, layer: event.target.value as DisplayLayer }))
                  }
                >
                  {layerOrder.map((layer) => (
                    <option key={layer} value={layer}>
                      {layerLabels[layer]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Metric Type</span>
                <select
                  value={evaluatorForm.metricType}
                  onChange={(event) =>
                    setEvaluatorForm((current) => ({
                      ...current,
                      metricType: event.target.value as DemoEvaluator["metricType"],
                    }))
                  }
                >
                  {Object.entries(metricTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              {selectedEvaluatorFamily === "code" ? (
                <label className="field">
                  <span>Code Strategy</span>
                  <select
                    value={evaluatorForm.codeStrategy}
                    onChange={(event) =>
                      setEvaluatorForm((current) => ({ ...current, codeStrategy: event.target.value }))
                    }
                  >
                    {codeStrategies.map((strategy) => (
                      <option key={strategy.value} value={strategy.value}>
                        {strategy.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="detail-card">
                  <h2>Judge Family</h2>
                  <p>当前创建的是 {evaluatorFamilyLabels[selectedEvaluatorFamily]}，配置会在 mock 层先序列化展示。</p>
                </div>
              )}
            </div>

            <label className="field">
              <span>描述</span>
              <textarea
                value={evaluatorForm.description}
                onChange={(event) =>
                  setEvaluatorForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="描述这个 evaluator 关注的判断标准。"
                required
              />
            </label>

            {selectedEvaluatorFamily === "code" ? (
              <div className="template-grid">
                {codeStrategies.map((strategy) => (
                  <button
                    key={strategy.value}
                    className={`template-card ${evaluatorForm.codeStrategy === strategy.value ? "is-selected" : ""}`}
                    type="button"
                    onClick={() =>
                      setEvaluatorForm((current) => ({ ...current, codeStrategy: strategy.value }))
                    }
                  >
                    <strong>{strategy.label}</strong>
                    <p>{strategy.description}</p>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setShowEvaluatorCreate(false)}>
                取消
              </button>
              <button className="primary-button" type="submit">
                创建评估器
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>{layerLabels[evaluatorLayer]} Layer Evaluators</h3>
            <span>列表页保持稳定，不在 hover 时改变边框宽度和布局。</span>
          </div>
        </div>

        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>Family</th>
                <th>Metric Type</th>
                <th>描述</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvaluators.map((evaluator) => (
                <tr
                  key={evaluator.id}
                  className={selectedEvaluatorId === evaluator.id ? "is-selected" : ""}
                  onClick={() => setSelectedEvaluatorId(evaluator.id)}
                >
                  <td>{evaluator.name}</td>
                  <td>{evaluator.evaluatorFamily === "model" ? "LLM" : "Code"}</td>
                  <td>{metricTypeLabels[evaluator.metricType]}</td>
                  <td>{evaluator.description}</td>
                  <td>
                    <button
                      className="table-link"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedEvaluatorId(evaluator.id);
                        setShowEvaluatorDrawer(true);
                      }}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderExperimentsPage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">实验</span>
          <h1>实验运行</h1>
          <p>围绕 overall / layer / case / trace 下钻。列表页先看 run 概览，再到某层 case，再跳到 trace。</p>
        </div>
        <div className="hero__meta">
          <span className="hero__pill">{allExperimentRows.length} runs</span>
          <span className="hero__pill">{selectedExperimentRow?.targetVersion ?? "--"}</span>
        </div>
      </section>

      {showExperimentCreate ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <h3>创建实验运行</h3>
              <span>先选 dataset、target 和 evaluators，用 mock data 跑通单实验流程。</span>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowExperimentCreate(false)}>
              返回列表
            </button>
          </div>

          <form className="form-layout" onSubmit={handleCreateExperiment}>
            <div className="form-grid">
              <label className="field">
                <span>运行名称</span>
                <input
                  value={experimentForm.name}
                  onChange={(event) =>
                    setExperimentForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="例如：Prompt v2 回归跑数"
                  required
                />
              </label>
              <label className="field">
                <span>Dataset</span>
                <select
                  value={experimentForm.datasetId}
                  onChange={(event) =>
                    setExperimentForm((current) => ({ ...current, datasetId: event.target.value }))
                  }
                >
                  {allDatasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>被测对象</span>
              <select
                value={experimentForm.targetKey}
                onChange={(event) =>
                  setExperimentForm((current) => ({ ...current, targetKey: event.target.value }))
                }
              >
                <option value="baseline">
                  {viewModel.baseline.target.name} / {viewModel.baseline.target.version}
                </option>
                <option value="candidate">
                  {viewModel.candidate.target.name} / {viewModel.candidate.target.version}
                </option>
              </select>
            </label>

            <div className="field">
              <span>Evaluators</span>
              <div className="checkbox-grid">
                {allEvaluators.map((evaluator) => (
                  <label key={evaluator.id} className="checkbox-card">
                    <input
                      type="checkbox"
                      checked={experimentForm.evaluatorIds.includes(evaluator.id)}
                      onChange={(event) =>
                        setExperimentForm((current) => ({
                          ...current,
                          evaluatorIds: event.target.checked
                            ? [...current.evaluatorIds, evaluator.id]
                            : current.evaluatorIds.filter((id) => id !== evaluator.id),
                        }))
                      }
                    />
                    <span>
                      {evaluator.name} · {layerLabels[evaluator.layer as DisplayLayer]}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setShowExperimentCreate(false)}>
                取消
              </button>
              <button className="primary-button" type="submit">
                运行实验
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="summary-grid">
        <article className="summary-card is-highlight">
          <span>当前 Run</span>
          <strong>{selectedExperimentRow?.label ?? "--"}</strong>
          <em>{selectedExperimentRow?.datasetName ?? "未选择"}</em>
        </article>
        <article className="summary-card">
          <span>Overall Score</span>
          <strong>{selectedExperimentRow ? formatMetric(selectedExperimentRow.overallScore) : "--"}</strong>
          <em>{selectedExperimentRow?.targetVersion ?? "--"}</em>
        </article>
        <article className="summary-card">
          <span>Case Count</span>
          <strong>{selectedExperimentRow?.totalCases ?? 0}</strong>
          <em>支持继续下钻到 case / trace</em>
        </article>
        <article className="summary-card">
          <span>Invalid Binary</span>
          <strong>{selectedExperimentRow?.invalidJudgmentCount ?? 0}</strong>
          <em>沿用共享 evaluator 结果</em>
        </article>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Run List</h3>
            <span>按 Coze 风格先列表，再进入详情抽屉。</span>
          </div>
          <button className="primary-button" type="button" onClick={() => setShowExperimentCreate(true)}>
            新建实验
          </button>
        </div>

        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>Dataset</th>
                <th>Target</th>
                <th>Status</th>
                <th>Overall</th>
                <th>Case</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {allExperimentRows.map((row) => (
                <tr
                  key={row.id}
                  className={selectedExperimentId === row.id ? "is-selected" : ""}
                  onClick={() => setSelectedExperimentId(row.id)}
                >
                  <td>{row.label}</td>
                  <td>{row.datasetName}</td>
                  <td>
                    {row.targetName}
                    <div className="meta-text">{row.targetVersion}</div>
                  </td>
                  <td>
                    <span className="status-badge">{row.status}</span>
                  </td>
                  <td>{formatMetric(row.overallScore)}</td>
                  <td>{row.totalCases}</td>
                  <td>{formatDate(row.finishedAt)}</td>
                  <td>
                    <button
                      className="table-link"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedExperimentId(row.id);
                        setShowRunDrawer(true);
                      }}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>评测结果</h3>
            <span>统一从实验内完成 overall / layer / case 的结果下钻。</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => setShowRunDrawer(true)}>
            查看完整 run
          </button>
        </div>

        <div className="flow-row">
          {layerOrder.map((layer) => (
            <button
              key={layer}
              className={`flow-node ${runLayer === layer ? "is-active" : ""}`}
              type="button"
              onClick={() => setRunLayer(layer)}
            >
              <strong>{layerLabels[layer]}</strong>
            </button>
          ))}
        </div>

        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Layer Score</th>
                <th>Overall</th>
                <th>Status</th>
                <th>Trace</th>
              </tr>
            </thead>
            <tbody>
              {currentRunCases.map((item) => (
                <tr
                  key={item.caseRun.caseId}
                  className={selectedCaseId === item.caseRun.caseId ? "is-selected" : ""}
                  onClick={() => setSelectedCaseId(item.caseRun.caseId)}
                >
                  <td>{item.title}</td>
                  <td>{formatMetric(item.layerScore)}</td>
                  <td>{formatMetric(item.overallScore)}</td>
                  <td>{item.caseRun.status}</td>
                  <td>
                    <button
                      className="table-link"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openTrace(item.caseRun.traceId, selectedExperimentRow?.id);
                      }}
                    >
                      查看 trace
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="detail-grid detail-grid--wide">
        <article className="detail-card">
          <h2>观测结果</h2>
          {selectedRunTraceRow ? (
            <div className="content-stack">
              <div className="summary-grid">
                <article className="summary-card">
                  <span>Retrieval</span>
                  <strong>{selectedRunTraceRow.trace.retrievalTrace.latencyMs}ms</strong>
                </article>
                <article className="summary-card">
                  <span>Rerank</span>
                  <strong>{selectedRunTraceRow.trace.rerankTrace.latencyMs}ms</strong>
                </article>
                <article className="summary-card">
                  <span>Answer</span>
                  <strong>{selectedRunTraceRow.trace.answerTrace.latencyMs}ms</strong>
                </article>
              </div>
              <div className="trace-section">
                <strong>Answer Output</strong>
                <pre>{JSON.stringify(selectedRunTraceRow.trace.answerTrace.outputs, null, 2)}</pre>
              </div>
            </div>
          ) : (
            <p>选择 case 后即可查看对应 trace 观测结果。</p>
          )}
        </article>

        <article className="detail-card">
          <h2>统计摘要</h2>
          {selectedExperimentAverageMetrics.length > 0 ? (
            <div className="metric-list">
              {selectedExperimentAverageMetrics.map(([name, value]) => (
                <article key={name} className="metric-item">
                  <div className="metric-item__top">
                    <strong>{name}</strong>
                    <span>{formatMetric(value)}</span>
                  </div>
                  <p>{selectedExperimentRow?.label} 的实验平均分摘要。</p>
                </article>
              ))}
            </div>
          ) : (
            <p>当前实验暂无统计摘要。</p>
          )}
        </article>
      </section>

      <section className="detail-grid">
        <article className="detail-card">
          <h2>Case Detail</h2>
          {selectedRunCase ? (
            <div className="content-stack">
              <p>{selectedRunCase.output}</p>
              <div className="metric-list">
                {selectedRunCase.layerMetrics
                  .filter((metric) => metric.layer === runLayer)
                  .map((metric) => (
                    <article key={`${metric.layer}:${metric.metricName}`} className="metric-item">
                      <div className="metric-item__top">
                        <strong>{metric.metricName}</strong>
                        <span>{formatMetric(metricScore(metric.score))}</span>
                      </div>
                      <p>{metric.reason}</p>
                    </article>
                  ))}
              </div>
            </div>
          ) : (
            <p>选择 case 后查看细节。</p>
          )}
        </article>

        <article className="detail-card">
          <div className="panel__header">
            <div>
              <h2>Root-cause</h2>
              <span>主线实验页直接承载 root-cause 摘要，不要求先跳 AB 页面。</span>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowComparisonDrawer(true)}>
              查看完整归因
            </button>
          </div>
          <p>{viewModel.comparison.headline}</p>
          <div className="stack-list">
            {viewModel.comparison.rootCauseSummary.map((line) => (
              <div key={line} className="stack-item">
                <span>{line}</span>
              </div>
            ))}
          </div>
          <div className="pill-list">
            {viewModel.comparison.driverNegative.map((driver) => (
              <span key={driver} className="pill pill--danger">
                {driver}
              </span>
            ))}
          </div>
        </article>
      </section>
    </div>
  );

  const renderAbPage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">实验</span>
          <h1>AB 实验</h1>
          <p>先看 overall 指标卡片和 headline，再看 layer deltas、drivers 和 evidence cases，最后下钻 trace。</p>
        </div>
        <div className="hero__meta">
          <span className="hero__pill">{viewModel.comparison.headline}</span>
          <span className="hero__pill">confidence {viewModel.comparison.confidence.toFixed(2)}</span>
        </div>
      </section>

      <section className="summary-grid">
        {viewModel.comparison.overallDeltas.slice(0, 6).map((metric) => (
          <article key={metric.metricName} className="summary-card">
            <span>{metric.metricName}</span>
            <strong>{formatMetric(metric.candidateValue)}</strong>
            <em className={statusTone(metric.delta)}>{formatDelta(metric.delta)}</em>
          </article>
        ))}
      </section>

      <section className="detail-grid">
        <article className="detail-card">
          <h2>Root Cause Summary</h2>
          <p>{viewModel.comparison.headline}</p>
          <div className="stack-list">
            {viewModel.comparison.rootCauseSummary.map((line) => (
              <div key={line} className="stack-item">
                <span>{line}</span>
              </div>
            ))}
          </div>
        </article>
        <article className="detail-card">
          <h2>Attribution Drivers</h2>
          <div className="stack-list">
            <div className="stack-item">
              <strong>Positive</strong>
              <div className="pill-list">
                {viewModel.comparison.driverPositive.length > 0 ? (
                  viewModel.comparison.driverPositive.map((driver) => (
                    <span key={driver} className="pill pill--success">
                      {driver}
                    </span>
                  ))
                ) : (
                  <span className="meta-text">暂无正向 driver</span>
                )}
              </div>
            </div>
            <div className="stack-item">
              <strong>Negative</strong>
              <div className="pill-list">
                {viewModel.comparison.driverNegative.length > 0 ? (
                  viewModel.comparison.driverNegative.map((driver) => (
                    <span key={driver} className="pill pill--danger">
                      {driver}
                    </span>
                  ))
                ) : (
                  <span className="meta-text">暂无负向 driver</span>
                )}
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Layer Drill-down</h3>
            <span>从 overall 进入 layer，再落到 evidence cases。</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => setShowComparisonDrawer(true)}>
            查看完整归因
          </button>
        </div>

        <div className="flow-row">
          {layerOrder.map((layer) => (
            <button
              key={layer}
              className={`flow-node ${abLayer === layer ? "is-active" : ""}`}
              type="button"
              onClick={() => setAbLayer(layer)}
            >
              <strong>{layerLabels[layer]}</strong>
            </button>
          ))}
        </div>

        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Layer</th>
                <th>Status</th>
                <th>平均变化</th>
                <th>Strongest Negative</th>
                <th>Strongest Positive</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.comparison.layerInsights.map((insight) => (
                <tr key={insight.layer}>
                  <td>{layerLabels[insight.layer as DisplayLayer]}</td>
                  <td>
                    <span className="status-badge">{insight.status}</span>
                  </td>
                  <td className={statusTone(insight.averageDelta)}>{formatDelta(insight.averageDelta)}</td>
                  <td>{insight.strongestNegativeMetric ?? "--"}</td>
                  <td>{insight.strongestPositiveMetric ?? "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Evidence Cases</h3>
            <span>按当前 layer 聚焦 case，再跳 trace。</span>
          </div>
        </div>

        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Domain</th>
                <th>Layer Delta</th>
                <th>Candidate</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {evidenceCases.map((item) => (
                <tr key={item.caseId}>
                  <td>{item.title}</td>
                  <td>{item.domain}</td>
                  <td className={statusTone(item.selectedLayerDelta)}>{formatDelta(item.selectedLayerDelta)}</td>
                  <td>{item.candidateRun.output}</td>
                  <td>
                    <button
                      className="table-link"
                      type="button"
                      onClick={() => openTrace(item.candidateRun.traceId, viewModel.candidate.experimentId)}
                    >
                      查看 trace
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderTracePage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">观测</span>
          <h1>Trace Viewer</h1>
          <p>统一查看 retrieval / rerank / answer 轨迹、延迟与 metric evidence，作为实验下钻的终点。</p>
        </div>
        <div className="hero__meta">
          <span className="hero__pill">{allTraceRows.length} traces</span>
          <span className="hero__pill">{selectedTraceRow?.traceId ?? "--"}</span>
        </div>
      </section>

      <section className="detail-grid detail-grid--wide">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h3>Trace List</h3>
              <span>支持从实验页、AB 页直接跳转进来。</span>
            </div>
            <input
              className="toolbar__search"
              value={traceQuery}
              onChange={(event) => setTraceQuery(event.target.value)}
              placeholder="搜索 trace / case"
            />
          </div>
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>Trace ID</th>
                  <th>Run</th>
                  <th>Case</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {filteredTraceRows.map((row) => (
                  <tr
                    key={row.key}
                    className={selectedTraceKey === row.key ? "is-selected" : ""}
                    onClick={() => setSelectedTraceKey(row.key)}
                  >
                    <td>{row.traceId}</td>
                    <td>{row.experimentLabel}</td>
                    <td>{row.title}</td>
                    <td>
                      {row.trace.retrievalTrace.latencyMs + row.trace.rerankTrace.latencyMs + row.trace.answerTrace.latencyMs}
                      ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <h3>Trace Detail</h3>
              <span>{selectedTraceRow?.title ?? "请选择 trace"}</span>
            </div>
          </div>

          {selectedTraceRow ? (
            <div className="content-stack">
              <div className="summary-grid">
                <article className="summary-card">
                  <span>Retrieval</span>
                  <strong>{selectedTraceRow.trace.retrievalTrace.latencyMs}ms</strong>
                </article>
                <article className="summary-card">
                  <span>Rerank</span>
                  <strong>{selectedTraceRow.trace.rerankTrace.latencyMs}ms</strong>
                </article>
                <article className="summary-card">
                  <span>Answer</span>
                  <strong>{selectedTraceRow.trace.answerTrace.latencyMs}ms</strong>
                </article>
                <article className="summary-card">
                  <span>Total</span>
                  <strong>
                    {selectedTraceRow.trace.retrievalTrace.latencyMs +
                      selectedTraceRow.trace.rerankTrace.latencyMs +
                      selectedTraceRow.trace.answerTrace.latencyMs}
                    ms
                  </strong>
                </article>
              </div>

              <section className="trace-section">
                <strong>Retrieval Output</strong>
                <pre>{JSON.stringify(selectedTraceRow.trace.retrievalTrace.outputs, null, 2)}</pre>
              </section>
              <section className="trace-section">
                <strong>Rerank Output</strong>
                <pre>{JSON.stringify(selectedTraceRow.trace.rerankTrace.outputs, null, 2)}</pre>
              </section>
              <section className="trace-section">
                <strong>Answer Output</strong>
                <pre>{JSON.stringify(selectedTraceRow.trace.answerTrace.outputs, null, 2)}</pre>
              </section>

              <section className="metric-list">
                {Object.values(selectedTraceRow.trace.layerMetrics ?? {}).map((metric) => (
                  <article key={`${metric.layer}:${metric.metricName}`} className="metric-item">
                    <div className="metric-item__top">
                      <strong>{metric.metricName}</strong>
                      <span>{formatMetric(metricScore(metric.score))}</span>
                    </div>
                    <p>
                      {layerLabels[metric.layer as DisplayLayer]} · {metric.reason}
                    </p>
                  </article>
                ))}
              </section>
            </div>
          ) : (
            <div className="detail-card">
              <h2>暂无 trace</h2>
              <p>当前没有可展示的 trace 记录。</p>
            </div>
          )}
        </article>
      </section>
    </div>
  );

  const renderStatsPage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">观测</span>
          <h1>统计</h1>
          <p>当前先保留轻量统计面板，聚焦实验数、trace 数和 AB headline，不扩展超出 PRD 的高级分析能力。</p>
        </div>
      </section>
      <section className="summary-grid">
        <article className="summary-card is-highlight">
          <span>Experiments</span>
          <strong>{allExperimentRows.length}</strong>
        </article>
        <article className="summary-card">
          <span>Traces</span>
          <strong>{allTraceRows.length}</strong>
        </article>
        <article className="summary-card">
          <span>AB Headline</span>
          <strong>{viewModel.comparison.headline}</strong>
        </article>
      </section>
    </div>
  );

  const renderAutomationPage = () => (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">观测</span>
          <h1>自动化任务</h1>
          <p>MVP 先保留任务入口和说明区，不发明新的自动化领域对象。</p>
        </div>
      </section>
      <section className="detail-grid">
        <article className="detail-card">
          <h2>当前状态</h2>
          <p>建议后续接入定时回归跑数、失败 trace 巡检和 AB 指标播报，但这版只提供前端入口位。</p>
        </article>
        <article className="detail-card">
          <h2>输入来源</h2>
          <p>会复用实验、AB 和 trace 的已有数据，不在 UI 层定义新的结果结构。</p>
        </article>
      </section>
    </div>
  );

  const renderContent = () => {
    switch (activeView) {
      case "prompt_dev":
        return renderPromptPage();
      case "playground":
        return renderPlaygroundPage();
      case "datasets":
        return renderDatasetsPage();
      case "evaluators":
        return renderEvaluatorsPage();
      case "experiment_runs":
        return renderExperimentsPage();
      case "ab_experiments":
        return renderAbPage();
      case "trace":
        return renderTracePage();
      case "stats":
        return renderStatsPage();
      case "automation":
        return renderAutomationPage();
      default:
        return null;
    }
  };

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar__brand">
            <div className="sidebar__mark">D</div>
            <div>
              <strong>Downey Evals Loop</strong>
              <span>Mock-first frontend shell</span>
            </div>
          </div>

          <div className="workspace-pill">
            Demo 空间
            <div className="meta-text">{syncState === "ready" ? "API bootstrap" : "Fallback mock"}</div>
          </div>

          {navGroups.map((group) => (
            <div key={group.title} className="sidebar__group">
              <div className="sidebar__title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  className={`sidebar__item ${activeView === item.key ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setActiveView(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <main className="content">
          <div className="notice-bar">
            当前页面以 mock data 跑通主流程；保持与 PRD / BRD 对齐，不在 UI 层改领域命名或新增公共字段。
          </div>
          {renderContent()}
        </main>
      </div>

      <Modal
        open={showPromptCreateModal && Boolean(promptDraft)}
        title="新建 Prompt"
        subtitle="轻量录入最小字段，不做重型 IDE"
        onClose={() => setShowPromptCreateModal(false)}
      >
        {promptDraft ? (
          <form className="form-layout" onSubmit={handleCreatePrompt}>
            <div className="form-grid">
              <label className="field">
                <span>Name</span>
                <input
                  value={promptDraft.name}
                  onChange={(event) => setPromptDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                  required
                />
              </label>
              <label className="field">
                <span>Version</span>
                <input
                  value={promptDraft.version}
                  onChange={(event) => setPromptDraft((current) => (current ? { ...current, version: event.target.value } : current))}
                  required
                />
              </label>
            </div>
            <label className="field">
              <span>Description</span>
              <textarea
                value={promptDraft.description ?? ""}
                onChange={(event) => setPromptDraft((current) => (current ? { ...current, description: event.target.value } : current))}
              />
            </label>
            <label className="field">
              <span>System prompt</span>
              <textarea
                value={promptDraft.systemPrompt}
                onChange={(event) => setPromptDraft((current) => (current ? { ...current, systemPrompt: event.target.value } : current))}
                required
              />
            </label>
            <label className="field">
              <span>User template</span>
              <textarea
                value={promptDraft.userTemplate}
                onChange={(event) => setPromptDraft((current) => (current ? { ...current, userTemplate: event.target.value } : current))}
                required
              />
            </label>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setShowPromptCreateModal(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Create Prompt
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={showAgentCreateModal && Boolean(agentDraft)}
        title="新建 Agent"
        subtitle="轻量录入被测 agent/pipeline 版本"
        onClose={() => setShowAgentCreateModal(false)}
      >
        {agentDraft ? (
          <form className="form-layout" onSubmit={handleCreateAgent}>
            <div className="form-grid">
              <label className="field">
                <span>Name</span>
                <input
                  value={agentDraft.name}
                  onChange={(event) => setAgentDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                  required
                />
              </label>
              <label className="field">
                <span>Version</span>
                <input
                  value={agentDraft.version}
                  onChange={(event) => setAgentDraft((current) => (current ? { ...current, version: event.target.value } : current))}
                  required
                />
              </label>
            </div>
            <label className="field">
              <span>Description</span>
              <textarea
                value={agentDraft.description ?? ""}
                onChange={(event) => setAgentDraft((current) => (current ? { ...current, description: event.target.value } : current))}
              />
            </label>
            <div className="form-grid">
              <label className="field">
                <span>query_processor</span>
                <input
                  value={agentDraft.queryProcessor}
                  onChange={(event) => setAgentDraft((current) => (current ? { ...current, queryProcessor: event.target.value } : current))}
                  required
                />
              </label>
              <label className="field">
                <span>retriever</span>
                <input
                  value={agentDraft.retriever}
                  onChange={(event) => setAgentDraft((current) => (current ? { ...current, retriever: event.target.value } : current))}
                  required
                />
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>reranker</span>
                <input
                  value={agentDraft.reranker}
                  onChange={(event) => setAgentDraft((current) => (current ? { ...current, reranker: event.target.value } : current))}
                  required
                />
              </label>
              <label className="field">
                <span>answerer</span>
                <input
                  value={agentDraft.answerer}
                  onChange={(event) => setAgentDraft((current) => (current ? { ...current, answerer: event.target.value } : current))}
                  required
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setShowAgentCreateModal(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Create Agent
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={showEvaluatorTypeModal}
        title="选择评估器类型"
        subtitle="第一步先选 LLM Evaluator / Code Evaluator"
        onClose={() => setShowEvaluatorTypeModal(false)}
      >
        <div className="template-grid">
          {(["model", "code"] as EvaluatorFamilyChoice[]).map((family) => (
            <button
              key={family}
              className="template-card"
              type="button"
              onClick={() => {
                setSelectedEvaluatorFamily(family);
                setShowEvaluatorTypeModal(false);
                setShowEvaluatorCreate(true);
              }}
            >
              <strong>{evaluatorFamilyLabels[family]}</strong>
              <p>{family === "model" ? "LLM judge 结构化评估" : "规则或脚本式评估"}</p>
            </button>
          ))}
        </div>
      </Modal>

      <Drawer
        open={showPromptDrawer && Boolean(selectedPrompt)}
        title={selectedPrompt?.name ?? "Prompt"}
        subtitle={selectedPrompt ? `${selectedPrompt.version}` : undefined}
        onClose={() => setShowPromptDrawer(false)}
        wide
      >
        {selectedPrompt ? (
          <div className="content-stack">
            <div className="summary-grid">
              <article className="summary-card">
                <span>Version</span>
                <strong>{selectedPrompt.version}</strong>
              </article>
              <article className="summary-card">
                <span>Source</span>
                <strong>{selectedPrompt.version.includes("-coze") ? "Coze Loop migrated" : "Business sample"}</strong>
              </article>
            </div>

            <article className="detail-card">
              <h2>Description</h2>
              <p>{selectedPrompt.description ?? "--"}</p>
            </article>

            <article className="detail-card">
              <h2>System Prompt</h2>
              <pre className="code-block">{selectedPrompt.systemPrompt}</pre>
            </article>

            <article className="detail-card">
              <h2>User Template</h2>
              <pre className="code-block">{selectedPrompt.userTemplate}</pre>
            </article>

            <article className="detail-card">
              <h2>Input Schema</h2>
              <pre className="code-block">{JSON.stringify(selectedPrompt.inputSchema ?? {}, null, 2)}</pre>
            </article>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={showDatasetDrawer && Boolean(selectedDataset)}
        title={selectedDataset?.name ?? "Dataset"}
        subtitle={selectedDataset ? datasetTypeLabels[selectedDataset.datasetType] : undefined}
        onClose={() => setShowDatasetDrawer(false)}
        wide
      >
        {selectedDataset ? (
          <div className="content-stack">
            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setShowDatasetDrawer(false);
                  void openDatasetEditor(selectedDataset.id);
                }}
              >
                编辑数据集
              </button>
            </div>

            <div className="summary-grid">
              <article className="summary-card">
                <span>样本数</span>
                <strong>{selectedDataset.itemCount}</strong>
              </article>
              <article className="summary-card">
                <span>版本</span>
                <strong>{selectedDataset.version}</strong>
              </article>
            </div>

            <article className="detail-card">
              <h2>Schema</h2>
              <div className="stack-list">
                {selectedDataset.columns.map((column) => (
                  <div key={column.name} className="stack-item">
                    <strong>{column.name}</strong>
                    <span>
                      {column.data_type} · {column.description}
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className="detail-card">
              <h2>样本浏览</h2>
              {selectedDataset.cases.length > 0 ? (
                <div className="table-shell">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th>{selectedDataset.datasetType === "trace_monitor" ? "trace_id" : "input"}</th>
                        <th>
                          {selectedDataset.datasetType === "ideal_output"
                            ? "reference_output"
                            : selectedDataset.datasetType === "workflow"
                              ? "expected_steps"
                              : "final_output"}
                        </th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDataset.cases.slice(0, 5).map((item) => (
                        <tr key={item.id}>
                          <td>{item.id}</td>
                          <td>{"input" in item ? item.input : "trace_id" in item ? item.trace_id : item.id}</td>
                          <td>
                            {"reference_output" in item
                              ? item.reference_output
                              : "expected_steps" in item
                                ? item.expected_steps.join(", ")
                                : "final_output" in item
                                  ? item.final_output
                                  : "--"}
                          </td>
                          <td>
                            <button
                              className="table-link"
                              type="button"
                              onClick={() => void openDatasetCaseDetail(item.id)}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="stack-list">
                  <div className="stack-item">
                    <strong>当前能力</strong>
                    <span>当前前端没有可展示的样本记录，可继续补充样本数据或接入后端查询。</span>
                  </div>
                </div>
              )}
            </article>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={showDatasetCaseDrawer && Boolean(selectedDatasetCase)}
        title={selectedDatasetCase?.id ?? "Dataset Case"}
        subtitle={selectedDataset?.name}
        onClose={() => setShowDatasetCaseDrawer(false)}
      >
        {selectedDatasetCase ? (
          <div className="content-stack">
            <article className="detail-card">
              <h2>Case Record</h2>
              <div className="stack-list">
                {Object.entries(selectedDatasetCase as Record<string, unknown>).map(([key, value]) => (
                  <div key={key} className="stack-item stack-item--block">
                    <strong>{key}</strong>
                    {typeof value === "string" ? (
                      <span>{value}</span>
                    ) : (
                      <pre className="code-block">{formatCaseValue(value)}</pre>
                    )}
                  </div>
                ))}
              </div>
            </article>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={showDatasetCaseEditor && Boolean(datasetCaseDraft)}
        title={datasetCaseEditorMode === "create" ? "New Case" : datasetCaseDraft?.id ?? "Edit Case"}
        subtitle={selectedDataset?.name}
        onClose={() => setShowDatasetCaseEditor(false)}
      >
        {datasetCaseDraft ? (
          <form className="form-layout" onSubmit={handleDatasetCaseSave}>
            {Object.entries(datasetCaseDraft as Record<string, unknown>).map(([key, value]) => (
              <label key={key} className="field">
                <span>{key}</span>
                {typeof value === "string" ? (
                  <input
                    value={String(value)}
                    readOnly={key === "id"}
                    onChange={(event) => handleDatasetCaseFieldChange(key, event.target.value)}
                  />
                ) : (
                  <textarea
                    value={datasetCaseJsonDrafts[key] ?? formatCaseValue(value)}
                    onChange={(event) => handleDatasetCaseFieldChange(key, event.target.value)}
                  />
                )}
              </label>
            ))}

            {datasetCaseFormError ? <div className="notice-bar">{datasetCaseFormError}</div> : null}

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setShowDatasetCaseEditor(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={datasetCaseSubmitting}>
                {datasetCaseSubmitting ? "Saving..." : datasetCaseEditorMode === "create" ? "Create case" : "Save case"}
              </button>
            </div>
          </form>
        ) : null}
      </Drawer>

      <Drawer
        open={showEvaluatorDrawer && Boolean(selectedEvaluator)}
        title={selectedEvaluator?.name ?? "Evaluator"}
        subtitle={
          selectedEvaluator
            ? `${layerLabels[selectedEvaluator.layer as DisplayLayer]} / ${
                selectedEvaluator.evaluatorFamily === "model" ? "LLM" : "Code"
              }`
            : undefined
        }
        onClose={() => setShowEvaluatorDrawer(false)}
      >
        {selectedEvaluator ? (
          <div className="content-stack">
            <div className="summary-grid">
              <article className="summary-card">
                <span>Metric Type</span>
                <strong>{metricTypeLabels[selectedEvaluator.metricType]}</strong>
              </article>
              <article className="summary-card">
                <span>Family</span>
                <strong>
                  {selectedEvaluator.evaluatorFamily === "model" ? "LLM Evaluator" : "Code Evaluator"}
                </strong>
              </article>
            </div>
            <article className="detail-card">
              <h2>描述</h2>
              <p>{selectedEvaluator.description}</p>
            </article>
            <article className="detail-card">
              <h2>配置</h2>
              <pre className="code-block">{selectedEvaluator.config || "{}"}</pre>
            </article>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={showRunDrawer && Boolean(selectedExperimentRow)}
        title={selectedExperimentRow?.label ?? "Run"}
        subtitle={
          selectedExperimentRow
            ? `${selectedExperimentRow.targetName} / ${selectedExperimentRow.targetVersion}`
            : undefined
        }
        onClose={() => setShowRunDrawer(false)}
        wide
      >
        {selectedExperimentRow ? (
          <div className="content-stack">
            <div className="flow-row">
              {layerOrder.map((layer) => (
                <button
                  key={layer}
                  className={`flow-node ${runLayer === layer ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setRunLayer(layer)}
                >
                  <strong>{layerLabels[layer]}</strong>
                </button>
              ))}
            </div>

            <div className="table-shell">
              <table className="table">
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Layer Score</th>
                    <th>Overall</th>
                    <th>Status</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {currentRunCases.map((item) => (
                    <tr
                      key={item.caseRun.caseId}
                      className={selectedCaseId === item.caseRun.caseId ? "is-selected" : ""}
                      onClick={() => setSelectedCaseId(item.caseRun.caseId)}
                    >
                      <td>{item.title}</td>
                      <td>{formatMetric(item.layerScore)}</td>
                      <td>{formatMetric(item.overallScore)}</td>
                      <td>{item.caseRun.status}</td>
                      <td>
                        <button
                          className="table-link"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openTrace(item.caseRun.traceId, selectedExperimentRow.id);
                          }}
                        >
                          查看 trace
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedRunCase ? (
              <div className="detail-grid">
                <article className="detail-card">
                  <h2>Case Output</h2>
                  <p>{selectedRunCase.output}</p>
                </article>
                <article className="detail-card">
                  <h2>Metrics</h2>
                  <div className="metric-list">
                    {selectedRunCase.layerMetrics
                      .filter((metric) => metric.layer === runLayer)
                      .map((metric) => (
                        <article key={`${metric.layer}:${metric.metricName}`} className="metric-item">
                          <div className="metric-item__top">
                            <strong>{metric.metricName}</strong>
                            <span>{formatMetric(metricScore(metric.score))}</span>
                          </div>
                          <p>{metric.reason}</p>
                        </article>
                      ))}
                  </div>
                </article>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={showComparisonDrawer}
        title="AB Compare Detail"
        subtitle={`${viewModel.baseline.target.version} vs ${viewModel.candidate.target.version}`}
        onClose={() => setShowComparisonDrawer(false)}
        wide
      >
        <div className="content-stack">
          <article className="detail-card">
            <h2>Attribution Records</h2>
            <div className="table-shell">
              <table className="table">
                <thead>
                  <tr>
                    <th>Target Metric</th>
                    <th>Driver</th>
                    <th>Layer</th>
                    <th>Delta</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {viewModel.comparison.attributionRecords.map((record) => (
                    <tr key={`${record.layer}:${record.candidateDriver}`}>
                      <td>{record.targetMetric}</td>
                      <td>{record.candidateDriver}</td>
                      <td>{layerLabels[record.layer as DisplayLayer]}</td>
                      <td className={statusTone(record.delta)}>{formatDelta(record.delta)}</td>
                      <td>{record.confidence.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="detail-card">
            <h2>Layer Deltas</h2>
            <div className="table-shell">
              <table className="table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Layer</th>
                    <th>Baseline</th>
                    <th>Candidate</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {viewModel.comparison.layerDeltas.map((delta) => (
                    <tr key={`${delta.layer}:${delta.metricName}`}>
                      <td>{delta.metricName}</td>
                      <td>{layerLabels[delta.layer as DisplayLayer]}</td>
                      <td>{formatMetric(delta.baselineValue)}</td>
                      <td>{formatMetric(delta.candidateValue)}</td>
                      <td className={statusTone(delta.delta)}>{formatDelta(delta.delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </Drawer>

      <Drawer
        open={showTraceDrawer && Boolean(selectedTraceRow)}
        title={selectedTraceRow?.traceId ?? "Trace"}
        subtitle={selectedTraceRow?.title}
        onClose={() => setShowTraceDrawer(false)}
        wide
      >
        {selectedTraceRow ? (
          <div className="content-stack">
            <article className="detail-card">
              <h2>Answer Output</h2>
              <pre className="code-block">{JSON.stringify(selectedTraceRow.trace.answerTrace.outputs, null, 2)}</pre>
            </article>
            <div className="detail-grid">
              <article className="detail-card">
                <h2>Retrieval</h2>
                <pre className="code-block">{JSON.stringify(selectedTraceRow.trace.retrievalTrace.outputs, null, 2)}</pre>
              </article>
              <article className="detail-card">
                <h2>Rerank</h2>
                <pre className="code-block">{JSON.stringify(selectedTraceRow.trace.rerankTrace.outputs, null, 2)}</pre>
              </article>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
};
