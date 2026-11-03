import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

const SECRET_KEY_PATTERN = /(password|token|apikey|api_key|authorization|secret)/i;
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Remove valores sensíveis de objetos antes de serializar. */
export function redact(meta: unknown): unknown {
  if (meta === null || typeof meta !== "object") return meta;
  if (Array.isArray(meta)) return meta.map(redact);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(value);
  }
  return out;
}

/**
 * Logger próprio do Marco 1 (sem dependências externas):
 * escreve no console e em data/logs/app-YYYY-MM-DD.log (JSON Lines).
 */
export function createLogger(
  options: {
    logDir?: string;
    minLevel?: LogLevel;
    toConsole?: boolean;
  } = {},
): Logger {
  const min = LEVELS[options.minLevel ?? "info"];
  const toConsole = options.toConsole ?? true;

  function write(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVELS[level] < min) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      ...(meta !== undefined ? { meta: redact(meta) } : {}),
    });

    if (toConsole) {
      if (level === "error") console.error(line);
      else console.log(line);
    }
    if (options.logDir) {
      try {
        const file = path.join(options.logDir, `app-${new Date().toISOString().slice(0, 10)}.log`);
        fs.mkdirSync(options.logDir, { recursive: true });
        fs.appendFileSync(file, line + "\n", "utf8");
      } catch {
        // Falha de escrita de log nunca deve derrubar a aplicação.
      }
    }
  }

  return {
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
  };
}

/** Apaga arquivos de log com mais de `retentionDays` dias (chamado na inicialização). */
export function pruneOldLogs(logDir: string, retentionDays = 30): void {
  if (!fs.existsSync(logDir)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(logDir)) {
    const full = path.join(logDir, file);
    try {
      if (fs.statSync(full).isFile() && fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    } catch {
      // ignora
    }
  }
}
