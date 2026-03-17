import {
  Dataset,
  DatasetColumn,
  DatasetType,
  EditableDatasetCase,
  IdealOutputDatasetCaseValue,
  TraceMonitorDatasetCaseValue,
  WorkflowDatasetCaseValue,
} from "./types.js";

export const MIN_DATASET_SAMPLE_COUNT = 10;

export const datasetSchemaTemplates: Record<DatasetType, DatasetColumn[]> = {
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

export const datasetRequiredFields: Record<DatasetType, string[]> = {
  ideal_output: ["input", "reference_output", "context"],
  workflow: ["input", "workflow_output", "expected_steps"],
  trace_monitor: ["trace_id", "final_output", "trajectory"],
};

const editableSchemaFieldMap: Record<DatasetType, string[]> = {
  ideal_output: ["input", "reference_output", "context"],
  workflow: ["input", "workflow_output", "expected_steps", "context"],
  trace_monitor: ["trace_id", "final_output", "trajectory", "context"],
};

const ensureNonEmpty = (value: string, fieldName: string) => {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
};

const ensureLaterTimestamp = (current: string, next: string): string => {
  const currentMs = Date.parse(current);
  const nextMs = Date.parse(next);

  if (Number.isNaN(currentMs) || Number.isNaN(nextMs) || nextMs > currentMs) {
    return next;
  }

  return new Date(currentMs + 1).toISOString();
};

export const validateDatasetSchema = (
  datasetType: DatasetType,
  schema: DatasetColumn[],
): void => {
  if (schema.length === 0) {
    throw new Error("Dataset schema must include at least one field");
  }

  const seen = new Set<string>();

  for (const field of schema) {
    ensureNonEmpty(field.name, "Schema field name");
    ensureNonEmpty(field.description, `Schema field ${field.name} description`);

    if (seen.has(field.name)) {
      throw new Error(`Duplicate schema field: ${field.name}`);
    }

    seen.add(field.name);
  }

  const requiredFields = datasetRequiredFields[datasetType];
  const missingFields = requiredFields.filter((field) => !seen.has(field));

  if (missingFields.length > 0) {
    throw new Error(
      `Dataset type ${datasetType} requires schema fields: ${missingFields.join(", ")}`,
    );
  }
};

export const validateDatasetSampleCount = (sampleCount: number): void => {
  if (!Number.isInteger(sampleCount)) {
    throw new Error("Dataset sampleCount must be an integer");
  }

  if (sampleCount < MIN_DATASET_SAMPLE_COUNT) {
    throw new Error(`Dataset sampleCount must be at least ${MIN_DATASET_SAMPLE_COUNT}`);
  }
};

const ensureObject = (value: unknown, fieldName: string) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
};

const ensureStringArray = (value: unknown, fieldName: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} must be an array of strings`);
  }
};

const validateIdealOutputCase = (item: IdealOutputDatasetCaseValue) => {
  ensureNonEmpty(item.caseId, "Dataset caseId");
  ensureNonEmpty(item.input, "Ideal output case input");
  ensureNonEmpty(item.referenceOutput, "Ideal output case referenceOutput");
  ensureObject(item.context, "Ideal output case context");
};

const validateWorkflowCase = (item: WorkflowDatasetCaseValue) => {
  ensureNonEmpty(item.caseId, "Dataset caseId");
  ensureNonEmpty(item.input, "Workflow case input");
  ensureObject(item.workflowOutput, "Workflow case workflowOutput");
  ensureStringArray(item.expectedSteps, "Workflow case expectedSteps");

  if (item.context !== undefined) {
    ensureObject(item.context, "Workflow case context");
  }
};

const validateTraceMonitorCase = (item: TraceMonitorDatasetCaseValue) => {
  ensureNonEmpty(item.caseId, "Dataset caseId");
  ensureNonEmpty(item.traceId, "Trace monitor case traceId");
  ensureNonEmpty(item.finalOutput, "Trace monitor case finalOutput");

  if (!Array.isArray(item.trajectory)) {
    throw new Error("Trace monitor case trajectory must be an array");
  }

  if (item.context !== undefined) {
    ensureObject(item.context, "Trace monitor case context");
  }
};

export const validateEditableDatasetCase = (
  datasetType: DatasetType,
  item: EditableDatasetCase,
): void => {
  switch (datasetType) {
    case "ideal_output":
      validateIdealOutputCase(item as IdealOutputDatasetCaseValue);
      return;
    case "workflow":
      validateWorkflowCase(item as WorkflowDatasetCaseValue);
      return;
    case "trace_monitor":
      validateTraceMonitorCase(item as TraceMonitorDatasetCaseValue);
      return;
  }
};

export const validateEditableDatasetCases = (
  datasetType: DatasetType,
  items: EditableDatasetCase[],
): void => {
  const seen = new Set<string>();

  for (const item of items) {
    validateEditableDatasetCase(datasetType, item);

    if (seen.has(item.caseId)) {
      throw new Error(`Duplicate dataset caseId: ${item.caseId}`);
    }

    seen.add(item.caseId);
  }
};

export const validateEditableCaseSchemaCompatibility = (
  datasetType: DatasetType,
  schema: DatasetColumn[],
  item: EditableDatasetCase,
): void => {
  const schemaFields = new Set(schema.map((field) => field.name));
  const supportedFields = new Set(editableSchemaFieldMap[datasetType]);
  const unsupportedRequiredFields = schema
    .filter((field) => field.required && !supportedFields.has(field.name))
    .map((field) => field.name);

  if (unsupportedRequiredFields.length > 0) {
    throw new Error(
      `Editable dataset cases do not support required schema fields: ${unsupportedRequiredFields.join(", ")}`,
    );
  }

  switch (datasetType) {
    case "ideal_output":
      if (!schemaFields.has("input") || !schemaFields.has("reference_output")) {
        throw new Error("Ideal output editable case requires input and reference_output fields");
      }
      if ("context" in item && item.context !== undefined && !schemaFields.has("context")) {
        throw new Error("Ideal output editable case context requires context schema field");
      }
      return;
    case "workflow":
      if (!schemaFields.has("input") || !schemaFields.has("workflow_output")) {
        throw new Error("Workflow editable case requires input and workflow_output fields");
      }
      if (
        "expectedSteps" in item &&
        item.expectedSteps !== undefined &&
        !schemaFields.has("expected_steps")
      ) {
        throw new Error("Workflow editable case expectedSteps requires expected_steps schema field");
      }
      if ("context" in item && item.context !== undefined && !schemaFields.has("context")) {
        throw new Error("Workflow editable case context requires context schema field");
      }
      return;
    case "trace_monitor":
      if (!schemaFields.has("trace_id") || !schemaFields.has("final_output")) {
        throw new Error("Trace monitor editable case requires trace_id and final_output fields");
      }
      if (
        "trajectory" in item &&
        item.trajectory !== undefined &&
        !schemaFields.has("trajectory")
      ) {
        throw new Error("Trace monitor editable case trajectory requires trajectory schema field");
      }
      if ("context" in item && item.context !== undefined && !schemaFields.has("context")) {
        throw new Error("Trace monitor editable case context requires context schema field");
      }
      return;
  }
};

export interface CreateDatasetDefinitionInput {
  id: string;
  name: string;
  description: string;
  datasetType: DatasetType;
  schema: DatasetColumn[];
  sampleCount?: number;
  version?: string;
  timestamp: string;
}

export const createDatasetDefinition = (
  input: CreateDatasetDefinitionInput,
): Dataset => {
  ensureNonEmpty(input.name, "Dataset name");
  ensureNonEmpty(input.description, "Dataset description");
  validateDatasetSchema(input.datasetType, input.schema);
  if (input.sampleCount !== undefined) {
    validateDatasetSampleCount(input.sampleCount);
  }

  return {
    id: input.id,
    name: input.name.trim(),
    description: input.description.trim(),
    datasetType: input.datasetType,
    schema: input.schema,
    cases: [],
    version: input.version ?? "0.1.0",
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
};

export interface UpdateDatasetDefinitionInput {
  current: Dataset;
  name: string;
  description: string;
  datasetType: DatasetType;
  schema: DatasetColumn[];
  sampleCount?: number;
  timestamp: string;
  version?: string;
}

export const updateDatasetDefinition = (
  input: UpdateDatasetDefinitionInput,
): Dataset => {
  ensureNonEmpty(input.name, "Dataset name");
  ensureNonEmpty(input.description, "Dataset description");
  validateDatasetSchema(input.datasetType, input.schema);
  if (input.sampleCount !== undefined) {
    validateDatasetSampleCount(input.sampleCount);
  }
  if (input.current.datasetType !== input.datasetType && input.current.cases.length > 0) {
    throw new Error("Cannot change datasetType while dataset still contains cases");
  }

  return {
    ...input.current,
    name: input.name.trim(),
    description: input.description.trim(),
    datasetType: input.datasetType,
    schema: input.schema,
    version: input.version ?? input.current.version,
    updatedAt: ensureLaterTimestamp(input.current.updatedAt, input.timestamp),
  };
};

export interface ReplaceDatasetCasesDefinitionInput {
  current: Dataset<EditableDatasetCase>;
  cases: EditableDatasetCase[];
  timestamp: string;
}

export const replaceDatasetCasesDefinition = (
  input: ReplaceDatasetCasesDefinitionInput,
): Dataset<EditableDatasetCase> => {
  validateEditableDatasetCases(input.current.datasetType, input.cases);
  for (const item of input.cases) {
    validateEditableCaseSchemaCompatibility(input.current.datasetType, input.current.schema, item);
  }

  return {
    ...input.current,
    cases: input.cases,
    updatedAt: ensureLaterTimestamp(input.current.updatedAt, input.timestamp),
  };
};

export interface CreateDatasetCaseDefinitionInput {
  current: Dataset<EditableDatasetCase>;
  item: EditableDatasetCase;
  timestamp: string;
}

export const createDatasetCaseDefinition = (
  input: CreateDatasetCaseDefinitionInput,
): Dataset<EditableDatasetCase> => {
  validateEditableDatasetCase(input.current.datasetType, input.item);
  validateEditableCaseSchemaCompatibility(input.current.datasetType, input.current.schema, input.item);

  if (input.current.cases.some((item) => item.caseId === input.item.caseId)) {
    throw new Error(`Duplicate dataset caseId: ${input.item.caseId}`);
  }

  return {
    ...input.current,
    cases: [...input.current.cases, input.item],
    updatedAt: ensureLaterTimestamp(input.current.updatedAt, input.timestamp),
  };
};

export interface UpdateDatasetCaseDefinitionInput {
  current: Dataset<EditableDatasetCase>;
  item: EditableDatasetCase;
  timestamp: string;
}

export const updateDatasetCaseDefinition = (
  input: UpdateDatasetCaseDefinitionInput,
): Dataset<EditableDatasetCase> => {
  validateEditableDatasetCase(input.current.datasetType, input.item);
  validateEditableCaseSchemaCompatibility(input.current.datasetType, input.current.schema, input.item);

  const index = input.current.cases.findIndex((item) => item.caseId === input.item.caseId);
  if (index === -1) {
    throw new Error(`Missing dataset case: ${input.item.caseId}`);
  }

  const cases = [...input.current.cases];
  cases[index] = input.item;

  return {
    ...input.current,
    cases,
    updatedAt: ensureLaterTimestamp(input.current.updatedAt, input.timestamp),
  };
};

export interface DeleteDatasetCaseDefinitionInput {
  current: Dataset<EditableDatasetCase>;
  caseId: string;
  timestamp: string;
}

export const deleteDatasetCaseDefinition = (
  input: DeleteDatasetCaseDefinitionInput,
): Dataset<EditableDatasetCase> => {
  const cases = input.current.cases.filter((item) => item.caseId !== input.caseId);

  if (cases.length === input.current.cases.length) {
    throw new Error(`Missing dataset case: ${input.caseId}`);
  }

  return {
    ...input.current,
    cases,
    updatedAt: ensureLaterTimestamp(input.current.updatedAt, input.timestamp),
  };
};
