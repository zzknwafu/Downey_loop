import type { ExperimentFieldMappingRecord } from "../shared/contracts.js";

export interface GeminiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface GeminiTextCallInput {
  systemPrompt: string;
  userPrompt: string;
  modelParams?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface GeminiTextCallResult {
  outputText: string;
  responseId: string | null;
  usage: {
    prompt_tokens: number | null;
    candidates_tokens: number | null;
    total_tokens: number | null;
  };
  debugInfo: Record<string, unknown>;
}

const FIXED_MODEL = "gemini-2.5-flash";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  return JSON.stringify(value);
};

const readPath = (source: Record<string, unknown>, path: string): unknown => {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== "object") {
      return undefined;
    }

    return Reflect.get(current as object, segment);
  }, source);
};

export const renderPromptTemplate = (
  template: string,
  source: Record<string, unknown>,
): string =>
  template.replace(/{{\s*([^}]+)\s*}}/g, (_match, token: string) => {
    const key = String(token).trim();
    const value = readPath(source, key);
    return toStringValue(value);
  });

export const resolvePromptVariables = (
  source: Record<string, unknown>,
  mappings: ExperimentFieldMappingRecord[],
): Record<string, string> => {
  const resolved: Record<string, string> = {};

  for (const mapping of mappings) {
    resolved[mapping.target_field] = toStringValue(readPath(source, mapping.source_field));
  }

  return resolved;
};

export const callGeminiText = async (
  config: GeminiConfig,
  input: GeminiTextCallInput,
): Promise<GeminiTextCallResult> => {
  const model = config.model || FIXED_MODEL;
  const requestBody = {
    systemInstruction: input.systemPrompt
      ? {
          parts: [{ text: input.systemPrompt }],
        }
      : undefined,
    contents: [
      {
        role: "user",
        parts: [{ text: input.userPrompt }],
      },
    ],
    generationConfig: normalizeGenerationParams(input.modelParams),
  } as Record<string, unknown>;

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${trimTrailingSlash(config.baseUrl)}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      },
    );

    const rawText = await response.text();
    const parsed = rawText.length > 0 ? (JSON.parse(rawText) as Record<string, unknown>) : {};

    if (!response.ok) {
      const errorMessage =
        extractGeminiErrorMessage(parsed) ?? `Gemini request failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    const outputText = extractOutputText(parsed);
    if (!outputText) {
      throw new Error("Gemini response did not include output text");
    }

    return {
      outputText,
      responseId: typeof parsed.id === "string" ? parsed.id : null,
      usage: {
        prompt_tokens: readNumber(parsed, ["usageMetadata", "promptTokenCount"]),
        candidates_tokens: readNumber(parsed, ["usageMetadata", "candidatesTokenCount"]),
        total_tokens: readNumber(parsed, ["usageMetadata", "totalTokenCount"]),
      },
      debugInfo: {
        model,
        response_id: typeof parsed.id === "string" ? parsed.id : null,
        usage: parsed.usageMetadata ?? null,
      },
    };
  } finally {
    clearTimeout(timer);
  }
};

const normalizeGenerationParams = (modelParams?: Record<string, unknown>) => {
  if (!modelParams) {
    return {};
  }

  const result: Record<string, unknown> = {};
  const temperature = modelParams.temperature;
  if (typeof temperature === "number") {
    result.temperature = temperature;
  }

  const topP = modelParams.topP ?? modelParams.top_p;
  if (typeof topP === "number") {
    result.topP = topP;
  }

  const maxOutputTokens = modelParams.maxOutputTokens ?? modelParams.max_output_tokens ?? modelParams.maxTokens;
  if (typeof maxOutputTokens === "number") {
    result.maxOutputTokens = maxOutputTokens;
  }

  const candidateCount = modelParams.candidateCount;
  if (typeof candidateCount === "number") {
    result.candidateCount = candidateCount;
  }

  const presencePenalty = modelParams.presencePenalty ?? modelParams.presence_penalty;
  if (typeof presencePenalty === "number") {
    result.presencePenalty = presencePenalty;
  }

  const frequencyPenalty = modelParams.frequencyPenalty ?? modelParams.frequency_penalty;
  if (typeof frequencyPenalty === "number") {
    result.frequencyPenalty = frequencyPenalty;
  }

  const seed = modelParams.seed;
  if (typeof seed === "number") {
    result.seed = seed;
  }

  const stopSequences = modelParams.stopSequences;
  if (Array.isArray(stopSequences) && stopSequences.every((item) => typeof item === "string")) {
    result.stopSequences = stopSequences;
  }

  for (const [key, value] of Object.entries(modelParams)) {
    if (
      value !== undefined &&
      key !== "model" &&
      key !== "temperature" &&
      key !== "topP" &&
      key !== "top_p" &&
      key !== "maxOutputTokens" &&
      key !== "max_output_tokens" &&
      key !== "maxTokens" &&
      key !== "timeoutMs" &&
      key !== "candidateCount" &&
      key !== "presencePenalty" &&
      key !== "presence_penalty" &&
      key !== "frequencyPenalty" &&
      key !== "frequency_penalty" &&
      key !== "seed" &&
      key !== "stopSequences"
    ) {
      result[key] = value;
    }
  }

  return result;
};

const extractGeminiErrorMessage = (response: Record<string, unknown>): string | null => {
  const error = response.error;
  if (error && typeof error === "object") {
    const message = Reflect.get(error as object, "message");
    if (typeof message === "string") {
      return message;
    }
  }

  const message = response.message;
  return typeof message === "string" ? message : null;
};

const extractOutputText = (response: Record<string, unknown>): string => {
  const candidates = response.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "";
  }

  const chunks: string[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = Reflect.get(item as object, "content");
    if (!content || typeof content !== "object") {
      continue;
    }

    const parts = Reflect.get(content as object, "parts");
    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const text = Reflect.get(part as object, "text");
      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }

  return chunks.join("");
};

const readNumber = (response: Record<string, unknown>, path: [string, string]): number | null => {
  const parent = response[path[0]];
  if (!parent || typeof parent !== "object") {
    return null;
  }

  const value = Reflect.get(parent as object, path[1]);
  return typeof value === "number" ? value : null;
};

export type LlmConfig = GeminiConfig;
export type LlmTextCallInput = GeminiTextCallInput;
export type LlmTextCallResult = GeminiTextCallResult;
export const callLlmText = callGeminiText;

// Deprecated compatibility aliases. Keep temporarily so concurrent branches do not break.
export type OpenAIConfig = GeminiConfig;
export type OpenAITextCallInput = GeminiTextCallInput;
export type OpenAITextCallResult = GeminiTextCallResult;
export const callOpenAIText = callGeminiText;
