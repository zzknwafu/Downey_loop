import { resolve } from "node:path";

export interface AppConfig {
  dataDir: string;
  storeFile: string;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  openAiModel: string;
}

export const loadAppConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const dataDir = resolve(env.DATA_DIR ?? "data");

  return {
    dataDir,
    storeFile: resolve(dataDir, env.STORE_FILE ?? "downey-evals-store.json"),
    openAiApiKey: env.OPENAI_API_KEY,
    openAiBaseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openAiModel: env.OPENAI_MODEL ?? "gpt-4.1-mini",
  };
};
