import { z } from "zod";
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
});

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
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
  /** Presente somente quando AI_API_KEY está configurada. */
  ai: AiConfig | null;
}

/**
 * Carrega e valida a configuração. A aplicação funciona sem `.env`
 * (todos os valores têm padrão; ver docs/ESPECIFICACAO-TECNICA.md §10.3).
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  opts: { backendDir?: string } = {},
): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "env"}: ${i.message}`)
      .join("; ");
    throw new Error(`Configuração inválida (${issues}). Verifique o arquivo .env.`);
  }
  const e = parsed.data;

  // src/config/index.ts → backend/src → backend
  const backendDir =
    opts.backendDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const rootDir = path.resolve(backendDir, "..");

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
    ai: e.AI_API_KEY
      ? {
          apiKey: e.AI_API_KEY,
          baseUrl: e.AI_BASE_URL,
          model: e.AI_MODEL,
          timeoutMs: e.AI_TIMEOUT_MS,
        }
      : null,
  };
}
