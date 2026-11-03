import { Router } from "express";
import { getDashboard } from "../../services/dashboard.js";
import type { ServiceContext } from "../../services/context.js";

export function dashboardRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/dashboard — contadores reais do banco + atividade recente
  router.get("/", (_req, res) => {
    res.json(getDashboard(ctx, 10));
  });

  return router;
}
