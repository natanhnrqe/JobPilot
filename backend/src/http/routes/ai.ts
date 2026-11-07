import { Router } from "express";
import { getAiUsage } from "../../services/aiUsage.js";
import type { ServiceContext } from "../../services/context.js";

/**
 * Uso e orçamento diário de IA (Fase 3, tarefa 3.4).
 *
 * Somente leitura: o consumo é gravado pelas chamadas reais (extração, CV e
 * análise). A UI usa este endpoint para exibir o uso do dia e avisar quando o
 * teto `AI_DAILY_BUDGET` foi atingido.
 */
export function aiRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/ai/usage — tokens usados hoje, teto e detalhamento por tipo
  router.get("/usage", (_req, res) => {
    res.json(getAiUsage(ctx));
  });

  return router;
}
