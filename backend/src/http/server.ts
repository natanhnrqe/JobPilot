import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/index.js";
import { DbHolder } from "../db/holder.js";
import type { Logger } from "../logging/logger.js";
import { createAiProvider, type AiProvider } from "../ai/provider.js";
import { errorEnvelope, requestLogger } from "./middleware/http.js";
import { jobsRouter, activityRouter } from "./routes/jobs.js";
import { applicationsRouter, notesRouter } from "./routes/applications.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { extractionsRouter } from "./routes/extractions.js";
import { runsRouter, sourcesRouter } from "./routes/runs.js";
import { preferencesRouter } from "./routes/preferences.js";
import { profileRouter } from "./routes/profile.js";
import { aiRouter } from "./routes/ai.js";
import { exportsRouter } from "./routes/exports.js";
import { systemRouter } from "./routes/system.js";
import type { ServiceContext } from "../services/context.js";

export interface AppServer {
  app: Express;
  ctx: ServiceContext;
  logger: Logger;
  close(): void;
}

/**
 * Fábrica do servidor. Testes criam instâncias com banco em diretório temporário
 * e podem injetar um provedor de IA falso (offline); o processo real usa
 * loadConfig() + createLogger() e cria o provedor real quando há AI_API_KEY.
 */
export function createServer(
  config: AppConfig,
  logger: Logger,
  opts: { aiProvider?: AiProvider } = {},
): AppServer {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.backupsDir, { recursive: true });
  fs.mkdirSync(config.logsDir, { recursive: true });

  const holder = new DbHolder(config, logger);
  const ai = opts.aiProvider ?? (config.ai ? createAiProvider(config.ai) : null);
  const ctx: ServiceContext = { config, holder, ai };

  const app = express();
  app.disable("x-powered-by");
  // 10 MB: o upload do CV vai em base64 no JSON (limite real do arquivo: 5 MB).
  app.use(express.json({ limit: "10mb" }));
  app.use(requestLogger(logger));

  // API — apenas localhost (Seção 4: auth local simples por bind 127.0.0.1).
  const api = express.Router();
  api.use("/dashboard", dashboardRouter(ctx));
  api.use("/jobs", jobsRouter(ctx));
  api.use("/applications", applicationsRouter(ctx));
  api.use("/notes", notesRouter(ctx));
  api.use("/activity", activityRouter(ctx));
  api.use("/extractions", extractionsRouter(ctx));
  api.use("/runs", runsRouter(ctx));
  api.use("/sources", sourcesRouter(ctx));
  api.use("/preferences", preferencesRouter(ctx));
  api.use("/profile", profileRouter(ctx));
  api.use("/ai", aiRouter(ctx));
  api.use("/exports", exportsRouter(ctx));
  api.use("/", systemRouter(ctx));
  app.use("/api/v1", api);

  // Rotas /api não mapeadas → 404 com envelope (nunca HTML).
  app.use("/api", (_req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Rota não encontrada.", details: {} },
    });
  });

  // Frontend compilado (produção): backend serve a UI compilada.
  const frontendDist = path.join(config.rootDir, "frontend", "dist");
  const indexHtml = path.join(frontendDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(frontendDist));
    // Fallback SPA (compatível com Express 4 e 5): qualquer GET fora de /api
    // que não casou com um arquivo estático recebe o index.html.
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) {
        res.sendFile(indexHtml);
        return;
      }
      next();
    });
  }

  app.use(errorEnvelope);

  return {
    app,
    ctx,
    logger,
    close(): void {
      holder.close();
    },
  };
}
