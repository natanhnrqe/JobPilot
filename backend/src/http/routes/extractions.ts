import { Router } from "express";
import { z } from "zod";
import { parse } from "../middleware/http.js";
import { extractJobFromText, extractJobFromUrl } from "../../services/extraction.js";
import type { ServiceContext } from "../../services/context.js";

const fromTextSchema = z.object({
  text: z
    .string()
    .trim()
    .min(30, "Cole ao menos o texto da vaga (mínimo 30 caracteres).")
    .max(100000),
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === "" ? undefined : v))
    .refine((v) => v === undefined || /^https?:\/\//i.test(v), {
      message: "A URL deve começar com http:// ou https://",
    })
    .optional(),
});

const fromUrlSchema = z.object({
  url: z.string().trim().min(1, "Informe a URL da vaga.").max(2000),
});

export function extractionsRouter(ctx: ServiceContext): Router {
  const router = Router();

  // GET /api/v1/extractions/status — indica se a IA está configurada
  router.get("/status", (_req, res) => {
    res.json({
      enabled: ctx.ai !== null,
      model: ctx.ai?.model ?? null,
      provider: ctx.ai?.name ?? null,
      dailyBudgetTokens: ctx.config.aiDailyBudget,
    });
  });

  // POST /api/v1/extractions/from-text — extrai rascunho de texto colado (NÃO persiste)
  router.post("/from-text", async (req, res, next) => {
    try {
      const input = parse(fromTextSchema, req.body ?? {});
      const result = await extractJobFromText(ctx, input);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/extractions/from-url — busca a página (com proteções) e extrai (NÃO persiste)
  router.post("/from-url", async (req, res, next) => {
    try {
      const input = parse(fromUrlSchema, req.body ?? {});
      const result = await extractJobFromUrl(ctx, input);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
