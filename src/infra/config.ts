import { resolve } from "node:path";

export interface AppConfig {
  dataDir: string;
  storeFile: string;
  geminiApiKey?: string;
  geminiBaseUrl: string;
  geminiModel: string;
}

export const loadAppConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const dataDir = resolve(env.DATA_DIR ?? "data");

  return {
    dataDir,
    storeFile: resolve(dataDir, env.STORE_FILE ?? "downey-evals-store.json"),
    geminiApiKey: env.GEMINI_API_KEY ?? env.OPENAI_API_KEY,
    geminiBaseUrl: env.GEMINI_BASE_URL ?? env.OPENAI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta",
    geminiModel: "gemini-2.5-flash",
  };
};
