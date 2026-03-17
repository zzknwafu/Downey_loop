import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentRecord,
  BootstrapResponse,
  CodeEvaluatorStrategy,
  CreateAgentInput,
  CreateComparisonInput,
  CreateDatasetCaseInput,
  CreateDatasetInput,
  CreateEvaluatorInput,
  CreateExperimentInput,
  CreatePromptInput,
  DatasetCaseRecord,
  DatasetSchemaField,
  DatasetSynthesisColumnInput,
  DatasetSynthesisDirection,
  DatasetSynthesisResult,
  DatasetSynthesisSource,
  DatasetType,
  EvaluatorFamily,
  LayerName,
  MetricType,
  PromptPreviewInput,
  PromptPreviewResult,
  PromptRecord,
  ReplaceDatasetCasesInput,
  SynthesizeDatasetInput,
  UpdateDatasetInput,
  UpdateDatasetCaseInput,
} from "../shared/contracts.js";
import { FileBackedLocalStore } from "../infra/store.js";
import { createReferencePipelineExecutor, EvalLoopService } from "../services/eval-loop-service.js";
import {
  toAgentRecord,
  toComparisonRecord,
  toEditableDatasetCase,
  toDatasetCaseRecord,
  toDatasetRecord,
  toEvaluatorRecord,
  toExperimentRunRecord,
  toPromptRecord,
  toTraceRunRecord,
} from "./contract-adapter.js";
import { loadConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");
const clientDistDir = path.join(rootDir, "dist/client");

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const config = loadConfig(rootDir);
const store = new FileBackedLocalStore(config.storeFilePath);
const service = new EvalLoopService(store, createReferencePipelineExecutor());
const ready = service.seedDefaults();

const datasetTypes = new Set<DatasetType>(["ideal_output", "workflow", "trace_monitor"]);
const layerNames = new Set<LayerName>(["retrieval", "rerank", "answer", "overall"]);
const metricTypes = new Set<MetricType>(["binary", "continuous", "categorical"]);
const evaluatorFamilies = new Set<EvaluatorFamily>(["model", "code"]);
const codeStrategies = new Set<CodeEvaluatorStrategy>([
  "exact_match",
  "regex_match",
  "fuzzy_match",
  "python_script",
]);

const withCors = (res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
};

const sendJson = (res: ServerResponse, statusCode: number, payload: unknown) => {
  withCors(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
};

const sendError = (res: ServerResponse, statusCode: number, message: string) => {
  sendJson(res, statusCode, { error: message });
};

const readJsonBody = async <T>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as T;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isSchemaField = (value: unknown): value is DatasetSchemaField =>
  isObject(value) &&
  typeof value.name === "string" &&
  typeof value.data_type === "string" &&
  ["String", "Number", "Boolean", "JSON"].includes(value.data_type) &&
  typeof value.required === "boolean" &&
  typeof value.description === "string";

const isSynthesisColumn = (value: unknown): value is DatasetSynthesisColumnInput =>
  isObject(value) &&
  typeof value.name === "string" &&
  typeof value.description === "string" &&
  typeof value.generation_requirement === "string";

const parseDatasetInput = (payload: unknown): CreateDatasetInput | null => {
  if (!isObject(payload)) {
    return null;
  }

  if (
    typeof payload.name !== "string" ||
    typeof payload.description !== "string" ||
    typeof payload.dataset_type !== "string" ||
    !datasetTypes.has(payload.dataset_type as DatasetType) ||
    typeof payload.sample_count !== "number" ||
    !Number.isInteger(payload.sample_count) ||
    !Array.isArray(payload.schema) ||
    !payload.schema.every(isSchemaField)
  ) {
    return null;
  }

  return {
    name: payload.name,
    description: payload.description,
    dataset_type: payload.dataset_type as DatasetType,
    sample_count: payload.sample_count,
    schema: payload.schema,
  };
};

const parsePromptInput = (payload: unknown): CreatePromptInput | null => {
  if (
    !isObject(payload) ||
    typeof payload.name !== "string" ||
    typeof payload.system_prompt !== "string" ||
    typeof payload.user_template !== "string" ||
    (payload.description !== undefined && typeof payload.description !== "string")
  ) {
    return null;
  }

  return {
    name: payload.name,
    description: payload.description,
    system_prompt: payload.system_prompt,
    user_template: payload.user_template,
  };
};

const parsePromptPreviewInput = (payload: unknown): PromptPreviewInput | null => {
  if (
    !isObject(payload) ||
    typeof payload.input !== "string" ||
    (payload.variables !== undefined &&
      (!isObject(payload.variables) ||
        Object.values(payload.variables).some((item) => typeof item !== "string")))
  ) {
    return null;
  }

  return {
    input: payload.input,
    variables: payload.variables as Record<string, string> | undefined,
  };
};

const parseAgentInput = (payload: unknown): CreateAgentInput | null => {
  if (
    !isObject(payload) ||
    typeof payload.name !== "string" ||
    typeof payload.query_processor !== "string" ||
    typeof payload.retriever !== "string" ||
    typeof payload.reranker !== "string" ||
    typeof payload.answerer !== "string" ||
    (payload.description !== undefined && typeof payload.description !== "string")
  ) {
    return null;
  }

  return {
    name: payload.name,
    description: payload.description,
    query_processor: payload.query_processor,
    retriever: payload.retriever,
    reranker: payload.reranker,
    answerer: payload.answerer,
  };
};

const parseUpdateDatasetInput = (payload: unknown): UpdateDatasetInput | null => {
  const parsed = parseDatasetInput(payload);
  if (!parsed) {
    return null;
  }

  return parsed;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isTraceStepRecord = (
  value: unknown,
): value is DatasetCaseRecord extends infer T
  ? T extends { trajectory: infer U }
    ? U extends Array<infer Step>
      ? Step
      : never
    : never
  : never =>
  isObject(value) &&
  typeof value.layer === "string" &&
  typeof value.latency_ms === "number" &&
  isObject(value.inputs) &&
  isObject(value.outputs);

const parseDatasetCaseInput = (
  payload: unknown,
  datasetType: DatasetType,
): CreateDatasetCaseInput | UpdateDatasetCaseInput | null => {
  if (!isObject(payload) || typeof payload.id !== "string") {
    return null;
  }

  if (
    datasetType === "ideal_output" &&
    typeof payload.input === "string" &&
    typeof payload.reference_output === "string" &&
    isObject(payload.context)
  ) {
    return {
      id: payload.id,
      input: payload.input,
      reference_output: payload.reference_output,
      context: payload.context,
    };
  }

  if (
    datasetType === "workflow" &&
    typeof payload.input === "string" &&
    isObject(payload.workflow_output) &&
    isStringArray(payload.expected_steps)
  ) {
    return {
      id: payload.id,
      input: payload.input,
      workflow_output: payload.workflow_output,
      expected_steps: payload.expected_steps,
      context: isObject(payload.context) ? payload.context : undefined,
    };
  }

  if (
    datasetType === "trace_monitor" &&
    typeof payload.trace_id === "string" &&
    typeof payload.final_output === "string" &&
    Array.isArray(payload.trajectory) &&
    payload.trajectory.every(isTraceStepRecord)
  ) {
    return {
      id: payload.id,
      trace_id: payload.trace_id,
      final_output: payload.final_output,
      trajectory: payload.trajectory,
      context: isObject(payload.context) ? payload.context : undefined,
    };
  }

  return null;
};

const parseReplaceDatasetCasesInput = (
  payload: unknown,
  datasetType: DatasetType,
): ReplaceDatasetCasesInput | null => {
  if (!isObject(payload) || !Array.isArray(payload.cases)) {
    return null;
  }

  const cases = payload.cases
    .map((item) => parseDatasetCaseInput(item, datasetType))
    .filter((item): item is DatasetCaseRecord => item !== null);

  if (cases.length !== payload.cases.length) {
    return null;
  }

  return { cases };
};

const parseSynthesizeDatasetInput = (payload: unknown): SynthesizeDatasetInput | null => {
  if (
    !isObject(payload) ||
    typeof payload.dataset_id !== "string" ||
    (payload.source !== "dataset" && payload.source !== "online") ||
    typeof payload.direction !== "string" ||
    !new Set<DatasetSynthesisDirection>([
      "generalize",
      "augment_failures",
      "augment_guardrails",
      "align_online_distribution",
    ]).has(payload.direction as DatasetSynthesisDirection) ||
    typeof payload.scenario_description !== "string" ||
    typeof payload.use_case_description !== "string" ||
    typeof payload.seed_source_ref !== "string" ||
    !Array.isArray(payload.columns) ||
    !payload.columns.every(isSynthesisColumn) ||
    typeof payload.sample_count !== "number" ||
    !Number.isInteger(payload.sample_count) ||
    payload.sample_count < 10
  ) {
    return null;
  }

  return {
    dataset_id: payload.dataset_id,
    source: payload.source as DatasetSynthesisSource,
    direction: payload.direction as DatasetSynthesisDirection,
    scenario_description: payload.scenario_description,
    use_case_description: payload.use_case_description,
    seed_source_ref: payload.seed_source_ref,
    columns: payload.columns,
    sample_count: payload.sample_count,
  };
};

const parseDatasetCaseRoute = (pathname: string) => {
  const match = pathname.match(/^\/api\/datasets\/([^/]+)\/cases\/([^/]+)$/);
  if (!match) {
    return null;
  }

  return {
    datasetId: decodeURIComponent(match[1]!),
    caseId: decodeURIComponent(match[2]!),
  };
};

const parsePromptPreviewRoute = (pathname: string) => {
  const match = pathname.match(/^\/api\/prompts\/([^/]+)\/preview$/);
  if (!match) {
    return null;
  }

  return {
    promptId: decodeURIComponent(match[1]!),
  };
};

const parseDatasetCasesRoute = (pathname: string) => {
  const match = pathname.match(/^\/api\/datasets\/([^/]+)\/cases$/);
  if (!match) {
    return null;
  }

  return {
    datasetId: decodeURIComponent(match[1]!),
  };
};

const parseDatasetSynthesisRoute = (pathname: string) => {
  const match = pathname.match(/^\/api\/datasets\/([^/]+)\/synthesis$/);
  if (!match) {
    return null;
  }

  return {
    datasetId: decodeURIComponent(match[1]!),
  };
};

const parseEvaluatorInput = (payload: unknown): CreateEvaluatorInput | null => {
  if (!isObject(payload)) {
    return null;
  }

  if (
    typeof payload.name !== "string" ||
    typeof payload.description !== "string" ||
    typeof payload.family !== "string" ||
    !evaluatorFamilies.has(payload.family as EvaluatorFamily) ||
    typeof payload.layer !== "string" ||
    !layerNames.has(payload.layer as LayerName) ||
    typeof payload.metric_type !== "string" ||
    !metricTypes.has(payload.metric_type as MetricType) ||
    !isObject(payload.config)
  ) {
    return null;
  }

  if (
    payload.code_strategy !== undefined &&
    (typeof payload.code_strategy !== "string" ||
      !codeStrategies.has(payload.code_strategy as CodeEvaluatorStrategy))
  ) {
    return null;
  }

  return {
    name: payload.name,
    description: payload.description,
    family: payload.family as EvaluatorFamily,
    layer: payload.layer as LayerName,
    metric_type: payload.metric_type as MetricType,
    code_strategy:
      typeof payload.code_strategy === "string"
        ? (payload.code_strategy as CodeEvaluatorStrategy)
        : undefined,
    config: payload.config,
  };
};

const parseExperimentInput = (payload: unknown): CreateExperimentInput | null => {
  if (!isObject(payload) || !isObject(payload.pipeline_version)) {
    return null;
  }

  const pipeline = payload.pipeline_version;
  if (
    typeof payload.dataset_id !== "string" ||
    (payload.evaluator_ids !== undefined &&
      (!Array.isArray(payload.evaluator_ids) || !payload.evaluator_ids.every((id) => typeof id === "string"))) ||
    typeof pipeline.id !== "string" ||
    typeof pipeline.name !== "string" ||
    typeof pipeline.version !== "string" ||
    typeof pipeline.query_processor !== "string" ||
    typeof pipeline.retriever !== "string" ||
    typeof pipeline.reranker !== "string" ||
    typeof pipeline.answerer !== "string"
  ) {
    return null;
  }

  return {
    dataset_id: payload.dataset_id,
    evaluator_ids: payload.evaluator_ids as string[] | undefined,
    pipeline_version: {
      id: pipeline.id,
      name: pipeline.name,
      version: pipeline.version,
      query_processor: pipeline.query_processor,
      retriever: pipeline.retriever,
      reranker: pipeline.reranker,
      answerer: pipeline.answerer,
    },
  };
};

const parseComparisonInput = (payload: unknown): CreateComparisonInput | null => {
  if (
    !isObject(payload) ||
    typeof payload.baseline_run_id !== "string" ||
    typeof payload.candidate_run_id !== "string"
  ) {
    return null;
  }

  return {
    baseline_run_id: payload.baseline_run_id,
    candidate_run_id: payload.candidate_run_id,
  };
};

const buildBootstrapResponse = async (): Promise<BootstrapResponse> => ({
  meta: {
    app_name: config.appName,
    generated_at: new Date().toISOString(),
    storage: {
      driver: "local_json",
      data_dir: config.dataDir,
      sqlite_path: config.sqlitePath,
    },
  },
  data: {
    datasets: (await service.listDatasets()).map(toDatasetRecord),
    evaluators: (await service.listEvaluators()).map(toEvaluatorRecord),
    experiments: (await service.listExperiments()).map(toExperimentRunRecord),
    traces: (await service.listTraces()).map(toTraceRunRecord),
    ab_experiment: toComparisonRecord(
      (await service.getLatestComparison()) ??
        (await service.compareExperimentRuns("exp_baseline", "exp_candidate")),
    ),
  },
});

const sendFile = async (filePath: string, res: ServerResponse) => {
  const fileStat = await stat(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream",
    "Content-Length": fileStat.size,
    "Cache-Control": filePath.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(filePath).pipe(res);
};

const handleApi = async (req: IncomingMessage, res: ServerResponse, pathname: string) => {
  await ready;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { status: "ok", app_name: config.appName });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(res, 200, await buildBootstrapResponse());
    return true;
  }

  if (req.method === "GET" && pathname === "/api/prompts") {
    sendJson(res, 200, { items: (await service.listPrompts()).map(toPromptRecord) });
    return true;
  }

  const promptPreviewRoute = parsePromptPreviewRoute(pathname);
  if (req.method === "POST" && promptPreviewRoute) {
    const prompt = await store.getPrompt(promptPreviewRoute.promptId);
    if (!prompt) {
      sendError(res, 404, "Prompt not found");
      return true;
    }

    const payload = parsePromptPreviewInput(await readJsonBody<unknown>(req));
    if (!payload) {
      sendError(res, 400, "Invalid prompt preview payload");
      return true;
    }

    sendJson(res, 200, {
      item: buildPromptPreviewResult(toPromptRecord(prompt), payload),
    });
    return true;
  }

  if (req.method === "GET" && pathname.startsWith("/api/prompts/")) {
    const prompt = await store.getPrompt(pathname.split("/").pop() ?? "");
    if (!prompt) {
      sendError(res, 404, "Prompt not found");
      return true;
    }

    sendJson(res, 200, { item: toPromptRecord(prompt) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/prompts") {
    const payload = parsePromptInput(await readJsonBody<unknown>(req));
    if (!payload) {
      sendError(res, 400, "Invalid prompt payload");
      return true;
    }

    try {
      const prompt = await service.createPrompt({
        name: payload.name,
        description: payload.description,
        systemPrompt: payload.system_prompt,
        userTemplate: payload.user_template,
      });

      sendJson(res, 201, { item: toPromptRecord(prompt) });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid prompt payload");
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/agents") {
    sendJson(res, 200, { items: (await service.listAgents()).map(toAgentRecord) });
    return true;
  }

  if (req.method === "GET" && pathname.startsWith("/api/agents/")) {
    const agent = await store.getAgent(pathname.split("/").pop() ?? "");
    if (!agent) {
      sendError(res, 404, "Agent not found");
      return true;
    }

    sendJson(res, 200, { item: toAgentRecord(agent) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/agents") {
    const payload = parseAgentInput(await readJsonBody<unknown>(req));
    if (!payload) {
      sendError(res, 400, "Invalid agent payload");
      return true;
    }

    try {
      const agent = await service.createAgent({
        name: payload.name,
        description: payload.description,
        queryProcessor: payload.query_processor,
        retriever: payload.retriever,
        reranker: payload.reranker,
        answerer: payload.answerer,
      });

      sendJson(res, 201, { item: toAgentRecord(agent) });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid agent payload");
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/datasets") {
    sendJson(res, 200, { items: (await service.listDatasets()).map(toDatasetRecord) });
    return true;
  }

  const datasetCasesRoute = parseDatasetCasesRoute(pathname);
  if (req.method === "GET" && datasetCasesRoute) {
    const dataset = await store.getDataset(datasetCasesRoute.datasetId);
    if (!dataset) {
      sendError(res, 404, "Dataset not found");
      return true;
    }

    sendJson(res, 200, { items: toDatasetRecord(dataset).cases });
    return true;
  }

  if (req.method === "PUT" && datasetCasesRoute) {
    const dataset = await store.getDataset(datasetCasesRoute.datasetId);
    if (!dataset) {
      sendError(res, 404, "Dataset not found");
      return true;
    }

    const payload = parseReplaceDatasetCasesInput(await readJsonBody<unknown>(req), dataset.datasetType);
    if (!payload) {
      sendError(res, 400, "Invalid dataset cases payload");
      return true;
    }

    try {
      const updated = await service.replaceDatasetCases(datasetCasesRoute.datasetId, {
        cases: payload.cases.map((item) => toEditableDatasetCase(item, dataset.datasetType)),
      });

      sendJson(res, 200, {
        items: updated.cases.map((item) => toDatasetCaseRecord(item, updated.datasetType)),
      });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid dataset cases payload");
    }
    return true;
  }

  if (req.method === "POST" && datasetCasesRoute) {
    const dataset = await store.getDataset(datasetCasesRoute.datasetId);
    if (!dataset) {
      sendError(res, 404, "Dataset not found");
      return true;
    }

    const payload = parseDatasetCaseInput(await readJsonBody<unknown>(req), dataset.datasetType);
    if (!payload) {
      sendError(res, 400, "Invalid dataset case payload");
      return true;
    }

    try {
      const updated = await service.createDatasetCase(
        datasetCasesRoute.datasetId,
        toEditableDatasetCase(payload, dataset.datasetType),
      );
      const created = updated.cases.find((item) => getDatasetCaseKey(item) === payload.id);
      if (!created) {
        sendError(res, 500, "Dataset case creation did not persist");
        return true;
      }

      sendJson(res, 201, { item: toDatasetCaseRecord(created, updated.datasetType) });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid dataset case payload");
    }
    return true;
  }

  const datasetCaseRoute = parseDatasetCaseRoute(pathname);
  if (req.method === "GET" && datasetCaseRoute) {
    const dataset = await store.getDataset(datasetCaseRoute.datasetId);
    if (!dataset) {
      sendError(res, 404, "Dataset not found");
      return true;
    }

    const datasetCase = toDatasetRecord(dataset).cases.find((item) => item.id === datasetCaseRoute.caseId);
    if (!datasetCase) {
      sendError(res, 404, "Dataset case not found");
      return true;
    }

    sendJson(res, 200, { item: datasetCase });
    return true;
  }

  if (req.method === "PUT" && datasetCaseRoute) {
    const dataset = await store.getDataset(datasetCaseRoute.datasetId);
    if (!dataset) {
      sendError(res, 404, "Dataset not found");
      return true;
    }

    const payload = parseDatasetCaseInput(await readJsonBody<unknown>(req), dataset.datasetType);
    if (!payload || payload.id !== datasetCaseRoute.caseId) {
      sendError(res, 400, "Invalid dataset case payload");
      return true;
    }

    const currentCase = dataset.cases.find((item) => getDatasetCaseKey(item) === datasetCaseRoute.caseId);
    if (!currentCase) {
      sendError(res, 404, "Dataset case not found");
      return true;
    }

    try {
      const updated = await service.updateDatasetCase(
        datasetCaseRoute.datasetId,
        toEditableDatasetCase(payload, dataset.datasetType),
      );
      const updatedCase = updated.cases.find((item) => getDatasetCaseKey(item) === datasetCaseRoute.caseId);
      if (!updatedCase) {
        sendError(res, 404, "Dataset case not found");
        return true;
      }

      sendJson(res, 200, { item: toDatasetCaseRecord(updatedCase, updated.datasetType) });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid dataset case payload");
    }
    return true;
  }

  if (req.method === "DELETE" && datasetCaseRoute) {
    const datasetCase = await store.getDatasetCase(datasetCaseRoute.datasetId, datasetCaseRoute.caseId);
    if (!datasetCase) {
      sendError(res, 404, "Dataset case not found");
      return true;
    }

    try {
      await service.deleteDatasetCase(datasetCaseRoute.datasetId, datasetCaseRoute.caseId);
      withCors(res);
      res.writeHead(204);
      res.end();
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid dataset case payload");
    }
    return true;
  }

  const datasetSynthesisRoute = parseDatasetSynthesisRoute(pathname);
  if (req.method === "POST" && datasetSynthesisRoute) {
    const payload = parseSynthesizeDatasetInput(await readJsonBody<unknown>(req));
    if (!payload || payload.dataset_id !== datasetSynthesisRoute.datasetId) {
      sendError(res, 400, "Invalid synthesis payload");
      return true;
    }

    const result = await store.synthesizeDatasetCases(datasetSynthesisRoute.datasetId, payload);
    if (!result) {
      sendError(res, 404, "Dataset not found");
      return true;
    }

    sendJson(res, 200, {
      item: {
        dataset_id: result.dataset_id,
        source: result.source,
        direction: result.direction,
        items: result.items,
        status: result.status,
        created_at: result.created_at,
      } satisfies DatasetSynthesisResult,
    });
    return true;
  }

  if (req.method === "GET" && pathname.startsWith("/api/datasets/")) {
    const datasetId = pathname.split("/").pop() ?? "";
    const dataset = await store.getDataset(datasetId);
    if (!dataset) {
      sendError(res, 404, "Dataset not found");
      return true;
    }

    sendJson(res, 200, { item: toDatasetRecord(dataset) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/datasets") {
    const payload = parseDatasetInput(await readJsonBody<unknown>(req));
    if (!payload) {
      sendError(res, 400, "Invalid dataset payload");
      return true;
    }

    try {
      sendJson(res, 201, {
        item: toDatasetRecord(
          await service.createDataset({
            name: payload.name,
            description: payload.description,
            datasetType: payload.dataset_type,
            sampleCount: payload.sample_count,
            schema: payload.schema.map((field) => ({
              name: field.name,
              dataType: field.data_type,
              required: field.required,
              description: field.description,
            })),
          }),
        ),
      });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid dataset payload");
    }
    return true;
  }

  if (req.method === "PUT" && pathname.startsWith("/api/datasets/")) {
    const datasetId = pathname.split("/").pop() ?? "";
    const payload = parseUpdateDatasetInput(await readJsonBody<unknown>(req));
    if (!payload) {
      sendError(res, 400, "Invalid dataset payload");
      return true;
    }

    try {
      const dataset = await store.updateDataset(datasetId, {
        name: payload.name,
        description: payload.description,
        datasetType: payload.dataset_type,
        sampleCount: payload.sample_count,
        schema: payload.schema.map((field) => ({
          name: field.name,
          dataType: field.data_type,
          required: field.required,
          description: field.description,
        })),
        timestamp: new Date().toISOString(),
      });

      if (!dataset) {
        sendError(res, 404, "Dataset not found");
        return true;
      }

      sendJson(res, 200, { item: toDatasetRecord(dataset) });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid dataset payload");
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/evaluators") {
    sendJson(res, 200, { items: (await service.listEvaluators()).map(toEvaluatorRecord) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/evaluators") {
    const payload = parseEvaluatorInput(await readJsonBody<unknown>(req));
    if (!payload) {
      sendError(res, 400, "Invalid evaluator payload");
      return true;
    }

    try {
      sendJson(res, 201, {
        item: toEvaluatorRecord(
          await service.createEvaluator({
            name: payload.name,
            description: payload.description,
            family: payload.family,
            layer: payload.layer,
            metricType: payload.metric_type,
            codeStrategy: payload.code_strategy,
            config: payload.config,
          }),
        ),
      });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid evaluator payload");
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/experiments") {
    sendJson(res, 200, { items: (await service.listExperiments()).map(toExperimentRunRecord) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/experiments") {
    const payload = parseExperimentInput(await readJsonBody<unknown>(req));
    if (!payload) {
      sendError(res, 400, "Invalid experiment payload");
      return true;
    }

    try {
      const experiment = await service.runExperiment({
        datasetId: payload.dataset_id,
        evaluatorIds: payload.evaluator_ids,
        target: {
          id: payload.pipeline_version.id,
          name: payload.pipeline_version.name,
          version: payload.pipeline_version.version,
          queryProcessor: payload.pipeline_version.query_processor,
          retriever: payload.pipeline_version.retriever,
          reranker: payload.pipeline_version.reranker,
          answerer: payload.pipeline_version.answerer,
        },
      });

      sendJson(res, 201, { item: toExperimentRunRecord(experiment) });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid experiment payload");
    }
    return true;
  }

  if (req.method === "GET" && pathname.startsWith("/api/experiments/")) {
    const experiment = await service.getExperiment(pathname.split("/").pop() ?? "");
    if (!experiment) {
      sendError(res, 404, "Experiment not found");
      return true;
    }

    sendJson(res, 200, { item: toExperimentRunRecord(experiment) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/comparisons") {
    const payload = parseComparisonInput(await readJsonBody<unknown>(req));
    if (!payload) {
      sendError(res, 400, "Invalid comparison payload");
      return true;
    }

    try {
      const comparison = await service.compareExperimentRuns(
        payload.baseline_run_id,
        payload.candidate_run_id,
      );

      sendJson(res, 201, { item: toComparisonRecord(comparison) });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Invalid comparison payload");
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/traces") {
    sendJson(res, 200, { items: (await service.listTraces()).map(toTraceRunRecord) });
    return true;
  }

  if (req.method === "GET" && pathname.startsWith("/api/traces/")) {
    const trace = await service.getTrace(pathname.split("/").pop() ?? "");
    if (!trace) {
      sendError(res, 404, "Trace not found");
      return true;
    }

    sendJson(res, 200, { item: toTraceRunRecord(trace) });
    return true;
  }

  return false;
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      withCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, pathname);
      if (!handled) {
        sendError(res, 404, "Route not found");
      }
      return;
    }

    if (!existsSync(clientDistDir)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Frontend build not found. Run `npm run build` or use `npm run dev`.");
      return;
    }

    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.join(clientDistDir, requestedPath.replace(/^\/+/, ""));

    if (existsSync(filePath)) {
      await sendFile(filePath, res);
      return;
    }

    await sendFile(path.join(clientDistDir, "index.html"), res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    sendError(res, 500, message);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`${config.appName} API listening on ${config.appBaseUrl}`);
});

const getDatasetCaseKey = (item: object): string | undefined => {
  const caseId = Reflect.get(item, "caseId");
  if (typeof caseId === "string") {
    return caseId;
  }

  const id = Reflect.get(item, "id");
  return typeof id === "string" ? id : undefined;
};

const buildPromptPreviewResult = (
  prompt: PromptRecord,
  input: PromptPreviewInput,
): PromptPreviewResult => {
  const renderedSystem = applyPromptVariables(prompt.system_prompt, input.input, input.variables);
  const renderedUser = applyPromptVariables(prompt.user_template, input.input, input.variables);

  return {
    prompt_id: prompt.id,
    input: input.input,
    rendered_system_prompt: renderedSystem,
    rendered_user_prompt: renderedUser,
    output_preview: `Preview only: ${input.input}`,
    created_at: new Date().toISOString(),
  };
};

const applyPromptVariables = (
  template: string,
  input: string,
  variables?: Record<string, string>,
): string => {
  const entries = { input, ...(variables ?? {}) };
  return Object.entries(entries).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  );
};
