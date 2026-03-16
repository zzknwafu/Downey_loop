import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BootstrapResponse,
  CodeEvaluatorStrategy,
  CreateComparisonInput,
  CreateDatasetInput,
  CreateEvaluatorInput,
  CreateExperimentInput,
  DatasetSchemaField,
  DatasetType,
  EvaluatorFamily,
  LayerName,
  MetricType,
} from "../shared/contracts.js";
import { FileBackedLocalStore } from "../infra/store.js";
import { createReferencePipelineExecutor, EvalLoopService } from "../services/eval-loop-service.js";
import {
  toComparisonRecord,
  toDatasetRecord,
  toEvaluatorRecord,
  toExperimentRunRecord,
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
const service = new EvalLoopService(
  new FileBackedLocalStore(config.storeFilePath),
  createReferencePipelineExecutor(),
);
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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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

const parseDatasetInput = (payload: unknown): CreateDatasetInput | null => {
  if (!isObject(payload)) {
    return null;
  }

  if (
    typeof payload.name !== "string" ||
    typeof payload.description !== "string" ||
    typeof payload.dataset_type !== "string" ||
    !datasetTypes.has(payload.dataset_type as DatasetType) ||
    !Array.isArray(payload.schema) ||
    !payload.schema.every(isSchemaField)
  ) {
    return null;
  }

  return {
    name: payload.name,
    description: payload.description,
    dataset_type: payload.dataset_type as DatasetType,
    schema: payload.schema,
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

  if (req.method === "GET" && pathname === "/api/datasets") {
    sendJson(res, 200, { items: (await service.listDatasets()).map(toDatasetRecord) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/datasets") {
    const payload = parseDatasetInput(await readJsonBody<unknown>(req));
    if (!payload) {
      sendError(res, 400, "Invalid dataset payload");
      return true;
    }

    sendJson(res, 201, {
      item: toDatasetRecord(
        await service.createDataset({
          name: payload.name,
          description: payload.description,
          datasetType: payload.dataset_type,
          schema: payload.schema.map((field) => ({
            name: field.name,
            dataType: field.data_type,
            required: field.required,
            description: field.description,
          })),
        }),
      ),
    });
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

    const comparison = await service.compareExperimentRuns(
      payload.baseline_run_id,
      payload.candidate_run_id,
    );

    sendJson(res, 201, { item: toComparisonRecord(comparison) });
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
