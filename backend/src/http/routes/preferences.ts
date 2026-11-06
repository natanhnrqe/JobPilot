import { Router } from "express";
import { parse } from "../middleware/http.js";
import { preferencesSchema } from "../schemas.js";
import { getSearchPreferences, setSearchPreferences } from "../../repositories/preferences.js";
import type { ServiceContext } from "../../services/context.js";

/**
 * Preferências de busca (migração 004). Aplicadas na próxima coleta —
 * não alteram vagas já cadastradas.
 */
export function preferencesRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/preferences
  router.get("/", (_req, res) => {
    res.json(getSearchPreferences(ctx.holder.get()));
  });

  // PUT /api/v1/preferences — atualização parcial (campos ausentes são mantidos)
  router.put("/", (req, res) => {
    const input = parse(preferencesSchema, req.body ?? {});
    res.json(setSearchPreferences(ctx.holder.get(), input));
  });

  return router;
}
