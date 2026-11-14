import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_PATH: z.string().optional(),
  DATA_DIR: z.string().optional(),
  NODE_ENV: z.string().optional(),
  // Integração com IA (opcional — sem chave, o restante funciona normalmente).
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
  // Teto diário em tokens (entrada + saída). 0 = sem limite.
  AI_DAILY_BUDGET: z.coerce.number().int().min(0).default(0),
  // Integração com o RapidAPI (opcional — sem chave, a fonte JSearch fica desligada).
  RAPIDAPI_KEY: z.string().optional(),
  RAPIDAPI_HOST: z.string().default("jsearch.p.rapidapi.com"),
});

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

/** RapidAPI (JSearch). A chave fica só no `.env` local e nunca é registrada. */
export interface RapidApiConfig {
  key: string;
  host: string;
}

export interface AppConfig {
  port: number;
  host: string;
  /** Diretório do pacote backend (raiz do código do servidor). */
  backendDir: string;
  /** Raiz do repositório (pai de backend/). */
  rootDir: string;
  dataDir: string;
  databasePath: string;
  backupsDir: string;
  logsDir: string;
  isProd: boolean;
  /** Teto diário de tokens de IA (0 = sem limite). Vale para todas as chamadas. */
  aiDailyBudget: number;
  /** Presente somente quando AI_API_KEY está configurada. */
  ai: AiConfig | null;
  /** Presente somente quando RAPIDAPI_KEY está configurada. */
  rapidapi: RapidApiConfig | null;
}

/**
 * Lê um arquivo `.env` simples (KEY=VALUE, `#` para comentários, aspas
 * opcionais) sem dependências externas. Variáveis já presentes no ambiente
 * têm precedência sobre o arquivo.
 */
function readDotEnv(filePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const values: Record<string, string> = {};
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      const quoted =
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")));
      if (quoted) value = value.slice(1, -1);
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

/**
 * Carrega e valida a configuração. A aplicação funciona sem `.env`
 * (todos os valores têm padrão; ver docs/ESPECIFICACAO-TECNICA.md §10.3).
 *
 * Quando nenhum `env` é informado (processo real), o arquivo `.env` da raiz
 * do repositório é lido; `process.env` tem precedência sobre ele. Os testes
 * passam `env` explícito e, de propósito, ignoram o `.env` do desenvolvedor.
 */
export function loadConfig(
  env?: Record<string, string | undefined>,
  opts: { backendDir?: string } = {},
): AppConfig {
  // src/config/index.ts → backend/src → backend
  const backendDir =
    opts.backendDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const rootDir = path.resolve(backendDir, "..");

  const source: Record<string, string | undefined> = env ?? {
    ...readDotEnv(path.join(rootDir, ".env")),
    ...process.env,
  };

  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "env"}: ${i.message}`)
      .join("; ");
    throw new Error(`Configuração inválida (${issues}). Verifique o arquivo .env.`);
  }
  const e = parsed.data;

  const dataDir = e.DATA_DIR ? path.resolve(e.DATA_DIR) : path.join(rootDir, "data");
  const databasePath = e.DATABASE_PATH
    ? path.resolve(e.DATABASE_PATH)
    : path.join(dataDir, "jobpilot.sqlite");

  return {
    port: e.PORT,
    host: e.HOST,
    backendDir,
    rootDir,
    dataDir,
    databasePath,
    backupsDir: path.join(dataDir, "backups"),
    logsDir: path.join(dataDir, "logs"),
    isProd: e.NODE_ENV === "production",
    aiDailyBudget: e.AI_DAILY_BUDGET,
    ai: e.AI_API_KEY
      ? {
          apiKey: e.AI_API_KEY,
          baseUrl: e.AI_BASE_URL,
          model: e.AI_MODEL,
          timeoutMs: e.AI_TIMEOUT_MS,
        }
      : null,
    rapidapi: e.RAPIDAPI_KEY ? { key: e.RAPIDAPI_KEY, host: e.RAPIDAPI_HOST } : null,
  };
}
