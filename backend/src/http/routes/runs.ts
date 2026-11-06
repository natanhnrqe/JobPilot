import { Router } from "express";
import { z } from "zod";
import { parse } from "../middleware/http.js";
import { getExecution, listExecutions, listSourceInfos } from "../../services/executions.js";
import type { ServiceContext } from "../../services/context.js";

const runsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const runParams = z.object({
  id: z.coerce.number().int().min(1),
});

export function runsRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/runs — histórico de execuções + resumo de data/last-run.json
  router.get("/", (req, res) => {
    const { limit } = parse(runsQuery, req.query);
    res.json(listExecutions(ctx, limit));
  });

  // GET /api/v1/runs/:id — uma execução com o passo a passo (execution_logs)
  router.get("/:id", (req, res) => {
    const { id } = parse(runParams, req.params);
    res.json(getExecution(ctx, id));
  });

  return router;
}

export function sourcesRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/sources — fontes registradas e estado de suporte
  router.get("/", (_req, res) => {
    res.json({ items: listSourceInfos(ctx) });
  });

  return router;
}
