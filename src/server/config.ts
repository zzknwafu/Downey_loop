import fs from "node:fs";
import path from "node:path";

export interface AppConfig {
  appName: string;
  host: string;
  port: number;
  nodeEnv: string;
  appBaseUrl: string;
  geminiApiKey?: string;
  geminiBaseUrl: string;
  geminiModel: string;
  dataDir: string;
  sqlitePath: string;
  stateFilePath: string;
  storeFilePath: string;
}

const parseEnvFile = (filePath: string): Record<string, string> => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const entries: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = value.replace(/^"(.*)"$/, "$1");
  }

  return entries;
};

const readEnv = (rootDir: string) => {
  const fileValues = parseEnvFile(path.join(rootDir, ".env"));
  return (key: string, fallback: string) => process.env[key] ?? fileValues[key] ?? fallback;
};

export const loadConfig = (rootDir = process.cwd()): AppConfig => {
  const env = readEnv(rootDir);
  const host = env("HOST", "0.0.0.0");
  const port = Number(env("PORT", "3000"));
  const dataDir = path.resolve(rootDir, env("DATA_DIR", "./data"));
  const sqlitePath = path.resolve(rootDir, env("SQLITE_PATH", "./data/downey-evals-loop.sqlite"));
  const storeFilePath = path.resolve(dataDir, env("STORE_FILE", "downey-evals-store.json"));

  return {
    appName: env("APP_NAME", "Downey Evals Loop"),
    host,
    port,
    nodeEnv: env("NODE_ENV", "development"),
    appBaseUrl: env("APP_BASE_URL", `http://${host}:${port}`),
    geminiApiKey: env("GEMINI_API_KEY", env("OPENAI_API_KEY", "")),
    geminiBaseUrl: env(
      "GEMINI_BASE_URL",
      env("OPENAI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"),
    ),
    geminiModel: "gemini-2.5-flash",
    dataDir,
    sqlitePath,
    stateFilePath: path.join(dataDir, "app-state.json"),
    storeFilePath,
  };
};
